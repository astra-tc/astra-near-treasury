/**
 * Offline one-command demo: x402 paywall → CEO mock spends → intents dry quote (fixture).
 * No network signing. Live Intents optional via ASTRA_INTENTS_LIVE=1.
 */
import { Paywall, MockRpc } from "../x402/src/index.ts";
import {
  proposeSpends,
  demoProposals,
  demoInitialState,
} from "../agents/src/index.ts";
import {
  DEMO_DRY_QUOTE_PARAMS,
  requestDryQuote,
  summarizeQuote,
  parseQuoteResponse,
} from "../intents/src/index.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function section(title: string) {
  console.log("\n=== " + title + " ===");
}

section("1) x402 sandbox paywall");
const rpc = new MockRpc();
const paywall = new Paywall({
  amount: "1000000",
  receiver: "treasury.sandbox",
  network: "sandbox",
  resource: "treasury-snapshot",
  rpc,
  now: () => new Date("2026-11-06T19:00:00.000Z"),
  newNonce: () => "demo-nonce-1",
});

const unpaid = await paywall.handle(null);
console.log("unpaid →", unpaid.status, unpaid.body);

if (unpaid.status === 402) {
  const challenge = unpaid.body;
  const paymentId = "demo-pay-1";
  rpc.seed({
    paymentId,
    amount: challenge.amount,
    receiver: challenge.receiver,
    settled: true,
  });
  const paid = await paywall.handle({
    paymentId,
    nonce: challenge.nonce,
    amount: challenge.amount,
    receiver: challenge.receiver,
    network: challenge.network,
  });
  console.log(
    "paid →",
    paid.status,
    paid.status === 200 ? `snapshot resource=${paid.body.resource}` : paid.body,
  );
}

section("2) CEO → spend_guard mock (within cap / over cap)");
const { results, finalState } = proposeSpends(demoInitialState(), demoProposals());
for (const r of results) {
  console.log(
    `${r.proposal.label}: ${r.decision.approved ? "APPROVED" : "REJECTED"} (${r.decision.reason}) amount=${r.proposal.amount}`,
  );
}
console.log(
  `final balance=${finalState.balance} spentToday=${finalState.spentToday}`,
);

section("3) Intents dry quote (read-only)");
if (process.env.ASTRA_INTENTS_LIVE === "1") {
  const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const live = await requestDryQuote({ ...DEMO_DRY_QUOTE_PARAMS, deadline });
  console.log("live:", summarizeQuote(live));
} else {
  const fixturePath = join(
    __dirname,
    "..",
    "intents",
    "test",
    "fixtures",
    "dry_quote_wnear_usdc.json",
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const parsed = parseQuoteResponse(fixture.response);
  console.log("fixture:", summarizeQuote(parsed));
  console.log("(set ASTRA_INTENTS_LIVE=1 for a live dry:true POST)");
}

console.log("\nDemo complete. No chain txs signed.");
