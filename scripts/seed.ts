/**
 * Record the fixture set (specs/seed-data.md): run each input LIVE once, write every raw Nansen response the atlas
 * touched plus the atlas itself to fixtures/<INPUT>--<chain>.json. Responses are stored byte-for-byte and never edited.
 * `npm run verify` replays them offline and must reproduce every atlas hash.
 *
 *   set -a; source ~/.config/nansen/meridian.env; set +a; npm run seed        # all fixtures (~1,100 credits)
 *   npm run seed -- PEPE WLFI                                                 # a subset
 */
import { CachedNansenClient, MemoryCache, atlas, writeFixture, AtlasError, type Fixture, type Atlas } from "../packages/core/src/index.js";
import { FIXTURE_SET } from "./fixture-set.js";

const wanted = process.argv.slice(2).map((q) => q.toUpperCase());
const set = wanted.length ? FIXTURE_SET.filter((f) => wanted.includes(f.input.toUpperCase())) : FIXTURE_SET;
const apiKey = process.env.NANSEN_API_KEY ?? "";
let totalCredits = 0,
  totalCalls = 0;

for (const f of set) {
  // A fresh in-memory store per fixture: every response is fetched live and lands in the file, nothing is shared.
  const store = new MemoryCache();
  const client = new CachedNansenClient(apiKey, { store });
  const now = Date.now();
  let a: Atlas;
  try {
    a = await atlas(client, f.input, { chain: f.chain, holders: f.holders, custody: f.custody, now });
  } catch (e) {
    if (!(e instanceof AtlasError)) throw e;
    // the no-token state is a fixture too: the search response is recorded, the atlas is the error
    a = { input: f.input, error: { code: e.code, message: e.message }, calls: client.calls, credits: client.creditsSpent, ms: Date.now() - now, hash: `error:${e.code}` } as unknown as Atlas;
  }
  const live = a.calls.filter((c) => !c.cached && c.ok);
  const failed = a.calls.filter((c) => !c.ok);
  const fixture: Fixture = {
    edge: f.edge,
    input: f.input,
    options: { chain: f.chain, holders: f.holders, custody: f.custody },
    now,
    recordedAt: new Date(now).toISOString(),
    live: { calls: live.length, credits: a.credits, ms: a.ms },
    responses: store.entries(),
    atlas: a,
  };
  const path = writeFixture(fixture);
  totalCredits += a.credits;
  totalCalls += live.length;
  const outcome = a.countries ? `${(a.attributable * 100).toFixed(1)}% attributable · ${a.countries.map((c) => `${c.code} ${(c.share * 100).toFixed(1)}%`).join(" ") || "no country"}` : `no-token`;
  console.log(
    `${f.input.slice(0, 12).padEnd(13)}${f.chain ? `--${f.chain} `.padEnd(12) : "".padEnd(12)}→ ${path}  ${outcome} · ${a.credits} cr / ${live.length} calls / ${(a.ms / 1000).toFixed(1)}s · ${a.hash}${failed.length ? `  ⚠ ${failed.length} call(s) failed` : ""}`,
  );
}
console.log(`\n${set.length} fixtures · ${totalCredits} credits · ${totalCalls} live calls`);
