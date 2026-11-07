# Threat model: Astra Treasury spend_guard

**Asset:** the treasury contract account's NEAR and the budget the Board credits to it.
**Actors:** Board/owner (full-access key, sets rules), treasury agent (function-call key only), allow-listed vendors, everyone else (strangers, compromised agents, prompt-injected agents).

## Threats and mitigations (each row names its test)

| # | Threat | Mitigation | Evidence |
|---|--------|------------|----------|
| T1 | Compromised / prompt-injected agent tries to drain the treasury | Agent holds only a FC key scoped to `propose_spend`, `execute_spend`, `clear_pending` on the contract; every spend still passes all policy checks | sandbox `scenario_enforces_board_rules_on_chain` |
| T2 | Agent sends NEAR directly, bypassing the contract | FC keys cannot sign `Transfer` actions; the node refuses with `RequiresFullAccess` | sandbox step `agent-raw-transfer` |
| T3 | Agent rewrites the rules (raise cap, add itself to allow-list) | `set_policy` / `credit` are outside the key scope (node: `MethodNameMismatch`) **and** assert `predecessor == owner` | sandbox `agent-rewrites-policy`, `stranger-rewrites-policy`, `only_owner_can_credit…`; unit `credit_owner_only` |
| T4 | Overspend past what the Board allocated | `amount ≤ budget − reserve`, checked on propose and again on execute | unit tests; sandbox `reserve_floor_holds_even_under_daily_cap` |
| T5 | Many small spends (burst) | `daily_cap` with a UTC day bucket; single spend > cap also rejected | unit `daily_cap_rejects_second_spend`, `day_roll_resets_spent_today`; sandbox `ops-tools-over-cap` |
| T6 | Paying an attacker-controlled address | Receiver must be on the owner-managed allow-list | sandbox `unknown-receiver`; unit `allow_list_rejects_stranger` |
| T7 | Replay an approved spend | Nonce burned on execute; propose and execute reject used nonces; nonce stays burned even if the transfer fails | sandbox `replay-nonce`; unit `failed_transfer_refunds_budget_but_keeps_nonce_burned` |
| T8 | Fake a refund by calling the callback | `on_transfer_complete` is `#[private]` (only the contract itself) | sandbox `execute_moves_real_near_and_callback_is_private` |
| T9 | Transfer fails but the budget is still deducted | Callback restores budget + daily bucket and emits `transfer_failed_refunded` | unit `failed_transfer_refunds_budget_but_keeps_nonce_burned` |
| T10 | Hidden leverage | The contract has no borrow / loan / credit-line methods; the ABI is the whole surface | code review of `contracts/spend_guard/src/lib.rs` |
| T11 | Agent burns gas forever with junk calls | FC key has a gas allowance (0.25 NEAR in the sandbox setup); once spent, the key stops working | `sandbox/src/lib.rs` `setup()` |
| T12 | Off-chain claims that don't match what happened | Every decision emits an `EVENT_JSON` (NEP-297, standard `astra_spend_guard`); dashboard renders from those events | sandbox step events; `dashboard/` tests |
| T13 | x402 receipt reuse | Nonce store; a reused receipt returns `409` | `x402/test/paywall.test.ts`; `pnpm demo` section 1 |
| T14 | Intents quote turns into a real swap | Client forces `dry:true`; no deposit address is ever funded | `intents/test/quote.test.ts` |

## Trust boundaries
- **Owner (Board rules as code):** full-access key. Sets policy, credits budget, rotates the allow-list, can clear a pending spend. Owner-key compromise is out of scope for the contract; mitigate with a multisig/DAO owner (roadmap: SputnikDAO as owner).
- **Agent:** FC key on its own account, receiver = spend_guard, methods = propose/execute/clear. Can only act inside current policy.
- **External caller (x402):** pays; paywall verifies the receipt before serving data.

## Known gaps (not yet addressed)
- One pending spend at a time (simple, but a stuck proposal blocks the agent until it is cleared).
- Budget vs. real account balance: the reserve applies to the credited budget, not the account's live NEAR balance; a failed transfer is refunded via callback.
- Key rotation for the agent is a manual owner action (delete/add access key); there is no on-chain rotation helper.
- No testnet deployment yet; all evidence is from the local sandbox.
