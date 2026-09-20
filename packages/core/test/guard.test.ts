/**
 * Spend-guard tests for the public /api/atlas route (apps/web/lib/guard.ts): the server key spends real credits (~120 a
 * cold atlas), so the route must (1) rate-limit an address, (2) stop going live once the day's credit ceiling is reached,
 * and (3) degrade to a labelled fixture replay — or an honest 503 — instead of crashing. Routes are driven directly, as in
 * boundary.test.ts; the fixture replay reads the real fixtures/ directory (cwd = repo root under vitest).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { GET as atlasRoute } from "@/app/api/atlas/route";
import {
  ipAllowed,
  ipRelease,
  creditsLeft,
  recordSpend,
  budgetExhausted,
  resetGuard,
  replayFixture,
  clientIp,
  IP_PER_MIN,
  DAILY_CREDITS,
  MAX_ATLAS_CREDITS,
  BUDGET_MESSAGE,
  NO_FIXTURE_MESSAGE,
  CRAWLER_MESSAGE,
  OPEN_PAGE_MESSAGE,
  RUN_HEADER,
  isPageRun,
} from "@/lib/guard";

const KEY = "nsn_test_key_0000000000000000000000";

// A real shell with NANSEN_OFFLINE=1 exported must not change what this suite asserts — the route drives a live
// CachedNansenClient in several tests here, so the ambient env is neutralized around every test in this file.
const REAL_NANSEN_OFFLINE = process.env.NANSEN_OFFLINE;
beforeEach(() => {
  delete process.env.NANSEN_OFFLINE;
});
afterEach(() => {
  if (REAL_NANSEN_OFFLINE === undefined) delete process.env.NANSEN_OFFLINE;
  else process.env.NANSEN_OFFLINE = REAL_NANSEN_OFFLINE;
});

/** the page's own fetch: carries the run marker (RUN_HEADER) — the only kind of request that may go live */
const req = (q: string, extra = "", ip = "203.0.113.7") =>
  new NextRequest(`http://localhost:3000/api/atlas?q=${encodeURIComponent(q)}${extra}`, { headers: { "x-forwarded-for": ip, [RUN_HEADER]: "1" } });
/** a bare GET: a crawler, a link unfurler, a link checker, curl */
const bare = (q: string, extra = "", ip = "203.0.113.7") =>
  new NextRequest(`http://localhost:3000/api/atlas?q=${encodeURIComponent(q)}${extra}`, { headers: { "x-forwarded-for": ip } });

describe("guard counters", () => {
  beforeEach(resetGuard);

  it("clientIp prefers the first x-forwarded-for hop, then x-real-ip, then 'unknown'", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it(`an address gets ${IP_PER_MIN} atlases a minute, then a Retry-After, then the window slides`, () => {
    const t0 = 1_000_000;
    for (let i = 0; i < IP_PER_MIN; i++) expect(ipAllowed("a", t0 + i)).toEqual({ ok: true, stamp: t0 + i });
    const blocked = ipAllowed("a", t0 + 10_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfter).toBe(50);
    expect(ipAllowed("b", t0 + 10_000)).toEqual({ ok: true, stamp: t0 + 10_000 });
    expect(ipAllowed("a", t0 + 60_001)).toEqual({ ok: true, stamp: t0 + 60_001 });
  });

  it("the table is bounded: 5,000 distinct addresses clear it rather than growing forever", () => {
    for (let i = 0; i < IP_PER_MIN; i++) ipAllowed("late");
    expect(ipAllowed("late").ok).toBe(false);
    for (let i = 0; i < 5_000; i++) ipAllowed(`ip-${i}`);
    expect(ipAllowed("late").ok).toBe(true);
  });

  it("the daily ceiling counts recorded spend and rolls over at UTC midnight", () => {
    const day1 = Date.parse("2026-09-20T12:00:00Z");
    expect(creditsLeft(day1)).toBe(DAILY_CREDITS);
    recordSpend(DAILY_CREDITS - MAX_ATLAS_CREDITS, day1);
    expect(budgetExhausted(day1)).toBe(false);
    recordSpend(1, day1);
    expect(budgetExhausted(day1)).toBe(true);
    recordSpend(-50, day1);
    expect(budgetExhausted(day1)).toBe(true);
    const day2 = Date.parse("2026-09-21T00:00:01Z");
    expect(budgetExhausted(day2)).toBe(false);
  });
});

describe("fixture replay", () => {
  it("PEPE replays from fixtures/ at 0 credits, labelled, with the recorded clock; the final stream event carries the label too", async () => {
    const events: Array<{ type: string }> = [];
    const r = await replayFixture("PEPE", "ethereum", { onProgress: (e) => events.push(e) });
    expect(r).toBeDefined();
    expect(r!.atlas.credits).toBe(0);
    expect(r!.atlas.warnings).toContain(BUDGET_MESSAGE);
    expect(r!.atlas.warnings.filter((w) => w === BUDGET_MESSAGE)).toHaveLength(1);
    expect(r!.atlas.calls.every((c) => c.cached)).toBe(true);
    expect(r!.atlas.hash).toBe(JSON.parse(readFileSync("fixtures/PEPE--ethereum.json", "utf8")).atlas.hash);
    const last = events.at(-1) as { type: string; atlas?: { warnings: string[] } };
    expect(last.type).toBe("atlas");
    expect(last.atlas?.warnings).toContain(BUDGET_MESSAGE);
  });

  it("a traversal-shaped query can never escape the fixtures directory (CodeQL js/path-injection)", async () => {
    for (const q of ["../../package", "..\\..\\package", "/etc/passwd", "PEPE/../../package"]) expect(await replayFixture(q)).toBeUndefined();
  });

  it("chain is part of the fixture name; an unknown ticker has no replay; the no-token fixture rethrows its AtlasError", async () => {
    expect(await replayFixture("DEGEN", "base")).toBeDefined();
    expect(await replayFixture("DEGEN", "ethereum")).toBeUndefined();
    expect(await replayFixture("ZZQXNOFIX")).toBeUndefined();
    await expect(replayFixture("XQZPLM")).rejects.toMatchObject({ code: "no-token" });
  });
});

describe("route behaviour under the guard", () => {
  const fetchSpy = vi.fn<typeof fetch>();
  let savedKey: string | undefined;
  beforeEach(() => {
    resetGuard();
    savedKey = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = savedKey;
  });

  it("past the per-IP rate the route answers 429 + Retry-After without touching the network", async () => {
    for (let i = 0; i < IP_PER_MIN; i++) ipAllowed("203.0.113.7");
    const res = await atlasRoute(req("PEPE"));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("past the daily ceiling a fixture query replays at 0 credits with degraded:true — zero fetches, still a full atlas", async () => {
    recordSpend(DAILY_CREDITS);
    const res = await atlasRoute(req("PEPE", "&chain=ethereum"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.credits).toBe(0);
    expect(body.attributable).toBeGreaterThan(0.3);
    expect(body.countries[0].code).toBe("US");
    expect(body.warnings).toContain(BUDGET_MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("audit 2026-09-19: a request that spent 0 credits gives its per-IP slot back — the judge's path (4 cached maps + the JSON link in a minute) is not a 429", async () => {
    const t0 = 5_000_000;
    for (let i = 0; i < IP_PER_MIN; i++) {
      const g = ipAllowed("judge", t0 + i);
      expect(g.ok).toBe(true);
      if (g.ok) ipRelease("judge", g.stamp); // each one was warm
    }
    expect(ipAllowed("judge", t0 + 100).ok).toBe(true);
    // releasing an unknown stamp is a no-op; a cold map keeps its slot
    ipRelease("judge", 42);
    for (let i = 0; i < IP_PER_MIN - 1; i++) expect(ipAllowed("judge", t0 + 200 + i).ok).toBe(true);
    expect(ipAllowed("judge", t0 + 300).ok).toBe(false);
  });

  it("audit 2026-09-19: over the wire — five fixture replays from one address inside a minute all answer 200 (0 credits each), a typo does not burn a slot", async () => {
    recordSpend(DAILY_CREDITS);
    for (const [q, extra] of [
      ["PEPE", "&chain=ethereum"],
      ["WLFI", "&chain=ethereum"],
      ["DEGEN", "&chain=base"],
      ["MEW", "&chain=solana"],
      ["PEPE", "&chain=ethereum"],
    ]) {
      const res = await atlasRoute(req(q, extra, "198.51.100.9"));
      expect(res.status).toBe(200);
    }
    for (let i = 0; i < 3; i++) expect((await atlasRoute(req("XQZPLM", "", "198.51.100.9"))).status).toBe(404);
    expect((await atlasRoute(req("PEPE", "&chain=ethereum", "198.51.100.9"))).status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("past the daily ceiling a query with no fixture is an honest 503 naming tokens that do replay", async () => {
    recordSpend(DAILY_CREDITS);
    const res = await atlasRoute(req("ZZQXNOFIX"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(NO_FIXTURE_MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the no-token fixture answers 404 with the candidates Nansen returned, never a 500", async () => {
    recordSpend(DAILY_CREDITS);
    const res = await atlasRoute(req("XQZPLM"));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("no-token");
  });

  it("the streaming variant degrades the same way: replay events end with a labelled atlas + asOf, a no-fixture query ends with an error event", async () => {
    recordSpend(DAILY_CREDITS);
    const ok = await atlasRoute(req("WLFI", "&chain=ethereum&stream=1"));
    expect(ok.status).toBe(200);
    const lines = (await ok.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: "call", phase: "end", call: { endpoint: "search/general" } }); // the rail sees the search before the token
    expect(lines.find((e) => e.type !== "call").type).toBe("token");
    expect(lines.filter((e) => e.type === "wallet").length).toBeGreaterThan(30);
    const atlas = lines.find((e) => e.type === "atlas");
    expect(atlas.atlas.warnings).toContain(BUDGET_MESSAGE);
    expect(lines.at(-1).type).toBe("asOf");

    const none = await atlasRoute(req("ZZQXNOFIX", "&stream=1", "203.0.113.8"));
    const last = (await none.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .at(-1);
    expect(last).toEqual({ type: "error", message: NO_FIXTURE_MESSAGE });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("holders= is clamped to 1–60 and never crashes on garbage", async () => {
    recordSpend(DAILY_CREDITS);
    for (const [i, h] of ["abc", "0", "999", "-4"].entries()) {
      const res = await atlasRoute(req("PEPE", `&chain=ethereum&holders=${h}`, `203.0.113.${20 + i}`));
      expect(res.status).toBe(200);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("crawler spend trap (audit 2026-09-19: a link checker following /judge's API href spent two cold maps)", () => {
  const fetchSpy = vi.fn<typeof fetch>();
  let savedKey: string | undefined;
  beforeEach(() => {
    resetGuard();
    savedKey = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = savedKey;
  });

  it("isPageRun: only the exact marker counts", () => {
    expect(isPageRun(new Headers({ [RUN_HEADER]: "1" }))).toBe(true);
    expect(isPageRun(new Headers({ [RUN_HEADER]: "true" }))).toBe(false);
    expect(isPageRun(new Headers({ "sec-fetch-mode": "cors", "user-agent": "Twitterbot/1.0" }))).toBe(false);
    expect(isPageRun(new Headers())).toBe(false);
  });

  it("a bare GET of a fixture token is the labelled replay — 200, replay:true, 0 credits, zero fetches, budget untouched, no IP slot", async () => {
    const res = await atlasRoute(bare("PEPE", "&chain=ethereum", "192.0.2.1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replay).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.credits).toBe(0);
    expect(body.hash).toBe(JSON.parse(readFileSync("fixtures/PEPE--ethereum.json", "utf8")).atlas.hash);
    expect(body.warnings).toContain(CRAWLER_MESSAGE);
    expect(body.warnings).not.toContain(BUDGET_MESSAGE);
    expect(body.page).toBe("/?q=PEPE&chain=ethereum");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(creditsLeft()).toBe(DAILY_CREDITS);
    for (let i = 0; i < IP_PER_MIN; i++) expect(ipAllowed("192.0.2.1").ok).toBe(true); // bare GETs never took a slot
  });

  it("a bare GET of anything else is a 202 pointing at the page — never a search, never a holders call", async () => {
    for (const [q, extra] of [
      ["NOTAFIXTURE", "&chain=ethereum"],
      ["0xd8da6bf26964af9d7eed9e03e62f31d0d9a0ee8f", "&chain=ethereum"],
      ["hello world", ""],
    ]) {
      const res = await atlasRoute(bare(q, extra));
      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.message).toBe(OPEN_PAGE_MESSAGE);
      expect(body.credits).toBe(0);
      expect(body.page.startsWith("/?q=")).toBe(true);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a bare GET of the recorded no-token fixture is still the honest 404", async () => {
    const res = await atlasRoute(bare("XQZPLM"));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the bare streaming variant replays too, ending with asOf replay:true; a non-fixture ends with the open-page error", async () => {
    const ok = await atlasRoute(bare("MEW", "&chain=solana&stream=1"));
    const lines = (await ok.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: "call", phase: "end", call: { endpoint: "search/general" } }); // the rail sees the search before the token
    expect(lines.find((e) => e.type !== "call").type).toBe("token");
    expect(lines.find((e) => e.type === "atlas").atlas.warnings).toContain(CRAWLER_MESSAGE);
    expect(lines.at(-1)).toMatchObject({ type: "asOf", replay: true, degraded: false });
    const none = await atlasRoute(bare("NOTAFIXTURE", "&chain=base&stream=1"));
    expect(
      (await none.text())
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
        .at(-1),
    ).toMatchObject({ type: "error", code: "open-page" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the marker is what lets a request go live: the same query with x-atlas-run: 1 reaches the network", async () => {
    fetchSpy.mockResolvedValue(new Response('{"tokens":[]}', { status: 200 }));
    // a query no earlier run could have cached on disk (the engine's read-through cache is real under vitest)
    const res = await atlasRoute(req(`NOFIX${Date.now().toString(36).toUpperCase()}`, "&chain=ethereum"));
    expect(res.status).toBe(404); // search found nothing — but it WAS asked
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("search/general");
  });
});

describe("GET /api/og — an image never 4xxs and never spends", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    resetGuard();
    savedKey = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = savedKey;
  });

  it("the PEPE card renders from the fixture: 200 image/png, zero fetches, cacheable", async () => {
    const { GET: og } = await import("@/app/api/og/route");
    const res = await og(new NextRequest("http://localhost:3000/api/og?q=PEPE&chain=ethereum"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(res.headers.get("cache-control")).toContain("s-maxage");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an unknown token and garbage both get the generic card: 200, zero fetches", async () => {
    const { GET: og } = await import("@/app/api/og/route");
    for (const q of ["ZZQXNOFIX", "<script>", ""]) {
      const res = await og(new NextRequest(`http://localhost:3000/api/og?q=${encodeURIComponent(q)}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("review pass 1 (2026-09-18): /api/og never previews a half-cached token", () => {
  it("a disk cache holding only the search + holders responses yields the generic card, not a poster of error rows", async () => {
    const { GET: og } = await import("@/app/api/og/route");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
    const res = await og(new NextRequest("http://localhost:3000/api/og?q=NOTCACHEDTOKEN&chain=base"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
