import { COUNTRY_PATHS, CENTROIDS, WORLD_W, WORLD_H } from "@/lib/world";
import { countryName } from "@core/labels";
import type { Atlas, BucketRow } from "@holderatlas/core";

/**
 * THE picture: one SVG (1600×900) — the honesty number as large as the map, the world map with one bubble per attributed
 * country, and the ranked bar with the grey (global exchanges, no trace, unnamed) drawn as loudly as the green.
 * Literal colours, not CSS variables: the same markup is exported to PNG on a canvas and rendered by /api/og, where no
 * stylesheet exists. Tokens = the family system (dark surface); the form is dataviz "emphasis": one hue + de-emphasis grey.
 */
export const C = {
  surface: "#131a22",
  surface2: "#182130",
  border: "#22303d",
  border2: "#2c3b4b",
  text: "#e6edf3",
  text2: "#b6c2cf",
  muted: "#8b9bab",
  real: "#22c55e",
  realInk: "#04150a",
  grey: "#8b9bab",
  greyDim: "#3d4a58",
  warn: "#f59e0b",
  red: "#ef4444",
  accent: "#38bdf8",
};
export const POSTER_W = 1600;
export const POSTER_H = 900;
const SANS = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export type PosterData = Pick<
  Atlas,
  | "token"
  | "chain"
  | "naming"
  | "countries"
  | "global"
  | "otherEntity"
  | "untraced"
  | "unnamed"
  | "errors"
  | "attributable"
  | "attributableByWallets"
  | "custodyShare"
  | "structuralShare"
  | "examined"
  | "holdersFetched"
  | "coverage"
> & {
  asOf?: string;
  credits?: number;
  calls?: number;
  hash?: string;
  /** while streaming: wallets done / total */
  progress?: { done: number; total: number };
};

export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
export const bubbleR = (share: number) => Math.min(96, 10 + 72 * Math.sqrt(Math.max(0, share)));

export type BarRow = {
  key: string;
  label: string;
  sub: string;
  share: number;
  wallets: number;
  kind: "country" | "global" | "other" | "untraced" | "unnamed" | "error";
};

/** The ranked rows of the bar: countries (top 8, rest folded), then every grey bucket that has wallets. */
export function barRows(d: PosterData): BarRow[] {
  const rows: BarRow[] = [];
  const cs = d.countries.slice(0, 8);
  for (const c of cs)
    rows.push({ key: c.code, label: c.code, sub: `${countryName(c.code)} · ${c.exchanges.join(", ")}`, share: c.share, wallets: c.wallets, kind: "country" });
  const rest = d.countries.slice(8);
  if (rest.length)
    rows.push({
      key: "other-countries",
      label: `+${rest.length}`,
      sub: rest.map((c) => c.code).join(" "),
      share: rest.reduce((n, c) => n + c.share, 0),
      wallets: rest.reduce((n, c) => n + c.wallets, 0),
      kind: "country",
    });
  const b = (key: string, label: string, sub: string, r: BucketRow, kind: BarRow["kind"]) => {
    if (r.wallets) rows.push({ key, label, sub, share: r.share, wallets: r.wallets, kind });
  };
  b("global", "GLOBAL", `global exchanges, no location by design · ${d.global.exchanges.join(", ")}`, d.global, "global");
  b("other", "ENTITY", `named entities not in the exchange table · ${d.otherEntity.exchanges.join(", ")}`, d.otherEntity, "other");
  b("unnamed", "UNNAMED", `exchanges Nansen cannot name on ${d.chain}`, d.unnamed, "unnamed");
  b("untraced", "NO TRACE", "no exchange transfer of this token in a year", d.untraced, "untraced");
  b("error", "FAILED", "lookup timed out or failed — never guessed", d.errors, "error");
  return rows;
}

function fmtAsOf(iso?: string) {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "";
}

/**
 * Bubble label placement: big bubbles carry their label inside; small ones get a label to the right, and a label that
 * would overlap an already-placed one is pushed down in 26 px steps (greedy, in supply order) so the map stays readable.
 */
export function layoutLabels(countries: PosterData["countries"]) {
  const placed: Array<{ x: number; y: number; w: number }> = [];
  const bubbles = countries.map((c) => ({ at: CENTROIDS[c.code], r: bubbleR(c.share) })).filter((b) => b.at) as Array<{ at: [number, number]; r: number }>;
  const out: Array<{ c: PosterData["countries"][number]; at: [number, number]; r: number; inside: boolean; lx: number; ly: number }> = [];
  for (const c of countries) {
    const at = CENTROIDS[c.code];
    if (!at) continue;
    const r = bubbleR(c.share);
    const inside = r >= 34;
    let lx = at[0] + r + 14,
      ly = at[1] + 6;
    if (!inside) {
      const w = 18 * 0.62 * `${c.code} ${pct(c.share, c.share >= 0.1 ? 0 : 1)}`.length;
      const clash = () =>
        placed.some((p) => Math.abs(p.y - ly) < 22 && lx < p.x + p.w + 8 && lx + w > p.x - 8) ||
        bubbles.some((b) => b.at !== at && Math.abs(b.at[1] - (ly - 6)) < b.r + 10 && lx < b.at[0] + b.r + 6 && lx + w > b.at[0] - b.r - 6);
      let tries = 0;
      while (clash() && tries++ < 8) ly += 26;
      if (lx + w > WORLD_W - 4) lx = Math.max(4, at[0] - r - 14 - w);
      placed.push({ x: lx, y: ly, w });
    }
    out.push({ c, at, r, inside, lx, ly });
  }
  return out;
}

export function Poster({ d, id = "poster", interactive = false }: { d: PosterData; id?: string; interactive?: boolean }) {
  const rows = barRows(d);
  const number = pct(d.attributable, 1);
  const [intPart, fracPart] = number.replace("%", "").split(".");
  const analysed = d.examined.custody + d.examined.human;
  const caption = [
    `${analysed} of ${d.holdersFetched} top holders analysed (${pct(d.coverage, 0)} of their supply)`,
    `exchange custody ${pct(d.custodyShare, 0)}`,
    `pools/contracts excluded ${pct(d.structuralShare, 0)}`,
  ]
    .filter(Boolean)
    .join("  ·  ");
  const footer = [
    d.asOf ? `as of ${fmtAsOf(d.asOf)}` : null,
    d.calls != null ? `${d.calls} Nansen calls` : null,
    d.credits != null ? `${d.credits} credits` : null,
    d.hash ? `atlas ${d.hash}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  const barX = 1200,
    barW = 250,
    rowH = 46,
    barTop = 176;
  const barScale = Math.max(0.25, ...rows.map((r) => r.share));
  const streaming = d.progress && d.progress.done < d.progress.total;
  return (
    <svg id={id} viewBox={`0 0 ${POSTER_W} ${POSTER_H}`} width="100%" role="img" aria-labelledby={`${id}-title`} fontFamily={SANS} style={{ display: "block" }}>
      <title id={`${id}-title`}>{`${d.token.symbol} on ${d.chain}: ${number} of analysed supply placed on a country — ${
        rows
          .filter((r) => r.kind === "country")
          .map((r) => `${r.label} ${pct(r.share, 0)}`)
          .join(", ") || "none"
      }`}</title>
      <defs>
        <pattern id={`${id}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill={C.greyDim} />
          <line x1="0" y1="0" x2="0" y2="8" stroke={C.grey} strokeWidth="2" />
        </pattern>
        {/* userSpaceOnUse = the referencing group's own (translated) space, so the clip rect sits at 0,0 */}
        <clipPath id={`${id}-map`}>
          <rect x="0" y="0" width={WORLD_W} height={WORLD_H} rx="14" />
        </clipPath>
      </defs>
      <rect width={POSTER_W} height={POSTER_H} fill={C.surface} />

      {/* header */}
      <text x="60" y="78" fontSize="44" fontWeight="800" fill={C.text} letterSpacing="-1">
        {d.token.symbol}
        <tspan fontSize="26" fontWeight="500" fill={C.muted} dx="18">
          {d.token.name} · {d.chain}
        </tspan>
      </text>
      <text x="60" y="116" fontSize="19" fill={C.muted} fontFamily={MONO}>
        {caption}
      </text>
      <text x={POSTER_W - 60} y="78" fontSize="15" fill={C.muted} fontFamily={MONO} textAnchor="end">
        {footer || "holderatlas · Nansen API"}
      </text>
      <text x={POSTER_W - 60} y="102" fontSize="15" fill={C.muted} textAnchor="end">
        holderatlas · built on the Nansen API
      </text>

      {/* the honesty number — as large as the map */}
      <text x="52" y="352" fontSize="250" fontWeight="800" fill={C.text} letterSpacing="-12" style={{ fontVariantNumeric: "normal" }}>
        {intPart}
        <tspan fontSize="120" fontWeight="800" fill={C.text2} letterSpacing="-4">
          .{fracPart}
        </tspan>
        <tspan fontSize="120" fontWeight="800" fill={C.real} dx="8" letterSpacing="-2">
          %
        </tspan>
      </text>
      <text x="60" y="392" fontSize="24" fill={C.text2}>
        of analysed supply placed on a country
        <tspan fill={C.muted}>
          {"  ·  "}
          {pct(d.attributableByWallets, 0)} of wallets
        </tspan>
        {streaming ? (
          <tspan fill={C.accent}>
            {"  ·  "}
            {d.progress!.done}/{d.progress!.total} wallets so far
          </tspan>
        ) : null}
      </text>

      {/* the map */}
      <g transform="translate(40 400)" clipPath={`url(#${id}-map)`}>
        <rect width={WORLD_W} height={WORLD_H} fill={C.surface} />
        <g fill={C.surface2} stroke={C.border} strokeWidth="0.75" strokeLinejoin="round">
          {COUNTRY_PATHS.map((p) => (
            <path key={p.code} d={p.d}>
              {interactive ? <title>{p.name}</title> : null}
            </path>
          ))}
        </g>
        {layoutLabels(d.countries).map(({ c, at, r, inside, lx, ly }) => {
          return (
            <g key={c.code} className="bubble" data-code={c.code}>
              <circle cx={at[0]} cy={at[1]} r={r} fill={C.real} fillOpacity="0.88" stroke={C.surface} strokeWidth="2" />
              {inside ? (
                <>
                  <text x={at[0]} y={at[1] - 4} textAnchor="middle" fontSize={r >= 60 ? 30 : 22} fontWeight="800" fill={C.realInk}>
                    {c.code}
                  </text>
                  <text x={at[0]} y={at[1] + (r >= 60 ? 26 : 18)} textAnchor="middle" fontSize={r >= 60 ? 24 : 16} fontWeight="600" fill={C.realInk}>
                    {pct(c.share, c.share >= 0.1 ? 0 : 1)}
                  </text>
                </>
              ) : (
                <>
                  <line
                    x1={at[0] + r * 0.7}
                    y1={at[1] + r * 0.7 * Math.sign(ly - at[1] || 1) * (Math.abs(ly - at[1]) > r ? 1 : 0)}
                    x2={lx - 4}
                    y2={ly - 6}
                    stroke={C.text2}
                    strokeWidth="1.5"
                  />
                  <text x={lx} y={ly} fontSize="18" fontWeight="700" fill={C.text} stroke={C.surface} strokeWidth="4" paintOrder="stroke">
                    {c.code} {pct(c.share, c.share >= 0.1 ? 0 : 1)}
                  </text>
                </>
              )}
              {interactive ? (
                <title>{`${countryName(c.code)}: ${pct(c.share)} of analysed supply · ${c.wallets} wallet${c.wallets === 1 ? "" : "s"} · ${c.exchanges.join(", ")}`}</title>
              ) : null}
            </g>
          );
        })}
        {!d.naming ? (
          <text x={WORLD_W / 2} y={WORLD_H / 2} textAnchor="middle" fontSize="26" fontWeight="700" fill={C.warn}>
            {d.chain}: exchanges are visible but cannot be named on this API path — nothing can be placed
          </text>
        ) : d.countries.length === 0 && !streaming ? (
          <text x={WORLD_W / 2} y={WORLD_H / 2} textAnchor="middle" fontSize="26" fontWeight="700" fill={C.muted}>
            no holder reaches a regional exchange — nothing to place
          </text>
        ) : null}
      </g>

      {/* the ranked bar */}
      <text x={barX - 140} y="150" fontSize="22" fontWeight="700" fill={C.text}>
        Where the analysed supply is
      </text>
      {rows.map((r, i) => {
        const y = barTop + i * rowH;
        const w = Math.max(4, (r.share / barScale) * barW);
        const fill =
          r.kind === "country"
            ? C.real
            : r.kind === "unnamed"
              ? `url(#${id}-hatch)`
              : r.kind === "untraced"
                ? C.greyDim
                : r.kind === "error"
                  ? "transparent"
                  : C.grey;
        return (
          <g key={r.key} className={`bar-row ${r.kind}`} data-key={r.key}>
            <text x={barX - 140} y={y + 16} fontSize="18" fontWeight="800" fill={r.kind === "country" ? C.text : C.text2}>
              {r.label}
            </text>
            <text x={barX - 140} y={y + 36} fontSize="13" fill={C.muted}>
              {r.sub.length > 46 ? r.sub.slice(0, 45) + "…" : r.sub}
            </text>
            {/* ≤ 22 px thick, rounded data-end, square at the baseline; 2 px surface gap = the row spacing */}
            <path
              d={`M${barX} ${y + 2}h${Math.max(0, w - 4)}a4 4 0 0 1 4 4v14a4 4 0 0 1 -4 4h${-Math.max(0, w - 4)}z`}
              fill={fill}
              stroke={r.kind === "error" ? C.red : r.kind === "untraced" ? C.border2 : "none"}
              strokeWidth="1.5"
            />
            <text x={barX + w + 10} y={y + 18} fontSize="18" fontWeight="700" fill={C.text} style={{ fontVariantNumeric: "tabular-nums" }}>
              {pct(r.share, 1)}
              <tspan fill={C.muted} fontWeight="500" fontSize="14">
                {"  "}
                {r.wallets} w
              </tspan>
            </text>
            {interactive ? <title>{`${r.label}: ${pct(r.share)} · ${r.wallets} wallets · ${r.sub}`}</title> : null}
          </g>
        );
      })}
      {rows.length === 0 ? (
        <text x={barX - 140} y={barTop + 20} fontSize="16" fill={C.muted}>
          {streaming ? "waiting for the first wallet…" : "nothing analysed"}
        </text>
      ) : null}
      <text x={barX - 140} y={barTop + rows.length * rowH + 22} fontSize="14" fill={C.muted}>
        green = placed on a country · grey = global exchange or no trace
      </text>
    </svg>
  );
}

/** Atlas → the poster's data (plus overrides while streaming). Lives here, not in the client component, so /api/og can call it. */
export function toPoster(a: Atlas, extra: Partial<PosterData> = {}): PosterData {
  return {
    token: a.token,
    chain: a.chain,
    naming: a.naming,
    countries: a.countries,
    global: a.global,
    otherEntity: a.otherEntity,
    untraced: a.untraced,
    unnamed: a.unnamed,
    errors: a.errors,
    attributable: a.attributable,
    attributableByWallets: a.attributableByWallets,
    custodyShare: a.custodyShare,
    structuralShare: a.structuralShare,
    examined: a.examined,
    holdersFetched: a.holdersFetched,
    coverage: a.coverage,
    asOf: a.asOf,
    credits: a.credits,
    calls: a.calls.length,
    hash: a.hash,
    ...extra,
  };
}
