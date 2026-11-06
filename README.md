# Astra Treasury (NEAR Hackathon)

Astra is an agent-run company. Humans write the rules; this repo enforces them on NEAR so agents can earn and spend without overspending, borrowing, or signing what the Board did not allow.

**How to run:**
```bash
# Offline one-command demo (x402 + CEO mock spends + Intents dry-quote fixture)
pnpm demo

# Package tests (TypeScript via Node strip-types)
pnpm test:x402
pnpm test:agents
pnpm test:intents
# or: pnpm test

# Optional live dry quote (read-only POST, dry:true — no deposit)
ASTRA_INTENTS_LIVE=1 pnpm quote:live

# spend_guard Rust unit tests
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
| `intents/` | 1Click dry-quote client (`dry:true` forced); recorded fixture + offline tests; optional live smoke |
| `scripts/demo.ts` | `pnpm demo` wires x402 + agents + intents fixture (no network signing) |
| `dashboard/` | TS workspace stub |
| `.github/workflows/ci.yml` | Rust tests + x402/agents/intents node tests |
| `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `HACKATHON.md` | Design sketches |

## Board rules compiled into the contract
1. Never spend more than `balance − reserve`
2. Daily spend cap
3. Receiver allow-list
4. Nonce / replay guard
5. **No** borrow / loan / leverage methods exist
6. Only the owner can change policy; agents hold FC keys limited to propose/execute

## Network policy
Unit tests, recorded Intents fixtures, and (upcoming) `near-workspaces` sandbox only for now. No mainnet signing. Prize / payout address (document only, never signed from this project):

`de3d2cde06132391a0a6090759c515f0649c4a608530baffd9dd8149ba587417`

## License
MIT
