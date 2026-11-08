import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ceoResultsFromContract,
  decisionFromSandboxStep,
  loadSandboxRun,
  resultsFromSandboxRun,
} from "../src/ceo_sandbox.ts";
import { demoProposals, serializeDemoBatch } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "sandbox_run_ceo.json");
const exportPath = join(here, "..", "demo_proposals.json");

describe("CEO → sandbox contract bridge (offline fixture)", () => {
  it("maps CEO demo proposals to on-chain propose_spend decisions", () => {
    const run = loadSandboxRun(fixturePath);
    const results = resultsFromSandboxRun(run);
    assert.equal(results.length, 2);
    assert.equal(results[0].proposal.label, "ops-tools-within-cap");
    assert.equal(results[0].proposal.amount, 50n);
    assert.equal(results[0].proposal.receiver, "vendor.sandbox");
    assert.deepEqual(results[0].decision, { approved: true, reason: "proposed" });
    assert.equal(results[1].proposal.label, "ops-tools-over-cap");
    assert.equal(results[1].proposal.amount, 200n);
    assert.deepEqual(results[1].decision, {
      approved: false,
      reason: "exceeds_daily_cap",
    });
  });

  it("ceoResultsFromContract reads a fixture path without spawning a sandbox", () => {
    const results = ceoResultsFromContract({ runPath: fixturePath });
    assert.equal(results.length, demoProposals().length);
    assert.equal(results[0].decision.approved, true);
    assert.equal(results[1].decision.approved, false);
  });

  it("throws if a CEO label is missing from the sandbox run", () => {
    assert.throws(
      () =>
        resultsFromSandboxRun({
          steps: [
            {
              label: "unrelated",
              actor: "agent",
              action: "propose_spend 1 → vendor",
              ok: true,
              detail: "ok",
            },
          ],
        }),
      /missing propose_spend step for CEO proposal/,
    );
  });

  it("classifies common on-chain rejection strings", () => {
    assert.deepEqual(
      decisionFromSandboxStep({
        label: "x",
        actor: "a",
        action: "propose_spend",
        ok: false,
        detail: "spend rejected: receiver not on allow-list",
      }),
      { approved: false, reason: "receiver_not_allowed" },
    );
    assert.deepEqual(
      decisionFromSandboxStep({
        label: "x",
        actor: "a",
        action: "propose_spend",
        ok: false,
        detail: "nonce already used (replay)",
      }),
      { approved: false, reason: "nonce_replay" },
    );
  });
});

describe("CEO demo export", () => {
  it("checked-in demo_proposals.json matches demoProposals() + demoInitialState()", () => {
    const checkedIn = JSON.parse(readFileSync(exportPath, "utf8"));
    assert.deepEqual(checkedIn, serializeDemoBatch());
  });
});
