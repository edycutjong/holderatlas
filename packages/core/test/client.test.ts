import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NansenClient, BudgetError, clientFromEnv } from "../src/client.js";
import { CachedNansenClient, MemoryCache } from "../src/cache.js";
import { atlas } from "../src/atlas.js";
import { pepeRoutes } from "./helpers.js";
import { fakeClient } from "./helpers.js";

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

describe("NansenClient", () => {
  it("rejects a missing or malformed key", () => {
    expect(() => new NansenClient("")).toThrow(/NANSEN_API_KEY/);
    expect(() => new NansenClient("abc")).toThrow(/nsn_/);
  });
  it("sends the apikey header and records credits, status and a sha256 of the raw body", async () => {
    let headers: Record<string, string> = {};
    const fetchImpl: typeof fetch = async (_u, init) => {
      headers = init!.headers as Record<string, string>;
      return new Response('{"data":[]}', { status: 200 });
    };
    const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl });
    await c.post("tgm/holders", { chain: "ethereum", token_address: "0x1" }, ["data[].address_label"]);
    expect(headers.apikey).toMatch(/^nsn_/);
    expect(c.calls[0]).toMatchObject({ endpoint: "tgm/holders", credits: 5, status: 200, cached: false, fieldsUsed: ["data[].address_label"] });
    expect(c.calls[0].responseHash).toHaveLength(64);
    expect(c.creditsSpent).toBe(5);
  });
  it("retries once on 429 then succeeds; the failed attempt is not recorded", async () => {
    let n = 0;
    const c = fakeClient(() => (n++ === 0 ? new Response("slow down", { status: 429 }) : { ok: true }));
    const out = await c.post("tgm/transfers", {});
    expect(out).toEqual({ ok: true });
    expect(n).toBe(2);
    expect(c.calls).toHaveLength(1);
  });
  it("throws NansenError with status on 4xx without retry", async () => {
    let n = 0;
    const c = fakeClient(() => {
      n++;
      return new Response('{"error":"Missing field"}', { status: 422 });
    });
    await expect(c.post("tgm/transfers", {})).rejects.toThrow(/HTTP 422/);
    expect(n).toBe(1);
    // the failure is recorded in provenance at 0 credits, with the real attempt count
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ ok: false, status: 422, credits: 0, attempts: 1 });
    expect(c.calls[0].error).toMatch(/HTTP 422/);
  });
  it("gives up after the second 5xx and records attempts=2", async () => {
    const c = fakeClient(() => new Response("boom", { status: 503 }));
    await expect(c.post("tgm/holders", {})).rejects.toThrow(/HTTP 503/);
    expect(c.calls[0]).toMatchObject({ ok: false, status: 503, attempts: 2 });
    expect(c.calls[0].totalMs).toBeGreaterThanOrEqual(700);
  });
  it("a successful call to an endpoint outside the CREDITS table records 1 credit as a fallback", async () => {
    const c = fakeClient(() => ({ ok: 1 }));
    await c.post("totally/unknown-endpoint", {});
    expect(c.calls[0].credits).toBe(1);
  });
  it("a thrown non-Error value is recorded via String(e), and its budget rolls back through the same ?? 1 fallback for an unknown endpoint", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw "boom";
    };
    const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, rps: 1000 });
    await expect(c.post("totally/unknown-endpoint", {}, [], { retries: 0 })).rejects.toBe("boom");
    expect(c.calls[0]).toMatchObject({ ok: false, error: "boom", credits: 0 });
  });
});

describe("review fix F5: retried attempts are visible", () => {
  it("records attempts=2 and totalMs ≥ the retry backoff when the first attempt fails", async () => {
    let n = 0;
    const c = fakeClient(() => (n++ === 0 ? new Response("x", { status: 503 }) : { ok: 1 }));
    await c.post("tgm/holders", {});
    expect(c.calls[0].attempts).toBe(2);
    expect(c.calls[0].totalMs).toBeGreaterThanOrEqual(700);
    expect(c.calls[0].ms).toBeLessThan(700);
  });
  it("a first-attempt timeout is retried and counted", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async (_u, init) => {
      if (n++ === 0)
        await new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      return new Response('{"ok":1}', { status: 200 });
    };
    const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, timeoutMs: 30, rps: 1000 });
    await c.post("tgm/holders", {});
    expect(c.calls[0].attempts).toBe(2);
  });
});

describe("per-call options", () => {
  it("retries: 0 fails fast on a 5xx with attempts=1", async () => {
    let n = 0;
    const c = fakeClient(() => {
      n++;
      return new Response("x", { status: 503 });
    });
    await expect(c.post("tgm/transfers", {}, [], { retries: 0 })).rejects.toThrow(/503/);
    expect(n).toBe(1);
    expect(c.calls[0].attempts).toBe(1);
  });
  it("a per-call timeoutMs overrides the client default", async () => {
    const fetchImpl: typeof fetch = async (_u, init) =>
      new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, timeoutMs: 60_000, rps: 1000 });
    const t0 = Date.now();
    await expect(c.post("tgm/transfers", {}, [], { timeoutMs: 20, retries: 0 })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(c.calls[0]).toMatchObject({ ok: false, error: "timeout", attempts: 1 });
  });
});

describe("credit ceiling (DEVIATIONS #10, 2026-09-18: `seed --reuse-cache` on a cold cache re-billed 1,050 credits)", () => {
  it("the call that would cross maxCredits throws BudgetError before any request is sent", async () => {
    let fetches = 0;
    const c = fakeClient(
      () => {
        fetches++;
        return { data: [] };
      },
      { maxCredits: 6 },
    );
    await c.post("tgm/holders", { chain: "ethereum" }); // 5 → 5 spent
    await c.post("tgm/transfers", { chain: "ethereum" }); // 1 → 6 spent, exactly the ceiling
    await expect(c.post("tgm/transfers", { chain: "ethereum", n: 2 })).rejects.toBeInstanceOf(BudgetError);
    expect(fetches).toBe(2);
    expect(c.creditsSpent).toBe(6);
    const failed = c.calls.at(-1)!;
    expect(failed).toMatchObject({ ok: false, credits: 0 });
    expect(failed.error).toMatch(/credit ceiling/);
  });
  it("cached hits are free and never count against the ceiling; the first cold call past it is refused", async () => {
    let fetches = 0;
    const store = new MemoryCache();
    const warm = new CachedNansenClient("nsn_test_key_0000000000000000000000", {
      store,
      fetchImpl: async () => {
        fetches++;
        return new Response('{"data":[]}', { status: 200 });
      },
    });
    await warm.post("tgm/holders", { chain: "ethereum", token_address: "0x1" });
    const capped = new CachedNansenClient("nsn_test_key_0000000000000000000000", {
      store,
      maxCredits: 1,
      fetchImpl: async () => {
        fetches++;
        return new Response('{"data":[]}', { status: 200 });
      },
    });
    await capped.post("tgm/holders", { chain: "ethereum", token_address: "0x1" }); // a hit: 0 credits, allowed under a ceiling of 1
    expect(capped.creditsSpent).toBe(0);
    await expect(capped.post("tgm/holders", { chain: "ethereum", token_address: "0x2" })).rejects.toBeInstanceOf(BudgetError);
    expect(fetches).toBe(1);
  });
  it("atlas() stops at the ceiling instead of finishing with every wallet marked 'lookup failed'", async () => {
    const c = fakeClient(pepeRoutes, { maxCredits: 12 });
    await expect(atlas(c, "PEPE", { now: Date.parse("2026-09-18T11:00:00Z") })).rejects.toBeInstanceOf(BudgetError);
    expect(c.creditsSpent).toBeLessThanOrEqual(12);
  });
});

describe("RateLimiter (via NansenClient.post)", () => {
  it("a second request within the same second waits out the window before the limiter lets it through", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl: typeof fetch = async () => new Response("{}", { status: 200 });
      const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, rps: 1, timeoutMs: 60_000 });
      const first = c.post("tgm/holders", { a: 1 });
      await vi.advanceTimersByTimeAsync(0);
      await first;
      const second = c.post("tgm/holders", { a: 2 });
      let done = false;
      second.then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(done).toBe(false); // still queued behind the 1 rps limiter
      await vi.advanceTimersByTimeAsync(600);
      await second;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("the per-minute window holds a request even when the per-second window is open (Nansen's 300/min cap)", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl: typeof fetch = async () => new Response("{}", { status: 200 });
      const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, rps: 1000, rpm: 2, timeoutMs: 60_000 });
      await c.post("tgm/holders", { a: 1 });
      await c.post("tgm/holders", { a: 2 });
      const third = c.post("tgm/holders", { a: 3 });
      let done = false;
      third.then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(done).toBe(false); // second window open, minute window full
      await vi.advanceTimersByTimeAsync(31_000);
      await third;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("clientFromEnv", () => {
  it("builds a NansenClient from NANSEN_API_KEY", () => {
    const prev = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = "nsn_test_key_0000000000000000000000";
    try {
      expect(clientFromEnv()).toBeInstanceOf(NansenClient);
    } finally {
      if (prev === undefined) delete process.env.NANSEN_API_KEY;
      else process.env.NANSEN_API_KEY = prev;
    }
  });
  it("falls back to an empty key when NANSEN_API_KEY is unset, which the client rejects", () => {
    const prev = process.env.NANSEN_API_KEY;
    delete process.env.NANSEN_API_KEY;
    try {
      expect(() => clientFromEnv()).toThrow(/NANSEN_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.NANSEN_API_KEY = prev;
    }
  });
});
