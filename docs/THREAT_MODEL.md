# Threat model sketch — Astra Treasury spend_guard

| Threat | Mitigation |
|--------|------------|
| Agent drains treasury | FC access key scoped to `propose_spend` / `execute_spend` only; cannot call `set_policy` or raw transfer |
| Overspend past balance | `amount ≤ balance − reserve` checked on propose and execute |
| Burst spending | `daily_cap` + per-day `spent_today` bucket (UTC day roll) |
| Paying attacker addresses | Receiver must be on owner-managed allow-list |
| Replay of an approved spend | `nonce` recorded in `used_nonces` after execute; propose rejects reused nonce |
| Policy tampering by agent | `set_policy` / `credit` assert predecessor == owner |
| Hidden leverage | Contract has **no** borrow / loan / credit-line methods |
| Confusing off-chain claims | Every decision emits NEP-297-style `EVENT_JSON` log |

## Trust boundaries
- **Owner (Board rules as code):** sets policy, credits demo balance, rotates allow-list.
- **Agent:** can only propose/execute within current policy.
- **External caller (x402):** pays; paywall verifies receipt via RPC before serving data (follow-up commit).

## Non-goals tonight
Live key rotation UI, formal verification, mainnet incident response runbooks — later.
