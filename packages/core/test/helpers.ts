import { NansenClient, type ClientOptions } from "../src/client.js";

/** A NansenClient whose network is a lookup table: (endpoint, body) → JSON. Records calls like the real one. */
export function fakeClient(routes: (endpoint: string, body: Record<string, unknown>) => unknown, opts: ClientOptions = {}) {
  const fetchImpl: typeof fetch = async (url, init) => {
    const endpoint = String(url).replace("https://api.nansen.ai/api/v1/", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    const out = routes(endpoint, body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  return new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, rps: 1000, ...opts });
}

export const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
export const BINANCE_14 = "0x28c6c06298d514db089934071355e5743bf21d60";
export const UPBIT = "0x3f9a834566a3f2b8c0a9c9b5d6e7f80112233445";
export const COINBASE = "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43";
export const POOL = "0xa43fe16908251ee70ef74718545e4fe6c5ccec9f";
export const BURN = "0x000000000000000000000000000000000000dead";
export const CONTRACT = "0xf5503773aa06f0ef8fc2e7dd90b6e3d3f8b5c8a1";
export const addr = (i: number) => "0x" + String(i).padStart(40, "0");

export const searchTokens = (tokens: Array<{ chain: string; address: string; symbol?: string; name?: string; rank?: number; market_cap?: number }>) => ({
  tokens: tokens.map((t, i) => ({
    name: t.name ?? "Pepe",
    symbol: t.symbol ?? "PEPE",
    chain: t.chain,
    address: t.address,
    price: 1,
    volume_24h: 1,
    market_cap: t.market_cap ?? 1,
    rank: t.rank ?? i + 1,
  })),
  entities: [],
  total_results: tokens.length,
});

export const holders = (rows: Array<{ address: string; label?: string | null; amount: number }>) => ({
  data: rows.map((r) => ({
    address: r.address,
    address_label: r.label ?? "",
    token_amount: r.amount,
    ownership_percentage: r.amount / 1e6,
    value_usd: r.amount,
  })),
  pagination: { page: 1, per_page: 100, is_last_page: true },
  warnings: null,
});

export const transfers = (rows: Array<{ hash: string; from: string; to: string; at?: string }>) => ({
  data: rows.map((r) => ({
    block_timestamp: r.at ?? "2026-09-17T08:02:23",
    transaction_hash: r.hash,
    from_address: r.from,
    to_address: r.to,
    from_address_label: "Token Billionaire",
    to_address_label: "High Activity",
    transaction_type: "transfer",
    transfer_amount: 1,
    transfer_value_usd: 1,
  })),
  pagination: { page: 1, per_page: 5, is_last_page: true },
});

export const lookup = (transfersArr: Array<{ from: string; fromLabel?: string | null; to: string; toLabel?: string | null; token?: string }>) => ({
  data: [
    {
      transaction_hash: "0x" + "1".repeat(64),
      from_address: transfersArr[0]?.from ?? addr(1),
      from_address_label: "Token Billionaire",
      to_address: PEPE,
      to_address_label: "Token Contract",
      block_timestamp: "2026-09-17T08:02:23",
      token_transfer_array: transfersArr.map((t) => ({
        from_address: t.from,
        from_address_label: t.fromLabel ?? null,
        to_address: t.to,
        to_address_label: t.toLabel ?? null,
        token_address: t.token ?? PEPE,
        token_symbol: "PEPE",
        token_amount: 1,
      })),
    },
  ],
});

export const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");

/**
 * Routes modelled on the live PEPE spike (2026-09-18): two custody wallets (Binance global, Upbit KR), five humans
 * (three from Coinbase, one Binance deposit, one untraced), a pool, a burn address, and one unlabelled contract.
 */
export function pepeRoutes(endpoint: string, body: Record<string, unknown>) {
  if (endpoint === "search/general") {
    const q = String(body.search_query);
    if (q === "XQZPLM") return searchTokens([]);
    return searchTokens([
      { chain: "ethereum", address: PEPE, rank: 1, market_cap: 1.4e9 },
      { chain: "base", address: addr(99), rank: 2, market_cap: 2e6 },
      { chain: "solana", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", rank: 3, symbol: "PEPE", market_cap: 1e5 },
      { chain: "hyperliquid", address: "PEPE", rank: 4 },
    ]);
  }
  if (endpoint === "tgm/holders") {
    if (body.label_type === "exchange")
      return holders([
        { address: BINANCE_14, amount: 500 },
        { address: UPBIT, amount: 100 },
      ]);
    return holders([
      { address: BINANCE_14, label: "Token Billionaire", amount: 500 },
      { address: POOL, label: "UniswapV2", amount: 300 },
      { address: CONTRACT, label: null, amount: 150 },
      { address: UPBIT, label: "Token Millionaire", amount: 100 },
      { address: addr(1), label: "PEPE Whale", amount: 60 },
      { address: addr(2), label: null, amount: 40 },
      { address: addr(3), label: null, amount: 30 },
      { address: addr(4), label: null, amount: 20 },
      { address: addr(5), label: null, amount: 10 },
      { address: BURN, label: null, amount: 1000 },
    ]);
  }
  if (endpoint === "tgm/transfers") {
    const f = body.filters as Record<string, string>;
    const w = (f.to_address ?? f.from_address) as string;
    const dir = f.to_address ? "to" : "from";
    if (w === BINANCE_14) return transfers([{ hash: H(10), from: addr(7), to: BINANCE_14 }]);
    if (w === UPBIT) return transfers([{ hash: H(11), from: addr(8), to: UPBIT }]);
    if (w === addr(1) && dir === "to") return transfers([{ hash: H(1), from: COINBASE, to: addr(1) }]);
    if (w === addr(2) && dir === "to") return transfers([{ hash: H(2), from: COINBASE, to: addr(2) }]);
    if (w === addr(3) && dir === "to") return transfers([{ hash: H(3), from: COINBASE, to: addr(3) }]);
    if (w === addr(4) && dir === "from") return transfers([{ hash: H(4), from: addr(4), to: addr(44) }]);
    return transfers([]);
  }
  if (endpoint === "transaction-with-token-transfer-lookup") {
    const h = String(body.transaction_hash);
    if (h === H(10)) return lookup([{ from: addr(7), to: BINANCE_14, toLabel: "🏦 Binance 14 [0x28c6c0]" }]);
    if (h === H(11)) return lookup([{ from: addr(8), to: UPBIT, toLabel: "​​🏦 Upbit [0x3f9a83]" }]);
    if (h === H(1) || h === H(2) || h === H(3))
      return lookup([{ from: COINBASE, fromLabel: "🤖 🏦 Coinbase [0xa9d1e0]", to: h === H(1) ? addr(1) : h === H(2) ? addr(2) : addr(3) }]);
    if (h === H(4)) return lookup([{ from: addr(4), to: addr(44), toLabel: "🏦 Binance: Deposit [0xcd38bb]" }]);
    return lookup([]);
  }
  if (endpoint === "profiler/address/related-wallets") {
    if (body.address === CONTRACT) return { data: [{ address: addr(50), address_label: "PEPE Deployer", relation: "Deployed by" }] };
    return { data: [] };
  }
  throw new Error("unexpected " + endpoint + " " + JSON.stringify(body));
}
