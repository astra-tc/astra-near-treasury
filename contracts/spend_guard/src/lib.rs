//! spend_guard — on-chain spend policy for an agent-run treasury.
//!
//! Enforces Board rules as code:
//! - amount ≤ balance − reserve
//! - daily spend cap
//! - receiver allow-list
//! - nonce / replay guard
//! - owner-only policy changes
//!
//! Intentionally has NO borrow / loan / leverage methods.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupSet, UnorderedSet};
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseResult,
};

/// One yoctoNEAR = 1 base unit; we track balances as u128 yocto.
type Yocto = u128;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    AllowList,
    UsedNonces,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Policy {
    /// Minimum yocto that must remain after a spend.
    pub reserve: Yocto,
    /// Maximum yocto that may be spent in a single UTC day.
    pub daily_cap: Yocto,
}

/// JSON view of [`Policy`] with string-encoded amounts.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct PolicyView {
    pub reserve: U128,
    pub daily_cap: U128,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub struct PendingSpend {
    pub receiver: AccountId,
    pub amount: Yocto,
    pub nonce: u64,
    pub proposer: AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct DecisionEvent<'a> {
    event: &'a str,
    /// NEP-297 standard version.
    standard: &'a str,
    version: &'a str,
    data: DecisionData<'a>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct DecisionData<'a> {
    approved: bool,
    reason: &'a str,
    amount: U128,
    receiver: &'a str,
    nonce: u64,
    proposer: &'a str,
}

const EVENT_STANDARD: &str = "astra_spend_guard";
const EVENT_VERSION: &str = "1.0.0";

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SpendGuard {
    owner: AccountId,
    policy: Policy,
    /// Simulated treasury balance (sandbox / unit-test friendly).
    /// On a real deploy this would track attached deposits / withdrawals.
    balance: Yocto,
    /// Yocto spent since `day_start_ts` (UTC day bucket).
    spent_today: Yocto,
    /// Unix seconds at the start of the current UTC day bucket.
    day_start_ts: u64,
    allow_list: UnorderedSet<AccountId>,
    used_nonces: LookupSet<u64>,
    pending: Option<PendingSpend>,
}

#[near]
impl SpendGuard {
    #[init]
    pub fn new(owner: AccountId, reserve: U128, daily_cap: U128, initial_balance: U128) -> Self {
        require!(
            daily_cap.0 > 0,
            "daily_cap must be > 0"
        );
        Self {
            owner,
            policy: Policy {
                reserve: reserve.0,
                daily_cap: daily_cap.0,
            },
            balance: initial_balance.0,
            spent_today: 0,
            day_start_ts: Self::utc_day_start(env::block_timestamp_ms() / 1000),
            allow_list: UnorderedSet::new(StorageKey::AllowList),
            used_nonces: LookupSet::new(StorageKey::UsedNonces),
            pending: None,
        }
    }

    /// Owner-only: replace reserve, daily cap, and the full allow-list.
    pub fn set_policy(
        &mut self,
        reserve: U128,
        daily_cap: U128,
        allow_list: Vec<AccountId>,
    ) {
        self.assert_owner();
        require!(daily_cap.0 > 0, "daily_cap must be > 0");
        self.policy.reserve = reserve.0;
        self.policy.daily_cap = daily_cap.0;
        self.allow_list.clear();
        for acct in allow_list {
            self.allow_list.insert(&acct);
        }
        self.emit_decision(
            true,
            "policy_updated",
            0,
            env::predecessor_account_id().as_str(),
            0,
            env::predecessor_account_id().as_str(),
        );
    }

    /// Agent-callable: propose a spend. Stores it as pending; does not transfer.
    pub fn propose_spend(&mut self, receiver: AccountId, amount: U128, nonce: u64) {
        require!(amount.0 > 0, "amount must be > 0");
        require!(
            !self.used_nonces.contains(&nonce),
            "nonce already used (replay)"
        );
        require!(
            self.pending.is_none(),
            "a spend is already pending; execute or clear it first"
        );

        let reason = self.check_spend(&receiver, amount.0);
        if let Some(why) = reason {
            self.emit_decision(
                false,
                &why,
                amount.0,
                receiver.as_str(),
                nonce,
                env::predecessor_account_id().as_str(),
            );
            env::panic_str(&format!("spend rejected: {why}"));
        }

        self.pending = Some(PendingSpend {
            receiver: receiver.clone(),
            amount: amount.0,
            nonce,
            proposer: env::predecessor_account_id(),
        });
        self.emit_decision(
            true,
            "proposed",
            amount.0,
            receiver.as_str(),
            nonce,
            env::predecessor_account_id().as_str(),
        );
    }

    /// Agent-callable: execute the pending spend after re-checking policy.
    ///
    /// Deducts the spend from the tracked budget, marks the nonce used, then
    /// sends a real NEAR transfer of `amount` yocto to the receiver. If the
    /// transfer fails (e.g. the contract account lacks liquid NEAR), the
    /// `on_transfer_complete` callback restores the budget and daily bucket.
    /// The nonce stays burned either way, so a failed spend cannot be replayed.
    pub fn execute_spend(&mut self) -> Promise {
        let pending = self
            .pending
            .take()
            .unwrap_or_else(|| env::panic_str("no pending spend"));

        require!(
            !self.used_nonces.contains(&pending.nonce),
            "nonce already used (replay)"
        );

        if let Some(why) = self.check_spend(&pending.receiver, pending.amount) {
            // Put it back so the caller can see state; then reject.
            self.pending = Some(pending.clone());
            self.emit_decision(
                false,
                &why,
                pending.amount,
                pending.receiver.as_str(),
                pending.nonce,
                pending.proposer.as_str(),
            );
            env::panic_str(&format!("spend rejected: {why}"));
        }

        self.roll_day_if_needed();
        self.balance = self
            .balance
            .checked_sub(pending.amount)
            .unwrap_or_else(|| env::panic_str("balance underflow"));
        self.spent_today = self
            .spent_today
            .checked_add(pending.amount)
            .unwrap_or_else(|| env::panic_str("spent_today overflow"));
        self.used_nonces.insert(&pending.nonce);
        // pending already taken (cleared)

        self.emit_decision(
            true,
            "executed",
            pending.amount,
            pending.receiver.as_str(),
            pending.nonce,
            pending.proposer.as_str(),
        );

        Promise::new(pending.receiver.clone())
            .transfer(NearToken::from_yoctonear(pending.amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(10))
                    .on_transfer_complete(
                        pending.receiver,
                        U128(pending.amount),
                        pending.nonce,
                        pending.proposer,
                    ),
            )
    }

    /// Callback after the transfer in `execute_spend`. Contract-only.
    #[private]
    pub fn on_transfer_complete(
        &mut self,
        receiver: AccountId,
        amount: U128,
        nonce: u64,
        proposer: AccountId,
    ) -> bool {
        let ok = matches!(env::promise_result(0), PromiseResult::Successful(_));
        if ok {
            self.emit_decision(true, "transferred", amount.0, receiver.as_str(), nonce, proposer.as_str());
        } else {
            // Undo the budget deduction; keep the nonce burned.
            self.balance = self.balance.saturating_add(amount.0);
            self.spent_today = self.spent_today.saturating_sub(amount.0);
            self.emit_decision(false, "transfer_failed_refunded", amount.0, receiver.as_str(), nonce, proposer.as_str());
        }
        ok
    }

    /// Clear a pending proposal without executing (proposer or owner).
    pub fn clear_pending(&mut self) {
        let pending = self
            .pending
            .as_ref()
            .unwrap_or_else(|| env::panic_str("no pending spend"));
        let caller = env::predecessor_account_id();
        require!(
            caller == pending.proposer || caller == self.owner,
            "only proposer or owner may clear"
        );
        let p = self.pending.take().unwrap();
        self.emit_decision(
            false,
            "cleared",
            p.amount,
            p.receiver.as_str(),
            p.nonce,
            caller.as_str(),
        );
    }

    /// Test / demo helper: credit the tracked treasury balance (owner only).
    pub fn credit(&mut self, amount: U128) {
        self.assert_owner();
        require!(amount.0 > 0, "amount must be > 0");
        self.balance = self
            .balance
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str("balance overflow"));
    }

    // ── views ──────────────────────────────────────────────────────────

    /// Policy as JSON strings (U128) so yocto amounts above 2^53 survive JS clients.
    pub fn get_policy(&self) -> PolicyView {
        PolicyView {
            reserve: U128(self.policy.reserve),
            daily_cap: U128(self.policy.daily_cap),
        }
    }

    pub fn get_balance(&self) -> U128 {
        U128(self.balance)
    }

    pub fn get_spent_today(&self) -> U128 {
        U128(self.spent_today)
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn is_allowed(&self, account: AccountId) -> bool {
        self.allow_list.contains(&account)
    }

    pub fn get_pending(&self) -> Option<(AccountId, U128, u64, AccountId)> {
        self.pending.as_ref().map(|p| {
            (
                p.receiver.clone(),
                U128(p.amount),
                p.nonce,
                p.proposer.clone(),
            )
        })
    }

    pub fn nonce_used(&self, nonce: u64) -> bool {
        self.used_nonces.contains(&nonce)
    }
}

impl SpendGuard {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "owner only"
        );
    }

    fn utc_day_start(ts_secs: u64) -> u64 {
        ts_secs - (ts_secs % 86_400)
    }

    fn roll_day_if_needed(&mut self) {
        let now = env::block_timestamp_ms() / 1000;
        let start = Self::utc_day_start(now);
        if start > self.day_start_ts {
            self.day_start_ts = start;
            self.spent_today = 0;
        }
    }

    /// Returns None if ok, Some(reason) if rejected.
    fn check_spend(&mut self, receiver: &AccountId, amount: Yocto) -> Option<String> {
        self.roll_day_if_needed();

        if !self.allow_list.contains(receiver) {
            return Some("receiver not on allow-list".to_string());
        }
        if amount > self.policy.daily_cap {
            return Some("amount exceeds daily_cap".to_string());
        }
        if self
            .spent_today
            .checked_add(amount)
            .map(|v| v > self.policy.daily_cap)
            .unwrap_or(true)
        {
            return Some("would exceed daily_cap".to_string());
        }
        let available = self.balance.saturating_sub(self.policy.reserve);
        if amount > available {
            return Some("amount exceeds balance minus reserve".to_string());
        }
        None
    }

    /// NEP-297 style JSON event log.
    fn emit_decision(
        &self,
        approved: bool,
        reason: &str,
        amount: Yocto,
        receiver: &str,
        nonce: u64,
        proposer: &str,
    ) {
        let payload = DecisionEvent {
            event: "spend_decision",
            standard: EVENT_STANDARD,
            version: EVENT_VERSION,
            data: DecisionData {
                approved,
                reason,
                amount: U128(amount),
                receiver,
                nonce,
                proposer,
            },
        };
        let json = near_sdk::serde_json::to_string(&payload)
            .unwrap_or_else(|_| "{}".to_string());
        env::log_str(&format!("EVENT_JSON:{json}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::{testing_env, VMContext};

    fn ctx(predecessor: AccountId, ts_ms: u64) -> VMContext {
        VMContextBuilder::new()
            .predecessor_account_id(predecessor)
            .block_timestamp(ts_ms * 1_000_000) // ns
            .build()
    }

    fn owner() -> AccountId {
        accounts(0)
    }
    fn agent() -> AccountId {
        accounts(1)
    }
    fn vendor() -> AccountId {
        accounts(2)
    }
    fn stranger() -> AccountId {
        accounts(3)
    }

    fn fresh() -> SpendGuard {
        testing_env!(ctx(owner(), 1_700_000_000_000)); // ~2023-ish ms
        let mut c = SpendGuard::new(
            owner(),
            U128(100),   // reserve
            U128(500),   // daily_cap
            U128(1_000), // balance
        );
        // seed allow-list via set_policy
        c.set_policy(U128(100), U128(500), vec![vendor()]);
        c
    }

    /// Context for the contract calling its own callback.
    fn self_ctx(ts_ms: u64) -> VMContext {
        VMContextBuilder::new()
            .current_account_id(accounts(4))
            .predecessor_account_id(accounts(4))
            .block_timestamp(ts_ms * 1_000_000)
            .build()
    }

    fn callback_env(result: PromiseResult) {
        testing_env!(
            self_ctx(1_700_000_000_000),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![result]
        );
    }

    #[test]
    fn failed_transfer_refunds_budget_but_keeps_nonce_burned() {
        let mut c = fresh();
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.propose_spend(vendor(), U128(200), 1);
        let _ = c.execute_spend();
        assert_eq!(c.get_balance().0, 800);
        callback_env(PromiseResult::Failed);
        assert!(!c.on_transfer_complete(vendor(), U128(200), 1, agent()));
        assert_eq!(c.get_balance().0, 1_000);
        assert_eq!(c.get_spent_today().0, 0);
        assert!(c.nonce_used(1), "nonce must stay burned after a failed transfer");
    }

    #[test]
    fn successful_transfer_keeps_deduction() {
        let mut c = fresh();
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.propose_spend(vendor(), U128(200), 1);
        let _ = c.execute_spend();
        callback_env(PromiseResult::Successful(vec![]));
        assert!(c.on_transfer_complete(vendor(), U128(200), 1, agent()));
        assert_eq!(c.get_balance().0, 800);
        assert_eq!(c.get_spent_today().0, 200);
    }

    #[test]
    fn approved_spend_happy_path() {
        let mut c = fresh();
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.propose_spend(vendor(), U128(200), 1);
        let _ = c.execute_spend();
        assert_eq!(c.get_balance().0, 800);
        assert_eq!(c.get_spent_today().0, 200);
        assert!(c.nonce_used(1));
        assert!(c.get_pending().is_none());
    }

    #[test]
    #[should_panic(expected = "would exceed daily_cap")]
    fn daily_cap_rejects_second_spend() {
        let mut c = fresh();
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.propose_spend(vendor(), U128(400), 1);
        let _ = c.execute_spend();
        // 400 spent; another 200 would hit 600 > 500
        c.propose_spend(vendor(), U128(200), 2);
    }

    #[test]
    #[should_panic(expected = "amount exceeds daily_cap")]
    fn single_amount_over_daily_cap() {
        let mut c = fresh();
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.propose_spend(vendor(), U128(600), 1);
    }

    #[test]
    #[should_panic(expected = "amount exceeds balance minus reserve")]
    fn reserve_blocks_overspend() {
        let mut c = fresh();
        // balance 1000, reserve 100 → available 900, but daily_cap is 500
        // raise daily_cap so reserve is the binding constraint
        testing_env!(ctx(owner(), 1_700_000_000_000));
        c.set_policy(U128(100), U128(10_000), vec![vendor()]);
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.propose_spend(vendor(), U128(950), 1);
    }

    #[test]
    #[should_panic(expected = "receiver not on allow-list")]
    fn allow_list_rejects_stranger() {
        let mut c = fresh();
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.propose_spend(stranger(), U128(10), 1);
    }

    #[test]
    #[should_panic(expected = "nonce already used")]
    fn replay_nonce_rejected_on_propose() {
        let mut c = fresh();
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.propose_spend(vendor(), U128(50), 7);
        let _ = c.execute_spend();
        c.propose_spend(vendor(), U128(50), 7);
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn set_policy_owner_only() {
        let mut c = fresh();
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.set_policy(U128(1), U128(1), vec![]);
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn credit_owner_only() {
        let mut c = fresh();
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.credit(U128(1));
    }

    #[test]
    fn owner_can_update_allow_list_and_caps() {
        let mut c = fresh();
        testing_env!(ctx(owner(), 1_700_000_000_000));
        c.set_policy(U128(50), U128(300), vec![stranger()]);
        assert_eq!(c.get_policy().reserve.0, 50);
        assert_eq!(c.get_policy().daily_cap.0, 300);
        assert!(c.is_allowed(stranger()));
        assert!(!c.is_allowed(vendor()));
    }

    #[test]
    #[should_panic(expected = "amount exceeds balance minus reserve")]
    fn overspend_rejected_even_within_cap() {
        // balance 1000 reserve 100 → max 900; set tiny balance via spending
        let mut c = fresh();
        testing_env!(ctx(owner(), 1_700_000_000_000));
        c.set_policy(U128(900), U128(500), vec![vendor()]);
        // available = 1000-900 = 100
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.propose_spend(vendor(), U128(150), 1);
    }

    #[test]
    fn clear_pending_by_proposer() {
        let mut c = fresh();
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.propose_spend(vendor(), U128(10), 3);
        assert!(c.get_pending().is_some());
        c.clear_pending();
        assert!(c.get_pending().is_none());
        // nonce not consumed — can re-propose
        c.propose_spend(vendor(), U128(10), 3);
        assert!(c.get_pending().is_some());
    }

    #[test]
    fn day_roll_resets_spent_today() {
        let mut c = fresh();
        testing_env!(ctx(agent(), 1_700_000_000_000));
        c.propose_spend(vendor(), U128(400), 1);
        let _ = c.execute_spend();
        assert_eq!(c.get_spent_today().0, 400);

        // +1 day in ms
        let next_day_ms = 1_700_000_000_000 + 86_400_000;
        testing_env!(ctx(agent(), next_day_ms));
        c.propose_spend(vendor(), U128(400), 2);
        let _ = c.execute_spend();
        assert_eq!(c.get_spent_today().0, 400);
        assert_eq!(c.get_balance().0, 200);
    }
}
