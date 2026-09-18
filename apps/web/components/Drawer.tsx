"use client";
import type { Call } from "@holderatlas/core";

export function Drawer({
  calls,
  open,
  onClose,
  credits,
  ms,
  asOf,
  hash,
}: {
  calls: Call[];
  open: boolean;
  onClose: () => void;
  credits: number;
  ms: number;
  asOf?: string | null;
  hash?: string;
}) {
  const cached = calls.filter((c) => c.cached).length;
  const byEp = new Map<string, { n: number; cr: number; cached: number; ms: number; live: number }>();
  for (const c of calls) {
    const e = byEp.get(c.endpoint) ?? { n: 0, cr: 0, cached: 0, ms: 0, live: 0 };
    e.n++;
    e.cr += c.credits;
    if (c.cached) e.cached++;
    else {
      e.ms += c.ms;
      e.live++;
    }
    byEp.set(c.endpoint, e);
  }
  return (
    <aside className={`drawer ${open ? "open" : ""}`} aria-hidden={!open}>
      <h3>
        Every Nansen call behind this map{" "}
        <button className="btn" onClick={onClose} tabIndex={open ? 0 : -1}>
          close
        </button>
      </h3>
      <table>
        <thead>
          <tr>
            <th>endpoint</th>
            <th>calls</th>
            <th>credits</th>
            <th>cached</th>
            <th>avg ms live</th>
          </tr>
        </thead>
        <tbody>
          {[...byEp].map(([ep, e]) => (
            <tr key={ep}>
              <td className="mono">{ep}</td>
              <td>{e.n}</td>
              <td>{e.cr}</td>
              <td>{e.cached}</td>
              <td>{e.live ? Math.round(e.ms / e.live) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sum">
        {credits} credits · {calls.length} calls ({cached} cached{asOf ? `, as of ${asOf.slice(0, 16).replace("T", " ")} UTC` : ""}) · {(ms / 1000).toFixed(1)}{" "}
        s{hash ? ` · atlas ${hash}` : ""}
      </p>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>endpoint</th>
            <th>body</th>
            <th>cr</th>
            <th>ms</th>
            <th>fields used</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => (
            <tr key={i} className={c.ok ? "" : "fail"}>
              <td>{i + 1}</td>
              <td className="mono">
                {c.endpoint}
                {c.attempts > 1 ? ` (×${c.attempts})` : ""}
              </td>
              <td className="mono">{summarise(c.body)}</td>
              <td>{c.credits}</td>
              <td>{c.cached ? "cached" : c.ok ? c.ms : `${c.totalMs} · ${c.error}`}</td>
              <td className="mono">{c.fieldsUsed.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

function summarise(body: Record<string, unknown>): string {
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
  return parts.filter(Boolean).join(" ");
}
