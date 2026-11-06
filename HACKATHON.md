# NEAR Hackathon checklist — Astra Treasury

Build window: **1–14 Nov 2026**. Submit by 14 Nov 23:59 UTC.

## Tracks (multi-select, one submission)
- [x] Autonomous Business (primary)
- [x] Agent Economy
- [x] AI Security & Defense

## Build checklist
- [x] Repo created (private OK while building; **must be public by 14 Nov**)
- [x] MIT LICENSE
- [x] `spend_guard` contract + ≥10 unit tests
- [x] CI workflow present
- [x] README first lines = what / why / how to run
- [x] docs/ARCHITECTURE.md + docs/THREAT_MODEL.md sketches
- [ ] near-workspaces sandbox integration tests
- [x] x402 paywall (402 → pay → verify → serve) — offline mock RPC
- [x] agents/ceo router + ledger → spend_guard — mock decisions (within / over cap)
- [x] intents/ dry-quote client (`dry:true`) + recorded fixture + offline tests
- [x] `pnpm demo` offline loop (x402 + CEO mock + intents fixture; no chain signing)
- [ ] dashboard reading event log + README screenshot
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
