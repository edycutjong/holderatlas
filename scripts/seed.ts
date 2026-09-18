/**
 * Record the fixture set (specs/seed-data.md): run each input LIVE once, write every raw Nansen response the atlas
 * touched plus the atlas itself to fixtures/<INPUT>--<chain>.json. Responses are stored byte-for-byte and never edited.
 * `npm run verify` replays them offline and must reproduce every atlas hash.
 *
 *   set -a; source ~/.config/nansen/meridian.env; set +a; npm run seed        # all fixtures (~1,400 credits)
 *   npm run seed -- PEPE WLFI                                                 # a subset
 *   npm run seed -- --reuse-cache                                             # today's .cache/ first; aborts past 150 live credits
 *   npm run seed -- --max-credits 300                                         # any run: hard ceiling, the crossing call is never made
 */
import {
  CachedNansenClient,
  MemoryCache,
  DiskCache,
  atlas,
  writeFixture,
  AtlasError,
  BudgetError,
  type Fixture,
  type Atlas,
  type CacheStore,
  type CacheEntry,
} from "../packages/core/src/index.js";
import { FIXTURE_SET } from "./fixture-set.js";

/**
 * --reuse-cache: read through today's `.cache/` (the spike's live responses, same UTC day → same 1-year window → same
 * keys) so a token already fetched today costs 0 credits to record; everything still lands in the fixture byte-for-byte.
 * The fixture says so in `live.source`. Default: a fresh store per fixture, every response fetched live now.
 */
const reuse = process.argv.includes("--reuse-cache");
/**
 * Credit ceiling for the whole run, enforced inside the client before each network call (BudgetError, nothing sent).
 * `--reuse-cache` means "this should cost ~0": the cache keys carry the UTC date of the 1-year window, so a re-run on a
 * later day (or after the 24 h TTL) is cold for every token — on 2026-09-18 that silently re-billed 1,050 credits.
 * Default ceiling under --reuse-cache: 150 (one cold token, then stop). Override with --max-credits N.
 */
const maxArg = process.argv.indexOf("--max-credits");
const MAX_CREDITS = maxArg >= 0 ? Number(process.argv[maxArg + 1]) : reuse ? 150 : Infinity;
if (!(MAX_CREDITS > 0)) {
  console.error("--max-credits needs a positive number");
  process.exit(2);
}
class Layered implements CacheStore {
  constructor(
    private mem: MemoryCache,
    private disk: DiskCache,
  ) {}
  get(key: string) {
    const m = this.mem.get(key);
    if (m) return m;
    const d = this.disk.get(key);
    if (d) this.mem.set(key, d);
    return d;
  }
  set(key: string, entry: CacheEntry) {
    this.mem.set(key, entry);
    this.disk.set(key, entry);
  }
}

const wanted = process.argv
  .slice(2)
  .filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--max-credits")
  .map((q) => q.toUpperCase());
const set = wanted.length ? FIXTURE_SET.filter((f) => wanted.includes(f.input.toUpperCase())) : FIXTURE_SET;
const apiKey = process.env.NANSEN_API_KEY ?? "";
let totalCredits = 0,
  totalCalls = 0;

for (const f of set) {
  // A fresh in-memory store per fixture: every response is fetched live and lands in the file, nothing is shared.
  const store = new MemoryCache();
  // 24 h TTL: with --reuse-cache, anything fetched today is a hit (the default 30 min silently refetched — and re-billed — every token)
  const client = new CachedNansenClient(apiKey, {
    store: reuse ? new Layered(store, new DiskCache(".cache")) : store,
    ttlMs: 24 * 3600 * 1000,
    // the ceiling is for the RUN: what earlier tokens spent counts against this token's client
    maxCredits: Number.isFinite(MAX_CREDITS) ? Math.max(0, MAX_CREDITS - totalCredits) : Infinity,
  });
  const now = Date.now();
  let a: Atlas;
  try {
    a = await atlas(client, f.input, { chain: f.chain, holders: f.holders, custody: f.custody, now });
  } catch (e) {
    if (e instanceof BudgetError) {
      console.error(
        `\n✖ ${f.input}: ${e.message}\n  run total so far ${totalCredits + client.creditsSpent} credits over ${totalCalls} live calls; ${f.input} NOT written` +
          (reuse ? " — the cache is cold for this token (a new UTC day or > 24 h); re-run without --reuse-cache, or raise --max-credits, on purpose" : ""),
      );
      process.exit(5);
    }
    if (!(e instanceof AtlasError)) throw e;
    // the no-token state is a fixture too: the search response is recorded, the atlas is the error
    a = {
      input: f.input,
      error: { code: e.code, message: e.message },
      calls: client.calls,
      credits: client.creditsSpent,
      ms: Date.now() - now,
      hash: `error:${e.code}`,
    } as unknown as Atlas;
  }
  const live = a.calls.filter((c) => !c.cached && c.ok);
  const failed = a.calls.filter((c) => !c.ok);
  const fixture: Fixture = {
    edge: f.edge,
    input: f.input,
    options: { chain: f.chain, holders: f.holders, custody: f.custody },
    now,
    recordedAt: new Date(now).toISOString(),
    live: {
      calls: live.length,
      credits: a.credits,
      ms: a.ms,
      ...(reuse && a.calls.some((c) => c.cached) ? { source: "responses recorded live earlier today (spike run), read from .cache/" } : {}),
    },
    responses: store.entries(),
    atlas: a,
  };
  const path = writeFixture(fixture);
  totalCredits += a.credits;
  totalCalls += live.length;
  const outcome = a.countries
    ? `${(a.attributable * 100).toFixed(1)}% attributable · ${a.countries.map((c) => `${c.code} ${(c.share * 100).toFixed(1)}%`).join(" ") || "no country"}`
    : `no-token`;
  console.log(
    `${f.input.slice(0, 12).padEnd(13)}${f.chain ? `--${f.chain} `.padEnd(12) : "".padEnd(12)}→ ${path}  ${outcome} · ${a.credits} cr / ${live.length} calls / ${(a.ms / 1000).toFixed(1)}s · ${a.hash}${failed.length ? `  ⚠ ${failed.length} call(s) failed` : ""}`,
  );
}
console.log(`\n${set.length} fixtures · ${totalCredits} credits · ${totalCalls} live calls`);
