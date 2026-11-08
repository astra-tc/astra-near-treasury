/**
 * CEO stub — proposes spends.
 *
 * Offline (`pnpm demo`, `pnpm test:agents`): decisions come from
 * spend_guard_mock.ts. On-chain (`pnpm demo:sandbox`): the same
 * demoProposals() batch is exported to demo_proposals.json and submitted
 * to contracts/spend_guard. See ceo_sandbox.ts.
 */

import {
  type GuardState,
  type SpendDecision,
  checkSpend,
  applyApproved,
} from "./spend_guard_mock.ts";

export interface SpendProposal {
  label: string;
  receiver: string;
  amount: bigint;
  nonce: number;
}

export interface ProposalResult {
  proposal: SpendProposal;
  decision: SpendDecision;
}

/**
 * Run a batch of proposals sequentially against mock policy.
 * Approved spends mutate a local copy of state so later proposals see caps.
 */
export function proposeSpends(
  initial: GuardState,
  proposals: SpendProposal[],
): { results: ProposalResult[]; finalState: GuardState } {
  let state: GuardState = {
    ...initial,
    allowList: new Set(initial.allowList),
    usedNonces: new Set(initial.usedNonces),
    policy: { ...initial.policy },
  };
  const results: ProposalResult[] = [];

  for (const proposal of proposals) {
    const decision = checkSpend(
      state,
      proposal.receiver,
      proposal.amount,
      proposal.nonce,
    );
    results.push({ proposal, decision });
    if (decision.approved) {
      state = applyApproved(state, proposal.amount, proposal.nonce);
    }
  }

  return { results, finalState: state };
}

/** Demo pair: one within policy, one over the daily cap. */
export function demoProposals(): SpendProposal[] {
  return [
    {
      label: "ops-tools-within-cap",
      receiver: "vendor.sandbox",
      amount: 50n,
      nonce: 1,
    },
    {
      label: "ops-tools-over-cap",
      receiver: "vendor.sandbox",
      amount: 200n,
      nonce: 2,
    },
  ];
}

export function demoInitialState(): GuardState {
  return {
    policy: { reserve: 100n, dailyCap: 100n },
    balance: 1000n,
    spentToday: 0n,
    allowList: new Set(["vendor.sandbox"]),
    usedNonces: new Set(),
  };
}
