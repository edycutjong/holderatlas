import { CachedNansenClient, DiskCache, atlas, isChain, type AtlasOptions, type Chain } from "@holderatlas/core";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * One engine for every route. The cache is a disk cache: `.cache/` locally, `/tmp` on Vercel (the only writable path
 * there, per-instance — a warm instance answers a repeat token at 0 credits, a cold one goes live). TTL 24 h: holder
 * geography does not move by the minute, and the recording runs on a warm cache with the "as of" stamp visible.
 */
const dir = process.env.VERCEL ? join(tmpdir(), "holderatlas-cache") : join(process.cwd(), "../../.cache");
let store: DiskCache | undefined;
export const TTL_MS = 24 * 60 * 60 * 1000;

export function client(): CachedNansenClient {
  store ??= new DiskCache(dir);
  return new CachedNansenClient(process.env.NANSEN_API_KEY ?? "", { store, ttlMs: TTL_MS });
}

/** a ticker (≤ 24 chars) or an EVM / Solana address (≤ 44) */
export const SAFE_QUERY = /^[A-Za-z0-9 ._$-]{1,44}$/;

export function parseChain(s: string | null | undefined): Chain | undefined {
  return s && isChain(s) ? s : undefined;
}

export async function atlasFor(q: string, opts: AtlasOptions = {}) {
  const c = client();
  const a = await atlas(c, q, opts);
  return { atlas: a, oldestHit: c.oldestHit };
}
