/** `pnpm dashboard` — render dashboard/data/*.json into dashboard/out/index.html. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHtml, summarize, type DemoRun, type SandboxRun } from "../src/render.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = <T>(f: string): T | null => {
  const p = join(root, "data", f);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
};
const sandbox = read<SandboxRun>("sandbox_run.json");
const demo = read<DemoRun>("demo_run.json");
mkdirSync(join(root, "out"), { recursive: true });
const out = join(root, "out", "index.html");
writeFileSync(out, renderHtml(sandbox, demo));
if (sandbox) {
  const s = summarize(sandbox);
  console.log(`sandbox: balance=${s.balance} spent=${s.spentToday}/${s.dailyCap} allowed=${s.allowed} blocked=${s.blocked}`);
}
console.log(`demo: ${demo ? "x402 + CEO + intents" : "missing (run pnpm demo)"}`);
console.log(`wrote ${out} — open it in a browser`);
