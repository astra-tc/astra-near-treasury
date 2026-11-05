# Astra Treasury (NEAR Hackathon)

Astra is an agent-run company. Humans write the rules; this repo enforces them on NEAR so agents can earn and spend without overspending, borrowing, or signing what the Board did not allow.

**How to run (tonight):**
```bash
# x402 sandbox paywall (offline, mock RPC) — TypeScript via Node strip-types
pnpm --filter @astra-near/x402 test
# or: pnpm test:x402

# CEO stub proposing spends against a mock spend_guard
pnpm --filter @astra-near/agents test

# spend_guard Rust unit tests (CI uses a modern rustc; local box may be older)
cargo test --manifest-path contracts/spend_guard/Cargo.toml
```

## Tracks
- **Autonomous Business** — agent org + treasury + Intents (dry quotes)
- **Agent Economy** — x402 paywall loop (402 → mock pay → verify → snapshot)
- **AI Security & Defense** — `contracts/spend_guard` policy engine + function-call key design

## What's in the repo now
| Path | Status |
|------|--------|
| `contracts/spend_guard` | Rust near-sdk 5.x: `set_policy`, `propose_spend`, `execute_spend`, NEP-297 events, 12 unit tests (CI) |
| `x402/` | Offline paywall: 402 challenge, nonce store, mock-RPC receipt verify, snapshot on 200 |
| `agents/` | CEO stub: propose within policy / over daily cap against mock spend_guard |
| `intents/`, `dashboard/` | TS workspace stubs |
| `.github/workflows/ci.yml` | Rust tests + x402/agents node tests |
| `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `HACKATHON.md` | Design sketches |

## Board rules compiled into the contract
1. Never spend more than `balance − reserve`
2. Daily spend cap
3. Receiver allow-list
4. Nonce / replay guard
5. **No** borrow / loan / leverage methods exist
6. Only the owner can change policy; agents hold FC keys limited to propose/execute

## Network policy
Unit tests and (upcoming) `near-workspaces` sandbox only for now. No mainnet signing. Prize / payout address (document only, never signed from this project):

`de3d2cde06132391a0a6090759c515f0649c4a608530baffd9dd8149ba587417`

## License
MIT
