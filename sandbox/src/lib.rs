//! Local `near-workspaces` sandbox harness for `contracts/spend_guard`.
//!
//! Everything here runs against an in-process local NEAR sandbox node with
//! throwaway keys. Nothing touches testnet or mainnet, and no real funds move.
//!
//! The same scenario is used by the integration tests (`tests/sandbox.rs`) and
//! by the demo runner (`src/bin/sandbox_demo.rs`), which writes the decision
//! events to JSON for the dashboard.

use anyhow::{anyhow, Context, Result};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{AccessKey, Account, Contract, Worker};
use serde_json::{json, Value};
use std::path::PathBuf;

/// Methods the agent's function-call key may call. Nothing else.
pub const AGENT_METHODS: &[&str] = &["propose_spend", "execute_spend", "clear_pending"];

/// Demo policy (yoctoNEAR units in the contract's simulated ledger).
pub const RESERVE: u128 = 100;
pub const DAILY_CAP: u128 = 100;
pub const INITIAL_BALANCE: u128 = 1_000;

/// Path to the compiled contract. Override with `SPEND_GUARD_WASM`.
pub fn wasm_path() -> PathBuf {
    if let Ok(p) = std::env::var("SPEND_GUARD_WASM") {
        return PathBuf::from(p);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("target/wasm32-unknown-unknown/release/spend_guard.wasm")
}

pub fn load_wasm() -> Result<Vec<u8>> {
    let p = wasm_path();
    std::fs::read(&p).with_context(|| {
        format!(
            "spend_guard wasm not found at {} — run `pnpm build:wasm` first",
            p.display()
        )
    })
}

/// Deployed fixture: contract + owner + agent (FC key only) + vendors.
pub struct Fixture {
    pub worker: Worker<Sandbox>,
    pub contract: Contract,
    pub owner: Account,
    /// The agent account signing with a *function-call access key* only.
    pub agent_fc: Account,
    pub vendor: Account,
    pub stranger: Account,
}

/// Boot sandbox, deploy spend_guard, set policy, give the agent an FC key.
pub async fn setup() -> Result<Fixture> {
    let wasm = load_wasm()?;
    let worker = near_workspaces::sandbox().await?;
    let contract = worker.dev_deploy(&wasm).await?;
    let owner = worker.dev_create_account().await?;
    let agent_full = worker.dev_create_account().await?;
    let vendor = worker.dev_create_account().await?;
    let stranger = worker.dev_create_account().await?;

    contract
        .call("new")
        .args_json(json!({
            "owner": owner.id(),
            "reserve": RESERVE.to_string(),
            "daily_cap": DAILY_CAP.to_string(),
            "initial_balance": INITIAL_BALANCE.to_string(),
        }))
        .transact()
        .await?
        .into_result()
        .map_err(|e| anyhow!("init failed: {e:?}"))?;

    owner
        .call(contract.id(), "set_policy")
        .args_json(json!({
            "reserve": RESERVE.to_string(),
            "daily_cap": DAILY_CAP.to_string(),
            "allow_list": [vendor.id()],
        }))
        .transact()
        .await?
        .into_result()
        .map_err(|e| anyhow!("set_policy failed: {e:?}"))?;

    // Agent gets a function-call key scoped to spend_guard's agent methods,
    // with a small gas allowance. Its full-access key is never used again.
    let fc_sk = SecretKey::from_random(KeyType::ED25519);
    agent_full
        .batch(agent_full.id())
        .add_key(
            fc_sk.public_key(),
            AccessKey::function_call_access(
                contract.id(),
                AGENT_METHODS,
                Some(NearToken::from_millinear(250)),
            ),
        )
        .transact()
        .await?
        .into_result()
        .map_err(|e| anyhow!("add FC key failed: {e:?}"))?;
    let agent_fc = Account::from_secret_key(agent_full.id().clone(), fc_sk, &worker);

    Ok(Fixture {
        worker,
        contract,
        owner,
        agent_fc,
        vendor,
        stranger,
    })
}

/// Extract `EVENT_JSON:` logs (NEP-297) from every receipt of an outcome.
pub fn events(outcome: &ExecutionFinalResult) -> Vec<Value> {
    outcome
        .logs()
        .into_iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| serde_json::from_str(j).ok())
        .collect()
}

/// Human-readable failure text for an outcome (empty if it succeeded).
pub fn failure_text(outcome: &ExecutionFinalResult) -> String {
    if outcome.is_success() {
        String::new()
    } else {
        format!("{:?}", outcome.clone().into_result().err())
    }
}

pub async fn propose(
    signer: &Account,
    contract: &Contract,
    receiver: &near_workspaces::AccountId,
    amount: u128,
    nonce: u64,
) -> Result<ExecutionFinalResult> {
    Ok(signer
        .call(contract.id(), "propose_spend")
        .args_json(json!({"receiver": receiver, "amount": amount.to_string(), "nonce": nonce}))
        .transact()
        .await?)
}

pub async fn execute(signer: &Account, contract: &Contract) -> Result<ExecutionFinalResult> {
    Ok(signer
        .call(contract.id(), "execute_spend")
        .args_json(json!({}))
        // transfer + callback (10 Tgas reserved for the callback)
        .gas(Gas::from_tgas(50))
        .transact()
        .await?)
}

pub async fn balance(contract: &Contract) -> Result<u128> {
    let v: String = contract.view("get_balance").await?.json()?;
    Ok(v.parse()?)
}

pub async fn spent_today(contract: &Contract) -> Result<u128> {
    let v: String = contract.view("get_spent_today").await?.json()?;
    Ok(v.parse()?)
}

/// One row of the demo report (also what the dashboard renders).
#[derive(Debug, Clone)]
pub struct Step {
    pub label: String,
    pub actor: String,
    pub action: String,
    pub ok: bool,
    pub detail: String,
    pub events: Vec<Value>,
}

impl Step {
    pub fn to_json(&self) -> Value {
        json!({
            "label": self.label,
            "actor": self.actor,
            "action": self.action,
            "ok": self.ok,
            "detail": self.detail,
            "events": self.events,
        })
    }
}

fn step(label: &str, actor: &str, action: &str, o: &ExecutionFinalResult) -> Step {
    let detail = if o.is_success() {
        "ok".to_string()
    } else {
        short_reason(&failure_text(o))
    };
    Step {
        label: label.into(),
        actor: actor.into(),
        action: action.into(),
        ok: o.is_success(),
        detail,
        events: events(o),
    }
}

/// Pull the human-meaningful part out of a NEAR failure debug string.
pub fn short_reason(s: &str) -> String {
    // Prefix needles: keep the text that follows up to the end of the message.
    if let Some(i) = s.find("spend rejected: ") {
        let rest = &s[i..];
        let end = rest.find(['"', '\\']).unwrap_or(rest.len());
        return rest[..end].trim().to_string();
    }
    if let Some(i) = s.find("MethodNameMismatch") {
        let rest = &s[i..];
        let end = rest.find('}').map(|e| e + 1).unwrap_or(rest.len());
        return rest[..end].replace("\\\"", "\"").trim().to_string();
    }
    // Exact needles.
    for needle in [
        "nonce already used (replay)",
        "RequiresFullAccess",
        "owner only",
        "no pending spend",
    ] {
        if s.contains(needle) {
            return needle.to_string();
        }
    }
    s.chars().take(160).collect()
}

/// Turn a transaction attempt into a Step. A transaction can be refused by the
/// node before execution (e.g. an FC key calling a method outside its scope),
/// which surfaces as `Err` rather than a failed outcome; both count as BLOCKED.
fn step_from(
    label: &str,
    actor: &str,
    action: &str,
    r: Result<ExecutionFinalResult, near_workspaces::error::Error>,
) -> Step {
    match r {
        Ok(o) => step(label, actor, action, &o),
        Err(e) => Step {
            label: label.into(),
            actor: actor.into(),
            action: action.into(),
            ok: false,
            detail: format!("refused by node: {}", short_reason(&format!("{e:?} {e}"))),
            events: vec![],
        },
    }
}

/// The full demo scenario. Returns the steps plus final views.
pub async fn run_scenario(f: &Fixture) -> Result<(Vec<Step>, Value)> {
    let mut steps = Vec::new();
    let c = &f.contract;
    let agent = &f.agent_fc;

    // 1. within policy: propose + execute 50
    let o = propose(agent, c, f.vendor.id(), 50, 1).await?;
    steps.push(step("ops-tools-within-cap", "agent (FC key)", "propose_spend 50 → vendor", &o));
    let o = execute(agent, c).await?;
    steps.push(step("ops-tools-within-cap", "agent (FC key)", "execute_spend", &o));

    // 2. over daily cap: 50 already spent, 60 more breaks cap of 100
    let o = propose(agent, c, f.vendor.id(), 60, 2).await?;
    steps.push(step("ops-tools-over-cap", "agent (FC key)", "propose_spend 60 → vendor", &o));

    // 3. receiver not on allow-list
    let o = propose(agent, c, f.stranger.id(), 10, 3).await?;
    steps.push(step("unknown-receiver", "agent (FC key)", "propose_spend 10 → stranger", &o));

    // 4. replay a used nonce
    let o = propose(agent, c, f.vendor.id(), 10, 1).await?;
    steps.push(step("replay-nonce", "agent (FC key)", "propose_spend nonce=1 again", &o));

    // 5. agent FC key tries to rewrite policy
    let r = agent
        .call(c.id(), "set_policy")
        .args_json(json!({"reserve": "0", "daily_cap": "1000000", "allow_list": [agent.id()]}))
        .transact()
        .await;
    steps.push(step_from("agent-rewrites-policy", "agent (FC key)", "set_policy (not in key scope)", r));

    // 6. agent FC key tries a raw NEAR transfer
    let r = agent
        .transfer_near(f.stranger.id(), NearToken::from_millinear(1))
        .await;
    steps.push(step_from("agent-raw-transfer", "agent (FC key)", "transfer 0.001 NEAR → stranger", r));

    // 7. stranger (not owner) tries set_policy with its own full key
    let r = f
        .stranger
        .call(c.id(), "set_policy")
        .args_json(json!({"reserve": "0", "daily_cap": "1000000", "allow_list": [f.stranger.id()]}))
        .transact()
        .await;
    steps.push(step_from("stranger-rewrites-policy", "stranger", "set_policy", r));

    let views = json!({
        "contract": c.id(),
        "owner": f.owner.id(),
        "agent": agent.id(),
        "agent_key_methods": AGENT_METHODS,
        "balance": balance(c).await?.to_string(),
        "spent_today": spent_today(c).await?.to_string(),
        "policy": c.view("get_policy").await?.json::<Value>()?,
        "reserve": RESERVE.to_string(),
        "daily_cap": DAILY_CAP.to_string(),
    });
    Ok((steps, views))
}
