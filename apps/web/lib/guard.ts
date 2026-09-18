import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { CachedNansenClient, fixtureName, fixtureStore, readFixture, atlas, AtlasError, type AtlasOptions, type Atlas } from "@holderatlas/core";

/**
 * Spend guard for the public /api/atlas route. The key is server-only and every cold atlas costs real Nansen credits
 * (~100–130), so an unattended loop against the URL could drain the account. Three ceilings, no new services:
 *
 *   1. per-IP:  IP_PER_MIN atlases per rolling minute → 429 with Retry-After;
 *   2. global:  DAILY_CREDITS live credits per UTC day, counted from the atlas's own provenance;
 *   3. degrade: past the daily ceiling a token with a recorded fixture replays it offline (0 credits, labelled), one
 *      without gets a 503 that says so — the page shows the message instead of a crash.
 *
 * Counters live in instance memory: a ceiling, not accounting. Vercel may run several instances, so the true daily
 * spend is bounded by DAILY_CREDITS × instances — still an order of magnitude under the balance.
 */
export const IP_PER_MIN = Number(process.env.GUARD_IP_PER_MIN ?? 4);
export const DAILY_CREDITS = Number(process.env.GUARD_DAILY_CREDITS ?? 3000);
/** a cold atlas at the defaults: 10 (holders) + 1 (probe) + 12 custody × 2 + 40 humans × ≤ 3 + ≤ 5 contract checks */
export const MAX_ATLAS_CREDITS = 160;
const WINDOW_MS = 60_000;

const hits = new Map<string, number[]>();

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip")?.trim() || "unknown";
}

export function ipAllowed(ip: string, now = Date.now()): { ok: true; stamp: number } | { ok: false; retryAfter: number } {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= IP_PER_MIN) {
    hits.set(ip, recent);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)) };
  }
  recent.push(now);
  if (hits.size >= 5000) hits.clear(); // bound memory under a distributed scan; a cleared window only errs toward allowing
  hits.set(ip, recent);
  return { ok: true, stamp: now };
}

/**
 * Give the slot back when the request spent nothing: a warm cache hit, a fixture replay, a typo (search is 0 credits).
 * The per-IP limit exists to cap COLD maps (~120 credits each); the judge's own 30-second path is four cached maps plus
 * the JSON link inside one minute, which a spend-blind counter answered with a 429 (audit 2026-09-19).
 */
export function ipRelease(ip: string, stamp: number): void {
  const recent = hits.get(ip);
  if (!recent) return;
  const i = recent.indexOf(stamp);
  if (i >= 0) recent.splice(i, 1);
  if (recent.length) hits.set(ip, recent);
  else hits.delete(ip);
}

let day = "";
let spent = 0;
function roll(now: number) {
  const d = new Date(now).toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    spent = 0;
  }
}
export function creditsLeft(now = Date.now()): number {
  roll(now);
  return Math.max(0, DAILY_CREDITS - spent);
}
export function recordSpend(credits: number, now = Date.now()): void {
  roll(now);
  spent += Math.max(0, credits);
}
/** true when the day's budget cannot cover one more worst-case atlas */
export function budgetExhausted(now = Date.now()): boolean {
  return creditsLeft(now) < MAX_ATLAS_CREDITS;
}
/** test hook */
export function resetGuard(): void {
  hits.clear();
  day = "";
  spent = 0;
}

export const BUDGET_MESSAGE = "Today's live Nansen budget is used up — this is a replay of a recorded run.";
export const NO_FIXTURE_MESSAGE =
  "Today's live Nansen budget is used up and this token has no recorded run. Try PEPE, WLFI, DEGEN or MOG, or come back tomorrow.";

export function fixturesDir(): string | undefined {
  for (const c of [join(process.cwd(), "fixtures"), join(process.cwd(), "..", "..", "fixtures")]) if (existsSync(c)) return c;
  return undefined;
}

export function fixturePath(q: string, chain?: string): string | undefined {
  const dir = fixturesDir();
  if (!dir) return undefined;
  // `q` is user input: fixtureName() already reduces it to [A-Z0-9_-], and the resolved path is still checked to sit
  // inside the fixtures directory before anything is read (no `..`, no absolute paths, no traversal by construction)
  const root = resolve(dir);
  const path = resolve(root, `${fixtureName(q, chain)}.json`);
  return path.startsWith(root + sep) && existsSync(path) ? path : undefined;
}

/**
 * The offline fallback: the fixture's recorded responses under the same engine, same clock, so the atlas is the one the
 * live run produced. Returns undefined when no fixture matches the input + chain.
 */
export async function replayFixture(
  q: string,
  chain?: string,
  opts: Omit<AtlasOptions, "chain" | "now"> = {},
): Promise<{ atlas: Atlas; oldestHit: string } | undefined> {
  const path = fixturePath(q, chain);
  if (!path) return undefined;
  const f = readFixture(path);
  const c = new CachedNansenClient("nsn_offline_replay_no_network", { store: fixtureStore(f), offline: true });
  const onProgress: AtlasOptions["onProgress"] = (e) => {
    if (e.type === "atlas" && !e.atlas.warnings.includes(BUDGET_MESSAGE)) e.atlas.warnings.push(BUDGET_MESSAGE);
    opts.onProgress?.(e);
  };
  try {
    const a = await atlas(c, q, { chain: f.options.chain, holders: f.options.holders, custody: f.options.custody, now: f.now, ...opts, onProgress });
    if (!a.warnings.includes(BUDGET_MESSAGE)) a.warnings.push(BUDGET_MESSAGE);
    return { atlas: a, oldestHit: c.oldestHit ?? f.recordedAt };
  } catch (e) {
    if (e instanceof AtlasError) throw e;
    return undefined;
  }
}
