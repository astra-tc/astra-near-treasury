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

    // CEO-exported batch: first proposal approved + executed on-chain.
    let batch = load_ceo_demo_batch()?;
    assert!(batch.proposals.len() >= 2, "CEO demo batch needs within-cap then over-cap");
    let first = &batch.proposals[0];
    let second = &batch.proposals[1];

    let p = by(&first.label, "propose_spend");
    assert!(p.ok, "{p:?}");
    assert!(
        p.action.contains(&first.amount.to_string()),
        "propose action should use CEO-exported amount {}: {}",
        first.amount,
        p.action
    );
    assert_eq!(p.events[0]["data"]["reason"], "proposed");
    assert_eq!(p.events[0]["data"]["amount"], json!(first.amount.to_string()));
    let e = by(&first.label, "execute_spend");
    assert!(e.ok, "{e:?}");
    assert_eq!(e.events[0]["data"]["reason"], "executed");
    assert_eq!(e.events[0]["standard"], "astra_spend_guard");
    // The real NEAR transfer landed and the callback confirmed it.
    assert!(
        e.events.iter().any(|ev| ev["data"]["reason"] == "transferred"),
        "{:?}",
        e.events
    );

    // CEO-exported second proposal is rejected for daily cap.
    let over = by(&second.label, "propose_spend");
    assert!(!over.ok);
    assert!(over.detail.contains("daily_cap"), "{}", over.detail);
    assert!(
        over.action.contains(&second.amount.to_string()),
        "over-cap action should use CEO-exported amount {}: {}",
        second.amount,
        over.action
    );

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

    // Only the one approved (CEO-exported) spend moved the simulated ledger.
    assert_eq!(
        views["balance"],
        json!((batch.initial_balance - first.amount).to_string())
    );
    assert_eq!(views["spent_today"], json!(first.amount.to_string()));
    assert_eq!(views["policy"]["daily_cap"], json!(batch.daily_cap.to_string()));
    assert_eq!(views["ceo_batch_source"], json!(batch.source));
    Ok(())
}

/// Named proof: the CEO export's first spend is approved and executed on-chain;
/// the second is rejected for the daily cap.
#[tokio::test]
async fn ceo_exported_proposals_are_decided_on_chain() -> anyhow::Result<()> {
    let batch = load_ceo_demo_batch()?;
    assert!(batch.proposals.len() >= 2);
    let first = &batch.proposals[0];
    let second = &batch.proposals[1];
    assert_eq!(first.label, "ops-tools-within-cap");
    assert_eq!(second.label, "ops-tools-over-cap");
    assert!(
        first.amount + second.amount > batch.daily_cap,
        "second CEO proposal must exceed remaining daily cap"
    );

    let f = setup().await?;
    let (steps, views) = run_scenario(&f).await?;
    let by = |label: &str, action_prefix: &str| {
        steps
            .iter()
            .find(|s| s.label == label && s.action.starts_with(action_prefix))
            .unwrap_or_else(|| panic!("missing step {label}/{action_prefix}"))
            .clone()
    };

    let propose = by(&first.label, "propose_spend");
    assert!(propose.ok, "CEO first proposal should be approved: {propose:?}");
    let exec = by(&first.label, "execute_spend");
    assert!(exec.ok, "CEO first proposal should execute: {exec:?}");
    assert!(
        exec.events.iter().any(|ev| ev["data"]["reason"] == "transferred"),
        "{:?}",
        exec.events
    );

    let over = by(&second.label, "propose_spend");
    assert!(!over.ok, "CEO second proposal should be rejected: {over:?}");
    assert!(over.detail.contains("daily_cap"), "{}", over.detail);

    assert_eq!(
        views["spent_today"],
        json!(first.amount.to_string())
    );
    Ok(())
}

#[test]
fn ceo_demo_export_matches_compiled_defaults() {
    let batch = load_ceo_demo_batch().expect("agents/demo_proposals.json");
    assert_eq!(batch.reserve, RESERVE);
    assert_eq!(batch.daily_cap, DAILY_CAP);
    assert_eq!(batch.initial_balance, INITIAL_BALANCE);
    assert!(batch.proposals.len() >= 2);
    assert_eq!(batch.proposals[0].label, "ops-tools-within-cap");
    assert_eq!(batch.proposals[0].receiver, CEO_VENDOR_ALIAS);
    assert_eq!(batch.proposals[1].label, "ops-tools-over-cap");
    assert!(
        batch.proposals[0].amount + batch.proposals[1].amount > batch.daily_cap,
        "demo batch should include a spend that exceeds the daily cap"
    );
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

#[tokio::test]
async fn execute_moves_real_near_and_callback_is_private() -> anyhow::Result<()> {
    let f = setup().await?;
    let before = f.vendor.view_account().await?.balance;
    propose(&f.agent_fc, &f.contract, f.vendor.id(), 50, 1).await?.into_result()?;
    let o = execute(&f.agent_fc, &f.contract).await?;
    assert!(o.is_success(), "{}", failure_text(&o));
    let after = f.vendor.view_account().await?.balance;
    assert_eq!(after.as_yoctonear() - before.as_yoctonear(), 50, "vendor got exactly 50 yocto");

    // Nobody but the contract itself may call the callback (would fake a refund).
    let o = f
        .stranger
        .call(f.contract.id(), "on_transfer_complete")
        .args_json(json!({"receiver": f.vendor.id(), "amount": "50", "nonce": 1, "proposer": f.stranger.id()}))
        .transact()
        .await?;
    assert!(failure_text(&o).contains("is private"), "{}", failure_text(&o));
    assert_eq!(balance(&f.contract).await?, INITIAL_BALANCE - 50);
    Ok(())
}
