import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryCache, type CacheEntry } from "./cache.js";
import type { Atlas, AtlasOptions } from "./atlas.js";

/**
 * A recorded live run: every raw Nansen response the atlas touched (keyed by cache key, byte-for-byte as sent), the atlas
 * it produced, and the clock it ran under. `scripts/seed.ts` writes these; `scripts/verify.ts` and the tests replay them
 * with NANSEN_OFFLINE — same inputs, same clock, so the atlas hash must come out identical. Responses are never edited.
 */
export type Fixture = {
  /** why this input is in the set — the edge it exercises (specs/seed-data.md) */
  edge: string;
  input: string;
  options: Pick<AtlasOptions, "chain" | "holders" | "custody">;
  /** the `now` the live run used for the 1-year window, so a replay later computes the same window and cache keys */
  now: number;
  recordedAt: string;
  live: { calls: number; credits: number; ms: number };
  responses: Record<string, CacheEntry>;
  atlas: Atlas;
};

export const FIXTURES_DIR = "fixtures";

export function fixtureName(input: string, chain?: string): string {
  return `${input.toUpperCase().slice(0, 24)}${chain ? `--${chain}` : ""}`.replace(/[^A-Z0-9_-]/gi, "_");
}

export function writeFixture(f: Fixture, dir = FIXTURES_DIR): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${fixtureName(f.input, f.options.chain)}.json`);
  writeFileSync(path, JSON.stringify(f, null, 2) + "\n");
  return path;
}

export function readFixture(path: string): Fixture {
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

export function listFixtures(dir = FIXTURES_DIR): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort()
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

/** A cache store pre-loaded with the fixture's responses — plug into `CachedNansenClient` with `offline: true`. */
export function fixtureStore(f: Fixture): MemoryCache {
  const store = new MemoryCache();
  for (const [key, entry] of Object.entries(f.responses)) store.set(key, entry);
  return store;
}
