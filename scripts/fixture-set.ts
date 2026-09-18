/** The fixture inputs and the edge each exercises (specs/seed-data.md). Shared by seed.ts, verify.ts and bench.ts. */
import type { Chain } from "../packages/core/src/index.js";

export type FixtureSpec = { input: string; chain?: Chain; edge: string; holders?: number; custody?: number };

export const FIXTURE_SET: FixtureSpec[] = [
  { input: "PEPE", chain: "ethereum", edge: "1 · the demo query: Binance-heavy custody, Coinbase withdrawals, Upbit/Bithumb/BTCTurk/Revolut custody" },
  { input: "WLFI", chain: "ethereum", edge: "2 · the KR contrast: Upbit's internal wallet holds half the analysed supply" },
  { input: "LINK", chain: "ethereum", edge: "3 · blue chip: custody spread across Upbit, Robinhood, Kraken, Bitpanda; one unlabelled mega-holder" },
  { input: "USDC", chain: "ethereum", edge: "4 · stablecoin: Nansen's per-wallet transfer filter times out on the highest-volume token — the error path, honest" },
  { input: "DEGEN", chain: "base", edge: "5 · base chain, Coinbase-heavy → US" },
  { input: "CAKE", chain: "bnb", edge: "6 · bnb chain: Binance custody = global grey" },
  { input: "ARB", chain: "arbitrum", edge: "7 · arbitrum: an L2 native token" },
  { input: "MOG", chain: "ethereum", edge: "8 · a meme with thin custody: mostly self-custody, few exchange traces" },
  { input: "MEW", chain: "solana", edge: "9 · solana: exchanges visible but unnamed — attributable 0 %, the unsupported state" },
  { input: "0x6982508145454ce325ddbe47a25d4ec3d2311933", chain: "ethereum", edge: "10 · address input skips the ticker search — same token as #1" },
  { input: "XQZPLM", edge: "11 · no such token — 0 credits, the no-token state" },
  { input: "PENGU", chain: "solana", edge: "12 · a second solana token: the unnamed custody share still renders" },
];
