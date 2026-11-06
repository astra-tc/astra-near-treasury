/**
 * Optional live dry-quote smoke (network). Not part of default `pnpm test`.
 * Usage: pnpm --filter @astra-near/intents quote:live
 */
import {
  DEMO_DRY_QUOTE_PARAMS,
  requestDryQuote,
  summarizeQuote,
} from "../src/index.ts";

const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

const res = await requestDryQuote({
  ...DEMO_DRY_QUOTE_PARAMS,
  deadline,
});

console.log(summarizeQuote(res));
console.log("ok: dry quote (no depositAddress)");
