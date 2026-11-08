/**
 * Serialize demoProposals() + demoInitialState() to JSON.
 * The checked-in file agents/demo_proposals.json is what the sandbox
 * loads so on-chain decisions use the same CEO batch as the offline demo.
 */

import { demoInitialState, demoProposals, type SpendProposal } from "./ceo.ts";

export interface DemoBatchJson {
  source: string;
  policy: {
    reserve: string;
    dailyCap: string;
    balance: string;
    spentToday: string;
    allowList: string[];
  };
  proposals: {
    label: string;
    receiver: string;
    amount: string;
    nonce: number;
  }[];
}

export const DEMO_BATCH_SOURCE =
  "agents/src/ceo.ts demoProposals() + demoInitialState()";

/** Logical receiver id used by the CEO demo; sandbox maps this to its vendor account. */
export const DEMO_VENDOR_ALIAS = "vendor.sandbox";

export function serializeDemoBatch(): DemoBatchJson {
  const state = demoInitialState();
  return {
    source: DEMO_BATCH_SOURCE,
    policy: {
      reserve: state.policy.reserve.toString(),
      dailyCap: state.policy.dailyCap.toString(),
      balance: state.balance.toString(),
      spentToday: state.spentToday.toString(),
      allowList: [...state.allowList],
    },
    proposals: demoProposals().map((p: SpendProposal) => ({
      label: p.label,
      receiver: p.receiver,
      amount: p.amount.toString(),
      nonce: p.nonce,
    })),
  };
}
