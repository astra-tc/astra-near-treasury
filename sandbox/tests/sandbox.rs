//! Integration tests: spend_guard on a local near-workspaces sandbox.
//! Requires `pnpm build:wasm` (or SPEND_GUARD_WASM) first.

use astra_sandbox::*;
use serde_json::json;

#[tokio::test]
async fn scenario_enforces_board_rules_on_chain() -> anyhow::Result<()> {
    let f = setup().await?;
    let (steps, views) = run_scenario(&f).await?;
    let by = |label: &str, action_prefix: &str| {
        steps
            .iter()
            .find(|s| s.label == label && s.action.starts_with(action_prefix))
            .unwrap_or_else(|| panic!("missing step {label}/{action_prefix}"))
            .clone()
    };

    // Within policy: proposal and execution succeed and emit events.
    let p = by("ops-tools-within-cap", "propose_spend");
    assert!(p.ok, "{p:?}");
    assert_eq!(p.events[0]["data"]["reason"], "proposed");
    let e = by("ops-tools-within-cap", "execute_spend");
    assert!(e.ok, "{e:?}");
    assert_eq!(e.events[0]["data"]["reason"], "executed");
    assert_eq!(e.events[0]["standard"], "astra_spend_guard");

    // Over daily cap is rejected.
    let over = by("ops-tools-over-cap", "propose_spend");
    assert!(!over.ok);
    assert!(over.detail.contains("daily_cap"), "{}", over.detail);

    // Receiver not on allow-list.
    let unk = by("unknown-receiver", "propose_spend");
    assert!(!unk.ok);
    assert!(unk.detail.contains("allow-list"), "{}", unk.detail);

    // Replayed nonce.
    let rep = by("replay-nonce", "propose_spend");
    assert!(!rep.ok);
    assert!(rep.detail.contains("replay"), "{}", rep.detail);

    // FC key cannot call owner method or move NEAR.
    let pol = by("agent-rewrites-policy", "set_policy");
    assert!(!pol.ok, "FC key must not reach set_policy: {pol:?}");
    assert!(pol.detail.contains("MethodNameMismatch"), "{}", pol.detail);
    let raw = by("agent-raw-transfer", "transfer");
    assert!(!raw.ok, "FC key must not transfer NEAR: {raw:?}");

    // A full-access stranger still is not the owner.
    let s = by("stranger-rewrites-policy", "set_policy");
    assert!(!s.ok);
    assert!(s.detail.contains("owner only"), "{}", s.detail);

    // Only the one approved spend moved the simulated ledger.
    assert_eq!(views["balance"], json!((INITIAL_BALANCE - 50).to_string()));
    assert_eq!(views["spent_today"], json!("50"));
    assert_eq!(views["policy"]["daily_cap"], json!(DAILY_CAP.to_string()));
    Ok(())
}

#[tokio::test]
async fn reserve_floor_holds_even_under_daily_cap() -> anyhow::Result<()> {
    let f = setup().await?;
    // Owner lowers balance headroom: raise cap but keep reserve, balance 1000.
    f.owner
        .call(f.contract.id(), "set_policy")
        .args_json(json!({"reserve": "990", "daily_cap": "500", "allow_list": [f.vendor.id()]}))
        .transact()
        .await?
        .into_result()?;
    let o = propose(&f.agent_fc, &f.contract, f.vendor.id(), 20, 7).await?;
    assert!(o.is_failure());
    assert!(failure_text(&o).contains("balance minus reserve"));
    let o = propose(&f.agent_fc, &f.contract, f.vendor.id(), 10, 8).await?;
    assert!(o.is_success(), "{}", failure_text(&o));
    assert!(execute(&f.agent_fc, &f.contract).await?.is_success());
    assert_eq!(balance(&f.contract).await?, 990);
    Ok(())
}

#[tokio::test]
async fn only_owner_can_credit_and_agent_cannot_execute_without_proposal() -> anyhow::Result<()> {
    let f = setup().await?;
    let o = f
        .stranger
        .call(f.contract.id(), "credit")
        .args_json(json!({"amount": "1000000"}))
        .transact()
        .await?;
    assert!(failure_text(&o).contains("owner only"));
    let o = execute(&f.agent_fc, &f.contract).await?;
    assert!(failure_text(&o).contains("no pending spend"));
    // FC key cannot call credit either (outside key scope).
    let r = f
        .agent_fc
        .call(f.contract.id(), "credit")
        .args_json(json!({"amount": "1"}))
        .transact()
        .await;
    match r {
        Err(e) => assert!(format!("{e:?}").contains("MethodNameMismatch"), "{e:?}"),
        Ok(o) => assert!(o.is_failure(), "FC key must not reach credit"),
    }
    assert_eq!(balance(&f.contract).await?, INITIAL_BALANCE);
    Ok(())
}
