"use client";
import { useEffect, useId, useRef, useState } from "react";
import { summarise, totals, type RailRow } from "@/lib/rail";
import { REPO } from "./Shell";

/**
 * The Nansen call rail — the live meter beside the page (the drawer is the receipt). Every row is a real call from the
 * engine's own provenance stream: pending (pulsing ring) → live (green) · cached (hollow grey) · error (red), with the
 * endpoint, a one-line param summary, the credits, the latency and the response hash. ≥ 1280 px it is a fixed right
 * panel; below that a docked bar that opens a sheet. Counters tick as rows land; the list follows the newest row.
 */
export function Rail({
  rows,
  runNames,
  run,
  session,
  onClear,
}: {
  rows: RailRow[];
  /** run id → what was typed, for the divider between runs (the rail accumulates across the session) */
  runNames: Record<string, string>;
  /** the current run's header numbers: label + calls/credits so far, plus the clock (ticking while `startedAt` is set, frozen at `ms` after) */
  run: { label: "replayed" | "streaming" | "live" | "cached" | "error" | "none"; calls: number; credits: number; startedAt: number | null; ms: number | null };
  session: { calls: number; credits: number };
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const sheetId = useId();
  const calls = useCountUp(run.calls);
  const credits = useCountUp(run.credits);
  const seconds = useClock(run.startedAt, run.ms);
  const t = totals(rows);

  // follow the newest row unless the reader scrolled up to look at older ones
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [rows, open]);
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const runLabel =
    run.label === "replayed"
      ? "example · replayed"
      : run.label === "streaming"
        ? "running"
        : run.label === "live"
          ? "live"
          : run.label === "cached"
            ? "warm cache"
            : run.label === "error"
              ? "stopped"
              : "";

  return (
    <aside className={`rail ${open ? "open" : ""}`} aria-label="Nansen API calls" aria-live="polite">
      <button type="button" className="rail-bar" aria-expanded={open} aria-controls={sheetId} onClick={() => setOpen((o) => !o)}>
        <span className="kicker">Nansen API</span>
        <span className="rail-bar-text">
          Nansen calls · <b>{t.calls}</b> · <b>{t.credits}</b> cr{t.pending ? ` · ${t.pending} pending` : ""}
        </span>
        <span className="rail-chevron" aria-hidden>
          {open ? "▾" : "▴"}
        </span>
      </button>
      <div className="rail-sheet" id={sheetId}>
        <header className="rail-head">
          <div className="rail-title">
            <span className="kicker">Nansen API</span>
            <h2>Live call log</h2>
            {runLabel ? <span className={`rail-runlabel ${run.label}`}>{runLabel}</span> : null}
          </div>
          <div className="rail-counters" aria-label="this run">
            <b>{calls}</b> calls · <b>{credits}</b> cr · <b>{seconds}</b> s
          </div>
        </header>
        {rows.length === 0 ? (
          <p className="rail-empty">
            No calls yet — run the example live. <span aria-hidden>↓</span>
            <small>Every Nansen request the page makes will appear here as it happens: endpoint · credits · latency.</small>
          </p>
        ) : (
          <ol className="rail-rows" ref={listRef} onScroll={onScroll}>
            {rows.map((r, i) => {
              const runId = r.key.slice(0, r.key.indexOf(":"));
              const prev = i ? rows[i - 1].key.slice(0, rows[i - 1].key.indexOf(":")) : null;
              return [
                runId !== prev ? (
                  <li key={`sep-${runId}`} className="rail-sep" aria-hidden>
                    {runNames[runId] ?? "run"}
                  </li>
                ) : null,
                <Row key={r.key} r={r} />,
              ];
            })}
          </ol>
        )}
        <footer className="rail-foot">
          <span>
            session · <b>{session.calls}</b> calls · <b>{session.credits}</b> credits
          </span>
          <span className="rail-foot-links">
            <a className="link-quiet" href={`${REPO}#run-it-in-under-10-minutes`} target="_blank" rel="noreferrer">
              same calls: <code>--explain</code> in the CLI
            </a>
            <button type="button" className="rail-clear" onClick={onClear} disabled={rows.length === 0}>
              clear
            </button>
          </span>
        </footer>
      </div>
    </aside>
  );
}

function Row({ r }: { r: RailRow }) {
  const cr =
    r.status === "pending" ? "…" : r.replayed ? "0 cr · replayed" : r.status === "cached" ? "0 cr · cached" : r.status === "error" ? "0 cr" : `${r.credits} cr`;
  const ms = r.status === "pending" ? "pending" : r.status === "error" ? (r.error ?? "failed").slice(0, 28) : `${r.ms} ms`;
  const params = summarise(r.body);
  return (
    <li className={`rail-row ${r.status}`}>
      <i className="rail-dot" aria-hidden />
      <div className="rail-main">
        <div className="rail-ep">
          <span className="rail-method">POST</span> <span className="rail-path">{r.endpoint}</span>
        </div>
        <div className="rail-params" title={params}>
          {params || "—"}
        </div>
      </div>
      <div className="rail-right">
        <span className={`rail-cr ${r.status}`}>{cr}</span>
        {r.status === "cached" ? null : (
          <span className="rail-ms" title={r.status === "error" ? r.error : undefined}>
            {ms}
          </span>
        )}
        {r.hash ? (
          <span className="rail-hash" title={`sha256 of the response body: ${r.hash}…`}>
            {r.hash}…
          </span>
        ) : null}
      </div>
    </li>
  );
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Counts from the previous value to `target` over 240 ms (the family ease); instant under prefers-reduced-motion. */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    if (reduced() || Math.abs(target - start) > 500) {
      from.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 240);
      const e = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + (target - start) * e);
      from.current = v; // a new target mid-flight continues from what is on screen, no jump back
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

/** Elapsed seconds: ticks every 100 ms while a run is in flight, then shows the engine's own `ms` so it equals the drawer. */
function useClock(startedAt: number | null, ms: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [startedAt]);
  if (startedAt !== null) return (Math.max(0, Math.max(now, startedAt) - startedAt) / 1000).toFixed(1);
  return ((ms ?? 0) / 1000).toFixed(1);
}
