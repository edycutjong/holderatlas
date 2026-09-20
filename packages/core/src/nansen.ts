/**
 * Typed wrappers for the five Nansen endpoints Holder Atlas uses. Bodies follow docs.nansen.ai openapi.json (2026-09-15),
 * verified live 2026-09-18. Nothing here decides anything — see atlas.ts.
 */
import { z } from "zod";
import type { NansenClient, CallOptions } from "./client.js";

/** Chains where holders + transfers + the transfer lookup all exist. Solana: holders + transfers only (no entity naming). */
export const CHAINS = ["ethereum", "base", "bnb", "arbitrum", "optimism", "avalanche", "linea", "solana"] as const;
export type Chain = (typeof CHAINS)[number];
export const NAMING_CHAINS: readonly Chain[] = ["ethereum", "base", "bnb", "arbitrum", "optimism", "avalanche", "linea"];
export function isChain(s: string): s is Chain {
  return (CHAINS as readonly string[]).includes(s);
}

export type DateRange = { from: string; to: string };
/** The last `days` days as whole dates — cache keys change once a day, and a fixture's stored `now` reproduces its window. */
export function window(now: number, days = 365): DateRange {
  const day = 86_400_000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: iso(now - days * day), to: iso(now + day) };
}

const num = z.number().nullable().optional();
const str = z.string().nullable().optional();

export const SearchResponse = z.object({
  tokens: z
    .array(z.object({ name: z.string(), symbol: z.string(), chain: z.string(), address: z.string(), rank: num, market_cap: num, volume_24h: num, price: num }))
    .default([]),
  total_results: z.number().optional(),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

export const HolderRow = z.object({
  address: str,
  address_label: str,
  token_amount: num,
  ownership_percentage: num,
  value_usd: num,
  balance_change_7d: num,
});
export type HolderRow = z.infer<typeof HolderRow>;
export const HoldersResponse = z.object({
  data: z.array(HolderRow),
  pagination: z.object({ is_last_page: z.boolean().optional() }).passthrough(),
  warnings: z.array(z.string()).nullable().optional(),
});
export type HoldersResponse = z.infer<typeof HoldersResponse>;

export const TransferRow = z.object({
  block_timestamp: z.string(),
  transaction_hash: z.string(),
  from_address: z.string(),
  to_address: z.string(),
  from_address_label: str,
  to_address_label: str,
  transaction_type: str,
  transfer_amount: num,
  transfer_value_usd: num,
});
export type TransferRow = z.infer<typeof TransferRow>;
export const TransfersResponse = z.object({ data: z.array(TransferRow), pagination: z.object({ is_last_page: z.boolean().optional() }).passthrough() });
export type TransfersResponse = z.infer<typeof TransfersResponse>;

export const RelatedWalletsResponse = z.object({ data: z.array(z.object({ address: z.string(), address_label: str, relation: z.string() })) });
export type RelatedWalletsResponse = z.infer<typeof RelatedWalletsResponse>;

export const TokenTransfer = z.object({
  from_address: z.string(),
  from_address_label: str,
  to_address: z.string(),
  to_address_label: str,
  token_address: str,
  token_symbol: str,
  token_amount: num,
});
export type TokenTransfer = z.infer<typeof TokenTransfer>;
export const TxLookupResponse = z.object({
  data: z.array(
    z.object({
      transaction_hash: z.string(),
      from_address: z.string(),
      from_address_label: str,
      to_address: z.string(),
      to_address_label: str,
      block_timestamp: z.string(),
      token_transfer_array: z.array(TokenTransfer).nullable(),
    }),
  ),
});
export type TxLookupResponse = z.infer<typeof TxLookupResponse>;

// `schema: S extends z.ZodTypeAny` + `z.infer<S>` (rather than `z.ZodType<T>` + `T`) is the precise idiom here: binding
// T only through ZodType's Output parameter let inference leak in the Input type too, so a field with `.default()`
// (optional on input, always-present on output) type-checked as possibly undefined even though safeParse guarantees
// the default is applied (fixed 2026-09-20 alongside removing the now-provably-dead `res.tokens ?? []` in atlas.ts).
function parse<S extends z.ZodTypeAny>(schema: S, endpoint: string, raw: unknown): z.infer<S> {
  const r = schema.safeParse(raw);
  if (!r.success) throw new Error(`Nansen ${endpoint}: unexpected response shape — ${r.error.issues[0]?.path.join(".")}: ${r.error.issues[0]?.message}`);
  return r.data;
}

export const nansen = {
  search: async (c: NansenClient, search_query: string, opts?: CallOptions) =>
    parse(
      SearchResponse,
      "search/general",
      await c.post(
        "search/general",
        { search_query, result_type: "token", limit: 25 },
        ["tokens[].symbol", "tokens[].chain", "tokens[].address", "tokens[].rank", "tokens[].market_cap"],
        opts,
      ),
    ),
  holders: async (c: NansenClient, chain: Chain, token_address: string, perPage = 100, opts?: CallOptions) =>
    parse(
      HoldersResponse,
      "tgm/holders",
      await c.post(
        "tgm/holders",
        { chain, token_address, pagination: { page: 1, per_page: perPage } },
        ["data[].address", "data[].address_label", "data[].token_amount", "data[].ownership_percentage"],
        opts,
      ),
    ),
  exchangeHolders: async (c: NansenClient, chain: Chain, token_address: string, perPage = 100, opts?: CallOptions) =>
    parse(
      HoldersResponse,
      "tgm/holders",
      await c.post(
        "tgm/holders",
        { chain, token_address, label_type: "exchange", pagination: { page: 1, per_page: perPage } },
        ["data[].address", "data[].token_amount"],
        opts,
      ),
    ),
  /** CEX-only transfers of `token_address` touching `wallet` in the given direction, newest first (default 5 rows). */
  cexTransfers: async (
    c: NansenClient,
    chain: Chain,
    token_address: string,
    wallet: string,
    direction: "to" | "from",
    date: DateRange,
    perPage = 5,
    opts?: CallOptions,
  ) =>
    parse(
      TransfersResponse,
      "tgm/transfers",
      await c.post(
        "tgm/transfers",
        {
          chain,
          token_address,
          date,
          filters: { include_cex: true, include_dex: false, non_exchange_transfers: false, [direction === "to" ? "to_address" : "from_address"]: wallet },
          pagination: { page: 1, per_page: perPage },
          order_by: [{ field: "block_timestamp", direction: "DESC" }],
        },
        ["data[].transaction_hash", "data[].block_timestamp", "data[].from_address", "data[].to_address"],
        opts,
      ),
    ),
  /** 1 credit. Contracts come back with a "Deployed by" / "Created by" relation; EOAs never do (sentwrong's spike, 2026-09-16). */
  relatedWallets: async (c: NansenClient, chain: Chain, address: string, opts?: CallOptions) =>
    parse(
      RelatedWalletsResponse,
      "profiler/address/related-wallets",
      await c.post(
        "profiler/address/related-wallets",
        { address, chain, pagination: { page: 1, per_page: 20 } },
        ["data[].relation", "data[].address_label"],
        opts,
      ),
    ),
  txLookup: async (c: NansenClient, chain: Chain, transaction_hash: string, opts?: CallOptions) =>
    parse(
      TxLookupResponse,
      "transaction-with-token-transfer-lookup",
      await c.post(
        "transaction-with-token-transfer-lookup",
        { chain, transaction_hash },
        ["data[].token_transfer_array[].from_address_label", "data[].token_transfer_array[].to_address_label"],
        opts,
      ),
    ),
};
