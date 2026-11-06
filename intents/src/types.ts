/**
 * Types for NEAR Intents 1Click /v0/quote (dry quotes only).
 * Schema aligned with https://1click.chaindefuser.com/docs/v0/openapi.yaml
 */

export type SwapType = "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT" | "ANY_INPUT";

export type DepositType = "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";

export type RecipientType = "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";

export type RefundType = "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";

/**
 * Fields the caller supplies. `dry` is always forced to true by the client —
 * this package never requests a deposit address.
 */
export interface DryQuoteParams {
  swapType: SwapType;
  slippageTolerance: number;
  originAsset: string;
  depositType: DepositType;
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: RefundType;
  recipient: string;
  recipientType: RecipientType;
  /** ISO-8601 deadline; required by the API. */
  deadline: string;
  depositMode?: "SIMPLE" | "MEMO";
  quoteWaitingTimeMs?: number;
}

export interface QuoteAmounts {
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  timeEstimate: number;
  refundFee?: string;
  withdrawFee?: string;
  /** Must be absent on dry quotes. */
  depositAddress?: string;
  timeWhenInactive?: string;
  deadline?: string;
}

export interface QuoteResponse {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: Record<string, unknown>;
  quote: QuoteAmounts;
}

export interface QuoteClientOptions {
  /** Override fetch (tests inject a fixture-backed mock). */
  fetch?: typeof fetch;
  /** Override endpoint URL (tests may point at a stub). */
  url?: string;
  signal?: AbortSignal;
}
