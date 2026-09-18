import { describe, it, expect } from "vitest";
import { entityKey, exchangeOf, countryOf, attributeLabel, isStructural, countryName, sourceOf, EXCHANGE_TABLE_SIZE, COUNTRY_NAMES } from "../src/labels.js";
import table from "../src/exchanges.json" with { type: "json" };

// every label string seen live in the 2026-09-18 spike, with the key it must normalise to
const SEEN: Array<[string, string | null]> = [
  ["🏦 Binance 14 [0x28c6c0]", "binance"],
  ["🏦 Binance 15 [0x21a31e]", "binance"],
  ["🏦 Binance [0x5a52e9]", "binance"],
  ["🏦 Binance: Reserve Address [0xf97781]", "binance"],
  ["🏦 Binance: Deposit [0xcd38bb]", "binance"],
  ["🏦 Binance: BSC-pegged Assets [0x47ac0f]", "binance"],
  ["​​🏦 Robinhood [0x1d4896]", "robinhood"],
  ["​​🏦 Robinhood: Hot Wallet [0x841ed6]", "robinhood"],
  ["​​🏦 Upbit [0x3f9a83]", "upbit"],
  ["🏦 Upbit : Link Wallet [0x0757e2]", "upbit"],
  ["🏦 Upbit: Internal Wallet [0xcaf924]", "upbit"],
  ["🏦 OKX: Deposit [0x611f7b]", "okx"],
  ["🏦 Bybit: Wallet [0xc93e48]", "bybit"],
  ["🏦 Bithumb: Wallet [0xc671b0]", "bithumb"],
  ["​​🏦 BTCTurk [0x76ec5a]", "btcturk"],
  ["🏦 Crypto.com: Hot Wallet [0xa023f0]", "crypto.com"],
  ["​​🏦 Revolut [0x15da75]", "revolut"],
  ["🤖 🏦 Coinbase [0xa9d1e0]", "coinbase"],
  ["🏦 Kraken: Deposit [0xde190d]", "kraken"],
  ["​​🏦 Kraken [0xd2dd7b]", "kraken"],
  ["🏦 Coinbase Prime: Custody Wallet [0x1138f1]", "coinbase prime"],
  ["🏦 Coinbase: LINK [0x563e3b]", "coinbase"],
  ["🏦 Bitvavo: Wallet [0xb21702]", "bitvavo"],
  ["🏦 Bitpanda [0xf197c6]", "bitpanda"],
  ["​​🤖 🏦 OKX: DEX Aggregator [0x8feab8]", "okx"],
  ["🏦 MetaMask: Gas Station Swap [0xe3478b]", "metamask"],
  ["High Activity [0x16c794]", null],
  ["Token Billionaire [0x28c6c0]", null],
  ["Uniswap V2: PEPE", null],
  ["", null],
];

describe("entityKey — Nansen entity label → key", () => {
  for (const [label, key] of SEEN) it(`${JSON.stringify(label)} → ${key}`, () => expect(entityKey(label)).toBe(key));
  it("null/undefined → null", () => {
    expect(entityKey(null)).toBeNull();
    expect(entityKey(undefined)).toBeNull();
  });
  it("a bare 🏦 with nothing else → null", () => expect(entityKey("🏦 [0x1234]")).toBeNull());
});

describe("exchanges.json — the curated table", () => {
  it("every row has a country and a source; every country code is named", () => {
    for (const [k, row] of Object.entries(table.exchanges)) {
      expect(row.country, k).toMatch(/^(global|[A-Z]{2})$/);
      expect(row.source.length, k).toBeGreaterThan(10);
      if (row.country !== "global") expect(COUNTRY_NAMES[row.country], `${k} → ${row.country}`).toBeTruthy();
    }
    expect(EXCHANGE_TABLE_SIZE).toBeGreaterThan(100);
  });
  it("global exchanges are never a country", () => {
    for (const g of ["binance", "okx", "bybit", "kucoin", "gate", "htx", "mexc", "bitget", "crypto.com"]) expect(countryOf(g)).toBe("global");
  });
  it("the regional ones from the idea card resolve", () => {
    expect(countryOf("upbit")).toBe("KR");
    expect(countryOf("bithumb")).toBe("KR");
    expect(countryOf("indodax")).toBe("ID");
    expect(countryOf("tokocrypto")).toBe("ID");
    expect(countryOf("coinbase")).toBe("US");
    expect(countryOf("bitvavo")).toBe("NL");
    expect(countryOf("bitso")).toBe("MX");
    expect(countryOf("wazirx")).toBe("IN");
    expect(countryOf("bitflyer")).toBe("JP");
    expect(countryOf("bitkub")).toBe("TH");
    expect(countryOf("mercado bitcoin")).toBe("BR");
  });
  it("aliases resolve to the canonical key", () => {
    expect(exchangeOf("coinbase prime")).toBe("coinbase");
    expect(exchangeOf("gate.io")).toBe("gate");
    expect(exchangeOf("huobi")).toBe("htx");
    expect(exchangeOf("btc turk")).toBe("btcturk");
    expect(exchangeOf("okex")).toBe("okx");
  });
  it("unknown keys → null everywhere", () => {
    expect(exchangeOf("metamask")).toBeNull();
    expect(countryOf(null)).toBeNull();
    expect(exchangeOf(null)).toBeNull();
    expect(sourceOf("upbit")).toMatch(/Dunamu/);
    expect(sourceOf("nope")).toBeUndefined();
  });
  it("countryName", () => {
    expect(countryName("KR")).toBe("South Korea");
    expect(countryName("global")).toBe("global exchanges");
    expect(countryName("ZZ")).toBe("ZZ");
  });
});

describe("attributeLabel", () => {
  it("regional exchange → entity + exchange + country", () => expect(attributeLabel("🏦 Upbit: Deposit")).toEqual({ entity: "upbit", exchange: "upbit", country: "KR" }));
  it("global exchange → country 'global'", () => expect(attributeLabel("🏦 Binance 14")).toEqual({ entity: "binance", exchange: "binance", country: "global" }));
  it("entity not in the table → exchange null, country null, entity kept", () => expect(attributeLabel("🏦 MetaMask: Gas Station Swap")).toEqual({ entity: "metamask", exchange: null, country: null }));
  it("wealth tag → nothing", () => expect(attributeLabel("Token Billionaire")).toEqual({ entity: null, exchange: null, country: null }));
});

describe("isStructural — pools, contracts, burn", () => {
  it.each(["Liquidity Pool", "UniswapV2", "Uniswap V2: PEPE", "Token Contract", "Proxy", "MultiSig", "Ziggy Token Deployer", "PancakeSwap V3 LP", "Aerodrome pool"])("%s", (l) => expect(isStructural("0x" + "1".repeat(40), l)).toBe(true));
  it.each(["Token Millionaire", "High Balance", "PEPE Whale", "kiing.sol", "", null])("%s is a person (or unknown)", (l) => expect(isStructural("0x" + "1".repeat(40), l)).toBe(false));
  it("burn addresses regardless of label", () => {
    expect(isStructural("0x000000000000000000000000000000000000dEaD", "PEPE Whale")).toBe(true);
    expect(isStructural("0x0000000000000000000000000000000000000000", null)).toBe(true);
  });
});
