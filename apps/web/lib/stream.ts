/**
 * The page's view of a running atlas, built one NDJSON event at a time. Pure — no React, no fetch — so the same reducer
 * the page uses is what the tests drive with a replayed fixture (packages/core/test/stream.test.ts).
 */
import type { PosterData } from "@/components/Poster";
import { toPoster } from "@/components/Poster";
import type { AtlasEvent, Candidate, WalletRow, Call } from "@holderatlas/core";

export type Live = {
  data: PosterData;
  rows: WalletRow[];
  calls: Call[];
  credits: number;
  ms: number;
  hash: string;
  warnings: string[];
  asOf: string | null;
  degraded: boolean;
  candidates: Candidate[];
};

export type StreamEvent =
  AtlasEvent | { type: "error"; message: string; code?: string; candidates?: Candidate[] } | { type: "asOf"; asOf: string | null; degraded: boolean };

const emptyBucket = { share: 0, supply: 0, wallets: 0, exchanges: [] as string[] };

export function blank(): Live {
  return {
    data: {
      token: { symbol: "…", name: "", chain: "ethereum", address: "", marketCap: null },
      chain: "ethereum",
      naming: true,
      countries: [],
      global: emptyBucket,
      otherEntity: emptyBucket,
      untraced: emptyBucket,
      unnamed: emptyBucket,
      errors: emptyBucket,
      attributable: 0,
      attributableByWallets: 0,
      custodyShare: 0,
      structuralShare: 0,
      examined: { custody: 0, human: 0 },
      holdersFetched: 0,
      coverage: 0,
    },
    rows: [],
    calls: [],
    credits: 0,
    ms: 0,
    hash: "",
    warnings: [],
    asOf: null,
    degraded: false,
    candidates: [],
  };
}

/** Split a chunked NDJSON buffer into complete lines; the remainder (a partial line) is returned to be prepended to the next chunk. */
export function splitLines(buf: string): { lines: string[]; rest: string } {
  const parts = buf.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim().length > 0), rest };
}

/**
 * Apply one stream event. `error` events are not applied here (the page shows them instead of the picture);
 * everything else folds into the live view so the picture is right at every step:
 *   token    → the header
 *   holders  → the caption (analysed / coverage / custody / structural — known before any lookup) and the progress total
 *   wallet   → one more row, the partial aggregates, the progress
 *   reclass  → the row is replaced (a mega-holder turned out to be a contract)
 *   atlas    → the final picture, verbatim from the engine
 *   asOf     → the cache stamp and whether this was a fixture replay
 */
export function applyEvent(cur: Live | null, e: StreamEvent): Live {
  const c = cur ?? blank();
  switch (e.type) {
    case "token":
      return { ...c, data: { ...blank().data, token: e.token, chain: e.token.chain, naming: e.token.chain !== "solana" }, candidates: e.candidates };
    case "holders":
      return {
        ...c,
        data: {
          ...c.data,
          holdersFetched: e.fetched,
          examined: e.examined,
          coverage: e.coverage,
          structuralShare: e.structuralShare,
          custodyShare: e.custodyShare,
          progress: { done: 0, total: e.examined.custody + e.examined.human },
        },
      };
    case "wallet":
      return {
        ...c,
        rows: [...c.rows, e.row],
        data: {
          ...c.data,
          countries: e.partial.countries,
          global: e.partial.global,
          untraced: e.partial.untraced,
          unnamed: e.partial.unnamed,
          otherEntity: e.partial.otherEntity,
          errors: e.partial.errors,
          attributable: e.partial.attributable,
          attributableByWallets: e.partial.attributableByWallets,
          progress: { done: e.done, total: e.total },
        },
      };
    case "reclass":
      return { ...c, rows: c.rows.map((r) => (r.address === e.row.address ? e.row : r)) };
    case "atlas": {
      const a = e.atlas;
      return {
        ...c,
        data: toPoster(a),
        rows: a.rows,
        calls: a.calls,
        credits: a.credits,
        ms: a.ms,
        hash: a.hash,
        warnings: a.warnings,
        candidates: a.candidates,
      };
    }
    case "asOf":
      return { ...c, asOf: e.asOf, degraded: e.degraded };
    default:
      return c;
  }
}
