# Architecture sketch — Astra Treasury

```
external agent ──HTTP──> x402/ paywall (TS)
   │ 402 {amount, receiver, nonce, network}
   └─pays (sandbox transfer / Intents dry quote shown)
         │
         ▼
revenue → treasury (sandbox account)
         │
         ▼
agents/ceo proposes spend ──> contracts/spend_guard
         │
         ├─ set_policy (owner only)
         ├─ propose_spend / execute_spend (agent FC key)
         └─ NEP-297 EVENT_JSON logs → dashboard/
```

## spend_guard (Rust, near-sdk 5.x)
State: owner, policy `{reserve, daily_cap}`, tracked balance, spent_today + day bucket, allow-list, used nonces, optional pending spend.

Checks on every propose/execute:
1. receiver ∈ allow-list
2. amount ≤ daily_cap and spent_today + amount ≤ daily_cap
3. amount ≤ balance − reserve
4. nonce not previously used

No borrow/loan methods. Agent keys (design): FunctionCall access key limited to `{propose_spend, execute_spend}` with an allowance cap.

## intents/
Read-only `POST https://1click.chaindefuser.com/v0/quote` with `dry:true`. No deposits.

## Out of scope (this hackathon)
- Mainnet deploy / mainnet signing
- OutLayer execution (roadmap mention only)
- Chain Signatures
