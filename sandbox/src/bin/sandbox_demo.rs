//! `pnpm demo:sandbox` — boot a local NEAR sandbox, deploy spend_guard, run the
//! agent scenario, print results and write `dashboard/data/sandbox_run.json`.
//! Local sandbox only: no testnet, no mainnet, no real funds.

use anyhow::Result;
use astra_sandbox::{run_scenario, setup};
use serde_json::json;
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<()> {
    println!("Booting local near-workspaces sandbox (no public network)…");
    let f = setup().await?;
    println!("spend_guard deployed at {} (owner {})", f.contract.id(), f.owner.id());
    println!("agent {} signs with a function-call key limited to {:?}\n", f.agent_fc.id(), astra_sandbox::AGENT_METHODS);

    let (steps, views) = run_scenario(&f).await?;
    for s in &steps {
        println!(
            "{:<26} {:<34} {}  {}",
            s.label,
            s.action,
            if s.ok { "OK      " } else { "BLOCKED " },
            s.detail
        );
    }
    println!(
        "\nfinal balance={} spent_today={} (reserve={}, daily_cap={})",
        views["balance"].as_str().unwrap_or("?"),
        views["spent_today"].as_str().unwrap_or("?"),
        views["reserve"].as_str().unwrap_or("?"),
        views["daily_cap"].as_str().unwrap_or("?"),
    );

    let out = std::env::var("ASTRA_SANDBOX_OUT").map(PathBuf::from).unwrap_or_else(|_| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dashboard/data/sandbox_run.json")
    });
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let doc = json!({
        "source": "near-workspaces local sandbox",
        "network": "sandbox",
        "views": views,
        "steps": steps.iter().map(|s| s.to_json()).collect::<Vec<_>>(),
    });
    std::fs::write(&out, serde_json::to_string_pretty(&doc)? + "\n")?;
    println!("wrote {}", std::fs::canonicalize(&out).unwrap_or(out.clone()).display());
    println!("Sandbox demo complete. No testnet/mainnet transactions.");
    Ok(())
}
