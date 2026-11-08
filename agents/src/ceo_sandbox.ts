/**
 * CEO → on-chain spend_guard bridge.
 *
 * Offline unit tests and `pnpm demo` use spend_guard_mock.ts (no chain).
 * The sandbox path submits the same demoProposals() batch to the real
 * contract: agents/demo_proposals.json is loaded by sandbox/src/lib.rs
 * `run_scenario`, which calls propose_spend / execute_spend on a local
 * near-workspaces node (`pnpm demo:sandbox`).
 *
 * This module maps that run (dashboard/data/sandbox_run.json) back to
 * ProposalResult[] for the CEO demo batch. It does not boot a sandbox
 * unless you pass `{ spawn: true }` or set ASTRA_SANDBOX=1. Default
 * `pnpm test:agents` / `pnpm test:node` only parse JSON fixtures.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  demoProposals,
  type ProposalResult,
  type SpendProposal,
} from "./ceo.ts";
import type { SpendDecision } from "./spend_guard_mock.ts";

export interface SandboxStep {
  label: string;
  actor: string;
  action: string;
  ok: boolean;
  detail: string;
  events?: unknown[];
}

export interface SandboxRunDoc {
  source?: string;
  ceo_batch_source?: string;
  steps: SandboxStep[];
  views?: Record<string, unknown>;
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function defaultSandboxRunPath(): string {
  return join(repoRoot(), "dashboard", "data", "sandbox_run.json");
}

export function decisionFromSandboxStep(step: SandboxStep): SpendDecision {
  if (step.ok) {
    return { approved: true, reason: "proposed" };
  }
  const d = step.detail;
  if (d.includes("daily_cap")) {
    return { approved: false, reason: "exceeds_daily_cap" };
  }
  if (d.includes("allow-list") || d.includes("not_allowed")) {
    return { approved: false, reason: "receiver_not_allowed" };
  }
  if (d.includes("replay")) {
    return { approved: false, reason: "nonce_replay" };
  }
  if (d.includes("reserve")) {
    return { approved: false, reason: "breaks_reserve" };
  }
  if (d.includes("amount") && d.includes("zero")) {
    return { approved: false, reason: "amount_zero" };
  }
  throw new Error(
    `unrecognized sandbox rejection for ${step.label}: ${d}`,
  );
}

/**
 * Pair each CEO demo proposal with the matching on-chain propose_spend step.
 * Receiver alias `vendor.sandbox` stays as the CEO proposed it; the sandbox
 * maps that alias to its fixture vendor account before calling the contract.
 */
export function resultsFromSandboxRun(
  run: SandboxRunDoc,
  proposals: SpendProposal[] = demoProposals(),
): ProposalResult[] {
  if (!run || !Array.isArray(run.steps)) {
    throw new Error("sandbox run JSON is missing a steps array");
  }
  return proposals.map((proposal) => {
    const step = run.steps.find(
      (s) => s.label === proposal.label && s.action.startsWith("propose_spend"),
    );
    if (!step) {
      throw new Error(
        `sandbox run missing propose_spend step for CEO proposal "${proposal.label}"`,
      );
    }
    return { proposal, decision: decisionFromSandboxStep(step) };
  });
}

export function loadSandboxRun(path: string): SandboxRunDoc {
  const raw = JSON.parse(readFileSync(path, "utf8")) as SandboxRunDoc;
  if (!raw || !Array.isArray(raw.steps)) {
    throw new Error(`not a sandbox run JSON: ${path}`);
  }
  return raw;
}

/** Spawn `pnpm demo:sandbox`. Never called by default tests. */
export function spawnSandboxDemo(cwd = repoRoot()): void {
  const r = spawnSync("pnpm", ["demo:sandbox"], { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`pnpm demo:sandbox failed with status ${r.status}`);
  }
}

/**
 * Return ProposalResult[] for the CEO demo batch from a sandbox run JSON.
 * Set opts.spawn or ASTRA_SANDBOX=1 to run `pnpm demo:sandbox` first.
 */
export function ceoResultsFromContract(opts?: {
  spawn?: boolean;
  runPath?: string;
}): ProposalResult[] {
  const shouldSpawn = opts?.spawn === true || process.env.ASTRA_SANDBOX === "1";
  const runPath = opts?.runPath ?? defaultSandboxRunPath();
  if (shouldSpawn) {
    spawnSandboxDemo();
  }
  if (!existsSync(runPath)) {
    throw new Error(
      `sandbox run JSON not found at ${runPath}. Run \`pnpm demo:sandbox\` first (or pass spawn: true / ASTRA_SANDBOX=1).`,
    );
  }
  return resultsFromSandboxRun(loadSandboxRun(runPath));
}
