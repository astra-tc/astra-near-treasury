/**
 * @astra-near/agents — CEO stub proposing spends against mock spend_guard.
 */

export {
  type Policy,
  type GuardState,
  type SpendDecision,
  checkSpend,
  applyApproved,
} from "./spend_guard_mock.ts";
export {
  type SpendProposal,
  type ProposalResult,
  proposeSpends,
  demoProposals,
  demoInitialState,
} from "./ceo.ts";

export const name = "agents";
