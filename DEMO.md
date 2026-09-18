# DEMO — Holder Atlas, real output

Everything on this page is pasted from real runs on 2026-09-18 with the `meridian` key. Nothing is edited.

## The hero run — `npm run holderatlas -- PEPE --chain ethereum --no-cache --explain` (live, cold)

Recorded 2026-09-18 11:00 UTC. **117 credits · 110 live calls · 57.3 s**. The first two lines and the per-wallet rows go to
stderr as they land (the web page streams the same events); the summary goes to stdout. The wallet rows below are from the
warm re-run seconds later (identical rows, share column = share of the top-100 supply); the summary is the cold run verbatim.

```
PEPE on ethereum 0x6982508145454ce325ddbe47a25d4ec3d2311933
holders 100: 57 exchange custody · 41 people · 2 pools/contracts → examining 12 + 40
  custody 0x5a52…efcb     11.8% of top-100  custody    global  2 calls · 0 cr
  custody 0xf977…acec      9.2% of top-100  custody    global  2 calls · 0 cr
  custody 0x1d48…0270      8.4% of top-100  custody    US  2 calls · 0 cr
  custody 0x3f9a…99b8      4.4% of top-100  custody    KR  2 calls · 0 cr
  custody 0x611f…b09d      4.0% of top-100  custody    global  2 calls · 0 cr
  custody 0xc93e…13b4      2.6% of top-100  custody    global  2 calls · 0 cr
  custody 0xc671…f271      2.5% of top-100  custody    KR  2 calls · 0 cr
  custody 0x76ec…fbd3      2.3% of top-100  custody    TR  2 calls · 0 cr
  custody 0xefef…bc5c      1.9% of top-100  custody    global  2 calls · 0 cr
  custody 0xa023…947e      1.9% of top-100  custody    global  2 calls · 0 cr
  custody 0x4368…f042      1.7% of top-100  custody    global  2 calls · 0 cr
  custody 0x40b3…e489      1.6% of top-100  custody    US  2 calls · 0 cr
  …  (52 wallet rows in total)
  human   0x66e0…e7bc      0.2% of top-100  withdrawal US  2 calls · 0 cr
  human   0xbb07…946e      0.2% of top-100  -          no exchange trace  2 calls · 0 cr
  human   0x664f…4eb5      0.2% of top-100  -          no exchange trace  2 calls · 0 cr
  human   0xd048…3e51      0.2% of top-100  deposit    global  3 calls · 0 cr

PEPE Pepe · ethereum · 0x6982508145454ce325ddbe47a25d4ec3d2311933

40.4% of analysed supply placed on a country (34.6% of wallets)

██████░░░░░░░░░░░░░░░░░░ US   24.1%  13 wallets · coinbase, kraken, robinhood
██░░░░░░░░░░░░░░░░░░░░░░ KR    9.5%  2 wallets · bithumb, upbit
█░░░░░░░░░░░░░░░░░░░░░░░ GB    3.4%  1 wallet · revolut
█░░░░░░░░░░░░░░░░░░░░░░░ TR    3.1%  1 wallet · btcturk
░░░░░░░░░░░░░░░░░░░░░░░░ NL    0.3%  1 wallet · bitvavo
███████████░░░░░░░░░░░░░ --   47.3%  global exchanges, no location by design · binance, bybit, crypto.com, gate, okx
███░░░░░░░░░░░░░░░░░░░░░ ··   12.3%  no exchange trace in 1 year · 23 wallets

analysed 52 of 100 top holders = 72.7% of their supply · exchange custody 71.9% · pools/contracts excluded 3.3% · countries = United States, South Korea, United Kingdom, Türkiye, Netherlands
117 credits · 110 calls (0 cached) · 57.3s · atlas 241f4d6ce145

calls:
  search/general                             1 calls     0 cr  0 cached  580 ms avg live
  tgm/holders                                2 calls    10 cr  0 cached  1025 ms avg live
  tgm/transfers                             78 calls    78 cr  0 cached  1695 ms avg live
  transaction-with-token-transfer-lookup    29 calls    29 cr  0 cached  2007 ms avg live
```

`fixtures/PEPE--ethereum.json` holds exactly this run's responses and hash (`241f4d6ce145`). The first recording of the day
(10:03 UTC, `4d9f7611a988`) differed by one wallet whose newest exchange transfer changed in between — live data moves, and
the hash says so. `npm run bench` (docs/BENCH.md) shows the warm run of each cold run hashing identically.

## Warm run — same command without `--no-cache`, seconds later
```
0 credits · 110 calls (110 cached, as of 2026-09-18 11:00 UTC) · 0.0s · atlas 241f4d6ce145
```

## The contrast — `npm run holderatlas -- WLFI --chain ethereum`
```
WLFI World Liberty Financial · ethereum · 0xda5e1988097297dcdc1f90d4dfe7909e847cbef6

55.2% of analysed supply placed on a country (20.0% of wallets)

████████████░░░░░░░░░░░░ KR   52.5%  2 wallets · upbit
█░░░░░░░░░░░░░░░░░░░░░░░ US    2.7%  7 wallets · coinbase, kraken, robinhood
████░░░░░░░░░░░░░░░░░░░░ --   18.8%  global exchanges, no location by design · binance, bybit, gate, mexc, okx
░░░░░░░░░░░░░░░░░░░░░░░░ ??    0.1%  entities not in exchanges.json · 🤖 🏦 Uniswap: V3 USD1-WLFI (0.3%) Liquidity Pool [0x4637ea]
██████░░░░░░░░░░░░░░░░░░ ··   25.9%  no exchange trace in 1 year · 27 wallets
```
(from `fixtures/WLFI--ethereum.json`, recorded live 2026-09-18 10:08 UTC, 120 credits)

## The honest states
- `npm run holderatlas -- MEW --chain solana` → `0.0%` · a hatched **UNNAMED 90.3 %** bar · warning: *solana: Nansen's transfer
  lookup (the only ≤5-credit field that names an exchange) has no solana support — exchanges are counted but unnamed*.
- `npm run holderatlas -- USDC --chain ethereum` → `9.6%` · warning: *Nansen's per-wallet transfer filter timed out on USDC over
  1 year — the exchange-trace window is 30 days for this token*.
- `npm run holderatlas -- XQZPLM` → `no token named "XQZPLM" on a supported chain` (exit 3, 0 credits).
- `npm run holderatlas -- 0x6982508145454ce325ddbe47a25d4ec3d2311933 --chain ethereum` → the PEPE atlas, same hash as the ticker.

## Benchmark (docs/BENCH.md, `npm run bench -- PEPE WLFI DEGEN MOG`)
| token | cold p50 | warm p50 | credits | live calls | result | warm hash = cold |
|---|---|---|---|---|---|---|
| PEPE --chain ethereum | 40.3 s | 7 ms | 115 | 108 | 40.4 % · US 24 KR 10 GB 3 | yes |
| WLFI --chain ethereum | 33.6 s | 4 ms | 120 | 113 | 55.2 % · KR 52 US 3 | yes |
| DEGEN --chain base | 59.0 s | 16 ms | 121 | 114 | 58.1 % · US 54 GB 2 NL 1 | yes |
| MOG --chain ethereum | 35.1 s | 4 ms | 116 | 109 | 33.2 % · US 17 GB 10 NL 5 | yes |

Cold p50 **40.3 s** · p95 **59.0 s** · warm p50 **7 ms** · mean **118 credits** and **111 live calls** per atlas · 0 failed calls in 444.

## Reproduce
```bash
git clone https://github.com/edycutjong/holderatlas && cd holderatlas && npm install
export NANSEN_API_KEY=nsn_...                              # https://app.nansen.ai/api
npm run holderatlas -- PEPE --chain ethereum --explain     # ~120 credits, ~40–60 s cold; 0 credits, 0 s the second time
npm run verify                                             # 12/12 recorded atlases replay offline, no key
npm run dev                                                # http://localhost:3000 — the picture
```
