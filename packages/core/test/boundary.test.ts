/**
 * Permission-boundary tests — the concrete claim in .github/SECURITY.md, backed by a test rather than a paragraph:
 *   1. the server-side NANSEN_API_KEY never reaches a client: not in an Atlas, not in any stream event, not in provenance,
 *      not in a cache key, not in an error message;
 *   2. input validation rejects a malformed query BEFORE any network call (and before the key is even looked at).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { NextRequest } from "next/server";
import { atlas, CachedNansenClient, MemoryCache, cacheKey, NansenClient, type AtlasEvent } from "../src/index.js";
import { fakeClient, pepeRoutes } from "./helpers.js";
import { GET as atlasRoute } from "@/app/api/atlas/route";
import { SAFE_QUERY } from "@/lib/engine";

const KEY = "nsn_test_key_0000000000000000000000";
const KEY_SHAPE = /nsn_[A-Za-z0-9_]{8,}/;

// A real shell with NANSEN_OFFLINE=1 exported must not change what this suite asserts — the CachedNansenClient built
// below relies on the default (live) path, so the ambient env is neutralized around every test in this file.
const REAL_NANSEN_OFFLINE = process.env.NANSEN_OFFLINE;
beforeEach(() => {
  delete process.env.NANSEN_OFFLINE;
});
afterEach(() => {
  if (REAL_NANSEN_OFFLINE === undefined) delete process.env.NANSEN_OFFLINE;
  else process.env.NANSEN_OFFLINE = REAL_NANSEN_OFFLINE;
});

describe("boundary 1: the API key never leaves the server", () => {
  it("a full atlas, every stream event, the provenance log and the cache keys contain no key and nothing key-shaped", async () => {
    const client = fakeClient(pepeRoutes);
    const events: AtlasEvent[] = [];
    const a = await atlas(client, "PEPE", { onProgress: (e) => events.push(e) });
    expect(events.length).toBeGreaterThan(5);
    for (const payload of [a, ...events, client.calls]) {
      const text = JSON.stringify(payload);
      expect(text).not.toContain(KEY);
      expect(text).not.toMatch(KEY_SHAPE);
    }
    for (const c of client.calls) {
      expect(JSON.stringify(c.body)).not.toContain("apikey");
      expect(cacheKey(c.endpoint, c.body)).not.toMatch(KEY_SHAPE);
    }
  });

  it("the cached client persists responses under content-addressed keys — a shared cache directory never stores the key", async () => {
    const store = new MemoryCache();
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ tokens: [], total_results: 0 }), { status: 200 });
    const c = new CachedNansenClient(KEY, { store, fetchImpl, rps: 1000 });
    await c.post("search/general", { search_query: "PEPE", result_type: "token" }, []);
    expect(JSON.stringify(store.entries())).not.toMatch(KEY_SHAPE);
  });

  it("a Nansen HTTP error surfaces the endpoint and status, never the request headers", async () => {
    const c = fakeClient(() => new Response("forbidden", { status: 403 }));
    await expect(c.post("tgm/holders", { chain: "ethereum", token_address: "0x1" }, [])).rejects.toMatchObject({ status: 403 });
    await expect(c.post("tgm/holders", { chain: "ethereum", token_address: "0x1" }, [])).rejects.not.toThrow(KEY);
  });

  it("a malformed or missing key is refused at construction, before any request can carry it", () => {
    expect(() => new NansenClient("")).toThrow();
    expect(() => new NansenClient("sk-not-a-nansen-key")).toThrow();
  });
});

describe("boundary 2: input validation runs before any network call", () => {
  const fetchSpy = vi.fn<typeof fetch>();
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.NANSEN_API_KEY;
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = savedKey;
  });

  const req = (q: string, extra = "") => new NextRequest(`http://localhost:3000/api/atlas?q=${encodeURIComponent(q)}${extra}`);

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["html", "<script>alert(1)</script>"],
    ["45 characters (one over the limit)", "A".repeat(45)],
    ["path traversal", "../../etc/passwd"],
    ["query-string injection", "PEPE&chain=ethereum"],
    ["unicode homoglyph", "PΕPE"],
    ["emoji", "🐸"],
  ])("%s → HTTP 400 and zero fetches, with the key present", async (_name, q) => {
    process.env.NANSEN_API_KEY = KEY;
    const res = await atlasRoute(req(q));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toMatch(KEY_SHAPE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("property: every string SAFE_QUERY rejects is a 400 with zero fetches (10,000 generated queries)", async () => {
    process.env.NANSEN_API_KEY = KEY;
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 60 }).filter((s) => !SAFE_QUERY.test(s.trim())),
        async (q) => {
          const res = await atlasRoute(req(q));
          return res.status === 400 && fetchSpy.mock.calls.length === 0;
        },
      ),
      { numRuns: 10_000 },
    );
  });

  it("a well-formed query with no server key is an honest 500 that names the missing variable — zero fetches", async () => {
    delete process.env.NANSEN_API_KEY;
    const res = await atlasRoute(req("PEPE"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("NANSEN_API_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the streaming variant is gated by the same validation", async () => {
    process.env.NANSEN_API_KEY = KEY;
    const res = await atlasRoute(req("<b>", "&stream=1"));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
