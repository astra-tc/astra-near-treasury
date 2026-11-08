//! Local `near-workspaces` sandbox harness for `contracts/spend_guard`.
//!
//! Everything here runs against an in-process local NEAR sandbox node with
//! throwaway keys. Nothing touches testnet or mainnet, and no real funds move.
//!
//! The same scenario is used by the integration tests (`tests/sandbox.rs`) and
//! by the demo runner (`src/bin/sandbox_demo.rs`), which writes the decision
//! events to JSON for the dashboard.
//!
//! CEO spend amounts/labels/nonces come from `agents/demo_proposals.json`
//! (exported from `demoProposals()` + `demoInitialState()`). Extra security
//! steps that are not CEO spends stay in this harness.

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
/// Must match `agents/demo_proposals.json` (see `ceo_demo_export_matches_compiled_defaults`).
pub const RESERVE: u128 = 100;
pub const DAILY_CAP: u128 = 100;
pub const INITIAL_BALANCE: u128 = 1_000;

/// Logical receiver in the CEO demo batch. Mapped to the fixture vendor at runtime.
pub const CEO_VENDOR_ALIAS: &str = "vendor.sandbox";

/// One spend from the CEO demo export.
#[derive(Debug, Clone)]
pub struct CeoDemoProposal {
    pub label: String,
    pub receiver: String,
    pub amount: u128,
    pub nonce: u64,
}

/// `demoProposals()` + `demoInitialState()`, loaded from JSON.
#[derive(Debug, Clone)]
pub struct CeoDemoBatch {
    pub source: String,
    pub reserve: u128,
    pub daily_cap: u128,
    pub initial_balance: u128,
    pub proposals: Vec<CeoDemoProposal>,
}

/// Path to the CEO demo export. Override with `ASTRA_CEO_DEMO_BATCH`.
pub fn ceo_demo_batch_path() -> PathBuf {
    if let Ok(p) = std::env::var("ASTRA_CEO_DEMO_BATCH") {
        return PathBuf::from(p);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../agents/demo_proposals.json")
}

fn json_u128(v: &Value, ctx: &str) -> Result<u128> {
    if let Some(s) = v.as_str() {
        return s.parse().with_context(|| format!("{ctx}: {s}"));
    }
    if let Some(n) = v.as_u64() {
        return Ok(n as u128);
    }
    Err(anyhow!("{ctx}: expected string or number, got {v}"))
}

pub fn load_ceo_demo_batch() -> Result<CeoDemoBatch> {
    let path = ceo_demo_batch_path();
    let text = std::fs::read_to_string(&path).with_context(|| {
        format!(
            "CEO demo batch not found at {} — run `pnpm export:ceo-demo`",
            path.display()
        )
    })?;
    let v: Value = serde_json::from_str(&text)
        .with_context(|| format!("invalid CEO demo JSON at {}", path.display()))?;
    let policy = v.get("policy").ok_or_else(|| anyhow!("CEO demo JSON missing policy"))?;
    let proposals = v
        .get("proposals")
        .and_then(|p| p.as_array())
        .ok_or_else(|| anyhow!("CEO demo JSON missing proposals array"))?;
    let mut out = Vec::new();
    for (i, p) in proposals.iter().enumerate() {
        out.push(CeoDemoProposal {
            label: p
                .get("label")
                .and_then(|x| x.as_str())
                .ok_or_else(|| anyhow!("proposals[{i}].label"))?
                .to_string(),
            receiver: p
                .get("receiver")
                .and_then(|x| x.as_str())
                .ok_or_else(|| anyhow!("proposals[{i}].receiver"))?
                .to_string(),
            amount: json_u128(
                p.get("amount").unwrap_or(&Value::Null),
                &format!("proposals[{i}].amount"),
            )?,
            nonce: p
                .get("nonce")
                .and_then(|x| x.as_u64())
                .ok_or_else(|| anyhow!("proposals[{i}].nonce"))?,
        });
    }
    Ok(CeoDemoBatch {
        source: v
            .get("source")
            .and_then(|s| s.as_str())
            .unwrap_or("agents/demo_proposals.json")
            .to_string(),
        reserve: json_u128(policy.get("reserve").unwrap_or(&Value::Null), "policy.reserve")?,
        daily_cap: json_u128(policy.get("dailyCap").unwrap_or(&Value::Null), "policy.dailyCap")?,
        initial_balance: json_u128(policy.get("balance").unwrap_or(&Value::Null), "policy.balance")?,
        proposals: out,
    })
}

/// Map a CEO logical receiver (`vendor.sandbox`) to the sandbox fixture account.
pub fn map_ceo_receiver<'a>(
    f: &'a Fixture,
    alias: &str,
) -> Result<&'a near_workspaces::AccountId> {
    match alias {
        CEO_VENDOR_ALIAS => Ok(f.vendor.id()),
        other => Err(anyhow!(
            "unknown CEO demo receiver alias {other:?}; sandbox maps {CEO_VENDOR_ALIAS} to the fixture vendor"
        )),
    }
}

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
    let batch = load_ceo_demo_batch()?;
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
            "reserve": batch.reserve.to_string(),
            "daily_cap": batch.daily_cap.to_string(),
            "initial_balance": batch.initial_balance.to_string(),
        }))
        .transact()
        .await?
        .into_result()
        .map_err(|e| anyhow!("init failed: {e:?}"))?;

    owner
        .call(contract.id(), "set_policy")
        .args_json(json!({
            "reserve": batch.reserve.to_string(),
            "daily_cap": batch.daily_cap.to_string(),
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
/// CEO spends are loaded from `agents/demo_proposals.json`; remaining steps
/// are harness security checks (not part of the CEO demo batch).
pub async fn run_scenario(f: &Fixture) -> Result<(Vec<Step>, Value)> {
    let mut steps = Vec::new();
    let c = &f.contract;
    let agent = &f.agent_fc;
    let batch = load_ceo_demo_batch()?;

    // CEO agent spend batch (source of truth: demoProposals()).
    for p in &batch.proposals {
        let receiver = map_ceo_receiver(f, &p.receiver)?;
        let o = propose(agent, c, receiver, p.amount, p.nonce).await?;
        steps.push(step(
            &p.label,
            "agent (FC key)",
            &format!("propose_spend {} → vendor", p.amount),
            &o,
        ));
        if o.is_success() {
            let o = execute(agent, c).await?;
            steps.push(step(&p.label, "agent (FC key)", "execute_spend", &o));
        }
    }

    // Extra security steps — not CEO spends.
    // Unknown receiver (not on allow-list)
    let o = propose(agent, c, f.stranger.id(), 10, 3).await?;
    steps.push(step("unknown-receiver", "agent (FC key)", "propose_spend 10 → stranger", &o));

    // Replay a used nonce from the first CEO proposal (or 1 if the batch is empty).
    let replay_nonce = batch.proposals.first().map(|p| p.nonce).unwrap_or(1);
    let o = propose(agent, c, f.vendor.id(), 10, replay_nonce).await?;
    steps.push(step(
        "replay-nonce",
        "agent (FC key)",
        &format!("propose_spend nonce={replay_nonce} again"),
        &o,
    ));

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
        "reserve": batch.reserve.to_string(),
        "daily_cap": batch.daily_cap.to_string(),
        "ceo_batch_source": batch.source,
        "ceo_proposals": batch
            .proposals
            .iter()
            .map(|p| {
                json!({
                    "label": p.label,
                    "receiver": p.receiver,
                    "amount": p.amount.to_string(),
                    "nonce": p.nonce,
                })
            })
            .collect::<Vec<_>>(),
    });
    Ok((steps, views))
}
