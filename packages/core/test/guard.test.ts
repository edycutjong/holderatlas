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
} from "@/lib/guard";

const KEY = "nsn_test_key_0000000000000000000000";
const req = (q: string, extra = "", ip = "203.0.113.7") =>
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
    for (let i = 0; i < IP_PER_MIN; i++) expect(ipAllowed("a", t0 + i)).toEqual({ ok: true });
    const blocked = ipAllowed("a", t0 + 10_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfter).toBe(50);
    expect(ipAllowed("b", t0 + 10_000)).toEqual({ ok: true });
    expect(ipAllowed("a", t0 + 60_001)).toEqual({ ok: true });
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
    expect(lines[0].type).toBe("token");
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
