import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter, REPO, SITE } from "@/components/Shell";

/**
 * /judge — a page built for exactly one reader. No auth, no cookies, no API call, no key: it is prerendered at build time
 * and mirrored verbatim in JUDGE.md at the repo root. Every number below is a real-run receipt with its source next to it.
 */
export const metadata: Metadata = {
  title: "Holder Atlas — for judges",
  description: "The claim, the 30-second path, the receipts, the real reproduce command, and the honest limitations.",
};

const TEST_COUNT = 214;
const CLEAN_CLONE_S = "54";

export default function Judge() {
  return (
    <>
      <SiteHeader current="judge" />
      <main className="wrap judge">
        <p className="judge-kicker">
          <Link href="/">← the tool</Link> · for judges · no login, no key, no setup
        </p>
        <h1>Type a token. One world map of where its holders actually are — and the honest share of supply the map covers.</h1>
        <p className="judge-lede">
          Exchanges know where holders live; Nansen names the exchange on every transfer. Holder Atlas reads that entity label for the top holders of a token,
          maps each exchange to its country through a curated table shipped in the repo, and prints the one number that keeps the picture honest — as large as
          the map. Global exchanges are never placed. Grey is never hidden.
        </p>

        <h2>The 30-second path</h2>
        <ol>
          <li>
            Open{" "}
            <a href={`${SITE}/?q=PEPE&chain=ethereum`}>
              <code>{SITE}/?q=PEPE&amp;chain=ethereum</code>
            </a>
            . Rows stream in — each wallet gains its exchange (🏦 Coinbase, 🏦 Upbit, 🏦 Binance…) — the map fills country by country, the bar re-sorts, the
            number counts to <b>40.4 %</b>: US 24 · KR 10 · GB 3 · TR 3 · NL 0.3, with 47 % on global exchanges in grey. Cold ≈ 40–60 s, cached ≈ 0 s. On the
            right, the <b>Nansen call rail</b> shows every request as it is made — <code>POST tgm/transfers</code>, credits, ms, response hash — each row
            turning from pending to green; its counters equal the drawer&rsquo;s totals.
          </li>
          <li>
            Click <b>WLFI</b> — the Korean contrast: Upbit holds half the analysed supply → <b>55 %</b>, KR 52. Then <b>DEGEN · base</b>: Coinbase → US 54.
          </li>
          <li>
            Click <b>Every Nansen call</b> — endpoint, body, credits, latency, cached or live, the fields used, the atlas hash. Click <b>Save PNG</b> — the
            poster, 1600×900, rendered in the browser.
          </li>
          <li>
            Click <b>MEW · solana</b> — the honest unsupported state: exchanges visible, unnamed, 0 % placed, and the banner says which Nansen field is missing.
          </li>
          <li>
            Open the permalink{" "}
            <a href={`${SITE}/t/ethereum/0x6982508145454ce325ddbe47a25d4ec3d2311933`}>
              <code>{SITE}/t/ethereum/0x6982…1933</code>
            </a>{" "}
            — the same map by address, and the link preview is the poster. The JSON behind it is <code>/api/atlas?q=PEPE&amp;chain=ethereum</code>, which the
            page fetches with a run marker; a bare GET of that URL (a crawler, an unfurler, <code>curl</code>) replays the recorded run at 0 credits and says so
            — only the page and the CLI run live.
          </li>
        </ol>

        <h2>Receipts</h2>
        <table className="judge-table">
          <tbody>
            <tr>
              <th>Hero query, live</th>
              <td>
                <code>PEPE</code> on ethereum: 100 holders fetched · 12 custody + 40 people examined ·{" "}
                <b>40.4 % placed · 117 credits · 110 calls · 57.3 s cold · 7 ms warm</b> · 2026-09-18 · atlas <code>241f4d6ce145</code> — output verbatim in{" "}
                <a href={`${REPO}/blob/main/DEMO.md`}>DEMO.md</a>
              </td>
            </tr>
            <tr>
              <th>Benchmark, live</th>
              <td>
                4 tokens × 1 cold run: <b>cold p50 40.3 s · p95 59.0 s · warm p50 7 ms · mean 118 credits, max 121</b> per atlas; 0 failed calls in 444; every
                warm hash equals its cold hash — <a href={`${REPO}/blob/main/docs/BENCH.md`}>docs/BENCH.md</a> is the script&rsquo;s output
              </td>
            </tr>
            <tr>
              <th>Spike, live (day one)</th>
              <td>
                6 tokens: median <b>40.6 %</b> of analysed supply placed on the five EVM tokens (PEPE 40.6 · WLFI 55.9 · DEGEN 57.7 · LINK 3.5 · USDC 2.0);
                Solana 0 % because no ≤ 5-credit Nansen field names an exchange there — <a href={`${REPO}/blob/main/docs/SCORING.md`}>docs/SCORING.md</a>
              </td>
            </tr>
            <tr>
              <th>Nansen endpoints</th>
              <td>
                <code>search/general</code> · <code>tgm/holders</code> (all + <code>label_type: exchange</code>) · <code>tgm/transfers</code> (CEX-only, per
                wallet) · <code>transaction-with-token-transfer-lookup</code> · <code>profiler/address/related-wallets</code> — every placement is one of their
                response fields joined to <a href={`${REPO}/blob/main/packages/core/src/exchanges.json`}>exchanges.json</a> (133 rows, one source each)
              </td>
            </tr>
            <tr>
              <th>Tests</th>
              <td>
                <b>{TEST_COUNT} tests</b> (vitest): every label string seen live pinned to its key; the arithmetic property-tested (14,000 generated cases);
                offline replay = same hash; the page&rsquo;s stream reducer driven by replayed fixtures; the USDC timeout path; the route boundary (10,000
                generated garbage queries → 400, zero fetches); the key never reaches a client
              </td>
            </tr>
            <tr>
              <th>Determinism</th>
              <td>12 recorded atlases replay offline with the same hash, zero network, zero credits — including a recorded timeout, replayed as a timeout</td>
            </tr>
            <tr>
              <th>Clean clone → first map</th>
              <td>
                {CLEAN_CLONE_S} s of machine time (clone 1 s · install 5 s · first live map 34 s · verify 1 s · build 10 s · tests 3 s), 2026-09-18 11:11 UTC
              </td>
            </tr>
          </tbody>
        </table>

        <h2>Reproduce</h2>
        <p>The real path — live Nansen calls, ~120 credits:</p>
        <pre>
          <code>{`git clone ${REPO} && cd holderatlas && npm install
export NANSEN_API_KEY=nsn_...                              # your key from https://app.nansen.ai/api
npm run holderatlas -- PEPE --chain ethereum --explain     # every wallet, every call, the number, the hash`}</code>
        </pre>
        <p>
          <b>CI / deterministic replay</b> (not the product — a check that the attribution has not drifted):
        </p>
        <pre>
          <code>{`npm run verify                       # 12/12 recorded atlases reproduced offline, no key, no network`}</code>
        </pre>

        <h2>Honest limitations</h2>
        <ul>
          <li>
            <b>Solana cannot be named.</b> <code>transaction-with-token-transfer-lookup</code> is the only ≤ 5-credit field carrying an exchange entity and it
            has no Solana support; holders and CEX transfers work there, so the custody share is shown with every exchange &ldquo;unnamed&rdquo; and 0 % placed.
          </li>
          <li>
            <b>Supply-weighted means whales decide.</b> 86 % of LINK&rsquo;s analysed supply is one 2017 team wallet with no exchange trace → 4 % placed. The
            wallet-weighted share (44 %) is printed beside the number for exactly this reason.
          </li>
          <li>
            <b>Countries are exchange jurisdictions, not people.</b> A Coinbase withdrawal is &ldquo;US&rdquo; the way a Coinbase account is; Kraken is treated
            as US; Revolut as GB. Every row of the table says why, and global exchanges (Binance, OKX, Bybit, KuCoin…) are grey on purpose.
          </li>
          <li>
            <b>Most recent exchange wins.</b> One lookup per wallet; a wallet that used Upbit last year and Binance last week is Binance.
          </li>
          <li>
            <b>USDC-class tokens time out.</b> Nansen&rsquo;s per-wallet transfer filter times out on the highest-volume tokens; the engine probes, shortens the
            window to 30 days, and skips the rest with a named reason rather than guessing.
          </li>
        </ul>

        <h2>Links</h2>
        <ul>
          <li>
            Live: <a href={SITE}>{SITE}</a>
          </li>
          <li>
            Repo: <a href={REPO}>{REPO}</a> — README, <a href={`${REPO}/blob/main/JUDGE.md`}>JUDGE.md</a> (this page),{" "}
            <a href={`${REPO}/blob/main/DEMO.md`}>DEMO.md</a>, <a href={`${REPO}/blob/main/docs/SCORING.md`}>SCORING.md</a>,{" "}
            <a href={`${REPO}/blob/main/docs/BENCH.md`}>BENCH.md</a>, <a href={`${REPO}/blob/main/docs/DX-REPORT.md`}>DX-REPORT.md</a>
          </li>
          <li>
            Built by <a href="https://x.com/edycutjong">@edycutjong</a> for the{" "}
            <a href="https://nansen.ai/campaigns/meridian-buildathon">Nansen Meridian Buildathon</a>
          </li>
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
