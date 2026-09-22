# DX report — building Holder Atlas on the Nansen API (2026-09-18)

Everything below was measured live with the `meridian` key; probe bodies are in the commit history of `scripts/spike.ts`.

## Frictions (9)
1. **Entity labels live in exactly one cheap place.** `profiler/address/transactions.tokens_sent[].to_address_label`,
   `tgm/transfers.*_address_label`, `tgm/holders.address_label` and `profiler/address/counterparties.counterparty_address_label`
   (even with `group_by: "entity"`) all return wealth/activity tags — Binance 14 is "Token Billionaire". Only
   `transaction-with-token-transfer-lookup.token_transfer_array[].*_address_label` says "🏦 Binance 14". Finding that cost a
   day-one spike; the docs never say which fields carry entity labels.
2. **`transaction-with-token-transfer-lookup` has no Solana (or Polygon).** The chain enum is EVM + bitcoin/near/sui/ton/tron.
   Solana holders and CEX transfers work, so a Solana token can show its custody share but never name an exchange.
3. **`aggregate_by_entity: true` on `tgm/holders` returns rows with `address: null` and `address_label: ""` on the free tier** —
   entity aggregation without entity names. Five credits for a list of anonymous balances.
4. **Some labels carry U+200B prefixes** ("​​🏦 Upbit [0x3f9a83]", Robinhood, BTCTurk, Revolut, Kraken). Invisible in
   logs; a naive `startsWith("🏦")` misses a third of the regional exchanges.
5. **The per-wallet transfer filter times out on the highest-volume tokens.** `tgm/transfers` with `to_address` + CEX-only over
   1 year exceeds 10 s on USDC for nearly every wallet (39/40 in the spike); 30 days answers. No documented limit, no 4xx —
   just a hang.
6. **The exchange set costs a second 5-credit call** (`label_type: "exchange"`), and naming each custody wallet costs two more,
   because holders rows do not say which exchange they are. An `entity_name` on holders rows would halve a map's credits.
7. **`🏦` is not "exchange".** Nansen puts the same mark on DEX pools ("🤖 🏦 Uniswap: V3 USD1-WLFI … Liquidity Pool"),
   custodians (Cobo), and aggregators ("🤖 🏦 OKX: DEX Aggregator"). The category has to be inferred from the name.
8. **Label spelling drifts within an entity**: "Upbit", "Upbit : Link Wallet", "Upbit: Internal Wallet", "Upbit: Deposit";
   "Coinbase", "Coinbase Prime: Custody Wallet", "Coinbase: LINK", "Coinbase: Main Wallet". A normaliser + alias table is
   unavoidable; every spelling seen live is pinned in `labels.test.ts`.
9. **Latency is the product's ceiling.** Live calls average 1.7 s (`tgm/transfers`) to 2.0 s (lookup); a 110-call map is 40–60 s
   cold even with a 4-wide pool under the 5 rps client bucket. Widening the pool does not help: 8-wide under 10 rps
   (measured 2026-09-22, docs/BENCH.md) moved p50 only 40.3 → 34.5 s and produced 3 failed calls in 441 where 4-wide had
   0 in 444 — the per-call latency, not the client, is the ceiling. A batch lookup (`counterparties/batch` exists — a
   `transfer-lookup/batch` would too) would make the map a 5-second experience.

## Wishes (5)
1. `entity_label` (or `entity_name`) on `tgm/transfers`, `tgm/holders` and `profiler/address/transactions` rows — the single change
   that turns this ~120-credit map into a ~12-credit one.
2. Solana (and Polygon) in `transaction-with-token-transfer-lookup`.
3. A batch transfer lookup: N hashes in, N labelled transfers out.
4. `entity_category` next to entity labels (exchange / dex / custodian / bridge), so 🏦 does not have to be parsed.
5. A documented timeout budget per endpoint, or a 4xx when a filter cannot be served in time.

## What worked well
- `search/general` at 0 credits resolves a ticker to the right contract with market cap and rank in one call.
- `tgm/transfers` filters (`include_cex`, `non_exchange_transfers`, `to_address`) are exactly the right knobs — one call per
  wallet, five rows, newest first.
- `profiler/address/related-wallets` is a reliable 1-credit contract detector ("Deployed by").
- `/account` at 0 credits makes budget checks free; credit costs match the published table exactly.
