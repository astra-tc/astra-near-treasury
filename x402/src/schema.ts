/**
 * HTTP 402 Payment Required challenge schema for the sandbox paywall.
 * Network is a label only (sandbox / testnet) — no live chain calls.
 */

export type NetworkLabel = "sandbox" | "testnet";

/** Body returned with HTTP 402. */
export interface PaymentChallenge {
  /** Required payment amount in base units (string to avoid precision loss). */
  amount: string;
  /** Treasury / merchant receiver account id. */
  receiver: string;
  /** One-time nonce that must appear on the payment receipt. */
  nonce: string;
  /** Network label — never a live RPC endpoint. */
  network: NetworkLabel;
  /** Human-readable resource being gated. */
  resource: string;
}

/** Client-supplied receipt proving a mock payment. */
export interface PaymentReceipt {
  /** Tx / payment id known to the mock RPC. */
  paymentId: string;
  /** Nonce copied from the challenge. */
  nonce: string;
  /** Amount the payer claims to have sent (base units). */
  amount: string;
  /** Receiver the payer claims to have paid. */
  receiver: string;
  /** Network label from the challenge. */
  network: NetworkLabel;
}

export function isPaymentChallenge(value: unknown): value is PaymentChallenge {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.amount === "string" &&
    typeof v.receiver === "string" &&
    typeof v.nonce === "string" &&
    (v.network === "sandbox" || v.network === "testnet") &&
    typeof v.resource === "string"
  );
}

export function isPaymentReceipt(value: unknown): value is PaymentReceipt {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.paymentId === "string" &&
    typeof v.nonce === "string" &&
    typeof v.amount === "string" &&
    typeof v.receiver === "string" &&
    (v.network === "sandbox" || v.network === "testnet")
  );
}
