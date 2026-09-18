#!/usr/bin/env -S npx tsx
import { cachedClientFromEnv, atlas, isChain, AtlasError, countryName, DEFAULT_HOLDERS, DEFAULT_CUSTODY, type Atlas, type Chain } from "@holderatlas/core";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const val = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const chainArg = val("--chain");
const holdersArg = val("--holders");
const custodyArg = val("--custody");
const taken = new Set([chainArg, holdersArg, custodyArg].filter(Boolean));
const input = args.filter((a) => !a.startsWith("--") && !taken.has(a))[0];

if (!input || flags.has("--help")) {
  console.log(`usage: holderatlas <ticker | address> [--chain <chain>] [--holders ${DEFAULT_HOLDERS}] [--custody ${DEFAULT_CUSTODY}] [--json] [--explain] [--no-cache]
  Type a token. One ranked list of the countries its holders reach exchanges from, and the share of supply that covers.
  Chains: ethereum base bnb arbitrum optimism avalanche linea (solana: holders only — exchanges cannot be named there).
  Needs NANSEN_API_KEY (set -a; source ~/.config/nansen/meridian.env; set +a).`);
  process.exit(input ? 0 : 1);
}
if (chainArg && !isChain(chainArg)) {
  console.error(`unsupported chain "${chainArg}"`);
  process.exit(2);
}

const G = "\x1b[32m",
  R = "\x1b[31m",
  Y = "\x1b[33m",
  D = "\x1b[2m",
  B = "\x1b[1m",
  X = "\x1b[0m";
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const bar = (x: number, w = 24) => "█".repeat(Math.round(x * w)).padEnd(w, "░");

const client = cachedClientFromEnv({ ttlMs: flags.has("--no-cache") ? 0 : undefined });
let a: Atlas;
try {
  a = await atlas(client, input, {
    chain: chainArg as Chain | undefined,
    holders: holdersArg ? Number(holdersArg) : undefined,
    custody: custodyArg ? Number(custodyArg) : undefined,
    onProgress: flags.has("--json")
      ? undefined
      : (e) => {
          if (e.type === "token") process.stderr.write(`${D}${e.token.symbol} on ${e.token.chain} ${e.token.address}${X}\n`);
          if (e.type === "holders")
            process.stderr.write(
              `${D}holders ${e.fetched}: ${e.custody} exchange custody · ${e.human} people · ${e.structural} pools/contracts → examining ${e.examined.custody} + ${e.examined.human}${X}\n`,
            );
          if (e.type === "wallet" && flags.has("--explain")) {
            const r = e.row;
            const where = r.country
              ? r.country === "global"
                ? `${D}global${X}`
                : `${G}${r.country}${X}`
              : r.bucket === "untraced"
                ? `${D}no exchange trace${X}`
                : r.bucket === "unnamed"
                  ? `${Y}unnamed${X}`
                  : r.bucket === "error"
                    ? `${R}${r.error}${X}`
                    : `${Y}${r.entityLabel} (not in table)${X}`;
            process.stderr.write(
              `  ${r.kind.padEnd(7)} ${short(r.address).padEnd(14)} ${pct(e.topShare).padStart(6)} of top-100  ${(r.via ?? "-").padEnd(10)} ${where}  ${D}${r.calls} calls · ${r.credits} cr${X}\n`,
            );
          }
        },
  });
} catch (e) {
  if (e instanceof AtlasError) {
    console.error(`${R}${e.message}${X}`);
    if (e.candidates.length) console.error(`${D}Nansen found: ${e.candidates.map((c) => `${c.symbol}/${c.chain}`).join(", ")}${X}`);
    process.exit(3);
  }
  console.error(`${R}${(e as Error).message}${X}`);
  process.exit(4);
}

if (flags.has("--json")) {
  console.log(JSON.stringify(a, null, 2));
  process.exit(0);
}

console.log(`\n${B}${a.token.symbol}${X} ${D}${a.token.name} · ${a.chain} · ${a.token.address}${X}`);
console.log(`\n${B}${G}${pct(a.attributable)}${X}${B} of analysed supply placed on a country${X} ${D}(${pct(a.attributableByWallets)} of wallets)${X}\n`);
for (const c of a.countries)
  console.log(
    `${G}${bar(c.share)}${X} ${c.code}  ${pct(c.share).padStart(6)}  ${D}${c.wallets} wallet${c.wallets === 1 ? "" : "s"} · ${c.exchanges.join(", ")}${X}`,
  );
if (a.global.wallets)
  console.log(
    `${D}${bar(a.global.share)} --  ${pct(a.global.share).padStart(6)}  global exchanges, no location by design · ${a.global.exchanges.join(", ")}${X}`,
  );
if (a.otherEntity.wallets)
  console.log(
    `${D}${bar(a.otherEntity.share)} ??  ${pct(a.otherEntity.share).padStart(6)}  entities not in exchanges.json · ${a.otherEntity.exchanges.join(", ")}${X}`,
  );
if (a.unnamed.wallets)
  console.log(
    `${Y}${bar(a.unnamed.share)}${X} ${D}??  ${pct(a.unnamed.share).padStart(6)}  ${a.naming ? "exchange transfer found, no entity label on the lookup" : `exchanges Nansen cannot name on ${a.chain}`} · ${a.unnamed.wallets} wallet${a.unnamed.wallets === 1 ? "" : "s"}${X}`,
  );
if (a.untraced.wallets)
  console.log(
    `${D}${bar(a.untraced.share)} ··  ${pct(a.untraced.share).padStart(6)}  no exchange trace in 1 year · ${a.untraced.wallets} wallet${a.untraced.wallets === 1 ? "" : "s"}${X}`,
  );
if (a.errors.wallets)
  console.log(
    `${R}${bar(a.errors.share)} !!  ${pct(a.errors.share).padStart(6)}  lookup failed · ${a.errors.wallets} wallet${a.errors.wallets === 1 ? "" : "s"}${X}`,
  );
console.log(
  `\n${D}analysed ${a.examined.custody + a.examined.human} of ${a.holdersFetched} top holders = ${pct(a.coverage)} of their supply · exchange custody ${pct(a.custodyShare)} · pools/contracts excluded ${pct(a.structuralShare)} · countries = ${a.countries.map((c) => countryName(c.code)).join(", ") || "none"}${X}`,
);
for (const w of a.warnings) console.log(`${Y}⚠ ${w}${X}`);
const hits = a.calls.filter((c) => c.cached).length;
const failed = a.calls.filter((c) => !c.ok);
for (const f of failed.slice(0, 5)) console.log(`${R}✗ ${f.endpoint} — ${f.error} (${(f.totalMs / 1000).toFixed(1)}s)${X}`);
console.log(
  `${D}${a.credits} credits · ${a.calls.length} calls (${hits} cached${client.oldestHit ? `, as of ${client.oldestHit.slice(0, 16).replace("T", " ")} UTC` : ""}) · ${(a.ms / 1000).toFixed(1)}s · atlas ${a.hash}${X}`,
);
if (flags.has("--explain")) {
  console.log(`\n${D}calls:${X}`);
  const byEp = new Map<string, { n: number; cr: number; ms: number; cached: number }>();
  for (const c of a.calls) {
    const e = byEp.get(c.endpoint) ?? { n: 0, cr: 0, ms: 0, cached: 0 };
    e.n++;
    e.cr += c.credits;
    e.ms += c.ms;
    if (c.cached) e.cached++;
    byEp.set(c.endpoint, e);
  }
  for (const [ep, e] of byEp)
    console.log(
      `${D}  ${ep.padEnd(40)} ${String(e.n).padStart(3)} calls  ${String(e.cr).padStart(4)} cr  ${e.cached} cached  ${(e.ms / Math.max(1, e.n - e.cached)).toFixed(0)} ms avg live${X}`,
    );
}
