
## Benchmark — 2026-09-18T10:38Z · 4 tokens × 1 cold run · live Nansen API · defaults (12 custody + 40 human wallets, 4-wide lookup pool, 5 rps)

| token | cold p50 | cold p95 | warm p50 | credits | live calls | failed | result | warm hash = cold |
|---|---|---|---|---|---|---|---|---|
| PEPE --chain ethereum | 40.3 s | 40.3 s | 7 ms | 115 | 108 | 0 | 40.4 % · US 24 KR 10 GB 3 | yes |
| WLFI --chain ethereum | 33.6 s | 33.6 s | 4 ms | 120 | 113 | 0 | 55.2 % · KR 52 US 3 | yes |
| DEGEN --chain base | 59.0 s | 59.0 s | 16 ms | 121 | 114 | 0 | 58.1 % · US 54 GB 2 NL 1 | yes |
| MOG --chain ethereum | 35.1 s | 35.1 s | 4 ms | 116 | 109 | 0 | 33.2 % · US 17 GB 10 NL 5 | yes |

**All tokens:** cold p50 **40.3 s** · p95 **59.0 s** · warm p50 **7 ms** · mean **118.0 credits** and **111.0 live calls** per atlas · max 121 credits · 0 failed calls in 444 · this run spent 472 credits over 444 live calls.

---

## Experiment — 2026-09-22 · 8-wide lookup pool under 10 rps (NOT adopted; defaults stay 4-wide / 5 rps, now with a 300/min window)

Same script, same 4 tokens, one cold run each, `DEFAULT_CONCURRENCY = 8`, `rps = 10`:

### Run — 2026-09-22T00:16Z · 4 tokens × 1 cold run · live Nansen API · defaults (12 custody + 40 human wallets, 8-wide lookup pool, 10 rps burst under a 300/min window)

| token | cold p50 | cold p95 | warm p50 | credits | live calls | failed | result | warm hash = cold |
|---|---|---|---|---|---|---|---|---|
| PEPE --chain ethereum | 34.5 s | 34.5 s | 7 ms | 116 | 109 | 0 | 39.8 % · US 24 KR 9 GB 3 | yes |
| WLFI --chain ethereum | 31.1 s | 31.1 s | 30 ms | 119 | 112 | 0 | 3.3 % · US 3 KR 1 | yes |
| DEGEN --chain base | 58.1 s | 58.1 s | 7215 ms | 115 | 111 | 3 | 52.6 % · US 53 | no |
| MOG --chain ethereum | 22.8 s | 22.8 s | 7 ms | 116 | 109 | 0 | 33.2 % · US 17 GB 10 NL 5 | yes |

**All tokens:** cold p50 **34.5 s** · p95 **58.1 s** · warm p50 **30 ms** · mean **116.5 credits** and **110.3 live calls** per atlas · max 119 credits · 3 failed calls in 441 · this run spent 466 credits over 441 live calls.

Read against the 2026-09-18 defaults above: cold p50 40.3 → 34.5 s (−14 %), p95 59.0 → 58.1 s (flat), and **3 failed calls in 441**
where the 4-wide run had 0 in 444; DEGEN's warm hash no longer equalled its cold hash because the failed lookups are not cached.
WLFI's 55.2 → 3.3 % is live data, not the pool: its 52 %-of-supply wallet's newest exchange touch is now "🏦 Blockchain.com: Deposit"
(added to exchanges.json as global that day). Nansen's per-call latency (0.9 s transfers, 1.9 s lookup) is the ceiling; a wider
client only adds failures. The 300/min sliding window that this experiment introduced in the client is kept as a hard stop.

