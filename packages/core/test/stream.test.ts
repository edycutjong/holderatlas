/**
 * The page's stream reducer (apps/web/lib/stream.ts), driven by the events a replayed fixture emits — the exact NDJSON
 * the route streams. Pins the audit finding of 2026-09-19: the `holders` event carried coverage / custody / structural
 * shares since 9d1a304 but the page never applied them, so the streaming caption read "0 % of their supply · exchange
 * custody 0 %" until the last wallet landed.
 */
import { describe, it, expect } from "vitest";
import { CachedNansenClient, atlas, readFixture, fixtureStore, type AtlasEvent } from "../src/index.js";
import { applyEvent, splitLines, blank, type Live } from "@/lib/stream";

async function replay(file: string) {
  const f = readFixture(`fixtures/${file}`);
  const events: AtlasEvent[] = [];
  const c = new CachedNansenClient("nsn_offline_replay_000000000000000", { store: fixtureStore(f), offline: true });
  const a = await atlas(c, f.input, { ...f.options, now: f.now, onProgress: (e) => events.push(e) });
  return { f, a, events };
}

describe("stream reducer", () => {
  it("the caption is right from the holders event on: coverage, custody and structural shares are applied before any wallet lands", async () => {
    const { events } = await replay("PEPE--ethereum.json");
    let live: Live | null = null;
    for (const e of events) {
      live = applyEvent(live, e);
      if (e.type === "holders") break;
    }
    expect(live).not.toBeNull();
    const h = events.find((e) => e.type === "holders")!;
    if (h.type !== "holders") throw new Error("no holders event");
    expect(live!.data.coverage).toBeCloseTo(h.coverage, 9);
    expect(live!.data.custodyShare).toBeCloseTo(h.custodyShare, 9);
    expect(live!.data.structuralShare).toBeCloseTo(h.structuralShare, 9);
    expect(live!.data.coverage).toBeGreaterThan(0.5); // PEPE: 72.7 % of the top-100 supply examined
    expect(live!.data.custodyShare).toBeGreaterThan(0.5); // 71.9 % of it exchange custody
    expect(live!.data.progress).toEqual({ done: 0, total: 52 });
    expect(live!.rows).toEqual([]);
  });

  it("after every event the view equals the engine's atlas: number, countries, rows, hash, calls", async () => {
    const { a, events } = await replay("PEPE--ethereum.json");
    let live: Live | null = null;
    let seen = 0;
    for (const e of events) {
      live = applyEvent(live, e);
      if (e.type === "wallet") {
        seen++;
        expect(live.rows).toHaveLength(seen);
        expect(live.data.progress).toEqual({ done: seen, total: 52 });
      }
    }
    live = applyEvent(live, { type: "asOf", asOf: "2026-09-18T11:26:44.038Z", degraded: true });
    expect(live!.hash).toBe(a.hash);
    expect(live!.data.attributable).toBe(a.attributable);
    expect(live!.data.countries.map((c) => c.code)).toEqual(a.countries.map((c) => c.code));
    expect(live!.rows).toHaveLength(a.rows.length);
    expect(live!.calls).toHaveLength(a.calls.length);
    expect(live!.data.examined).toEqual(a.examined);
    expect(live!.degraded).toBe(true);
    expect(live!.asOf).toBe("2026-09-18T11:26:44.038Z");
  });

  it("a reclass event replaces the row in place; the final atlas's examined count excludes it (DEGEN: 5 contracts among the top humans)", async () => {
    const { a, events } = await replay("DEGEN--base.json");
    const reclass = events.filter((e) => e.type === "reclass");
    expect(reclass.length).toBe(5);
    let live: Live | null = null;
    for (const e of events) {
      live = applyEvent(live, e);
      if (e.type === "reclass") {
        const row = live.rows.find((r) => r.address === e.row.address)!;
        expect(row.kind).toBe("structural");
      }
    }
    expect(live!.data.examined.custody + live!.data.examined.human).toBe(a.rows.filter((r) => r.kind !== "structural").length);
    expect(live!.data.examined.custody + live!.data.examined.human).toBe(47);
  });

  it("a solana fixture reaches the page as naming=false with every traced wallet 'unnamed' and 0 % placed", async () => {
    const { events } = await replay("MEW--solana.json");
    let live: Live | null = null;
    for (const e of events) live = applyEvent(live, e);
    expect(live!.data.naming).toBe(false);
    expect(live!.data.attributable).toBe(0);
    expect(live!.data.countries).toEqual([]);
    expect(live!.data.unnamed.wallets).toBeGreaterThan(0);
    expect(live!.rows.filter((r) => r.bucket === "unnamed").length).toBe(live!.data.unnamed.wallets);
  });

  it("splitLines keeps a partial trailing line for the next chunk and drops blank lines", () => {
    expect(splitLines('{"a":1}\n{"b":2}\n{"c"')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
    expect(splitLines('\n\n{"a":1}\n')).toEqual({ lines: ['{"a":1}'], rest: "" });
    expect(splitLines("")).toEqual({ lines: [], rest: "" });
  });

  it("blank() is a complete, NaN-free picture (what the page shows for the first frame)", () => {
    const b = blank();
    expect(b.data.attributable).toBe(0);
    expect(b.data.examined).toEqual({ custody: 0, human: 0 });
    expect(b.hash).toBe("");
  });
});
