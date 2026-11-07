# Architecture: Astra Treasury

```
external agent ──HTTP──> x402/ paywall (TS)
   │ 402 {amount, receiver, nonce, network}
   └─pays ──> receipt verified (mock RPC in demo) ──> 200 data; reused receipt ──> 409
         │ revenue
         ▼
treasury = spend_guard contract account (local near-workspaces sandbox)
         ▲
agents/ CEO ──propose_spend──┐       agent signs with a function-call key:
                             │         receiver = spend_guard, methods = propose/execute/clear,
                             │         gas allowance capped
                             ▼
contracts/spend_guard ── checks ── execute_spend ──> Promise::transfer(amount) ──> vendor
         │                                        └─> on_transfer_complete (#[private]):
         │                                              ok → "transferred"; fail → refund budget
         ├─ set_policy / credit (owner only)
         └─ EVENT_JSON (NEP-297) logs ──> sandbox_demo ──> dashboard/data/sandbox_run.json ──> dashboard/out/index.html
intents/ ── POST 1click.chaindefuser.com/v0/quote {dry:true} (read-only)
```

## spend_guard (Rust, near-sdk 5.x)
State: owner, policy `{reserve, daily_cap}`, credited budget (`balance`), `spent_today` + UTC day bucket, allow-list, used nonces, optional pending spend.

Checks on every propose and again on execute:
1. receiver ∈ allow-list
2. amount ≤ daily_cap and spent_today + amount ≤ daily_cap
3. amount ≤ budget − reserve
4. nonce not previously used

Execute deducts budget, burns the nonce, emits `executed`, sends a NEAR transfer and schedules `on_transfer_complete` (10 Tgas). Callers should attach ~50 Tgas.

Views: `get_policy` (U128 strings), `get_balance`, `get_spent_today`, `get_owner`, `is_allowed`, `get_pending`, `nonce_used`.

## sandbox/ (near-workspaces 0.24)
`setup()` boots a local sandbox node, deploys the wasm from `scripts/build-wasm.sh` (`target-cpu=mvp`), creates owner/agent/vendor/stranger dev accounts, sets policy, and adds the agent's FC key. `run_scenario()` is shared by the integration tests and `sandbox_demo`.

## intents/
Read-only `POST https://1click.chaindefuser.com/v0/quote` with `dry:true` (forced by the client). No deposits.
Offline tests use `intents/test/fixtures/dry_quote_wnear_usdc.json` (live capture, 2026-11-06). Optional live smoke: `ASTRA_INTENTS_LIVE=1 pnpm quote:live`.

## Out of scope (this hackathon)
- Mainnet deploy / mainnet signing
- OutLayer execution (roadmap mention only)
- Chain Signatures
