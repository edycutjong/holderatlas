"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Poster, pct, barRows } from "./Poster";
import { Drawer } from "./Drawer";
import { Rail } from "./Rail";
import { applyCall, markReplayed, rowsFromCalls, settlePending, totals, type RailRow } from "@/lib/rail";
import { Example, HowItDecides } from "./Example";
import { svgToPngBlob, download } from "@/lib/png";
import { CHAINS } from "@core/nansen";
import { countryName } from "@core/labels";
import { applyEvent, splitLines, type Live, type StreamEvent } from "@/lib/stream";
import type { Atlas as AtlasT, Candidate, WalletRow } from "@holderatlas/core";

const EXAMPLES: Array<{ q: string; chain: string }> = [
  { q: "PEPE", chain: "ethereum" },
  { q: "WLFI", chain: "ethereum" },
  { q: "DEGEN", chain: "base" },
  { q: "MOG", chain: "ethereum" },
  { q: "ARB", chain: "arbitrum" },
  { q: "MEW", chain: "solana" },
];

type Phase = "idle" | "streaming" | "done" | "error";
type RunMeta = { id: string; label: "replayed" | "streaming" | "live" | "cached" | "error" | "none"; startedAt: number | null; ms: number | null };
const EXAMPLE_RUN = "example";

export function AtlasApp({ initialQuery, initialChain, example }: { initialQuery?: string; initialChain?: string; example: AtlasT; exampleFile: string }) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [chain, setChain] = useState(initialChain && (CHAINS as readonly string[]).includes(initialChain) ? initialChain : "auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<{ message: string; candidates?: Candidate[] } | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const posterRef = useRef<HTMLDivElement>(null);
  // the call rail: the example's replayed calls on load, then every call of every run this session (oldest at top)
  const [rail, setRail] = useState<RailRow[]>(() => rowsFromCalls(example.calls, EXAMPLE_RUN));
  const [session, setSession] = useState({ calls: example.calls.length, credits: example.credits });
  const [runMeta, setRunMeta] = useState<RunMeta>({ id: EXAMPLE_RUN, label: "replayed", startedAt: null, ms: example.ms });
  const [runNames, setRunNames] = useState<Record<string, string>>({ [EXAMPLE_RUN]: `${example.token.symbol} · ${example.chain} · example` });
  const runSeq = useRef(0);
  const runTotals = useMemo(() => totals(rail.filter((r) => r.key.startsWith(`${runMeta.id}:`))), [rail, runMeta.id]);
  const clearRail = () => {
    setRail([]);
    setSession({ calls: 0, credits: 0 });
    if (phase !== "streaming") setRunMeta((m) => ({ ...m, label: "none", ms: 0 }));
  };

  const run = useCallback(async (term: string, ch: string) => {
    const t = term.trim();
    if (!t) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase("streaming");
    setError(null);
    setDrawer(false);
    setStatus("resolving the token…");
    setLive(null);
    const runId = String(++runSeq.current);
    const startedAt = Date.now();
    setRunMeta({ id: runId, label: "streaming", startedAt, ms: null });
    setRunNames((n) => ({ ...n, [runId]: ch !== "auto" ? `${t} · ${ch}` : t }));
    const url = new URL(window.location.href);
    url.searchParams.set("q", t);
    if (ch !== "auto") url.searchParams.set("chain", ch);
    else url.searchParams.delete("chain");
    window.history.replaceState(null, "", url.toString());
    let cur: Live | null = null;
    try {
      // the marker that lets the route run live: a bare GET (a crawler, an unfurler, curl) never spends a credit
      const res = await fetch(`/api/atlas?q=${encodeURIComponent(t)}${ch !== "auto" ? `&chain=${ch}` : ""}&stream=1`, {
        signal: ctrl.signal,
        headers: { "x-atlas-run": "1" },
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      // a run that was superseded (a new query aborted this fetch) must not touch state again — its last chunk may already
      // have resolved before abort() and would otherwise flip the header / phase back to the old run (code review, 2026-09-19)
      const settle = (reason: string) => setRail((rows) => settlePending(rows, runId, reason));
      for (;;) {
        const { value, done } = await reader.read();
        if (ctrl.signal.aborted) return;
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { lines, rest } = splitLines(buf);
        buf = rest;
        for (const line of lines) {
          if (ctrl.signal.aborted) return;
          const e = JSON.parse(line) as StreamEvent;
          if (e.type === "call") {
            // the rail: a pending row on start, the recorded Call on end — the same object the drawer will print
            setRail((rows) => applyCall(rows, e, runId));
            if (e.phase === "end") setSession((s) => ({ calls: s.calls + 1, credits: s.credits + e.call.credits }));
            continue;
          }
          if (e.type === "error") {
            settle("stream error");
            setError({ message: e.message, candidates: e.candidates });
            setPhase("error");
            setStatus("");
            setRunMeta({ id: runId, label: "error", startedAt: null, ms: Date.now() - startedAt });
            return;
          }
          if (e.type === "asOf" && e.degraded) setRail((rows) => markReplayed(rows, runId));
          cur = applyEvent(cur, e);
          setLive(cur);
          if (e.type === "token") setStatus(`${e.token.symbol} on ${e.token.chain} — fetching the top holders…`);
          else if (e.type === "holders")
            setStatus(
              `${e.fetched} holders: ${e.custody} exchange custody · ${e.human} people · ${e.structural} pools/contracts — naming ${e.examined.custody + e.examined.human} of them…`,
            );
          else if (e.type === "wallet") setStatus(`${e.done}/${e.total} wallets · ${pct(e.partial.attributable)} placed so far`);
        }
      }
      if (!cur || !(cur as Live).hash) {
        settle("stream ended");
        setError({ message: "the stream ended before the map was finished — try again" });
        setPhase("error");
        setStatus("");
        setRunMeta({ id: runId, label: "error", startedAt: null, ms: Date.now() - startedAt });
        return;
      }
      setPhase("done");
      const c = cur as Live;
      // the header clock freezes at the engine's own ms, so the rail and the drawer print the same seconds
      setRunMeta({ id: runId, label: c.degraded ? "replayed" : c.credits === 0 ? "cached" : "live", startedAt: null, ms: c.ms });
      setStatus(
        `${c.credits} credits · ${c.calls.length} calls${c.asOf ? ` · as of ${c.asOf.slice(11, 16)} UTC` : ""} · ${(c.ms / 1000).toFixed(1)} s · atlas ${c.hash}`,
      );
    } catch (err) {
      // superseded by a new query or a network failure: whatever this run still had in flight is settled, never left pulsing
      setRail((rows) => settlePending(rows, runId, (err as Error).name === "AbortError" ? "aborted" : "failed"));
      if ((err as Error).name === "AbortError") return;
      setError({ message: (err as Error).message });
      setPhase("error");
      setStatus("");
      setRunMeta({ id: runId, label: "error", startedAt: null, ms: Date.now() - startedAt });
    }
  }, []);

  // an initial query (permalink or ?q=) starts the stream after mount; run() only sets state from inside the response loop
  useEffect(() => {
    if (!initialQuery) return;
    const t = setTimeout(() => void run(initialQuery, initialChain && (CHAINS as readonly string[]).includes(initialChain) ? initialChain : "auto"), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePng = async () => {
    const svg = posterRef.current?.querySelector("svg");
    if (!svg) return;
    try {
      const blob = await svgToPngBlob(svg, 1600, 900, 1);
      const name = `holderatlas-${(live?.data.token.symbol ?? "atlas").toLowerCase()}-${live?.data.chain ?? ""}.png`;
      download(blob, name);
      flash("PNG saved");
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const share = async () => {
    if (!live) return;
    const url = `${window.location.origin}/t/${live.data.chain}/${live.data.token.address}`;
    try {
      await navigator.clipboard.writeText(url);
      flash("link copied");
    } catch {
      flash(url);
    }
  };
  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2200);
  };

  const idle = phase === "idle";
  const progress = live?.data.progress;
  const pctDone = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : phase === "streaming" ? 5 : 100;

  return (
    <>
      <main className="wrap">
        <header className="hero">
          <h1>
            Where are the <span className="real">holders</span>?
          </h1>
          <p>Type a token. One map of the countries its holders reach exchanges from — and how much of the supply that honestly covers.</p>
        </header>
        <div className="panel">
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              void run(q, chain);
            }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="a ticker like PEPE — or an address with its chain"
              aria-label="token ticker or address"
              maxLength={44}
              autoFocus
              spellCheck={false}
            />
            <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label="chain">
              <option value="auto">any chain</option>
              {CHAINS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="submit" disabled={phase === "streaming"}>
              {phase === "streaming" ? "Mapping…" : "Map"}
            </button>
          </form>
          <div className="chips" role="group" aria-label="examples">
            {EXAMPLES.map((x) => (
              <button
                key={`${x.q}-${x.chain}`}
                type="button"
                className={`chip ${live?.data.token.symbol === x.q && live?.data.chain === x.chain ? "on" : ""}`}
                onClick={() => {
                  setQ(x.q);
                  setChain(x.chain);
                  void run(x.q, x.chain);
                }}
              >
                {x.q}
                <span style={{ opacity: 0.6 }}> · {x.chain}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={`progress ${idle ? "hidden" : ""}`} aria-hidden>
          <i style={{ width: `${phase === "done" ? 100 : pctDone}%`, background: phase === "error" ? "var(--impostor)" : undefined }} />
        </div>
        <p className={`status ${idle ? "hidden" : ""}`} aria-live="polite">
          {status}
        </p>

        {error ? (
          <div className="banner err" role="alert">
            {error.message}
            {error.candidates?.length ? <small>Nansen found: {error.candidates.map((c) => `${c.symbol} on ${c.chain}`).join(" · ")}</small> : null}
          </div>
        ) : null}
        {live?.degraded ? (
          <div className="banner warn">
            Today&rsquo;s live budget is used up — this is a replay of a recorded run.{" "}
            <small>Same engine, same responses, same hash; recorded {live.asOf?.slice(0, 10)}.</small>
          </div>
        ) : null}
        {live && phase === "done" && !live.data.naming ? (
          <div className="banner warn">
            {live.data.chain}: exchanges are visible but cannot be named on this API path — the custody share is shown, nothing is placed.
            <small>
              Nansen&rsquo;s transaction-with-token-transfer-lookup, the only ≤ 5-credit field carrying an exchange entity, has no {live.data.chain} support.
            </small>
          </div>
        ) : null}
        {live && phase === "done" && live.data.naming && live.data.countries.length === 0 ? (
          <div className="banner warn">
            No examined holder reaches a regional exchange — every traced wallet touched a global one.{" "}
            <small>The map is honest at 0 %; the bar shows where the supply sits instead.</small>
          </div>
        ) : null}

        {live ? (
          <>
            <div className={`picture ${phase === "streaming" ? "streaming" : phase === "done" ? "done" : ""}`} ref={posterRef}>
              <Poster d={live.data} interactive />
            </div>
            <ul className="bars-mobile" aria-label="where the analysed supply is">
              {barRows(live.data).map((r) => (
                <li key={r.key} className={r.kind}>
                  <b>{r.label}</b>
                  <i style={{ width: `${Math.round(r.share * 100)}%` }} />
                  <span>
                    {pct(r.share)} · {r.wallets} w
                  </span>
                </li>
              ))}
            </ul>
            <div className="picture-actions">
              <button className="btn primary" onClick={savePng} disabled={phase !== "done"}>
                Save PNG
              </button>
              <button className="btn" onClick={share} disabled={phase !== "done"}>
                Copy link
              </button>
              <button className="btn" onClick={() => setDrawer(true)} disabled={!live.calls.length}>
                Every Nansen call ({live.calls.length})
              </button>
              <span className="meta">
                {live.candidates.length > 1 ? `${live.candidates.length} tokens share this name on Nansen · ` : ""}
                {live.data.token.address}
              </span>
            </div>
            {live.warnings
              .filter((w) => !w.startsWith("Today"))
              .map((w) => (
                <p key={w} className="candidates">
                  ⚠ {w}
                </p>
              ))}
            <div className="rows-head">
              <h2>{live.rows.filter((r) => r.kind !== "structural").length} wallets, one exchange each</h2>
              <span>custody first, then people by supply · most recent exchange wins</span>
            </div>
            <div className="rows" aria-live="polite">
              {[...live.rows]
                .filter((r) => r.kind !== "structural")
                .sort((a, b) => b.supply - a.supply)
                .map((r) => (
                  <Row key={r.address} r={r} />
                ))}
            </div>
          </>
        ) : null}

        {idle ? (
          <>
            <Example atlas={example} onRun={() => run(example.input, example.chain)} />
            <HowItDecides />
          </>
        ) : null}

        <Drawer
          calls={live?.calls ?? []}
          open={drawer}
          onClose={() => setDrawer(false)}
          credits={live?.credits ?? 0}
          ms={live?.ms ?? 0}
          asOf={live?.asOf}
          hash={live?.hash}
        />
        {toast ? <div className="toast">{toast}</div> : null}
      </main>
      <Rail
        rows={rail}
        runNames={runNames}
        run={{ id: runMeta.id, label: runMeta.label, calls: runTotals.calls, credits: runTotals.credits, startedAt: runMeta.startedAt, ms: runMeta.ms }}
        session={session}
        onClear={clearRail}
      />
    </>
  );
}

function Row({ r }: { r: WalletRow }) {
  const where =
    r.bucket === "country" ? (
      <span className="where country">
        {r.country} · {countryName(r.country!)}
      </span>
    ) : r.bucket === "global" ? (
      <span className="where grey">global · no location</span>
    ) : r.bucket === "unnamed" ? (
      <span className="where warn">exchange, unnamed</span>
    ) : r.bucket === "other-entity" ? (
      <span className="where warn">not in table</span>
    ) : r.bucket === "error" ? (
      <span className="where err">lookup failed</span>
    ) : (
      <span className="where grey">no exchange trace</span>
    );
  return (
    <div className="row">
      <span className="kind">{r.kind}</span>
      <span className="addr" title={r.address}>
        {r.address.slice(0, 8)}…{r.address.slice(-4)} {r.label ? <span style={{ color: "var(--muted)" }}>· {r.label.slice(0, 28)}</span> : null}
      </span>
      <span>
        {r.entityLabel ? (
          <span className="exch" title={r.entityLabel}>
            {cleanLabel(r.entityLabel)}
          </span>
        ) : null}{" "}
        {where}
      </span>
      <span className="share" title="share of the top-100 supply">
        {pct(r.topShare, 2)}
      </span>
    </div>
  );
}

function cleanLabel(l: string) {
  return l
    .replace(/\[0x[0-9a-f]+\]/gi, "")
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .trim();
}
