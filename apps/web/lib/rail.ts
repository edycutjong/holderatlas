/**
 * The Nansen call rail's state: one row per call the page has seen this session, oldest first, built from the engine's
 * `call` events (start → pending row, end → the recorded Call). Pure — no React — so the tests drive it with the events a
 * replayed fixture emits and check the rail's totals against the drawer's (the same Call objects; nothing synthetic).
 */
import type { Call, CallEvent } from "@holderatlas/core";

export type RailStatus = "pending" | "live" | "cached" | "error";

export type RailRow = {
  /** `<run>:<client call id>` — unique across the session, pairs a start with its end */
  key: string;
  endpoint: string;
  body: Record<string, unknown>;
  status: RailStatus;
  credits: number;
  ms: number;
  /** first 4 hex of the response sha256 ("" while pending or failed) */
  hash: string;
  /** a recorded run replayed offline (the example on load, a degraded replay) — shown as "replayed · 0 cr" */
  replayed: boolean;
  error?: string;
  /** monotonic arrival order (a pending row keeps its place when it completes) */
  seq: number;
};

/** Oldest rows are dropped past this many (spec A3). */
export const RAIL_CAP = 200;

export function statusOf(call: Call): RailStatus {
  if (!call.ok) return "error";
  return call.cached ? "cached" : "live";
}

export function rowFromCall(call: Call, key: string, seq: number, replayed: boolean): RailRow {
  return {
    key,
    endpoint: call.endpoint,
    body: call.body,
    status: statusOf(call),
    credits: call.credits,
    ms: call.cached ? 0 : call.ok ? call.ms : call.totalMs,
    hash: call.responseHash.slice(0, 4),
    replayed,
    error: call.error,
    seq,
  };
}

/** The rail on page load: the recorded example's calls, in order, all labelled replayed. */
export function rowsFromCalls(calls: Call[], run: string, replayed = true): RailRow[] {
  return cap(calls.map((c, i) => rowFromCall(c, `${run}:${i + 1}`, i + 1, replayed)));
}

/**
 * Apply one call event from run `run`. A start appends a pending row; an end completes its pending row in place or, when
 * there was no start (a cache hit, a replayed timeout), appends the finished row. Never reorders: oldest stays at the top.
 */
export function applyCall(rows: RailRow[], e: CallEvent, run: string, replayed = false): RailRow[] {
  const key = `${run}:${e.id}`;
  const seq = (rows.at(-1)?.seq ?? 0) + 1;
  if (e.phase === "start") {
    if (rows.some((r) => r.key === key)) return rows;
    return cap([...rows, { key, endpoint: e.endpoint, body: e.body, status: "pending", credits: 0, ms: 0, hash: "", replayed, seq }]);
  }
  const i = rows.findIndex((r) => r.key === key);
  if (i >= 0) {
    const next = rows.slice();
    next[i] = rowFromCall(e.call, key, rows[i].seq, replayed);
    return next;
  }
  return cap([...rows, rowFromCall(e.call, key, seq, replayed)]);
}

/**
 * A run that stops early (aborted by a new query, a stream error, a closed connection) must not leave pending rows pulsing
 * for the rest of the session: its still-pending rows become error rows with `reason`, at 0 credits — nothing is guessed.
 */
export function settlePending(rows: RailRow[], run: string, reason = "aborted"): RailRow[] {
  const prefix = `${run}:`;
  if (!rows.some((r) => r.status === "pending" && r.key.startsWith(prefix))) return rows;
  return rows.map((r) => (r.status === "pending" && r.key.startsWith(prefix) ? { ...r, status: "error" as const, error: reason, credits: 0, ms: 0 } : r));
}

/** Mark every row of `run` as replayed — used when the stream's closing `asOf` says the run was a fixture replay. */
export function markReplayed(rows: RailRow[], run: string): RailRow[] {
  return rows.map((r) => (r.key.startsWith(`${run}:`) && !r.replayed ? { ...r, replayed: true } : r));
}

export function cap(rows: RailRow[]): RailRow[] {
  return rows.length > RAIL_CAP ? rows.slice(rows.length - RAIL_CAP) : rows;
}

/** Finished calls and credits — the numbers the header ticks and the footer accumulates. */
export function totals(rows: RailRow[]): { calls: number; credits: number; pending: number } {
  let calls = 0;
  let credits = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.status === "pending") pending++;
    else {
      calls++;
      credits += r.credits;
    }
  }
  return { calls, credits, pending };
}

/**
 * One line of the request that is safe to show: chain, the filter that names the wallet, the hash, the query — never
 * the key, never a whole body. Shared with the provenance drawer so the rail and the receipt read the same.
 */
export function summarise(body: Record<string, unknown>): string {
  const f = body.filters as Record<string, unknown> | undefined;
  const w = (f?.to_address ?? f?.from_address) as string | undefined;
  const parts = [
    body.chain,
    body.label_type ? `label_type=${body.label_type}` : null,
    w ? `${f?.to_address ? "to" : "from"}=${w.slice(0, 8)}…` : null,
    body.transaction_hash ? `tx=${String(body.transaction_hash).slice(0, 10)}…` : null,
    body.address ? `addr=${String(body.address).slice(0, 8)}…` : null,
    body.search_query ? `q=${body.search_query}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
