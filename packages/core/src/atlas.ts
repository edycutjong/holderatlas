/**
 * The engine: token → holders → per-wallet exchange entity (Nansen) → country → one atlas.
 * All Nansen I/O goes through `nansen.ts`; the arithmetic in `aggregate()` is pure and property-tested.
 */
import { sha256, NansenError, BudgetError, type Call, type CallEvent, type NansenClient } from "./client.js";
import { canonicalize } from "./cache.js";
import { nansen, window, isChain, NAMING_CHAINS, type Chain, type HolderRow, type TokenTransfer } from "./nansen.js";
import { attributeLabel, isStructural, isDexOrContractEntity, countryName, type Country } from "./labels.js";

export type Token = { symbol: string; name: string; chain: Chain; address: string; marketCap: number | null };
export type Candidate = Token & { rank: number | null };

export type WalletKind = "custody" | "human" | "structural";
export type Bucket = "country" | "global" | "other-entity" | "untraced" | "unnamed" | "error";

export type WalletRow = {
  address: string;
  kind: WalletKind;
  /** free Nansen label on the holder row (a wealth tag, a pool name, an ENS…) */
  label: string | null;
  supply: number;
  /** share of the ANALYSED supply (examined custody + human rows) — final only after every row is in */
  share: number;
  /** share of the whole top-N supply fetched — fixed from the start, what the streaming rows show */
  topShare: number;
  /** the 🏦 entity label read from the transfer lookup, verbatim */
  entityLabel: string | null;
  /** table key, e.g. "upbit" */
  exchange: string | null;
  country: Country | null;
  bucket: Bucket;
  /** how the exchange was found */
  via: "withdrawal" | "deposit" | "custody" | null;
  txHash: string | null;
  txAt: string | null;
  calls: number;
  credits: number;
  error?: string;
};

export type CountryRow = { code: string; name: string; supply: number; share: number; wallets: number; exchanges: string[] };
export type BucketRow = { share: number; supply: number; wallets: number; exchanges: string[] };

export type Atlas = {
  input: string;
  token: Token;
  candidates: Candidate[];
  chain: Chain;
  /** naming (entity labels) is possible on this chain */
  naming: boolean;
  /** rows fetched from tgm/holders */
  holdersFetched: number;
  examined: { custody: number; human: number };
  /** supply held by examined rows — the denominator */
  analysedSupply: number;
  /** share of the top-N supply that the examined rows cover (structural + beyond-cap rows excluded) */
  coverage: number;
  structuralShare: number;
  countries: CountryRow[];
  global: BucketRow;
  otherEntity: BucketRow;
  untraced: BucketRow;
  unnamed: BucketRow;
  errors: BucketRow;
  /** Σ country share — the honesty number, supply-weighted */
  attributable: number;
  /** same, by wallet count */
  attributableByWallets: number;
  custodyShare: number;
  rows: WalletRow[];
  calls: Call[];
  credits: number;
  ms: number;
  asOf: string;
  hash: string;
  warnings: string[];
};

export type AtlasEvent =
  | { type: "token"; token: Token; candidates: Candidate[] }
  | {
      type: "holders";
      fetched: number;
      custody: number;
      human: number;
      structural: number;
      examined: { custody: number; human: number };
      /** known before any lookup: what the caption can show while streaming */ coverage: number;
      structuralShare: number;
      custodyShare: number;
    }
  | {
      type: "wallet";
      row: WalletRow;
      done: number;
      total: number;
      /** the wallet's share of the whole top-N supply — stable while streaming, unlike row.share */ topShare: number;
      partial: Pick<Atlas, "countries" | "global" | "untraced" | "unnamed" | "otherEntity" | "errors" | "attributable" | "attributableByWallets">;
    }
  | { type: "reclass"; row: WalletRow; reason: string }
  /** one Nansen call starting (pending) or finishing — the page's live rail; `call` is the same object the drawer prints */
  | ({ type: "call" } & CallEvent)
  | { type: "atlas"; atlas: Atlas };

export type AtlasOptions = {
  chain?: Chain;
  /** human wallets to examine (top by supply) */
  holders?: number;
  /** exchange-custody wallets to examine (top by supply) */
  custody?: number;
  now?: number;
  /** wallets looked up at once (the client's 5 rps / 300 per min buckets are the real cap); 1 = strictly sequential */
  concurrency?: number;
  onProgress?: (e: AtlasEvent) => void;
};

export const DEFAULT_HOLDERS = 40;
export const DEFAULT_CUSTODY = 12;
export const DEFAULT_CONCURRENCY = 4;
export const HOLDERS_PAGE = 100;
/** an untraced "human" row holding at least this share of the analysed supply gets a 1-credit contract check */
export const CONTRACT_CHECK_MIN_SHARE = 0.02;
export const CONTRACT_RELATION = /deployed by|created by/i;
/** when the 1-year per-wallet transfer window times out on the probe wallet, everyone gets this window instead */
export const SHORT_WINDOW_DAYS = 30;
export const FAST_FAIL_MESSAGE = "skipped: Nansen's per-wallet transfer filter times out on this token (very high transfer volume)";
export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class AtlasError extends Error {
  constructor(
    public code: "no-token" | "bad-chain" | "bad-input",
    message: string,
    public candidates: Candidate[] = [],
  ) {
    super(message);
  }
}

function lc(s: string) {
  return s.toLowerCase();
}

/** Ticker or address → the token to map. 0 credits (search/general). */
export async function resolveToken(client: NansenClient, input: string, chain?: Chain): Promise<{ token: Token; candidates: Candidate[] }> {
  const q = input.trim();
  if (!q) throw new AtlasError("bad-input", "type a ticker (PEPE) or a token address with its chain");
  if (chain && !isChain(chain)) throw new AtlasError("bad-chain", `unsupported chain "${chain}"`);
  const isAddr = EVM_ADDRESS.test(q) || SOLANA_ADDRESS.test(q);
  const res = await nansen.search(client, q);
  // res.tokens is never nullish: SearchResponse.tokens is `z.array(...).default([])` with no `.optional()`/`.nullable()`,
  // so a successful parse always yields an array (dead `?? []` removed 2026-09-20 — see coverage task commit).
  const all: Candidate[] = res.tokens
    .filter((t) => isChain(t.chain))
    .map((t) => ({ symbol: t.symbol, name: t.name, chain: t.chain as Chain, address: t.address, marketCap: t.market_cap ?? null, rank: t.rank ?? null }));
  // exact symbol/name (or address) matches only: a typo must never silently map onto Nansen's fuzzy top hit and spend ~120
  // credits on the wrong token (review pass 1, 2026-09-18) — the error lists what Nansen did find instead
  let pool = isAddr ? all.filter((t) => lc(t.address) === lc(q)) : all.filter((t) => lc(t.symbol) === lc(q) || lc(t.name) === lc(q));
  if (chain) pool = pool.filter((t) => t.chain === chain);
  if (!pool.length) {
    if (isAddr && chain && (EVM_ADDRESS.test(q) ? chain !== "solana" : chain === "solana")) {
      // an address Nansen's search does not index can still have holders — go straight to the holders call
      return {
        token: { symbol: q.slice(0, 6) + "…", name: "unknown token", chain, address: EVM_ADDRESS.test(q) ? lc(q) : q, marketCap: null },
        candidates: all,
      };
    }
    const near = all.slice(0, 3).map((t) => `${t.symbol} on ${t.chain}`);
    throw new AtlasError(
      "no-token",
      isAddr
        ? `no token at ${q}${chain ? ` on ${chain}` : " — add --chain"}`
        : `no token named "${q}"${chain ? ` on ${chain}` : " on a supported chain"}${near.length ? ` — Nansen's closest: ${near.join(", ")}` : ""}`,
      all,
    );
  }
  const score = (t: Candidate) => (t.marketCap ?? 0) * 1e6 + (t.rank ? 1e6 - t.rank : 0);
  const best = [...pool].sort((a, b) => score(b) - score(a))[0];
  const { rank: _r, ...token } = best;
  return { token: { ...token, address: token.chain === "solana" ? token.address : lc(token.address) }, candidates: all };
}

type Settled<T> = { ok: true; data: T } | { ok: false; error: string };
async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, data: await p };
  } catch (e) {
    // a credit ceiling is not a per-wallet failure: the whole atlas stops, nothing is guessed, the caller sees why
    if (e instanceof BudgetError) throw e;
    if (e instanceof NansenError) return { ok: false, error: `HTTP ${e.status}: ${e.bodyText.slice(0, 80)}` };
    const err = e as Error;
    return { ok: false, error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? e).slice(0, 120) };
  }
}

/**
 * Pick the 🏦 label that names the exchange side of a transfer involving `wallet`. Candidates are collected in priority
 * order (the wallet's own transfer of THIS token first, then any 🏦 party in the transaction); a label whose entity is in
 * exchanges.json beats one that is not — Nansen puts 🏦 on DEX pools and custodians too ("🤖 🏦 Uniswap: V3 … Pool"),
 * and a CEX withdrawal that lands in the same transaction as a swap must resolve to the CEX, not the pool.
 */
export function exchangeLabelFor(transfers: TokenTransfer[] | null | undefined, wallet: string, kind: WalletKind, token: string): string | null {
  if (!transfers?.length) return null;
  const w = lc(wallet);
  const tok = lc(token);
  const sameToken = transfers.filter((t) => !t.token_address || lc(t.token_address) === tok);
  const pool = sameToken.length ? sameToken : transfers;
  const candidates: string[] = [];
  const add = (l: string | null | undefined) => {
    if (l && attributeLabel(l).entity && !isDexOrContractEntity(l) && !candidates.includes(l)) candidates.push(l);
  };
  if (kind === "custody") {
    // the wallet itself is the exchange: its own label names it
    for (const t of pool) {
      if (lc(t.from_address) === w) add(t.from_address_label);
      if (lc(t.to_address) === w) add(t.to_address_label);
    }
  } else {
    // human: the counterparty on the wallet's own transfer names the exchange
    for (const t of pool) {
      if (lc(t.to_address) === w) add(t.from_address_label);
      if (lc(t.from_address) === w) add(t.to_address_label);
    }
    // fallback: any 🏦 party in the transaction that is not the wallet
    for (const t of pool) {
      if (lc(t.from_address) !== w) add(t.from_address_label);
      if (lc(t.to_address) !== w) add(t.to_address_label);
    }
  }
  return candidates.find((l) => attributeLabel(l).exchange) ?? candidates[0] ?? null;
}

/** True when every 🏦 party in the lookup is a DEX pool / contract — the "CEX-only" transfer filter leaked a swap or a stake. */
export function onlyDexParties(transfers: TokenTransfer[] | null | undefined): boolean {
  const marked = (transfers ?? []).flatMap((t) => [t.from_address_label, t.to_address_label]).filter((l) => attributeLabel(l).entity);
  return marked.length > 0 && marked.every((l) => isDexOrContractEntity(l));
}

/**
 * A "custody" wallet whose own 🏦 label turns out to be a pool / staking / bridge contract ("🤖 🏦 PancakeSwap: CAKE Staking
 * Pool" — Nansen's `label_type: exchange` filter returns those too). It is structural, not exchange custody: excluded from the
 * analysed supply like every other pool, never counted as an unknown entity.
 */
export function custodyIsContract(transfers: TokenTransfer[] | null | undefined, wallet: string): string | null {
  const w = lc(wallet);
  for (const t of transfers ?? []) {
    if (lc(t.from_address) === w && isDexOrContractEntity(t.from_address_label)) return t.from_address_label as string;
    if (lc(t.to_address) === w && isDexOrContractEntity(t.to_address_label)) return t.to_address_label as string;
  }
  return null;
}

/** Partition holder rows: burn/pool/contract → structural; in the exchange set → custody; else human. Sorted by supply desc. */
export function partition(rows: HolderRow[], exchangeSet: Set<string>): Array<{ address: string; label: string | null; supply: number; kind: WalletKind }> {
  const out: Array<{ address: string; label: string | null; supply: number; kind: WalletKind }> = [];
  for (const r of rows) {
    if (!r.address) continue;
    const address = r.address.startsWith("0x") ? lc(r.address) : r.address;
    const supply = Math.max(0, r.token_amount ?? 0);
    const label = r.address_label || null;
    const kind: WalletKind = isStructural(address, label) ? "structural" : exchangeSet.has(address) ? "custody" : "human";
    out.push({ address, label, supply, kind });
  }
  return out.sort((a, b) => b.supply - a.supply);
}

/** Pure aggregation from finished rows — the arithmetic behind the number. */
export function aggregate(rows: WalletRow[]) {
  const examined = rows.filter((r) => r.kind !== "structural");
  const analysedSupply = examined.reduce((n, r) => n + r.supply, 0);
  const share = (s: number) => (analysedSupply > 0 ? s / analysedSupply : 0);
  for (const r of examined) r.share = share(r.supply);
  const bucket = (b: Bucket): BucketRow => {
    const rs = examined.filter((r) => r.bucket === b);
    const supply = rs.reduce((n, r) => n + r.supply, 0);
    return {
      share: share(supply),
      supply,
      wallets: rs.length,
      exchanges: [...new Set(rs.map((r) => r.exchange ?? r.entityLabel ?? "").filter(Boolean))].sort(),
    };
  };
  const byCountry = new Map<string, WalletRow[]>();
  for (const r of examined) if (r.bucket === "country" && r.country) byCountry.set(r.country, [...(byCountry.get(r.country) ?? []), r]);
  const countries: CountryRow[] = [...byCountry.entries()]
    .map(([code, rs]) => {
      const supply = rs.reduce((n, r) => n + r.supply, 0);
      return { code, name: countryName(code), supply, share: share(supply), wallets: rs.length, exchanges: [...new Set(rs.map((r) => r.exchange!))].sort() };
    })
    .sort((a, b) => b.supply - a.supply || a.code.localeCompare(b.code));
  const attributable = countries.reduce((n, c) => n + c.share, 0);
  const attributableByWallets = examined.length ? examined.filter((r) => r.bucket === "country").length / examined.length : 0;
  const custodySupply = examined.filter((r) => r.kind === "custody").reduce((n, r) => n + r.supply, 0);
  return {
    analysedSupply,
    countries,
    global: bucket("global"),
    otherEntity: bucket("other-entity"),
    untraced: bucket("untraced"),
    unnamed: bucket("unnamed"),
    errors: bucket("error"),
    attributable,
    attributableByWallets,
    custodyShare: share(custodySupply),
  };
}

/** Stable hash of the decision: token, examined rows' attribution, the number. Latency, credits and labels' free text are display. */
export function atlasHash(a: Pick<Atlas, "token" | "rows" | "attributable">): string {
  const rows = a.rows
    .filter((r) => r.kind !== "structural")
    .map((r) => ({ a: r.address, k: r.kind, x: r.exchange, c: r.country, b: r.bucket, s: Number(r.share.toFixed(6)) }));
  return sha256(JSON.stringify(canonicalize({ t: `${a.token.chain}:${a.token.address}`, rows, p: Number(a.attributable.toFixed(4)) }))).slice(0, 12);
}

export async function atlas(client: NansenClient, input: string, opts: AtlasOptions = {}): Promise<Atlas> {
  const emit = (e: AtlasEvent) => opts.onProgress?.(e);
  // every call the client makes during this atlas is streamed as it happens (start → end), before the events that use it
  const unsubscribe = client.subscribe((e) => emit({ type: "call", ...e }));
  try {
    return await runAtlas(client, input, opts, emit);
  } finally {
    unsubscribe();
  }
}

async function runAtlas(client: NansenClient, input: string, opts: AtlasOptions, emit: (e: AtlasEvent) => void): Promise<Atlas> {
  const t0 = Date.now();
  const now = opts.now ?? Date.now();
  const callsBefore = client.calls.length;
  const warnings: string[] = [];

  const { token, candidates } = await resolveToken(client, input, opts.chain);
  emit({ type: "token", token, candidates });
  const chain = token.chain;
  const naming = NAMING_CHAINS.includes(chain);
  if (!naming)
    warnings.push(
      `${chain}: Nansen's transfer lookup (the only ≤5-credit field that names an exchange) has no ${chain} support — exchanges are counted but unnamed, so nothing can be placed on the map.`,
    );

  const [h, x] = await Promise.all([
    settle(nansen.holders(client, chain, token.address, HOLDERS_PAGE)),
    settle(nansen.exchangeHolders(client, chain, token.address, HOLDERS_PAGE)),
  ]);
  if (!h.ok) {
    // a 4xx from holders is Nansen saying "not a token here" (burn address, malformed address, unsupported pair) — a no-token
    // state for the page and the CLI, not a 502 (live QA, 2026-09-18)
    if (/^HTTP 4\d\d/.test(h.error))
      throw new AtlasError(
        "no-token",
        `Nansen has no holders for ${token.symbol} on ${chain}: ${h.error.replace(/^HTTP \d+: /, "").replace(/^\{"error":"([^"]+)".*$/, "$1")}`,
        candidates,
      );
    throw new Error(`tgm/holders failed: ${h.error}`);
  }
  if (!x.ok) warnings.push(`exchange-holder call failed (${x.error}) — custody wallets could not be separated from people`);
  const exchangeSet = new Set(
    (x.ok ? x.data.data : []).map((r) => (r.address ? (r.address.startsWith("0x") ? lc(r.address) : r.address) : "")).filter(Boolean),
  );
  const parts = partition(h.data.data, exchangeSet);
  // an address that is not a token (an EOA, a random contract) comes back 200 with zero holders — live 2026-09-19 that
  // rendered as "0 of 0 holders analysed · 0.0 %", a map of nothing dressed as an answer. It is the no-token state.
  if (parts.length === 0)
    throw new AtlasError("no-token", `Nansen has no holders for ${token.symbol} on ${chain} — not a token contract on this chain?`, candidates);
  const totalSupply = parts.reduce((n, p) => n + p.supply, 0);
  const custodyRows = parts.filter((p) => p.kind === "custody").slice(0, opts.custody ?? DEFAULT_CUSTODY);
  const humanRows = parts.filter((p) => p.kind === "human").slice(0, opts.holders ?? DEFAULT_HOLDERS);
  const examinedSupply0 = [...custodyRows, ...humanRows].reduce((n, p) => n + p.supply, 0);
  emit({
    type: "holders",
    fetched: parts.length,
    custody: parts.filter((p) => p.kind === "custody").length,
    human: parts.filter((p) => p.kind === "human").length,
    structural: parts.filter((p) => p.kind === "structural").length,
    examined: { custody: custodyRows.length, human: humanRows.length },
    coverage: totalSupply > 0 ? examinedSupply0 / totalSupply : 0,
    structuralShare: totalSupply > 0 ? parts.filter((p) => p.kind === "structural").reduce((n, p) => n + p.supply, 0) / totalSupply : 0,
    custodyShare: examinedSupply0 > 0 ? custodyRows.reduce((n, p) => n + p.supply, 0) / examinedSupply0 : 0,
  });

  const topShareOf = (supply: number) => (totalSupply > 0 ? supply / totalSupply : 0);
  const rows: WalletRow[] = parts
    .filter((p) => p.kind === "structural")
    .map((p) => ({
      ...p,
      share: 0,
      topShare: topShareOf(p.supply),
      entityLabel: null,
      exchange: null,
      country: null,
      bucket: "untraced" as Bucket,
      via: null,
      txHash: null,
      txAt: null,
      calls: 0,
      credits: 0,
    }));
  // Nansen's per-wallet transfer filter times out (10 s) on the highest-volume tokens (USDC, live 2026-09-18). Two sequential
  // probes on the largest examined wallet decide the window for everyone — deterministic, so a fixture replays identically:
  // 1-year window times out → 30 days; that times out too → every wallet is skipped with a named reason, never guessed.
  let windowDays = 365;
  let fastFail = false;
  const probeWallet = custodyRows[0] ?? humanRows[0];
  if (probeWallet) {
    for (const days of [365, SHORT_WINDOW_DAYS]) {
      const t = await settle(
        nansen.cexTransfers(client, chain, token.address, probeWallet.address, "to", window(now, days), 5, {
          timeoutMs: Math.round(client.defaultTimeoutMs * 1.25),
          retries: 0,
        }),
      );
      if (t.ok || t.error !== "timeout") break;
      windowDays = days === 365 ? SHORT_WINDOW_DAYS : windowDays;
      if (days === SHORT_WINDOW_DAYS) fastFail = true;
    }
  }
  const queue = [...custodyRows, ...humanRows];
  let done = 0;
  const lookup = async (p: (typeof queue)[number]): Promise<void> => {
    const c0 = client.calls.length;
    const row: WalletRow = {
      ...p,
      share: 0,
      topShare: topShareOf(p.supply),
      entityLabel: null,
      exchange: null,
      country: null,
      bucket: "untraced",
      via: null,
      txHash: null,
      txAt: null,
      calls: 0,
      credits: 0,
    };
    // 1. the wallet's newest exchange-touching transfer of this token (withdrawals first, then deposits)
    let tx: { hash: string; at: string; via: "withdrawal" | "deposit" } | null = null;
    for (const dir of ["to", "from"] as const) {
      if (fastFail) {
        row.error = FAST_FAIL_MESSAGE;
        break;
      }
      const t = await settle(
        nansen.cexTransfers(client, chain, token.address, p.address, dir, window(now, windowDays), 5, {
          timeoutMs: Math.round(client.defaultTimeoutMs * 1.25),
          retries: 0,
        }),
      );
      if (!t.ok) {
        row.error = `tgm/transfers ${dir}: ${t.error}`;
        break;
      }
      const newest = t.data.data[0];
      if (newest) {
        tx = { hash: newest.transaction_hash, at: newest.block_timestamp, via: dir === "to" ? "withdrawal" : "deposit" };
        break;
      }
    }
    if (tx) {
      row.txHash = tx.hash;
      row.txAt = tx.at;
      row.via = p.kind === "custody" ? "custody" : tx.via;
      if (!naming) row.bucket = "unnamed";
      else {
        // 2. the entity label on that transfer
        const l = await settle(nansen.txLookup(client, chain, tx.hash, { timeoutMs: Math.round(client.defaultTimeoutMs * 1.25), retries: 1 }));
        if (!l.ok) {
          row.error = `transfer lookup: ${l.error}`;
          row.bucket = "error";
        } else {
          const transfers = l.data.data[0]?.token_transfer_array;
          const label = exchangeLabelFor(transfers, p.address, p.kind, token.address);
          const attr = attributeLabel(label);
          row.entityLabel = label;
          row.exchange = attr.exchange;
          row.country = attr.country;
          const contractLabel = !label && p.kind === "custody" ? custodyIsContract(transfers, p.address) : null;
          if (contractLabel) {
            // the "exchange" holder is a pool / staking / bridge contract wearing Nansen's 🏦: structural, out of the denominator
            row.kind = "structural";
            row.label = row.label ? `${row.label} · ${contractLabel}` : contractLabel;
            row.share = 0;
            row.bucket = "untraced";
            row.txHash = null;
            row.txAt = null;
            row.via = null;
            emit({ type: "reclass", row, reason: `lookup: ${contractLabel} is a pool/contract, not exchange custody` });
          } else if (!label && onlyDexParties(transfers)) {
            // the exchange-filtered transfer was a swap or a stake (Nansen marks DEX pools 🏦 too): no exchange trace, not a table gap
            row.bucket = "untraced";
            row.txHash = null;
            row.txAt = null;
            row.via = null;
          } else
            row.bucket =
              attr.country && attr.country !== "global" ? "country" : attr.country === "global" ? "global" : attr.entity ? "other-entity" : "unnamed";
        }
      }
    } else if (row.error) row.bucket = "error";
    else row.bucket = "untraced";
    // calls made by THIS lookup: the client log is shared, so count by the wallet's own address in the bodies
    const made = client.calls
      .slice(c0)
      .filter(
        (c) => JSON.stringify(c.body).toLowerCase().includes(p.address.toLowerCase()) || (row.txHash ? JSON.stringify(c.body).includes(row.txHash) : false),
      );
    row.calls = made.length;
    row.credits = made.reduce((n, c) => n + c.credits, 0);
    rows.push(row);
    done++;
    const partial = aggregate(rows);
    emit({
      type: "wallet",
      row,
      done,
      total: queue.length,
      topShare: totalSupply > 0 ? row.supply / totalSupply : 0,
      partial: {
        countries: partial.countries,
        global: partial.global,
        untraced: partial.untraced,
        unnamed: partial.unnamed,
        otherEntity: partial.otherEntity,
        errors: partial.errors,
        attributable: partial.attributable,
        attributableByWallets: partial.attributableByWallets,
      },
    });
  };
  const width = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, queue.length || 1));
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const i = next++;
        if (i >= queue.length) return;
        await lookup(queue[i]);
      }
    }),
  );
  // deterministic order regardless of completion order: supply desc, then address
  rows.sort((a, b) => b.supply - a.supply || a.address.localeCompare(b.address));

  // 3. an unlabelled mega-holder with no exchange trace is more often a contract (staking, bridge, vesting) than a person:
  //    one related-wallets call (1 credit) per untraced row ≥ 2 % of the analysed supply; "Deployed by" → structural.
  aggregate(rows);
  for (const row of rows.filter(
    (r) => r.kind === "human" && (r.bucket === "untraced" || r.bucket === "error") && r.share >= CONTRACT_CHECK_MIN_SHARE && naming,
  )) {
    const c0 = client.calls.length;
    const rel = await settle(nansen.relatedWallets(client, chain, row.address, { retries: 0 }));
    const made = client.calls.slice(c0);
    row.calls += made.length;
    row.credits += made.reduce((n, c) => n + c.credits, 0);
    if (rel.ok) {
      const hit = rel.data.data.find((r) => CONTRACT_RELATION.test(r.relation));
      if (hit) {
        row.kind = "structural";
        row.label = row.label ? `${row.label} · contract (${hit.relation})` : `contract (${hit.relation})`;
        row.share = 0;
        emit({ type: "reclass", row, reason: `related-wallets: ${hit.relation}` });
      }
    }
  }

  const agg = aggregate(rows);
  // entityLabel is never null/empty on a row bucketed "other-entity": that bucket is only reached when
  // attributeLabel(label).entity is truthy, which itself requires label to be a non-empty 🏦-bearing string
  // (see entityKey) — so the `?? ""` + `.filter(Boolean)` this replaced were dead (2026-09-20, coverage task).
  const unknownEntities = [...new Set(rows.filter((r) => r.bucket === "other-entity").map((r) => r.entityLabel as string))];
  if (unknownEntities.length) warnings.push(`entities not in exchanges.json (counted as unattributed): ${unknownEntities.join(", ")}`);
  const failed = rows.filter((r) => r.bucket === "error").length;
  if (failed) warnings.push(`${failed} wallet${failed > 1 ? "s" : ""} could not be looked up (timeouts or errors) — shown as "lookup failed", never guessed`);
  if (windowDays !== 365)
    warnings.push(
      `Nansen's per-wallet transfer filter timed out on ${token.symbol} over 1 year — ${fastFail ? "and over 30 days: every wallet was skipped, nothing was guessed" : `the exchange-trace window is 30 days for this token`}`,
    );
  const calls = client.calls.slice(callsBefore);
  const out: Atlas = {
    input: input.trim(),
    token,
    candidates,
    chain,
    naming,
    holdersFetched: parts.length,
    // counted after the contract check: a reclassified mega-holder is structural, so it is neither "analysed" in the
    // caption nor in the by-wallets denominator (audit 2026-09-19 — DEGEN showed "52 of 100 analysed" over 47 rows)
    examined: { custody: rows.filter((r) => r.kind === "custody").length, human: rows.filter((r) => r.kind === "human").length },
    coverage: totalSupply > 0 ? agg.analysedSupply / totalSupply : 0,
    structuralShare: totalSupply > 0 ? rows.filter((r) => r.kind === "structural").reduce((n, r) => n + r.supply, 0) / totalSupply : 0,
    rows,
    ...agg,
    calls,
    credits: calls.reduce((n, c) => n + c.credits, 0),
    ms: Date.now() - t0,
    asOf: new Date(now).toISOString(),
    hash: "",
    warnings,
  };
  out.hash = atlasHash(out);
  emit({ type: "atlas", atlas: out });
  return out;
}
