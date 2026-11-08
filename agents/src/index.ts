/**
 * @astra-near/agents — CEO stub. Offline tests use the TS mock; the sandbox
 * path submits demoProposals() to the on-chain spend_guard contract.
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
export {
  type DemoBatchJson,
  DEMO_BATCH_SOURCE,
  DEMO_VENDOR_ALIAS,
  serializeDemoBatch,
} from "./demo_export.ts";
export {
  type SandboxStep,
  type SandboxRunDoc,
  defaultSandboxRunPath,
  decisionFromSandboxStep,
  resultsFromSandboxRun,
  loadSandboxRun,
  spawnSandboxDemo,
  ceoResultsFromContract,
} from "./ceo_sandbox.ts";

export const name = "agents";
