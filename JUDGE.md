# Holder Atlas — for the judge

*Mirrors https://holderatlas.edycu.dev/judge (static, no login, no key, no setup).*

**Type a token. One world map of where its holders actually are — and the honest share of supply the map covers.**

Exchanges know where holders live; Nansen names the exchange on every transfer. Holder Atlas reads that entity label for
the top holders of a token, maps each exchange to its country through a curated table shipped in the repo, and prints the
one number that keeps the picture honest — as large as the map. Global exchanges are never placed. Grey is never hidden.

## The 30-second path
1. Open **https://holderatlas.edycu.dev/?q=PEPE&chain=ethereum**. Rows stream in — each wallet gains its exchange
   (🏦 Coinbase, 🏦 Upbit, 🏦 Binance…) — the map fills country by country, the bar re-sorts, the number counts to **40.4 %**:
   US 24 · KR 10 · GB 3 · TR 3 · NL 0.3, with 47 % on global exchanges in grey. Cold ≈ 40–60 s, cached ≈ 0 s. On the right,
   the **Nansen call rail** shows every request as it is made — `POST tgm/transfers`, credits, ms, response hash — each row
   turning from pending to green; its counters equal the drawer's totals.
2. Click **WLFI** — the Korean contrast: Upbit holds half the analysed supply → **55 %**, KR 52. Then **DEGEN · base**: Coinbase → US 54.
3. Click **Every Nansen call** — endpoint, body, credits, latency, cached or live, the fields used, the atlas hash. Click
   **Save PNG** — the poster, 1600×900, rendered in the browser.
4. Click **MEW · solana** — the honest unsupported state: exchanges visible, unnamed, 0 % placed, and the banner says which
   Nansen field is missing.
5. Open the permalink **https://holderatlas.edycu.dev/t/ethereum/0x6982508145454ce325ddbe47a25d4ec3d2311933** — the same
   map by address, and the link preview is the poster. The JSON behind it is `/api/atlas?q=PEPE&chain=ethereum`, which the page
   fetches with a run marker; a bare GET of that URL (a crawler, an unfurler, `curl`) replays the recorded run at 0 credits and
   says so — only the page and the CLI run live.

## Receipts
| | |
|---|---|
| Hero query, live | `PEPE` on ethereum: 100 holders fetched · 12 custody + 40 people examined · **40.4 % placed · 117 credits · 110 calls · 57.3 s cold · 7 ms warm** · 2026-09-18 — output verbatim in [DEMO.md](DEMO.md) |
| Benchmark, live | 4 tokens × 1 cold run: **cold p50 40.3 s · p95 59.0 s · warm p50 7 ms · mean 118 credits, max 121** per atlas; 0 failed calls in 444; every warm hash equals its cold hash — [docs/BENCH.md](docs/BENCH.md) |
| Spike, live (day one) | 6 tokens: median **40.6 %** placed on the five EVM tokens (PEPE 40.6 · WLFI 55.9 · DEGEN 57.7 · LINK 3.5 · USDC 2.0); Solana 0 % because no ≤ 5-credit Nansen field names an exchange there — [docs/SCORING.md](docs/SCORING.md) |
| Nansen endpoints | `search/general` · `tgm/holders` (all + `label_type: exchange`) · `tgm/transfers` (CEX-only, per wallet) · `transaction-with-token-transfer-lookup` · `profiler/address/related-wallets` — every placement is one of their response fields joined to [exchanges.json](packages/core/src/exchanges.json) (134 rows, one source each) |
| Tests | **220 tests** (vitest): every label string seen live pinned to its key; the arithmetic property-tested (14,000 generated cases); offline replay = same hash; the page's stream reducer driven by replayed fixtures; the USDC timeout path; the route boundary (10,000 generated garbage queries → 400, zero fetches); the key never reaches a client — **100% statements/branches/functions/lines** on `packages/core/src`, enforced by `vitest.config.ts` thresholds |
| Calls accounted for in the repo | **2,065 live Nansen calls, no run counted twice**: 1,070 fetched live by `npm run seed` (per-fixture `live.calls`, uncached only) + 110 in the PEPE hero run in [DEMO.md](DEMO.md) (the PEPE fixture holds those responses from cache, `live.calls` 0) + 885 in the two bench tables in [docs/BENCH.md](docs/BENCH.md) (444 + 441, fresh in-memory store each run); the account-wide total is on Nansen's usage dashboard |
| Determinism | 12 recorded atlases replay offline with the same hash, zero network, zero credits — including a recorded timeout, replayed as a timeout |
| Clean clone → first map | **54 s** of machine time (clone 1 s · install 5 s · first live map 34 s · verify 1 s · build 10 s · tests 3 s), 2026-09-18 11:11 UTC |

## Reproduce
The real path — live Nansen calls, ~120 credits:
```bash
git clone https://github.com/edycutjong/holderatlas && cd holderatlas && npm install
export NANSEN_API_KEY=nsn_...                              # your key from https://app.nansen.ai/api
npm run holderatlas -- PEPE --chain ethereum --explain     # every wallet, every call, the number, the hash
```
CI / deterministic replay (not the product — a check that the attribution has not drifted):
```bash
npm run verify                       # 12/12 recorded atlases reproduced offline, no key, no network
```

## Honest limitations
- **Solana cannot be named.** `transaction-with-token-transfer-lookup` is the only ≤ 5-credit field carrying an exchange entity
  and it has no Solana support; holders and CEX transfers work there, so the custody share is shown with every exchange
  "unnamed" and 0 % placed.
- **Supply-weighted means whales decide.** 86 % of LINK's analysed supply is one 2017 team wallet with no exchange trace → 4 %
  placed. The wallet-weighted share (44 %) is printed beside the number for exactly this reason.
- **Countries are exchange jurisdictions, not people.** A Coinbase withdrawal is "US" the way a Coinbase account is; Kraken is
  treated as US; Revolut as GB. Every row of the table says why, and global exchanges (Binance, OKX, Bybit, KuCoin…) are grey on purpose.
- **Most recent exchange wins.** One lookup per wallet; a wallet that used Upbit last year and Binance last week is Binance.
- **USDC-class tokens time out.** Nansen's per-wallet transfer filter times out on the highest-volume tokens; the engine probes,
  shortens the window to 30 days, and skips the rest with a named reason rather than guessing.

## Links
- Live: https://holderatlas.edycu.dev
- Repo: https://github.com/edycutjong/holderatlas — [README](README.md), [DEMO.md](DEMO.md), [ARCHITECTURE.md](ARCHITECTURE.md), [docs/SCORING.md](docs/SCORING.md), [docs/BENCH.md](docs/BENCH.md), [docs/DX-REPORT.md](docs/DX-REPORT.md)
- Built by [@edycutjong](https://x.com/edycutjong) for the [Nansen Meridian Buildathon](https://nansen.ai/campaigns/meridian-buildathon)
