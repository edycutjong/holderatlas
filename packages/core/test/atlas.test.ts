import { describe, it, expect } from "vitest";
import { atlas, aggregate, atlasHash, exchangeLabelFor, partition, resolveToken, AtlasError, type AtlasEvent, type WalletRow } from "../src/atlas.js";
import { CachedNansenClient, MemoryCache } from "../src/cache.js";
import { fakeClient, pepeRoutes, PEPE, BINANCE_14, UPBIT, COINBASE, POOL, BURN, CONTRACT, addr, searchTokens, holders, transfers } from "./helpers.js";

const NOW = Date.parse("2026-09-18T12:00:00Z");

describe("resolveToken (search/general, 0 credits)", () => {
  it("ticker → the biggest token by market cap on a supported chain; hyperliquid perps are filtered out", async () => {
    const c = fakeClient(pepeRoutes);
    const { token, candidates } = await resolveToken(c, "pepe");
    expect(token).toMatchObject({ symbol: "PEPE", chain: "ethereum", address: PEPE });
    expect(candidates.map((x) => x.chain)).toEqual(["ethereum", "base", "solana"]);
    expect(c.creditsSpent).toBe(0);
  });
  it("--chain narrows the pick", async () => {
    const { token } = await resolveToken(fakeClient(pepeRoutes), "PEPE", "base");
    expect(token.chain).toBe("base");
  });
  it("an address input matches on address (case-insensitive) and skips the ticker filter", async () => {
    const { token } = await resolveToken(fakeClient(pepeRoutes), PEPE.toUpperCase().replace("0X", "0x"));
    expect(token.address).toBe(PEPE);
  });
  it("an unindexed address with an explicit chain goes straight to holders (unknown symbol)", async () => {
    const { token } = await resolveToken(fakeClient(pepeRoutes), addr(77), "ethereum");
    expect(token).toMatchObject({ address: addr(77), chain: "ethereum", name: "unknown token" });
  });
  it("an unindexed address WITHOUT a chain is a no-token error that says so", async () => {
    await expect(resolveToken(fakeClient(pepeRoutes), addr(77))).rejects.toMatchObject({ code: "no-token", message: /add --chain/ });
  });
  it("no such ticker → AtlasError no-token with the candidates Nansen did return", async () => {
    const err = await resolveToken(fakeClient(pepeRoutes), "XQZPLM").catch((e) => e);
    expect(err).toBeInstanceOf(AtlasError);
    expect(err.code).toBe("no-token");
  });
  it("empty input and an unsupported chain are rejected before any call", async () => {
    let n = 0;
    const c = fakeClient(() => (n++, searchTokens([])));
    await expect(resolveToken(c, "   ")).rejects.toMatchObject({ code: "bad-input" });
    await expect(resolveToken(c, "PEPE", "polygon" as never)).rejects.toMatchObject({ code: "bad-chain" });
    expect(n).toBe(0);
  });
  it("a solana address is recognised as an address", async () => {
    const { token } = await resolveToken(fakeClient(pepeRoutes), "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    expect(token.chain).toBe("solana");
  });
});

describe("partition — holders → custody / human / structural", () => {
  it("burn and pool rows are structural; exchange-set rows are custody; sorted by supply desc", () => {
    const rows = holders([
      { address: addr(1), amount: 10 },
      { address: BURN, amount: 1000 },
      { address: POOL, label: "UniswapV2", amount: 300 },
      { address: BINANCE_14, label: "Token Billionaire", amount: 500 },
    ]).data;
    const p = partition(rows, new Set([BINANCE_14]));
    expect(p.map((r) => r.kind)).toEqual(["structural", "custody", "structural", "human"]);
    expect(p[0].supply).toBe(1000);
  });
  it("rows without an address are dropped; negative amounts clamp to 0; addresses lower-cased", () => {
    const p = partition([{ address: null, token_amount: 5 }, { address: "0xABC", token_amount: -3 }] as never, new Set());
    expect(p).toEqual([{ address: "0xabc", label: null, supply: 0, kind: "human" }]);
  });
});

describe("exchangeLabelFor — which side of the transfer names the exchange", () => {
  const w = addr(1);
  it("human withdrawal: the from side", () => {
    expect(exchangeLabelFor([{ from_address: COINBASE, from_address_label: "🤖 🏦 Coinbase", to_address: w, to_address_label: null, token_address: PEPE }], w, "human", PEPE)).toBe("🤖 🏦 Coinbase");
  });
  it("human deposit: the to side", () => {
    expect(exchangeLabelFor([{ from_address: w, from_address_label: "High Balance", to_address: addr(9), to_address_label: "🏦 Binance: Deposit", token_address: PEPE }], w, "human", PEPE)).toBe("🏦 Binance: Deposit");
  });
  it("custody wallet: its own label", () => {
    expect(exchangeLabelFor([{ from_address: addr(9), from_address_label: null, to_address: w, to_address_label: "🏦 Upbit", token_address: PEPE }], w, "custody", PEPE)).toBe("🏦 Upbit");
  });
  it("prefers transfers of the atlas token; falls back to any 🏦 that is not the wallet; null when none", () => {
    const arr = [
      { from_address: addr(5), from_address_label: "🏦 Kraken", to_address: addr(6), to_address_label: null, token_address: addr(8) },
      { from_address: addr(7), from_address_label: null, to_address: w, to_address_label: "High Activity", token_address: PEPE },
    ];
    expect(exchangeLabelFor(arr, w, "human", PEPE)).toBeNull();
    expect(exchangeLabelFor(arr, w, "human", addr(8))).toBe("🏦 Kraken");
    expect(exchangeLabelFor(null, w, "human", PEPE)).toBeNull();
    expect(exchangeLabelFor([], w, "custody", PEPE)).toBeNull();
  });
});

function row(o: Partial<WalletRow> & { supply: number }): WalletRow {
  return { address: addr(1), kind: "human", label: null, share: 0, entityLabel: null, exchange: null, country: null, bucket: "untraced", via: null, txHash: null, txAt: null, calls: 0, credits: 0, ...o };
}

describe("aggregate — the arithmetic behind the number", () => {
  it("country shares sum to attributable; structural rows are outside the denominator; global is never attributed", () => {
    const rows = [
      row({ address: addr(1), kind: "custody", supply: 50, bucket: "global", exchange: "binance", country: "global" }),
      row({ address: addr(2), supply: 30, bucket: "country", exchange: "upbit", country: "KR" }),
      row({ address: addr(3), supply: 20, bucket: "country", exchange: "coinbase", country: "US" }),
      row({ address: addr(4), kind: "structural", supply: 900 }),
    ];
    const a = aggregate(rows);
    expect(a.analysedSupply).toBe(100);
    expect(a.attributable).toBeCloseTo(0.5, 6);
    expect(a.countries.map((c) => [c.code, c.share])).toEqual([
      ["KR", 0.3],
      ["US", 0.2],
    ]);
    expect(a.global).toMatchObject({ share: 0.5, wallets: 1, exchanges: ["binance"] });
    expect(a.custodyShare).toBe(0.5);
    expect(a.attributableByWallets).toBeCloseTo(2 / 3, 6);
    expect(rows[3].share).toBe(0);
  });
  it("empty → zeros, no NaN", () => {
    const a = aggregate([]);
    expect(a.attributable).toBe(0);
    expect(a.attributableByWallets).toBe(0);
    expect(a.analysedSupply).toBe(0);
    expect(a.countries).toEqual([]);
  });
  it("countries tie-break on code so the order is stable", () => {
    const a = aggregate([row({ address: addr(1), supply: 10, bucket: "country", exchange: "x", country: "US" }), row({ address: addr(2), supply: 10, bucket: "country", exchange: "y", country: "KR" })]);
    expect(a.countries.map((c) => c.code)).toEqual(["KR", "US"]);
  });
});

describe("atlas() end to end on the PEPE model", () => {
  it("names custody wallets, attributes humans, excludes the pool + burn, reclassifies the unlabelled contract", async () => {
    const c = fakeClient(pepeRoutes);
    const events: AtlasEvent[] = [];
    const a = await atlas(c, "PEPE", { now: NOW, onProgress: (e) => events.push(e) });
    expect(a.token.address).toBe(PEPE);
    expect(a.naming).toBe(true);
    const by = Object.fromEntries(a.rows.map((r) => [r.address, r]));
    expect(by[BINANCE_14]).toMatchObject({ kind: "custody", exchange: "binance", country: "global", bucket: "global", via: "custody" });
    expect(by[UPBIT]).toMatchObject({ kind: "custody", exchange: "upbit", country: "KR", bucket: "country" });
    expect(by[addr(1)]).toMatchObject({ kind: "human", exchange: "coinbase", country: "US", via: "withdrawal", bucket: "country" });
    expect(by[addr(4)]).toMatchObject({ kind: "human", exchange: "binance", via: "deposit", bucket: "global" });
    expect(by[addr(5)]).toMatchObject({ kind: "human", bucket: "untraced", exchange: null });
    expect(by[POOL].kind).toBe("structural");
    expect(by[BURN].kind).toBe("structural");
    // the 150-unit unlabelled holder was a contract (related-wallets "Deployed by") → structural, out of the denominator
    expect(by[CONTRACT]).toMatchObject({ kind: "structural", label: expect.stringMatching(/Deployed by/) });
    expect(events.some((e) => e.type === "reclass")).toBe(true);
    // denominator: 500 + 100 + 60 + 40 + 30 + 20 + 10 = 760; countries: KR 100 + US 130 = 230
    expect(a.analysedSupply).toBe(760);
    expect(a.attributable).toBeCloseTo(230 / 760, 6);
    expect(a.countries.map((x) => x.code)).toEqual(["US", "KR"]);
    expect(a.global.share).toBeCloseTo(520 / 760, 6);
    expect(a.untraced.wallets).toBe(1);
    expect(a.structuralShare).toBeCloseTo(1450 / 2210, 6);
    expect(a.hash).toHaveLength(12);
    expect(a.credits).toBe(c.creditsSpent);
    // credits: holders 5+5 · custody 2×2 · humans 3×2 + 1×3 (deposit path) + 1×2 (two empty transfers) · contract 2 empty transfers + 1 related-wallets = 28
    expect(a.credits).toBe(28);
    expect(events.filter((e) => e.type === "wallet")).toHaveLength(8); // 2 custody + 6 "humans" incl. the contract before its reclass
    expect(events.at(-1)?.type).toBe("atlas");
    expect(a.warnings).toEqual([]);
  });
  it("the hash is stable across runs and across completion order (concurrency 1 vs 4)", async () => {
    const a = await atlas(fakeClient(pepeRoutes), "PEPE", { now: NOW, concurrency: 1 });
    const b = await atlas(fakeClient(pepeRoutes), "PEPE", { now: NOW, concurrency: 4 });
    expect(a.hash).toBe(b.hash);
    expect(a.rows.map((r) => r.address)).toEqual(b.rows.map((r) => r.address));
  });
  it("the hash ignores latency/credits but changes when an attribution changes", async () => {
    const a = await atlas(fakeClient(pepeRoutes), "PEPE", { now: NOW });
    const moved = { ...a, rows: a.rows.map((r) => (r.address === UPBIT ? { ...r, country: "JP", exchange: "bitflyer" } : r)) };
    expect(atlasHash(moved)).not.toBe(a.hash);
    expect(atlasHash({ ...a, credits: 999, ms: 1 } as typeof a)).toBe(a.hash);
  });
  it("--holders / --custody cap the examined rows and the caption reports coverage", async () => {
    const a = await atlas(fakeClient(pepeRoutes), "PEPE", { now: NOW, holders: 2, custody: 1 });
    expect(a.examined).toEqual({ custody: 1, human: 2 });
    // the 150-unit contract was among the top-2 "humans" until the contract check moved it out of the denominator
    expect(a.coverage).toBeCloseTo((500 + 60) / 2210, 6);
  });
  it("solana: holders + transfers run, the lookup is skipped, everything traced is 'unnamed', attributable 0 with a warning", async () => {
    let lookups = 0;
    const routes = (e: string, b: Record<string, unknown>) => {
      if (e === "transaction-with-token-transfer-lookup") lookups++;
      if (e === "tgm/holders") return holders([{ address: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", amount: 100 }, { address: "8Mm46CsqxiEz1u4Ykrqv4A1p4HCf9tADJXmSdUsQ6K3Q", amount: 50 }]);
      if (e === "tgm/transfers") return (b.filters as Record<string, string>).to_address ? transfers([{ hash: "abc", from: "x", to: "y" }]) : transfers([]);
      return pepeRoutes(e, b);
    };
    const a = await atlas(fakeClient(routes), "PEPE", { now: NOW, chain: "solana" });
    expect(a.naming).toBe(false);
    expect(lookups).toBe(0);
    expect(a.attributable).toBe(0);
    expect(a.unnamed.wallets).toBe(2);
    expect(a.warnings[0]).toMatch(/solana/);
  });
  it("a failed transfers call marks the row 'error' and never blocks the atlas", async () => {
    const routes = (e: string, b: Record<string, unknown>) => {
      if (e === "tgm/transfers" && (b.filters as Record<string, string>).to_address === addr(1)) return new Response("boom", { status: 500 });
      return pepeRoutes(e, b);
    };
    const a = await atlas(fakeClient(routes, { timeoutMs: 500 }), "PEPE", { now: NOW });
    const r = a.rows.find((x) => x.address === addr(1))!;
    expect(r.bucket).toBe("error");
    expect(r.error).toMatch(/HTTP 500/);
    expect(a.errors.wallets).toBe(1);
    expect(a.warnings.join()).toMatch(/could not be looked up/);
  });
  it("a failed exchange-holders call degrades to 'everyone is human' with a warning", async () => {
    const routes = (e: string, b: Record<string, unknown>) => (e === "tgm/holders" && b.label_type === "exchange" ? new Response("x", { status: 503 }) : pepeRoutes(e, b));
    const a = await atlas(fakeClient(routes), "PEPE", { now: NOW });
    expect(a.examined.custody).toBe(0);
    expect(a.warnings.join()).toMatch(/custody wallets could not be separated/);
  });
  it("a failed holders call is fatal (nothing to draw)", async () => {
    const routes = (e: string, b: Record<string, unknown>) => (e === "tgm/holders" && !b.label_type ? new Response("x", { status: 503 }) : pepeRoutes(e, b));
    await expect(atlas(fakeClient(routes), "PEPE", { now: NOW })).rejects.toThrow(/tgm\/holders failed/);
  });
  it("an entity outside the table lands in other-entity and is named in a warning", async () => {
    const routes = (e: string, b: Record<string, unknown>) => {
      const out = pepeRoutes(e, b) as { data?: Array<{ token_transfer_array: Array<{ to_address_label: string | null }> }> };
      if (e === "transaction-with-token-transfer-lookup" && b.transaction_hash === "0x" + "b".padStart(64, "0")) out.data![0].token_transfer_array[0].to_address_label = "🏦 SomeNewCex 3";
      return out;
    };
    const a = await atlas(fakeClient(routes), "PEPE", { now: NOW });
    expect(a.otherEntity.wallets).toBe(1);
    expect(a.warnings.join()).toMatch(/SomeNewCex/);
  });
  it("replays byte-for-byte from a cache at 0 credits with the same hash (the fixture path)", async () => {
    const store = new MemoryCache();
    const fetchImpl: typeof fetch = async (url, init) => new Response(JSON.stringify(pepeRoutes(String(url).replace("https://api.nansen.ai/api/v1/", ""), JSON.parse(String(init?.body)))), { status: 200 });
    const live = new CachedNansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, store, rps: 1000 });
    const a = await atlas(live, "PEPE", { now: NOW });
    const replay = new CachedNansenClient("nsn_test_key_0000000000000000000000", { store, offline: true, rps: 1000 });
    const b = await atlas(replay, "PEPE", { now: NOW });
    expect(b.hash).toBe(a.hash);
    expect(b.credits).toBe(0);
    expect(b.calls.every((c) => c.cached)).toBe(true);
  });
});

describe("timeout strikes (USDC, live 2026-09-18: the per-wallet transfer filter times out on the highest-volume token)", () => {
  it("3 timeouts shrink the window to 30 days; 6 make the rest fail fast without a call; the warning names it", async () => {
    let transfersCalls = 0;
    const windows: string[] = [];
    const routes = (e: string, b: Record<string, unknown>) => {
      if (e === "tgm/transfers") {
        transfersCalls++;
        windows.push((b.date as { from: string }).from);
        return new Promise<never>(() => {}); // never resolves → client timeout
      }
      return pepeRoutes(e, b);
    };
    const fetchImpl: typeof fetch = async (url, init) => {
      const endpoint = String(url).replace("https://api.nansen.ai/api/v1/", "");
      const body = JSON.parse(String(init?.body ?? "{}"));
      const out = routes(endpoint, body);
      if (out instanceof Promise) return new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      return new Response(JSON.stringify(out), { status: 200 });
    };
    const { NansenClient } = await import("../src/client.js");
    const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, rps: 1000, timeoutMs: 20 });
    const a = await atlas(c, "PEPE", { now: NOW, concurrency: 1 });
    // 8 examined wallets: strikes 1-3 on the 1-year window, 4-6 on the 30-day window, then 7-8 skipped
    expect(transfersCalls).toBe(6);
    expect(new Set(windows.slice(0, 3)).size).toBe(1);
    expect(windows[3]).not.toBe(windows[0]);
    expect(a.errors.wallets).toBe(7); // 8 examined minus the contract, which the related-wallets check moves out of the denominator
    expect(a.rows.filter((r) => r.error?.startsWith("skipped:"))).toHaveLength(2);
    expect(a.warnings.join()).toMatch(/shortened to 30 days.*skipped/);
    expect(a.attributable).toBe(0);
  });
});
