/**
 * Record the fixture set (specs/seed-data.md): run each input LIVE once, write every raw Nansen response the atlas
 * touched plus the atlas itself to fixtures/<INPUT>--<chain>.json. Responses are stored byte-for-byte and never edited.
 * `npm run verify` replays them offline and must reproduce every atlas hash.
 *
 *   set -a; source ~/.config/nansen/meridian.env; set +a; npm run seed        # all fixtures (~1,100 credits)
 *   npm run seed -- PEPE WLFI                                                 # a subset
 */
import {
  CachedNansenClient,
  MemoryCache,
  DiskCache,
  atlas,
  writeFixture,
  AtlasError,
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
  .filter((a) => !a.startsWith("--"))
  .map((q) => q.toUpperCase());
const set = wanted.length ? FIXTURE_SET.filter((f) => wanted.includes(f.input.toUpperCase())) : FIXTURE_SET;
const apiKey = process.env.NANSEN_API_KEY ?? "";
let totalCredits = 0,
  totalCalls = 0;

for (const f of set) {
  // A fresh in-memory store per fixture: every response is fetched live and lands in the file, nothing is shared.
  const store = new MemoryCache();
  const client = new CachedNansenClient(apiKey, { store: reuse ? new Layered(store, new DiskCache(".cache")) : store });
  const now = Date.now();
  let a: Atlas;
  try {
    a = await atlas(client, f.input, { chain: f.chain, holders: f.holders, custody: f.custody, now });
  } catch (e) {
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
