import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { CachedNansenClient, DiskCache, atlas, type Atlas } from "@holderatlas/core";
import { replayFixture } from "@/lib/guard";
import { SAFE_QUERY, parseChain } from "@/lib/engine";
import { COUNTRY_PATHS, CENTROIDS, WORLD_W, WORLD_H } from "@/lib/world";
import { barRows, bubbleR, pct, C, toPoster, type PosterData } from "@/components/Poster";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/og?q=PEPE&chain=ethereum → 1200×675 PNG for link previews. Never spends credits: a recorded fixture replays,
 * otherwise today's disk cache answers offline, otherwise a generic card. Crawlers get a picture in < 1 s, not a 40 s run.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const chain = parseChain(req.nextUrl.searchParams.get("chain"));
  let a: Atlas | undefined;
  if (SAFE_QUERY.test(q)) {
    try {
      a = (await replayFixture(q, chain))?.atlas;
      if (!a) {
        const dir = process.env.VERCEL ? join(tmpdir(), "holderatlas-cache") : join(process.cwd(), "../../.cache");
        const c = new CachedNansenClient("nsn_offline_og_no_network_000000", { store: new DiskCache(dir), offline: true });
        a = await atlas(c, q, { chain });
      }
    } catch {
      a = undefined;
    }
  }
  const headers = { "cache-control": "public, s-maxage=1800, stale-while-revalidate=86400" };
  if (!a) return new ImageResponse(<Generic />, { width: 1200, height: 675, headers });
  return new ImageResponse(<Card d={toPoster(a)} />, { width: 1200, height: 675, headers });
}

function Generic() {
  return (
    <div
      style={{
        display: "flex",
        width: 1200,
        height: 675,
        background: C.surface,
        color: C.text,
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 72, fontWeight: 800 }}>
        Where are the&nbsp;<span style={{ color: C.real }}>holders</span>?
      </div>
      <div style={{ display: "flex", fontSize: 30, color: C.text2, marginTop: 20 }}>
        Type a token. One map of the countries its holders reach exchanges from — and how much of the supply that honestly covers.
      </div>
      <div style={{ display: "flex", fontSize: 22, color: C.muted, marginTop: 40 }}>holderatlas · built on the Nansen API</div>
    </div>
  );
}

function Card({ d }: { d: PosterData }) {
  const rows = barRows(d).slice(0, 7);
  const scale = Math.max(0.25, ...rows.map((r) => r.share));
  const mapW = 640,
    mapH = 320;
  return (
    <div
      style={{
        display: "flex",
        width: 1200,
        height: 675,
        background: C.surface,
        color: C.text,
        flexDirection: "column",
        padding: "36px 44px",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 800 }}>{d.token.symbol}</div>
        <div style={{ display: "flex", fontSize: 20, color: C.muted }}>
          {d.token.name} · {d.chain} · holderatlas
        </div>
      </div>
      <div style={{ display: "flex", gap: 30, marginTop: 6, flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 660 }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <div style={{ display: "flex", fontSize: 150, fontWeight: 800, letterSpacing: -6, lineHeight: 1 }}>{(d.attributable * 100).toFixed(0)}</div>
            <div style={{ display: "flex", fontSize: 70, fontWeight: 800, color: C.real, marginLeft: 6 }}>%</div>
          </div>
          <div style={{ display: "flex", fontSize: 20, color: C.text2, marginTop: -6 }}>
            of analysed supply placed on a country · {pct(d.attributableByWallets, 0)} of wallets
          </div>
          <svg width={mapW} height={mapH} viewBox={`0 0 ${WORLD_W} ${WORLD_H}`} style={{ marginTop: 14 }}>
            {COUNTRY_PATHS.map((p) => (
              <path key={p.code} d={p.d} fill={C.surface2} stroke={C.border} strokeWidth="0.75" />
            ))}
            {d.countries.map((c) => {
              const at = CENTROIDS[c.code];
              return at ? (
                <circle key={c.code} cx={at[0]} cy={at[1]} r={bubbleR(c.share)} fill={C.real} fillOpacity="0.88" stroke={C.surface} strokeWidth="2" />
              ) : null;
            })}
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingTop: 16 }}>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 700, color: C.text2, marginBottom: 8 }}>Where the analysed supply is</div>
          {rows.map((r) => (
            <div key={r.key} style={{ display: "flex", alignItems: "center", height: 50, gap: 10 }}>
              <div style={{ display: "flex", width: 110, fontSize: 17, fontWeight: 800, whiteSpace: "nowrap", color: r.kind === "country" ? C.text : C.text2 }}>
                {r.label}
              </div>
              <div style={{ display: "flex", width: 240 }}>
                <div
                  style={{
                    display: "flex",
                    width: Math.max(4, (r.share / scale) * 240),
                    height: 20,
                    borderRadius: "0 4px 4px 0",
                    background: r.kind === "country" ? C.real : r.kind === "untraced" ? C.greyDim : C.grey,
                  }}
                />
              </div>
              <div style={{ display: "flex", fontSize: 18, fontWeight: 700 }}>{pct(r.share)}</div>
              <div style={{ display: "flex", fontSize: 14, color: C.muted, whiteSpace: "nowrap" }}>{r.wallets} w</div>
            </div>
          ))}
          {!rows.length ? <div style={{ display: "flex", fontSize: 18, color: C.muted }}>nothing analysed</div> : null}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 15, color: C.muted }}>
        {d.examined.custody + d.examined.human} of {d.holdersFetched} top holders · custody {pct(d.custodyShare, 0)} · green = placed on a country, grey =
        global exchange or no trace · Nansen API
      </div>
    </div>
  );
}
