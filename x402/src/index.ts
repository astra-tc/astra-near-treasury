/**
 * @astra-near/x402 — sandbox HTTP 402 paywall with offline receipt verify.
 *
 * No network signing. Inject a PaymentRpc (MockRpc in tests) to settle.
 */

export {
  type NetworkLabel,
  type PaymentChallenge,
  type PaymentReceipt,
  isPaymentChallenge,
  isPaymentReceipt,
} from "./schema.ts";
export { NonceStore } from "./nonce.ts";
export { type PaymentRecord, type PaymentRpc, MockRpc } from "./rpc.ts";
export { type DataSnapshot, buildSnapshot } from "./snapshot.ts";
export { type PaywallConfig, type PaywallResult, Paywall } from "./paywall.ts";

export const name = "x402";
