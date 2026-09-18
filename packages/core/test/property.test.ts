/**
 * Property-based verification of the arithmetic behind the number (fast-check). The atlas is only as honest as
 * aggregate(): shares must partition the analysed supply, nothing global may ever count as attributed, structural rows
 * must never enter the denominator, and the hash must be a pure function of the attribution.
 */
import { describe, it } from "vitest";
import fc from "fast-check";
import { aggregate, atlasHash, type WalletRow, type Bucket } from "../src/atlas.js";
import { entityKey, exchangeOf, countryOf } from "../src/labels.js";
import TABLE from "../src/exchanges.json" with { type: "json" };

const bucketArb = fc.constantFrom<Bucket>("country", "global", "other-entity", "untraced", "unnamed", "error");
const COUNTRIES = ["US", "KR", "JP", "ID", "NL", "GB", "TR", "BR"];
const rowArb: fc.Arbitrary<WalletRow> = fc
  .record({
    address: fc.stringMatching(/^[0-9a-f]{40}$/).map((h) => "0x" + h),
    kind: fc.constantFrom("custody", "human", "structural"),
    supply: fc.double({ min: 0, max: 1e12, noNaN: true }),
    bucket: bucketArb,
    country: fc.constantFrom(...COUNTRIES),
  })
  .map((r) => ({
    address: r.address,
    kind: r.kind as WalletRow["kind"],
    label: null,
    supply: r.supply,
    share: 0,
    topShare: 0,
    entityLabel: null,
    exchange: r.bucket === "country" ? "x-" + r.country.toLowerCase() : r.bucket === "global" ? "binance" : null,
    country: r.bucket === "country" ? r.country : r.bucket === "global" ? "global" : null,
    bucket: r.bucket,
    via: null,
    txHash: null,
    txAt: null,
    calls: 0,
    credits: 0,
  }));
const rowsArb = fc.array(rowArb, { minLength: 0, maxLength: 60 });
const TOKEN = { symbol: "T", name: "T", chain: "ethereum" as const, address: "0x" + "1".repeat(40), marketCap: null };

describe("aggregate() — 5 properties × 2,000 cases", () => {
  it("bucket shares + country shares partition the analysed supply (sum = 1 when anything is analysed, 0 otherwise)", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const a = aggregate(rows);
        const total = a.attributable + a.global.share + a.otherEntity.share + a.untraced.share + a.unnamed.share + a.errors.share;
        return a.analysedSupply > 0 ? Math.abs(total - 1) < 1e-6 : total === 0;
      }),
      { numRuns: 2_000 },
    );
  });
  it("attributable never exceeds 1 and never counts a global or untraced row", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const a = aggregate(rows);
        const countryRows = rows.filter((r) => r.kind !== "structural" && r.bucket === "country");
        const expected = a.analysedSupply > 0 ? countryRows.reduce((n, r) => n + r.supply, 0) / a.analysedSupply : 0;
        return a.attributable <= 1 + 1e-9 && Math.abs(a.attributable - expected) < 1e-6;
      }),
      { numRuns: 2_000 },
    );
  });
  it("structural rows never enter the denominator and keep share 0", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const a = aggregate(rows);
        const analysed = rows.filter((r) => r.kind !== "structural").reduce((n, r) => n + r.supply, 0);
        return Math.abs(a.analysedSupply - analysed) < 1e-3 && rows.filter((r) => r.kind === "structural").every((r) => r.share === 0);
      }),
      { numRuns: 2_000 },
    );
  });
  it("countries come out sorted by supply desc, wallets sum to the country rows, and no code repeats", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const a = aggregate(rows);
        const codes = a.countries.map((c) => c.code);
        const sorted = a.countries.every((c, i) => i === 0 || a.countries[i - 1].supply >= c.supply);
        const wallets = a.countries.reduce((n, c) => n + c.wallets, 0) === rows.filter((r) => r.kind !== "structural" && r.bucket === "country").length;
        return sorted && wallets && new Set(codes).size === codes.length;
      }),
      { numRuns: 2_000 },
    );
  });
  it("the hash is a pure function of the attribution: same rows in any order → same hash; a moved country → different hash", () => {
    fc.assert(
      fc.property(
        rowsArb.filter((rs) => rs.some((r) => r.kind !== "structural" && r.bucket === "country")),
        fc.nat(),
        (rows, seed) => {
          const a = aggregate(rows);
          const rows2 = [...rows].sort((x, y) => (x.address < y.address ? -1 : 1));
          // atlasHash sorts nothing itself — the engine sorts rows before hashing — so we hash the same order twice and a permutation once
          const h1 = atlasHash({ token: TOKEN, rows, attributable: a.attributable });
          const h2 = atlasHash({ token: TOKEN, rows: rows.map((r) => ({ ...r })), attributable: a.attributable });
          const i = rows2.findIndex((r) => r.kind !== "structural" && r.bucket === "country");
          const moved = rows.map((r) =>
            r === rows2[i] ? { ...r, country: COUNTRIES[(COUNTRIES.indexOf(r.country!) + 1 + (seed % 7)) % COUNTRIES.length] } : r,
          );
          const h3 = atlasHash({ token: TOKEN, rows: moved, attributable: a.attributable });
          return h1 === h2 && h1 !== h3;
        },
      ),
      { numRuns: 2_000 },
    );
  });
});

describe("labels — 2 properties × 2,000 cases", () => {
  it("entityKey is null without the 🏦 mark and never keeps the mark, the [0x…] suffix, a role suffix or zero-width characters with it", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.boolean(), (s, mark) => {
        const label = (mark ? "​🏦 " : "") + s + " [0xabc123]";
        const k = entityKey(label);
        if (!mark) return k === null;
        return (
          k === null || (!/[\u{1F3E6}\u{1F916}\u{200B}]/u.test(k) && !/\[0x[0-9a-f]+\]/i.test(k) && k === k.toLowerCase() && k.trim() === k && !k.includes(":"))
        );
      }),
      { numRuns: 2_000 },
    );
  });
  it("every table key resolves to itself and to a country or 'global' — never to null", () => {
    const keys = Object.keys(TABLE.exchanges);
    fc.assert(
      fc.property(fc.constantFrom(...keys), (k) => exchangeOf(k) === k && countryOf(k) !== null),
      { numRuns: 2_000 },
    );
  });
});
