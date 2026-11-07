# NEAR Hackathon checklist — Astra Treasury

Build window: **1–14 Nov 2026**. Submit by 14 Nov 23:59 UTC.

## Tracks (multi-select, one submission)
- [x] Autonomous Business (primary)
- [x] Agent Economy
- [x] AI Security & Defense

## Build checklist
- [x] Repo created (private OK while building; **must be public by 14 Nov**)
- [x] MIT LICENSE
- [x] `spend_guard` contract + ≥10 unit tests (14)
- [x] CI workflow present
- [x] README first lines = what / why / how to run
- [x] docs/ARCHITECTURE.md + docs/THREAT_MODEL.md (threat → mitigation → test table)
- [x] near-workspaces sandbox integration tests (4 tests; FC key blocked on-chain; real transfer + private callback)
- [x] x402 paywall (402 → pay → verify → serve) — offline mock RPC
- [x] agents/ceo router + ledger → spend_guard — mock decisions (within / over cap)
- [x] intents/ dry-quote client (`dry:true`) + recorded fixture + offline tests
- [x] `pnpm demo` offline loop (x402 + CEO mock + intents fixture; no chain signing)
- [x] `pnpm demo:sandbox` on-chain loop on a local near-workspaces node
- [ ] CEO agent (`agents/`) calling the sandbox contract instead of the TS mirror
- [ ] Fresh-clone timing check (<3 min) on CI
- [x] dashboard reading event log + README screenshot (`pnpm dashboard`, docs/img/dashboard.png)
- [ ] Optional testnet deploy (only if Board allows testnet signing)
- [ ] 2-min demo video + X post ("built at NEAR HACKATHON")
- [ ] Repo public; form JSON approved by Board; POST once

## Identity / safety
- [ ] `git log` authors = Astra Trading Company only
- [ ] No personal/Board-member identity strings in repo or git authors
- [ ] No secrets in repo
- [ ] No mainnet signing from this project
- [ ] Prize address documented only

## Submission fields (fill on 14 Nov — Board approves exact JSON)
- Project name: Astra Treasury
- Team lead: *(Board decision — proposal: Carl (Astra Trading Company))*
- Email: carl.astratc@proton.me
- Team size: 1
- NEAR address: `de3d2cde06132391a0a6090759c515f0649c4a608530baffd9dd8149ba587417`
- Repo URL: https://github.com/astra-tc/astra-near-treasury
- X demo post URL: *(after 13 Nov)*
- requestId: *(generate UUID once, reuse on retries)*
- website: *(leave empty — spam trap)*
