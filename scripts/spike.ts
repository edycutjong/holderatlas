/**
 * Day-one spike (kitchen output → ../specs/spike.md). Five tokens through the exact engine path:
 * what share of analysed supply can be placed on a country with the transfers+lookup path, at what cost?
 *   source ~/.config/nansen/meridian.env && npm run spike
 */
import { CachedNansenClient, DiskCache, atlas } from "@holderatlas/core";

const TOKENS: Array<{ input: string; chain?: "ethereum" | "base" | "bnb" | "solana"; why: string }> = [
  { input: "MEW", chain: "solana", why: "Solana meme (cat in a dogs world) — the unsupported-for-naming state" },
  { input: "PEPE", chain: "ethereum", why: "the demo query: Binance-heavy custody + self-custody whales" },
  { input: "LINK", chain: "ethereum", why: "blue chip: custody spread across many exchanges" },
  { input: "WLFI", chain: "ethereum", why: "new / thin exchange history" },
  { input: "USDC", chain: "ethereum", why: "stablecoin: contracts and custody dominate" },
  { input: "DEGEN", chain: "base", why: "base chain, Coinbase-heavy" },
];
const holders = Number(process.env.SPIKE_HOLDERS ?? 30);
const custody = Number(process.env.SPIKE_CUSTODY ?? 10);

const client = new CachedNansenClient(process.env.NANSEN_API_KEY ?? "", { store: new DiskCache(".cache"), ttlMs: 24 * 3600 * 1000 });
const results: Array<Record<string, unknown>> = [];
for (const t of TOKENS) {
  const before = client.creditsSpent;
  console.log(`\n=== ${t.input} (${t.chain ?? "auto"}) — ${t.why}`);
  try {
    const a = await atlas(client, t.input, {
      chain: t.chain,
      holders,
      custody,
      onProgress: (e) => {
        if (e.type === "wallet") {
          const r = e.row;
          console.log(`  ${r.kind.padEnd(7)} ${r.address.slice(0, 10)} ${(r.share * 100).toFixed(2).padStart(6)}%  ${r.via ?? "-"}  ${r.entityLabel ?? (r.error ? "ERR " + r.error : "—")}  → ${r.exchange ?? "?"} ${r.country ?? ""} [${r.bucket}] ${r.calls} calls`);
        }
        if (e.type === "holders") console.log(`  holders fetched ${e.fetched}: custody ${e.custody} · human ${e.human} · structural ${e.structural} → examining ${e.examined.custody}+${e.examined.human}`);
      },
    });
    const line = {
      token: `${a.token.symbol}/${a.chain}`,
      attributable: +(a.attributable * 100).toFixed(1),
      byWallets: +(a.attributableByWallets * 100).toFixed(1),
      custody: +(a.custodyShare * 100).toFixed(1),
      global: +(a.global.share * 100).toFixed(1),
      untraced: +(a.untraced.share * 100).toFixed(1),
      unnamed: +(a.unnamed.share * 100).toFixed(1),
      otherEntity: +(a.otherEntity.share * 100).toFixed(1),
      errors: a.errors.wallets,
      coverage: +(a.coverage * 100).toFixed(1),
      structural: +(a.structuralShare * 100).toFixed(1),
      countries: a.countries.map((c) => `${c.code} ${(c.share * 100).toFixed(1)}% (${c.wallets})`).join(" · "),
      credits: client.creditsSpent - before,
      calls: a.calls.length,
      ms: a.ms,
      hash: a.hash,
      entities: [...new Set(a.rows.map((r) => r.entityLabel).filter(Boolean))].join(" | "),
      warnings: a.warnings.join(" / "),
    };
    results.push(line);
    console.log(JSON.stringify(line));
  } catch (e) {
    console.log("  FAILED:", (e as Error).message);
    results.push({ token: t.input, error: (e as Error).message, credits: client.creditsSpent - before });
  }
}
console.log("\n=== SUMMARY");
console.table(results.map(({ entities: _e, warnings: _w, countries: _c, ...r }) => r));
for (const r of results) console.log(r.token, "→", r.countries, "| entities:", r.entities, "| warnings:", r.warnings);
const attr = results.map((r) => r.attributable as number).filter((n) => typeof n === "number").sort((a, b) => a - b);
console.log("median attributable (supply-weighted):", attr[Math.floor(attr.length / 2)], "% over", attr.length, "tokens · total credits", client.creditsSpent);
