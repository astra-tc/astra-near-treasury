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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function section(title: string) {
  console.log("\n=== " + title + " ===");
}

// Collected for dashboard/data/demo_run.json (rendered by `pnpm dashboard`).
const record: {
  generatedAt: string;
  x402: { step: string; status: number; detail: string }[];
  ceo: { label: string; approved: boolean; reason: string; amount: string }[];
  ceoFinal?: { balance: string; spentToday: string };
  intents?: { mode: "fixture" | "live"; summary: string };
} = { generatedAt: new Date().toISOString(), x402: [], ceo: [] };

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
record.x402.push({
  step: "GET snapshot without payment",
  status: unpaid.status,
  detail: unpaid.status === 402 ? `402 challenge amount=${unpaid.body.amount} receiver=${unpaid.body.receiver}` : "unexpected",
});

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
  record.x402.push({
    step: "retry with settled payment receipt",
    status: paid.status,
    detail: paid.status === 200 ? `served ${paid.body.resource}` : "rejected",
  });
  const replay = await paywall.handle({
    paymentId,
    nonce: challenge.nonce,
    amount: challenge.amount,
    receiver: challenge.receiver,
    network: challenge.network,
  });
  console.log("replay same receipt →", replay.status);
  record.x402.push({
    step: "replay the same receipt",
    status: replay.status,
    detail: replay.status === 200 ? "served (unexpected)" : "refused (nonce already used)",
  });
}

section("2) CEO → spend_guard mock (within cap / over cap)");
const { results, finalState } = proposeSpends(demoInitialState(), demoProposals());
for (const r of results) {
  console.log(
    `${r.proposal.label}: ${r.decision.approved ? "APPROVED" : "REJECTED"} (${r.decision.reason}) amount=${r.proposal.amount}`,
  );
  record.ceo.push({
    label: r.proposal.label,
    approved: r.decision.approved,
    reason: r.decision.reason,
    amount: String(r.proposal.amount),
  });
}
record.ceoFinal = {
  balance: String(finalState.balance),
  spentToday: String(finalState.spentToday),
};
console.log(
  `final balance=${finalState.balance} spentToday=${finalState.spentToday}`,
);

section("3) Intents dry quote (read-only)");
if (process.env.ASTRA_INTENTS_LIVE === "1") {
  const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const live = await requestDryQuote({ ...DEMO_DRY_QUOTE_PARAMS, deadline });
  console.log("live:", summarizeQuote(live));
  record.intents = { mode: "live", summary: summarizeQuote(live) };
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
  record.intents = { mode: "fixture", summary: summarizeQuote(parsed) };
  console.log("(set ASTRA_INTENTS_LIVE=1 for a live dry:true POST)");
}

section("4) spend_guard on a local NEAR sandbox (near-workspaces)");
if (process.env.ASTRA_SANDBOX === "1") {
  const root = join(__dirname, "..");
  const build = spawnSync("bash", ["scripts/build-wasm.sh"], { cwd: root, stdio: "inherit" });
  const run =
    build.status === 0
      ? spawnSync("cargo", ["run", "-q", "-p", "astra_sandbox", "--bin", "sandbox_demo"], {
          cwd: root,
          stdio: "inherit",
        })
      : build;
  if (run.status !== 0) {
    console.error("sandbox step failed (needs Rust + wasm32 target); offline sections above still valid");
    process.exitCode = 1;
  }
} else {
  console.log("skipped — run `ASTRA_SANDBOX=1 pnpm demo` (or `pnpm demo:sandbox`) to deploy spend_guard");
  console.log("to a local near-workspaces node and watch the agent's FC key get blocked on-chain.");
}

const dataDir = join(__dirname, "..", "dashboard", "data");
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, "demo_run.json"), JSON.stringify(record, null, 2) + "\n");
console.log("\nwrote dashboard/data/demo_run.json — `pnpm dashboard` renders it");
console.log("Demo complete. No testnet/mainnet txs signed.");
