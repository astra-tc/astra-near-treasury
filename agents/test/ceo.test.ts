import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  proposeSpends,
  demoProposals,
  demoInitialState,
  checkSpend,
} from "../src/index.ts";

describe("CEO stub vs mock spend_guard", () => {
  it("approves a spend within daily cap and reserve", () => {
    const state = demoInitialState();
    const decision = checkSpend(state, "vendor.sandbox", 50n, 1);
    assert.deepEqual(decision, { approved: true, reason: "proposed" });
  });

  it("rejects a spend that exceeds the daily cap", () => {
    const state = demoInitialState();
    const decision = checkSpend(state, "vendor.sandbox", 200n, 2);
    assert.deepEqual(decision, { approved: false, reason: "exceeds_daily_cap" });
  });

  it("demo batch: first within policy, second over daily cap", () => {
    const { results, finalState } = proposeSpends(
      demoInitialState(),
      demoProposals(),
    );
    assert.equal(results.length, 2);
    assert.equal(results[0].decision.approved, true);
    assert.equal(results[0].proposal.label, "ops-tools-within-cap");
    assert.equal(results[1].decision.approved, false);
    if (!results[1].decision.approved) {
      assert.equal(results[1].decision.reason, "exceeds_daily_cap");
    }
    assert.equal(finalState.spentToday, 50n);
    assert.equal(finalState.balance, 950n);
    assert.equal(finalState.usedNonces.has(1), true);
    assert.equal(finalState.usedNonces.has(2), false);
  });

  it("rejects receiver not on allow-list", () => {
    const state = demoInitialState();
    const decision = checkSpend(state, "stranger.sandbox", 10n, 3);
    assert.deepEqual(decision, { approved: false, reason: "receiver_not_allowed" });
  });

  it("rejects spend that would break reserve", () => {
    const state = {
      ...demoInitialState(),
      balance: 120n,
      policy: { reserve: 100n, dailyCap: 1000n },
    };
    // available = 120 - 100 = 20
    const decision = checkSpend(state, "vendor.sandbox", 21n, 4);
    assert.deepEqual(decision, { approved: false, reason: "breaks_reserve" });
  });
});
