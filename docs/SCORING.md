# How Holder Atlas attributes — the rules, with the live numbers behind them

Every placement on the map is one Nansen response field joined to one row of `packages/core/src/exchanges.json`. There is
no model, no guess, no IP geolocation. This page states the rules exactly as `packages/core/src/atlas.ts` applies them and
shows what they produced live on 2026-09-18.

## 1 · The population — `tgm/holders` (5 credits) × 2
- `tgm/holders {chain, token_address, pagination 1/100}` → the top-100 holders by balance with `token_amount` and a free label.
- `tgm/holders {…, label_type: "exchange"}` → the subset that Nansen tags as exchange custody. Free-tier labels are wealth
  tags ("Token Billionaire"), so the *filter* is the only cheap way to know which holder is an exchange.
- Partition (`partition()`): burn addresses and rows whose label matches the structural pattern (pool · contract · proxy ·
  multisig · deployer · vesting · bridge · staking…) → **structural, excluded from the denominator**; rows in the exchange set →
  **custody**; the rest → **human**. Examined: the top 12 custody + top 40 human rows by balance (`--custody`, `--holders`).

## 2 · The exchange touch — `tgm/transfers` (1 credit per call)
`{chain, token_address, date: last 365 days, filters: {include_cex: true, include_dex: false, non_exchange_transfers: false,
to_address: <wallet>}, per_page 5, newest first}` — the wallet's newest CEX withdrawal of this token. A human wallet with no
withdrawal gets one more call with `from_address` (a deposit). No rows either way → **no exchange trace**.

Two sequential probes on the largest examined wallet decide the window for the whole token: if the 1-year window times out
(Nansen does this on the highest-volume tokens — USDC), everyone gets 30 days; if that times out too, every wallet is skipped
with a named reason. A recorded timeout is stored in the fixture and replayed as a timeout, so `verify` is deterministic.

## 3 · The name — `transaction-with-token-transfer-lookup` (1 credit)
`{chain, transaction_hash}` → `data[0].token_transfer_array[]` with `from_address_label` / `to_address_label`. This is the only
≤ 5-credit field on the API that carries an **entity** label: `🏦 Upbit: Deposit`, `🏦 Binance 14 [0x28c6c0]`, `🤖 🏦 Coinbase`.
`exchangeLabelFor()` picks, in order: the wallet's own transfer of this token (its own label for custody wallets, the
counterparty's for humans), then any 🏦 party in the transaction; a label whose entity is in the table beats one that is not
(Nansen puts 🏦 on DEX pools and custodians too). **Most recent exchange wins** — one lookup per wallet.

A 🏦 label that names no table exchange AND reads as a pool / staking / bridge / token contract (`isDexOrContractEntity()`,
the same structural pattern as the partition) is not an exchange at all: for a human it is skipped, and a transfer whose only
🏦 parties are such contracts is **untraced** (`onlyDexParties()`), never other-entity; a "custody" wallet whose own label is
such a contract (`custodyIsContract()` — the `label_type: exchange` filter returns pools too) is reclassified **structural** and
leaves the denominator, exactly like the partition would have done had the holder row carried the name. A table exchange
always wins the tie ("🏦 Binance: Bridge" is Binance).

`entityKey()`: strip the `[0x…]` suffix, emoji and zero-width characters, cut at `:`, drop trailing numerals, lower-case →
`upbit`, `binance`, `coinbase prime` → alias table → canonical key → `country` or `global`.

## 4 · The contract check — `profiler/address/related-wallets` (1 credit, ≤ 5 per token)
An untraced "human" row holding ≥ 2 % of the analysed supply gets one call; a `Deployed by` / `Created by` relation means it
is a contract (staking, bridge, vesting) → structural, out of the denominator. An EOA stays (LINK's 2017 team wallet does).

## 5 · The number
```
analysedSupply = Σ supply of examined custody + human rows            (structural rows excluded)
share(row)     = supply / analysedSupply
country C      = Σ share(rows placed on C)                            (custody in C's exchange + humans traced to it)
attributable   = Σ over countries                                     ← the hero number (supply-weighted)
byWallets      = placed rows / examined rows                          ← printed beside it
global         = Σ share(rows whose exchange is 'global')             — Binance, OKX, Bybit, KuCoin… never a country
untraced       = Σ share(rows with no CEX transfer in the window)
unnamed        = Σ share(traced rows on a chain the lookup does not support)   — Solana
other-entity   = Σ share(rows whose 🏦 entity is not in exchanges.json)
error          = Σ share(rows whose lookup failed)                    — shown, never guessed
atlasHash      = sha256({token, rows: [address, kind, exchange, country, bucket, share₆], attributable₄})[:12]
```
Latency, credits and label text are display, not decision — a cached replay and a live run that reach the same attribution
hash identically (`npm run verify`, 12/12).

## Live numbers (2026-09-18, defaults 12 + 40 — read from the recorded fixtures, `npm run verify` reproduces every row)
| Token | attributable | by wallets | custody | global | untraced | countries (exchanges seen) | credits |
|---|---|---|---|---|---|---|---|
| PEPE / ethereum | **40.4 %** | 34.6 % | 71.9 % | 47.3 % | 12.3 % | US 24.1 (coinbase, kraken, robinhood) · KR 9.5 (bithumb, upbit) · GB 3.4 (revolut) · TR 3.1 (btcturk) · NL 0.3 (bitvavo) | 117 |
| WLFI / ethereum | **55.2 %** | 19.6 % | 4.8 % | 18.8 % | 25.9 % | KR 52.5 (bithumb, upbit) · US 2.7 (coinbase, kraken, robinhood) | 120 |
| DEGEN / base | **58.1 %** | 25.5 % | 43.1 % | 34.5 % | 7.2 % | US 54.5 (coinbase, kraken) · GB 2.4 (revolut) · NL 1.2 (bitvavo) | 121 |
| MOG / ethereum | **33.2 %** | 13.7 % | 59.1 % | 32.5 % | 33.7 % | US 16.6 (kraken) · GB 9.8 (revolut) · NL 5.1 (bitvavo) · AT 1.7 (bitpanda) | 116 |
| ARB / arbitrum | **49.1 %** | 33.3 % | 53.7 % | 30.0 % | 21.0 % | US 32.1 (coinbase, kraken, robinhood) · KR 14.8 (bithumb, upbit) · TR 2.1 (btcturk) | 118 |
| LINK / ethereum | 4.0 % | 44.2 % | 3.8 % | 2.5 % | **93.5 %** (86 % of it one 2017 team EOA) | US 3.3 (coinbase, gemini, kraken, robinhood) · KR 0.6 (upbit) · AT 0.1 (bitpanda) | 117 |
| USDC / ethereum | 15.9 % (30-day window) | 20.4 % | 40.0 % | 44.3 % | 39.4 % | US 15.9 (coinbase, kraken) | 122 |
| CAKE / bnb | 0.8 % | 3.9 % | 78.9 % | 52.6 % | 32.9 % | KR 0.4 (bithumb) · NL 0.4 (bitvavo) | 121 |
| MEW / solana | **0 %** | 0 | 44.3 % | — | 8.7 % | none — 90.7 % "unnamed" (no Solana in the lookup) | 93 |
| PENGU / solana | **0 %** | 0 | 38.1 % | — | 37.6 % | none — 62.4 % "unnamed" | 95 |

Rows whose contract check reclassified a mega-holder (ARB, CAKE, MOG, WLFI: 1 each · USDC: 3 · DEGEN: 5) analyse 51 / 49 / 47
of the 52 examined wallets — the caption and the by-wallets denominator count what is in the number, not what was looked up.

Day-one spike (10 + 30 wallets, 6 tokens): median **40.6 %** on the five EVM tokens.

## What is deliberately NOT in the number
- No market cap, volume, price or holder count — only balances and labels.
- No premium labels (`premium_labels=true`, 150 credits) and no `profiler/address/labels` (100): the free tier is enough for
  the exchange entity, and a public tool has to stay ~120 credits a map.
- No IP geolocation, no ENS/name parsing, no guessing from wealth tags: a wallet either touched a named exchange or it is grey.
