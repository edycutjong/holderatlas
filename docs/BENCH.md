
> holderatlas@0.1.0 bench
> tsx scripts/bench.ts PEPE WLFI DEGEN MOG

## Benchmark — 2026-09-18T10:38Z · 4 tokens × 1 cold run · live Nansen API · defaults (12 custody + 40 human wallets, 4-wide lookup pool, 5 rps)

| token | cold p50 | cold p95 | warm p50 | credits | live calls | failed | result | warm hash = cold |
|---|---|---|---|---|---|---|---|---|
| PEPE --chain ethereum | 40.3 s | 40.3 s | 7 ms | 115 | 108 | 0 | 40.4 % · US 24 KR 10 GB 3 | yes |
| WLFI --chain ethereum | 33.6 s | 33.6 s | 4 ms | 120 | 113 | 0 | 55.2 % · KR 52 US 3 | yes |
| DEGEN --chain base | 59.0 s | 59.0 s | 16 ms | 121 | 114 | 0 | 58.1 % · US 54 GB 2 NL 1 | yes |
| MOG --chain ethereum | 35.1 s | 35.1 s | 4 ms | 116 | 109 | 0 | 33.2 % · US 17 GB 10 NL 5 | yes |

**All tokens:** cold p50 **40.3 s** · p95 **59.0 s** · warm p50 **7 ms** · mean **118.0 credits** and **111.0 live calls** per atlas · max 121 credits · 0 failed calls in 444 · this run spent 472 credits over 444 live calls.
