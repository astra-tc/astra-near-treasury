# Architecture: Astra Treasury

```
external agent ──HTTP──> x402/ paywall (TS)
   │ 402 {amount, receiver, nonce, network}
   └─pays ──> receipt verified (mock RPC in demo) ──> 200 data; reused receipt ──> 409
         │ revenue
         ▼
treasury = spend_guard contract account (local near-workspaces sandbox)
         ▲
agents/ CEO ──demoProposals()──JSON──┐   agent signs with a function-call key:
   offline: spend_guard_mock.ts      │     receiver = spend_guard, methods = propose/execute/clear,
                                     │     gas allowance capped
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

## agents/
`demoProposals()` + `demoInitialState()` are the source of truth for the demo spend batch (reserve 100, daily cap 100, balance 1000; labels `ops-tools-within-cap` / `ops-tools-over-cap`). Offline, `proposeSpends()` runs those proposals against `spend_guard_mock.ts` (`pnpm demo`, `pnpm test:agents`). The same batch is serialized to `agents/demo_proposals.json` (`pnpm export:ceo-demo`). `ceo_sandbox.ts` maps `dashboard/data/sandbox_run.json` (or a fixture) back to `ProposalResult[]`; it does not boot a sandbox unless `ASTRA_SANDBOX=1` or `{ spawn: true }` is set.

## sandbox/ (near-workspaces 0.24)
`setup()` boots a local sandbox node, deploys the wasm from `scripts/build-wasm.sh` (`target-cpu=mvp`), creates owner/agent/vendor/stranger dev accounts, sets policy from the CEO demo export (`agents/demo_proposals.json`), and adds the agent's FC key. `run_scenario()` submits that CEO spend batch to the on-chain contract (mapping `vendor.sandbox` to the fixture vendor account), then runs extra security steps that are not CEO spends (unknown receiver, replay nonce, FC key blocked on `set_policy`/transfer, stranger owner check). Shared by the integration tests and `sandbox_demo`. `pnpm demo:sandbox` prints that the spend proposals came from the CEO agent.

Do X → see Y: run `pnpm demo:sandbox` (or `pnpm test:sandbox`). You should see the CEO's first proposal (`ops-tools-within-cap`, 50) approved and executed on-chain, and the second (`ops-tools-over-cap`, 200) rejected for `daily_cap`.

## intents/
Read-only `POST https://1click.chaindefuser.com/v0/quote` with `dry:true` (forced by the client). No deposits.
Offline tests use `intents/test/fixtures/dry_quote_wnear_usdc.json` (live capture, 2026-11-06). Optional live smoke: `ASTRA_INTENTS_LIVE=1 pnpm quote:live`.

## Out of scope (this hackathon)
- Mainnet deploy / mainnet signing
- OutLayer execution (roadmap mention only)
- Chain Signatures
