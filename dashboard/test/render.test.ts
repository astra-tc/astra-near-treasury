import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { esc, renderHtml, summarize, type SandboxRun } from "../src/render.ts";

const here = dirname(fileURLToPath(import.meta.url));
const run: SandboxRun = JSON.parse(
  readFileSync(join(here, "fixtures", "sandbox_run.json"), "utf8"),
);

test("summary math: headroom = min(balance-reserve, cap-spent)", () => {
  const s = summarize(run);
  assert.equal(s.balance, 950n);
  assert.equal(s.spentToday, 50n);
  assert.equal(s.headroom, 50n);
  assert.equal(s.allowed, 2);
  assert.equal(s.blocked, 6);
  assert.ok(s.events >= 4);
});

test("headroom clamps to zero when balance is at the reserve", () => {
  const s = summarize({ ...run, views: { ...run.views, balance: "100", spent_today: "0" } });
  assert.equal(s.headroom, 0n);
});

test("html shows blocked FC-key attempts and escapes data", () => {
  const html = renderHtml(run, null);
  assert.match(html, /MethodNameMismatch/);
  assert.match(html, /RequiresFullAccess/);
  assert.match(html, /BLOCKED/);
  assert.match(html, /pnpm demo<\/code>/);
  assert.equal(esc(`<script>"x"</script>`), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
});

test("renders with no data at all", () => {
  const html = renderHtml(null, null);
  assert.match(html, /pnpm demo:sandbox/);
});
