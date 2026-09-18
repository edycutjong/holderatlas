/**
 * Nansen entity labels → exchange key → country. Pure; the table is `exchanges.json` (one source per row).
 *
 * Where the entity name comes from (live 2026-09-18): only `transaction-with-token-transfer-lookup`
 * `token_transfer_array[].from_address_label / to_address_label` carries it, e.g. "🏦 Binance 14 [0x28c6c0]",
 * "🏦 Upbit: Deposit", "🤖 🏦 Coinbase [0xa9d1e0]", "🏦 Kraken: Hot Wallet". Every cheaper field (holders, transfers,
 * transactions, counterparties) shows wealth tags ("Token Billionaire") instead.
 */
import table from "./exchanges.json" with { type: "json" };

export type Country = string; // ISO 3166-1 alpha-2, or "global"
export type ExchangeRow = { country: Country; source: string; aliases?: string[] };

const EXCHANGES = table.exchanges as Record<string, ExchangeRow>;
export const COUNTRY_NAMES = table.countries as Record<string, string>;

/** alias → canonical key, built once */
const ALIAS: Record<string, string> = {};
for (const [key, row] of Object.entries(EXCHANGES)) {
  ALIAS[key] = key;
  for (const a of row.aliases ?? []) ALIAS[a] = key;
}

/** The bank emoji Nansen puts on exchange entities. "🤖 🏦 Coinbase" carries both (a contract owned by an exchange). */
export const EXCHANGE_MARK = "🏦";

/**
 * "🏦 Binance 14 [0x28c6c0]" → "binance" · "🏦 Upbit: Deposit" → "upbit" · "🤖 🏦 Coinbase [0xa9d1e0]" → "coinbase"
 * "High Activity [0x16c794]" → null (no 🏦 → not an exchange entity) · "🏦 MetaMask: Gas Station Swap" → "metamask"
 * (an entity, but not in the table → the caller buckets it as "other entity").
 */
export function entityKey(label: string | null | undefined): string | null {
  if (!label || !label.includes(EXCHANGE_MARK)) return null;
  let s = label
    .replace(/\[0x[0-9a-f]+\]/gi, "")
    // emoji (🏦 🤖 …), variation selectors, and the zero-width characters Nansen prefixes some labels with ("\u200b\u200b🏦 Upbit")
    // eslint-disable-next-line no-misleading-character-class -- the variation selector and zero-width marks are exactly what is being stripped
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200B}-\u{200F}\u{FEFF}\u{2060}]/gu, "")
    .trim();
  // role suffix: "Binance: Deposit", "Kraken: Hot Wallet", "Coinbase: Deposit"
  const colon = s.indexOf(":");
  if (colon >= 0) s = s.slice(0, colon);
  // instance numerals: "Binance 14", "Upbit 3", "Coinbase 10"
  s = s
    .replace(/\s+\d+$/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return s.length ? s : null;
}

/** Canonical exchange key for an entity key (alias-resolved), or null when the table has no row. */
export function exchangeOf(key: string | null): string | null {
  if (!key) return null;
  return ALIAS[key] ?? null;
}

export function countryOf(exchange: string | null): Country | null {
  if (!exchange) return null;
  return EXCHANGES[exchange]?.country ?? null;
}

export function sourceOf(exchange: string): string | undefined {
  return EXCHANGES[exchange]?.source;
}

export function countryName(code: Country): string {
  return code === "global" ? "global exchanges" : (COUNTRY_NAMES[code] ?? code);
}

/** One-shot: label → { entity, exchange, country }. `entity` is set for any 🏦 label, the rest only when the table knows it. */
export function attributeLabel(label: string | null | undefined): { entity: string | null; exchange: string | null; country: Country | null } {
  const entity = entityKey(label);
  const exchange = exchangeOf(entity);
  return { entity, exchange, country: countryOf(exchange) };
}

/**
 * Holder rows that are not people and not exchanges: pools, token contracts, proxies, multisigs, deployers, burn.
 * Excluded from the analysed supply (denominator). Same family of tags whichone found on `tgm/holders` free labels.
 */
export const STRUCTURAL_TAG =
  /(liquidity pool|uniswap|pancake|sushi|curve|balancer|aerodrome|velodrome|raydium|orca|meteora|token contract|contract|proxy|multisig|multi-sig|safe|deployer|treasury|vesting|staking|bridge|burn|null address|dead|timelock|lp$|\blp\b|pool)/i;
export const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0xdead000000000000000042069420694206942069",
]);

export function isStructural(address: string, label: string | null | undefined): boolean {
  if (BURN_ADDRESSES.has(address.toLowerCase())) return true;
  return !!label && STRUCTURAL_TAG.test(label);
}

export const EXCHANGE_TABLE_SIZE = Object.keys(EXCHANGES).length;
