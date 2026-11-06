/**
 * Read-only NEAR Intents 1Click dry-quote client.
 *
 * Always POSTs with dry:true. Never initiates a swap or returns a usable
 * deposit address for funding. No auth / JWT required for default fees.
 */

import type {
  DryQuoteParams,
  QuoteAmounts,
  QuoteClientOptions,
  QuoteResponse,
} from "./types.ts";

export const ONECLICK_QUOTE_URL = "https://1click.chaindefuser.com/v0/quote";

/** Demo params: 1 wNEAR → NEAR native USDC via Intents balances (dry). */
export const DEMO_DRY_QUOTE_PARAMS: DryQuoteParams = {
  swapType: "EXACT_INPUT",
  slippageTolerance: 100,
  originAsset: "nep141:wrap.near",
  depositType: "INTENTS",
  destinationAsset:
    "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  amount: "1000000000000000000000000",
  recipient: "treasury-demo.near",
  recipientType: "INTENTS",
  refundTo: "treasury-demo.near",
  refundType: "INTENTS",
  deadline: "2099-01-01T00:00:00.000Z",
};

export class DryQuoteError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`1Click dry quote failed: HTTP ${status}: ${body}`);
    this.name = "DryQuoteError";
    this.status = status;
    this.body = body;
  }
}

/** Reject any quote payload that includes a deposit address (non-dry leak). */
export function assertNoDepositAddress(quote: QuoteAmounts | Record<string, unknown>): void {
  if (
    Object.prototype.hasOwnProperty.call(quote, "depositAddress") &&
    (quote as { depositAddress?: unknown }).depositAddress != null &&
    (quote as { depositAddress?: unknown }).depositAddress !== ""
  ) {
    throw new Error(
      "dry quote unexpectedly included depositAddress — refusing to accept non-dry response",
    );
  }
}

function isQuoteAmounts(value: unknown): value is QuoteAmounts {
  if (!value || typeof value !== "object") return false;
  const q = value as Record<string, unknown>;
  const required = [
    "amountIn",
    "amountInFormatted",
    "amountInUsd",
    "minAmountIn",
    "amountOut",
    "amountOutFormatted",
    "amountOutUsd",
    "minAmountOut",
    "timeEstimate",
  ] as const;
  for (const key of required) {
    if (!(key in q)) return false;
  }
  return typeof q.amountIn === "string" && typeof q.amountOut === "string";
}

function isQuoteResponse(value: unknown): value is QuoteResponse {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.correlationId === "string" &&
    typeof r.timestamp === "string" &&
    typeof r.signature === "string" &&
    typeof r.quoteRequest === "object" &&
    r.quoteRequest !== null &&
    isQuoteAmounts(r.quote)
  );
}

export function parseQuoteResponse(value: unknown): QuoteResponse {
  if (!isQuoteResponse(value)) {
    throw new Error("1Click response is not a QuoteResponse");
  }
  assertNoDepositAddress(value.quote);
  if (value.quoteRequest.dry !== true) {
    throw new Error("1Click quoteRequest.dry is not true");
  }
  return value;
}

/**
 * Request a dry (read-only) swap quote. Forces `dry: true` regardless of input.
 */
export async function requestDryQuote(
  params: DryQuoteParams,
  opts: QuoteClientOptions = {},
): Promise<QuoteResponse> {
  const url = opts.url ?? ONECLICK_QUOTE_URL;
  const fetchFn = opts.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("fetch is not available; inject opts.fetch for offline use");
  }

  const body = {
    ...params,
    dry: true as const,
  };

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "AstraTreasury-intents/0.1 (+https://github.com/astra-tc/astra-near-treasury)",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  const text = await res.text();
  // API returns 201 Created for successful quotes (observed 2026-11-06).
  if (res.status !== 200 && res.status !== 201) {
    throw new DryQuoteError(res.status, text);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`1Click dry quote returned non-JSON body: ${text.slice(0, 200)}`);
  }

  return parseQuoteResponse(json);
}

/** Summarize a quote for demo / logging (no secrets). */
export function summarizeQuote(res: QuoteResponse): string {
  const q = res.quote;
  const req = res.quoteRequest;
  return [
    `dry=${String(req.dry)}`,
    `${String(req.originAsset)} → ${String(req.destinationAsset)}`,
    `in=${q.amountInFormatted} ($${q.amountInUsd})`,
    `out≈${q.amountOutFormatted} ($${q.amountOutUsd})`,
    `minOut=${q.minAmountOut}`,
    `eta=${q.timeEstimate}s`,
    `corr=${res.correlationId}`,
  ].join(" | ");
}
