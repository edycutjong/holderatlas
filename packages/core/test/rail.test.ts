/**
 * The Nansen call rail (LANDING_DESIGN A3): every row is a real call from the engine's own provenance stream. These tests pin
 * (1) the client announces each call as it starts and ends with the SAME object it records, (2) the engine forwards them
 * as `call` events in order, and (3) the page's reducer (apps/web/lib/rail.ts) turns them into rows whose totals equal
 * the drawer's — calls, credits — with pending rows completing in place, oldest at the top.
 */
import { describe, it, expect } from "vitest";
import { CachedNansenClient, MemoryCache, atlas, readFixture, fixtureStore, type AtlasEvent, type CallEvent } from "../src/index.js";
import { fakeClient } from "./helpers.js";
import { applyCall, markReplayed, rowsFromCalls, settlePending, totals, summarise, RAIL_CAP, type RailRow } from "@/lib/rail";

describe("client call events", () => {
  it("a live call announces start then end, and the end carries the recorded Call object itself", async () => {
    const c = fakeClient(() => ({ data: [] }));
    const seen: CallEvent[] = [];
    const off = c.subscribe((e) => seen.push(e));
    await c.post("tgm/holders", { chain: "ethereum", token_address: "0x1" }, ["data[].address"]);
    expect(seen.map((e) => e.phase)).toEqual(["start", "end"]);
    expect(seen[0]).toMatchObject({ phase: "start", id: 1, endpoint: "tgm/holders", body: { chain: "ethereum" } });
    const end = seen[1];
    if (end.phase !== "end") throw new Error("no end");
    expect(end.id).toBe(1);
    expect(end.call).toBe(c.calls[0]); // identity, not a copy — the rail and the drawer print the same object
    expect(end.call).toMatchObject({ credits: 5, cached: false, ok: true, status: 200 });
    off();
    await c.post("tgm/transfers", {});
    expect(seen).toHaveLength(2); // unsubscribed: nothing more
  });

  it("a failed call ends with ok:false at 0 credits; a cache hit ends without a start", async () => {
    const seen: CallEvent[] = [];
    const bad = fakeClient(() => new Response('{"error":"nope"}', { status: 422 }));
    bad.subscribe((e) => seen.push(e));
    await expect(bad.post("tgm/transfers", { chain: "base" })).rejects.toThrow(/422/);
    expect(seen.map((e) => e.phase)).toEqual(["start", "end"]);
    expect(seen[1]).toMatchObject({ phase: "end", call: { ok: false, credits: 0, status: 422 } });

    const store = new MemoryCache();
    const c = new CachedNansenClient("nsn_test_key_0000000000000000000000", {
      store,
      fetchImpl: async () => new Response('{"data":[]}', { status: 200 }),
      rps: 1000,
    });
    const events: CallEvent[] = [];
    c.subscribe((e) => events.push(e));
    await c.post("tgm/holders", { chain: "ethereum", token_address: "0x2" });
    await c.post("tgm/holders", { chain: "ethereum", token_address: "0x2" });
    expect(events.map((e) => `${e.phase}:${e.id}`)).toEqual(["start:1", "end:1", "end:2"]);
    expect(events[2]).toMatchObject({ phase: "end", call: { cached: true, credits: 0 } });
  });
});

async function replay(file: string) {
  const f = readFixture(`fixtures/${file}`);
  const events: AtlasEvent[] = [];
  const c = new CachedNansenClient("nsn_offline_replay_000000000000000", { store: fixtureStore(f), offline: true });
  const a = await atlas(c, f.input, { ...f.options, now: f.now, onProgress: (e) => events.push(e) });
  return { f, a, events };
}

describe("engine forwards call events", () => {
  it("one `call` end event per recorded call, in provenance order, before the atlas event", async () => {
    const { a, events } = await replay("PEPE--ethereum.json");
    const ends = events.filter((e) => e.type === "call" && e.phase === "end");
    expect(ends).toHaveLength(a.calls.length);
    ends.forEach((e, i) => {
      if (e.type !== "call" || e.phase !== "end") throw new Error("shape");
      expect(e.call).toBe(a.calls[i]);
    });
    expect(events.findIndex((e) => e.type === "atlas")).toBeGreaterThan(events.map((e) => e.type).lastIndexOf("call"));
    // a replayed timeout (USDC) still arrives as a call event, failed, 0 credits
    const usdc = await replay("USDC--ethereum.json");
    const failed = usdc.events.filter((e) => e.type === "call" && e.phase === "end" && !e.call.ok);
    expect(failed.length).toBe(usdc.a.calls.filter((c) => !c.ok).length);
    expect(failed.length).toBeGreaterThan(0);
  });

  it("the listener is removed when the atlas finishes — a later call on the same client is not forwarded", async () => {
    const f = readFixture("fixtures/PEPE--ethereum.json");
    const c = new CachedNansenClient("nsn_offline_replay_000000000000000", { store: fixtureStore(f), offline: true });
    const events: AtlasEvent[] = [];
    await atlas(c, f.input, { ...f.options, now: f.now, onProgress: (e) => events.push(e) });
    const n = events.length;
    await c.post("search/general", { search_query: "PEPE", result_type: "token", limit: 25 }).catch(() => undefined);
    expect(events).toHaveLength(n);
  });
});

describe("rail reducer (apps/web/lib/rail.ts)", () => {
  it("replaying the hero fixture through the reducer gives the drawer's totals exactly: calls and credits", async () => {
    const { a, events } = await replay("PEPE--ethereum.json");
    let rows: RailRow[] = [];
    for (const e of events) if (e.type === "call") rows = applyCall(rows, e, "1");
    const t = totals(rows);
    expect(t.pending).toBe(0);
    expect(t.calls).toBe(a.calls.length);
    expect(t.credits).toBe(a.credits);
    expect(rows.map((r) => r.endpoint)).toEqual(a.calls.map((c) => c.endpoint));
    expect(rows.every((r) => r.status === "cached" && !r.replayed)).toBe(true);
    // the closing asOf says it was a replay → every row of that run is labelled, other runs untouched
    const other = applyCall([], { phase: "start", id: 1, endpoint: "tgm/holders", body: {} }, "2");
    const marked = markReplayed([...rows, ...other], "1");
    expect(marked.filter((r) => r.replayed)).toHaveLength(rows.length);
    expect(marked.at(-1)).toMatchObject({ status: "pending", replayed: false });
  });

  it("a pending row completes in place — oldest stays at the top, credits land only on end", () => {
    let rows: RailRow[] = [];
    rows = applyCall(rows, { phase: "start", id: 1, endpoint: "tgm/holders", body: { chain: "ethereum" } }, "1");
    rows = applyCall(rows, { phase: "start", id: 2, endpoint: "tgm/transfers", body: { chain: "ethereum" } }, "1");
    expect(rows.map((r) => r.status)).toEqual(["pending", "pending"]);
    expect(totals(rows)).toEqual({ calls: 0, credits: 0, pending: 2 });
    const call = {
      endpoint: "tgm/transfers",
      body: { chain: "ethereum" },
      credits: 1,
      ms: 412,
      cached: false,
      status: 200,
      fieldsUsed: [],
      responseHash: "a91f".padEnd(64, "0"),
      attempts: 1,
      totalMs: 412,
      ok: true,
    };
    rows = applyCall(rows, { phase: "end", id: 2, call }, "1");
    expect(rows.map((r) => r.status)).toEqual(["pending", "live"]);
    expect(rows[1]).toMatchObject({ key: "1:2", credits: 1, ms: 412, hash: "a91f", seq: 2 });
    expect(totals(rows)).toEqual({ calls: 1, credits: 1, pending: 1 });
    const failed = { ...call, endpoint: "tgm/holders", credits: 0, ok: false, error: "timeout", totalMs: 10000, responseHash: "" };
    rows = applyCall(rows, { phase: "end", id: 1, call: failed }, "1");
    expect(rows[0]).toMatchObject({ status: "error", ms: 10000, hash: "", error: "timeout" });
    // a duplicate start is ignored; an end without a start appends
    expect(applyCall(rows, { phase: "start", id: 1, endpoint: "x", body: {} }, "1")).toBe(rows);
    expect(applyCall(rows, { phase: "end", id: 9, call: { ...call, cached: true, credits: 0 } }, "1").at(-1)).toMatchObject({ key: "1:9", status: "cached" });
  });

  it("the example's calls populate the rail on load, labelled replayed; the rail keeps at most 200 rows", async () => {
    const { a } = await replay("PEPE--ethereum.json");
    const rows = rowsFromCalls(a.calls, "example");
    expect(rows).toHaveLength(a.calls.length);
    expect(rows.every((r) => r.replayed && r.status === "cached" && r.credits === 0)).toBe(true);
    let many = rows;
    for (let i = 0; i < 150; i++) many = applyCall(many, { phase: "start", id: i + 1, endpoint: "tgm/transfers", body: {} }, "1");
    expect(many).toHaveLength(RAIL_CAP);
    expect(many[0].key).not.toBe("example:1"); // oldest dropped first
    expect(many.at(-1)!.key).toBe("1:150");
  });

  it("an aborted run settles its pending rows as errors — nothing pulses for the rest of the session, other runs untouched", () => {
    let rows: RailRow[] = rowsFromCalls([], "example");
    rows = applyCall(rows, { phase: "start", id: 1, endpoint: "tgm/transfers", body: { chain: "ethereum" } }, "1");
    rows = applyCall(rows, { phase: "start", id: 2, endpoint: "tgm/transfers", body: { chain: "ethereum" } }, "1");
    const done = {
      endpoint: "tgm/transfers",
      body: {},
      credits: 1,
      ms: 300,
      cached: false,
      status: 200,
      fieldsUsed: [],
      responseHash: "abcd".padEnd(64, "0"),
      attempts: 1,
      totalMs: 300,
      ok: true,
    };
    rows = applyCall(rows, { phase: "end", id: 1, call: done }, "1");
    rows = applyCall(rows, { phase: "start", id: 1, endpoint: "search/general", body: { search_query: "WLFI" } }, "2"); // the new run
    const settled = settlePending(rows, "1", "aborted");
    expect(settled.map((r) => [r.key, r.status])).toEqual([
      ["1:1", "live"],
      ["1:2", "error"],
      ["2:1", "pending"],
    ]);
    expect(settled[1]).toMatchObject({ error: "aborted", credits: 0, ms: 0 });
    expect(totals(settled)).toEqual({ calls: 2, credits: 1, pending: 1 });
    expect(settlePending(settled, "1")).toBe(settled); // idempotent, no re-render when nothing is pending
  });

  it("the param summary never leaks the key or a whole body", () => {
    expect(summarise({ chain: "ethereum", token_address: "0x6982508145454ce325ddbe47a25d4ec3d2311933", filters: { to_address: "0xabcdef0123456789" } })).toBe(
      "ethereum · to=0xabcdef…",
    );
    expect(summarise({ search_query: "PEPE", result_type: "token", limit: 25, apikey: "nsn_should_never_appear" })).toBe("q=PEPE");
    expect(summarise({ chain: "base", transaction_hash: "0x1234567890abcdef" })).toBe("base · tx=0x12345678…");
  });
});
