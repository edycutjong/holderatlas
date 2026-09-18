/**
 * Proof numbers for the README: cold (fresh store, every call live) vs warm (same store, second run) latency, credits
 * and calls per atlas, failed calls, and whether the warm hash equals the cold hash. Writes Markdown to stdout.
 *
 *   set -a; source ~/.config/nansen/meridian.env; set +a; npm run bench -- PEPE WLFI DEGEN MOG > docs/BENCH.md   # ~450 credits
 *   npm run bench -- --runs 2 PEPE                                                                                  # one token, twice
 */
import { CachedNansenClient, MemoryCache, atlas } from "../packages/core/src/index.js";
import { FIXTURE_SET } from "./fixture-set.js";

const argv = process.argv.slice(2);
const runsIdx = argv.indexOf("--runs");
const runs = runsIdx >= 0 ? Number(argv[runsIdx + 1]) : 1;
const wanted = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--runs").map((q) => q.toUpperCase());
const set = FIXTURE_SET.filter((f) => f.input !== "XQZPLM" && (!wanted.length || wanted.includes(f.input.toUpperCase())));
const apiKey = process.env.NANSEN_API_KEY ?? "";

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};

type Row = { input: string; coldMs: number[]; warmMs: number[]; credits: number[]; calls: number[]; failed: number; hashStable: boolean; result: string };
const rows: Row[] = [];
let liveCalls = 0,
  liveCredits = 0;

for (const f of set) {
  const row: Row = { input: `${f.input} --chain ${f.chain}`, coldMs: [], warmMs: [], credits: [], calls: [], failed: 0, hashStable: true, result: "" };
  let hash: string | undefined;
  for (let i = 0; i < runs; i++) {
    const store = new MemoryCache();
    const client = new CachedNansenClient(apiKey, { store });
    const cold = await atlas(client, f.input, { chain: f.chain, holders: f.holders, custody: f.custody });
    const warm = await atlas(client, f.input, { chain: f.chain, holders: f.holders, custody: f.custody });
    row.coldMs.push(cold.ms);
    row.warmMs.push(warm.ms);
    row.credits.push(cold.credits);
    const live = cold.calls.filter((c) => !c.cached);
    row.calls.push(live.length);
    row.failed += cold.calls.filter((c) => !c.ok).length;
    liveCalls += live.length;
    liveCredits += cold.credits;
    if (warm.hash !== cold.hash) row.hashStable = false;
    if (hash && hash !== cold.hash) row.hashStable = false; // live data can legitimately move between runs; reported, not asserted
    hash = cold.hash;
    row.result = `${(cold.attributable * 100).toFixed(1)} % · ${cold.countries.slice(0, 3).map((c) => `${c.code} ${(c.share * 100).toFixed(0)}`).join(" ") || "—"}`;
  }
  rows.push(row);
  console.error(`${row.input.padEnd(24)} cold p50 ${pct(row.coldMs, 50)} ms · warm p50 ${pct(row.warmMs, 50)} ms · ${pct(row.credits, 50)} cr · ${row.result}${row.failed ? ` · ${row.failed} failed calls` : ""}${row.hashStable ? "" : " · hash moved between runs"}`);
}

const allCold = rows.flatMap((r) => r.coldMs),
  allWarm = rows.flatMap((r) => r.warmMs),
  allCr = rows.flatMap((r) => r.credits),
  allCalls = rows.flatMap((r) => r.calls);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
console.log(`## Benchmark — ${new Date().toISOString().slice(0, 16)}Z · ${set.length} tokens × ${runs} cold run${runs > 1 ? "s" : ""} · live Nansen API · defaults (12 custody + 40 human wallets, 4-wide lookup pool, 5 rps)\n`);
console.log(`| token | cold p50 | cold p95 | warm p50 | credits | live calls | failed | result | warm hash = cold |`);
console.log(`|---|---|---|---|---|---|---|---|---|`);
for (const r of rows)
  console.log(`| ${r.input} | ${(pct(r.coldMs, 50) / 1000).toFixed(1)} s | ${(pct(r.coldMs, 95) / 1000).toFixed(1)} s | ${pct(r.warmMs, 50)} ms | ${pct(r.credits, 50)} | ${pct(r.calls, 50)} | ${r.failed} | ${r.result} | ${r.hashStable ? "yes" : "no"} |`);
console.log(
  `\n**All tokens:** cold p50 **${(pct(allCold, 50) / 1000).toFixed(1)} s** · p95 **${(pct(allCold, 95) / 1000).toFixed(1)} s** · warm p50 **${pct(allWarm, 50)} ms** · mean **${mean(allCr).toFixed(1)} credits** and **${mean(allCalls).toFixed(1)} live calls** per atlas · max ${Math.max(...allCr)} credits · ${rows.reduce((n, r) => n + r.failed, 0)} failed calls in ${allCalls.reduce((a, b) => a + b, 0)} · this run spent ${liveCredits} credits over ${liveCalls} live calls.`,
);
