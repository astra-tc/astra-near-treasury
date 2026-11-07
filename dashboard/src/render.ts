/**
 * Dashboard renderer: turns demo outputs into one self-contained HTML page.
 *
 * Inputs (both optional, produced by the demos):
 *   data/sandbox_run.json  — `pnpm demo:sandbox` (spend_guard on a local NEAR sandbox)
 *   data/demo_run.json     — `pnpm demo` (x402 loop, CEO mock, Intents dry quote)
 * No network, no frameworks; the output opens straight from disk.
 */

export interface SandboxStep {
  label: string;
  actor: string;
  action: string;
  ok: boolean;
  detail: string;
  events: { event?: string; standard?: string; data?: Record<string, unknown> }[];
}

export interface SandboxRun {
  source: string;
  network: string;
  views: {
    contract: string;
    owner: string;
    agent: string;
    agent_key_methods: string[];
    balance: string;
    spent_today: string;
    reserve: string;
    daily_cap: string;
  };
  steps: SandboxStep[];
}

export interface DemoRun {
  generatedAt: string;
  x402: { step: string; status: number; detail: string }[];
  ceo: { label: string; approved: boolean; reason: string; amount: string }[];
  ceoFinal?: { balance: string; spentToday: string };
  intents?: { mode: "fixture" | "live"; summary: string };
}

export interface Summary {
  balance: bigint;
  reserve: bigint;
  dailyCap: bigint;
  spentToday: bigint;
  /** What the agent could still spend today under both rules. */
  headroom: bigint;
  allowed: number;
  blocked: number;
  events: number;
}

export function summarize(run: SandboxRun): Summary {
  const balance = BigInt(run.views.balance);
  const reserve = BigInt(run.views.reserve);
  const dailyCap = BigInt(run.views.daily_cap);
  const spentToday = BigInt(run.views.spent_today);
  const aboveReserve = balance > reserve ? balance - reserve : 0n;
  const capLeft = dailyCap > spentToday ? dailyCap - spentToday : 0n;
  return {
    balance,
    reserve,
    dailyCap,
    spentToday,
    headroom: aboveReserve < capLeft ? aboveReserve : capLeft,
    allowed: run.steps.filter((s) => s.ok).length,
    blocked: run.steps.filter((s) => !s.ok).length,
    events: run.steps.reduce((n, s) => n + s.events.length, 0),
  };
}

export function esc(v: unknown): string {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const ORG = [
  ["Board (humans)", "writes the rules → owner key → set_policy"],
  ["CEO agent", "routes work, proposes spends"],
  ["Sales / x402", "earns: 402 → pay → verify → serve"],
  ["Treasury agent", "FC key: propose_spend / execute_spend only"],
  ["spend_guard (NEAR)", "enforces cap, reserve, allow-list, replay"],
];

function badge(ok: boolean, yes = "ALLOWED", no = "BLOCKED"): string {
  return `<span class="b ${ok ? "ok" : "no"}">${ok ? yes : no}</span>`;
}

function pct(n: bigint, d: bigint): number {
  if (d === 0n) return 0;
  const p = Number((n * 1000n) / d) / 10;
  return Math.max(0, Math.min(100, p));
}

export function renderHtml(sandbox: SandboxRun | null, demo: DemoRun | null): string {
  const parts: string[] = [];
  parts.push(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Astra Treasury — spend_guard dashboard</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:0;background:#0d1117;color:#e6edf3}
main{max-width:1100px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:28px 0 10px;color:#9fb3c8}
.sub{color:#8b949e} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px}
.k{color:#8b949e;font-size:12px} .v{font-size:22px;font-weight:600}
table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d}
th,td{padding:7px 9px;border-bottom:1px solid #30363d;text-align:left;vertical-align:top}
th{color:#8b949e;font-weight:500;font-size:12px} code{font-size:12px;color:#c9d1d9}
.b{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:700}
.ok{background:#1f6f3f;color:#d2ffe0} .no{background:#8b1d2c;color:#ffd7dc}
.bar{height:8px;background:#30363d;border-radius:4px;overflow:hidden;margin-top:6px}
.bar i{display:block;height:100%;background:#2f81f7}
.org{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.org div{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:8px 10px;flex:1;min-width:160px}
.org b{display:block}
</style></head><body><main>
<h1>Astra Treasury — spend_guard dashboard</h1>
<div class="sub">Agents earn and spend; the Board's rules are enforced by a NEAR contract. Data below comes from local demo runs (no testnet/mainnet).</div>`);

  parts.push(`<h2>Org chart → who holds which key</h2><div class="org">${ORG.map(
    ([t, d]) => `<div><b>${esc(t)}</b><span class="sub">${esc(d)}</span></div>`,
  ).join("")}</div>`);

  if (sandbox) {
    const s = summarize(sandbox);
    parts.push(`<h2>Treasury (spend_guard on ${esc(sandbox.source)})</h2>
<div class="grid">
<div class="card"><div class="k">Tracked balance</div><div class="v">${s.balance}</div><div class="k">reserve floor ${s.reserve}</div></div>
<div class="card"><div class="k">Spent today / daily cap</div><div class="v">${s.spentToday} / ${s.dailyCap}</div><div class="bar"><i style="width:${pct(s.spentToday, s.dailyCap)}%"></i></div></div>
<div class="card"><div class="k">Agent headroom now</div><div class="v">${s.headroom}</div><div class="k">min(balance−reserve, cap−spent)</div></div>
<div class="card"><div class="k">Actions allowed / blocked</div><div class="v">${s.allowed} / ${s.blocked}</div><div class="k">${s.events} NEP-297 events</div></div>
</div>
<p class="sub">contract <code>${esc(sandbox.views.contract)}</code> · owner <code>${esc(sandbox.views.owner)}</code> · agent <code>${esc(sandbox.views.agent)}</code> (FC key: ${sandbox.views.agent_key_methods.map((m) => `<code>${esc(m)}</code>`).join(", ")})</p>
<h2>Agent actions against the contract</h2>
<table><tr><th>Scenario</th><th>Actor</th><th>Action</th><th>Result</th><th>Why</th><th>Events</th></tr>
${sandbox.steps
  .map(
    (st) => `<tr><td>${esc(st.label)}</td><td>${esc(st.actor)}</td><td><code>${esc(st.action)}</code></td><td>${badge(st.ok)}</td><td>${esc(st.detail)}</td><td>${st.events
      .map((e) => `<code>${esc(e.standard ?? "")}:${esc(String(e.data?.reason ?? e.event ?? ""))}</code>`)
      .join("<br>")}</td></tr>`,
  )
  .join("\n")}
</table>`);
  } else {
    parts.push(`<h2>Treasury</h2><p class="sub">No sandbox run yet — run <code>pnpm demo:sandbox</code>.</p>`);
  }

  if (demo) {
    parts.push(`<h2>Revenue side: x402 paywall</h2><table><tr><th>Step</th><th>HTTP</th><th>Detail</th></tr>
${demo.x402.map((r) => `<tr><td>${esc(r.step)}</td><td>${badge(r.status === 200 || r.status === 402, String(r.status), String(r.status))}</td><td>${esc(r.detail)}</td></tr>`).join("\n")}
</table>
<h2>CEO proposals (policy check)</h2><table><tr><th>Proposal</th><th>Amount</th><th>Decision</th><th>Reason</th></tr>
${demo.ceo.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.amount)}</td><td>${badge(r.approved, "APPROVED", "REJECTED")}</td><td>${esc(r.reason)}</td></tr>`).join("\n")}
</table>
${demo.intents ? `<h2>Paying vendors cross-chain: NEAR Intents dry quote (${esc(demo.intents.mode)})</h2><div class="card"><code>${esc(demo.intents.summary)}</code></div>` : ""}
<p class="sub">offline demo generated ${esc(demo.generatedAt)}</p>`);
  } else {
    parts.push(`<p class="sub">No offline demo run yet — run <code>pnpm demo</code>.</p>`);
  }

  parts.push(`</main></body></html>\n`);
  return parts.join("\n");
}
