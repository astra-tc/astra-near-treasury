/**
 * Write agents/demo_proposals.json from demoProposals() + demoInitialState().
 * Usage: pnpm --filter @astra-near/agents export-demo
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeDemoBatch } from "../src/demo_export.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "demo_proposals.json");
writeFileSync(out, JSON.stringify(serializeDemoBatch(), null, 2) + "\n");
console.log("wrote", out);
