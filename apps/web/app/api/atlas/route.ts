import { NextRequest } from "next/server";
import { atlasFor, SAFE_QUERY, parseChain } from "@/lib/engine";
import { clientIp, ipAllowed, ipRelease, budgetExhausted, recordSpend, replayFixture, NO_FIXTURE_MESSAGE } from "@/lib/guard";
import { AtlasError, DEFAULT_HOLDERS, type AtlasEvent } from "@holderatlas/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/atlas?q=PEPE[&chain=ethereum][&holders=40]          → Atlas JSON
 * GET /api/atlas?q=PEPE&stream=1                                → NDJSON: {token} · {holders} · {wallet}×N · {reclass}* · {atlas}
 * The stream is what the page renders: the map fills country by country as each wallet's exchange lands, the bar
 * re-sorts, the number counts. Same engine, same hash as the CLI.
 * Spend guard (lib/guard.ts): 429 past the per-IP rate; past the daily credit ceiling a recorded fixture replays at
 * 0 credits (labelled in `warnings`, `degraded: true`) or the request gets a 503 that says why.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const q = (url.searchParams.get("q") ?? "").trim();
  const chain = parseChain(url.searchParams.get("chain"));
  const holdersParam = Number(url.searchParams.get("holders") ?? DEFAULT_HOLDERS);
  const holders = Number.isInteger(holdersParam) && holdersParam >= 1 && holdersParam <= 60 ? holdersParam : DEFAULT_HOLDERS;
  if (!SAFE_QUERY.test(q)) return Response.json({ error: "type a ticker (1–24 letters or digits) or a token address" }, { status: 400 });
  if (!process.env.NANSEN_API_KEY) return Response.json({ error: "server has no NANSEN_API_KEY" }, { status: 500 });
  const ip = clientIp(req.headers);
  const gate = ipAllowed(ip);
  if (!gate.ok) {
    return Response.json(
      { error: `Too many maps from this address — try again in ${gate.retryAfter} s` },
      { status: 429, headers: { "retry-after": String(gate.retryAfter), "cache-control": "no-store" } },
    );
  }
  const degraded = budgetExhausted();
  // a request that spent nothing (cache hit, fixture replay, typo) gives its per-IP slot back — the limit caps cold maps
  const settle = (credits: number) => {
    if (!degraded) recordSpend(credits);
    if (credits === 0) ipRelease(ip, gate.stamp);
  };

  if (url.searchParams.get("stream") !== "1") {
    try {
      const r = degraded ? await replayFixture(q, chain, { holders }) : await atlasFor(q, { chain, holders });
      if (!r) {
        ipRelease(ip, gate.stamp);
        return Response.json({ error: NO_FIXTURE_MESSAGE }, { status: 503, headers: { "retry-after": "3600", "cache-control": "no-store" } });
      }
      settle(r.atlas.credits);
      return Response.json({ ...r.atlas, asOf: r.oldestHit ?? r.atlas.asOf, degraded }, { headers: { "cache-control": "no-store" } });
    } catch (e) {
      if (e instanceof AtlasError) {
        ipRelease(ip, gate.stamp);
        return Response.json({ error: e.message, code: e.code, candidates: e.candidates }, { status: 404, headers: { "cache-control": "no-store" } });
      }
      return Response.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The browser aborts this fetch when the user submits a new token mid-stream; after that every enqueue throws,
      // so a closed stream turns `send` into a no-op and the atlas simply finishes unobserved.
      let closed = false;
      const send = (
        e: AtlasEvent | { type: "error"; message: string; code?: string; candidates?: unknown[] } | { type: "asOf"; asOf: string | null; degraded: boolean },
      ) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        const r = degraded ? await replayFixture(q, chain, { holders, onProgress: send }) : await atlasFor(q, { chain, holders, onProgress: send });
        if (!r) {
          ipRelease(ip, gate.stamp);
          send({ type: "error", message: NO_FIXTURE_MESSAGE });
        } else {
          settle(r.atlas.credits);
          send({ type: "asOf", asOf: r.oldestHit ?? null, degraded });
        }
      } catch (e) {
        if (e instanceof AtlasError) {
          ipRelease(ip, gate.stamp);
          send({ type: "error", message: e.message, code: e.code, candidates: e.candidates });
        } else send({ type: "error", message: (e as Error).message });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed by the client */
          }
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
