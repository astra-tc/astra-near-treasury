/**
 * @astra-near/intents — read-only NEAR Intents 1Click dry-quote client.
 *
 * Always uses dry:true. No deposits, no signing, no JWT required.
 */

export type {
  SwapType,
  DepositType,
  RecipientType,
  RefundType,
  DryQuoteParams,
  QuoteAmounts,
  QuoteResponse,
  QuoteClientOptions,
} from "./types.ts";

export {
  ONECLICK_QUOTE_URL,
  DEMO_DRY_QUOTE_PARAMS,
  DryQuoteError,
  assertNoDepositAddress,
  parseQuoteResponse,
  requestDryQuote,
  summarizeQuote,
} from "./quote.ts";

export const name = "intents";
