import { createHash } from "node:crypto";

/** Every Nansen call the engine makes, recorded for the provenance drawer and `--explain`. */
export type Call = {
  endpoint: string;
  body: Record<string, unknown>;
  credits: number;
  ms: number;
  cached: boolean;
  status: number;
  fieldsUsed: string[];
  /** sha256 of the raw response body — verify.ts compares live vs fixture. */
  responseHash: string;
  /** network attempts made (1 = clean; 2 = one timeout/429/5xx was retried) */
  attempts: number;
  /** wall time including any failed attempt, so a hidden timeout is visible in provenance */
  totalMs: number;
  /** false when every attempt failed; `error` says why. Failed calls are recorded at 0 credits. */
  ok: boolean;
  error?: string;
};

/** Per-call overrides: a secondary lookup can be given a shorter timeout and no retry so it cannot stall a verdict. */
export type CallOptions = { timeoutMs?: number; retries?: number };

/**
 * Live notifications for the page's call rail: `start` fires before the first network attempt (the pending row),
 * `end` when the Call is recorded — the SAME object that lands in `client.calls`, so the rail and the drawer cannot
 * disagree. A cache hit or a replayed timeout emits `end` only (there is nothing to wait for). `id` pairs the two.
 */
export type CallEvent = { phase: "start"; id: number; endpoint: string; body: Record<string, unknown> } | { phase: "end"; id: number; call: Call };
export type CallListener = (e: CallEvent) => void;

export type ClientOptions = {
  baseUrl?: string;
  /** requests per second, client-side burst cap (Nansen: 300/min) */
  rps?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * Hard ceiling on credits this client may spend on the network (cached hits are free and do not count). The call that
   * would cross it throws a BudgetError BEFORE any request is made. Scripts that are meant to be free (`seed --reuse-cache`)
   * set it so a cold cache aborts at one token's worth instead of silently re-billing the whole set (1,050 credits, 2026-09-18).
   */
  maxCredits?: number;
};

/** Credit cost per endpoint (docs.nansen.ai credits table, 2026-09-15; extended 2026-09-18). Unknown endpoints count as 1. */
export const CREDITS: Record<string, number> = {
  "search/general": 0,
  "tgm/token-information": 1,
  "tgm/transfers": 1,
  "transaction-with-token-transfer-lookup": 1,
  "profiler/address/transactions": 1,
  "profiler/address/related-wallets": 1,
  "tgm/holders": 5,
  "profiler/address/counterparties": 5,
};

/** Thrown before a network call that would push `creditsSpent` past `maxCredits`. Nothing was sent. */
export class BudgetError extends Error {
  constructor(
    public endpoint: string,
    public spent: number,
    public cost: number,
    public maxCredits: number,
  ) {
    super(`credit ceiling: ${endpoint} costs ${cost}, ${spent} already spent, ceiling ${maxCredits} — call not made`);
    this.name = "BudgetError";
  }
}

export class NansenError extends Error {
  constructor(
    public endpoint: string,
    public status: number,
    public bodyText: string,
  ) {
    super(`Nansen ${endpoint} → HTTP ${status}: ${bodyText.slice(0, 200)}`);
  }
}

function withAttempts(e: unknown, attempts: number): unknown {
  if (e && typeof e === "object") (e as { attempts?: number }).attempts = attempts;
  return e;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Minimal token bucket: at most `rps` requests per rolling second. */
class RateLimiter {
  private timestamps: number[] = [];
  constructor(private rps: number) {}
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < 1000);
      if (this.timestamps.length < this.rps) {
        this.timestamps.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 - (now - this.timestamps[0]) + 5));
    }
  }
}

export class NansenClient {
  private baseUrl: string;
  private limiter: RateLimiter;
  protected timeoutMs: number;
  private fetchImpl: typeof fetch;
  protected maxCredits: number;
  /** credits committed to calls that passed the ceiling check (in flight or done) — released when a call fails, so a 4-wide pool cannot overshoot */
  private budgetUsed = 0;
  /** Every call made through this client, in order. */
  readonly calls: Call[] = [];
  private listeners = new Set<CallListener>();
  private seq = 0;

  constructor(
    private apiKey: string,
    opts: ClientOptions = {},
  ) {
    if (!apiKey || !apiKey.startsWith("nsn_")) {
      throw new Error("NANSEN_API_KEY missing or malformed (expected nsn_…)");
    }
    this.baseUrl = opts.baseUrl ?? "https://api.nansen.ai/api/v1";
    this.limiter = new RateLimiter(opts.rps ?? 5); // Nansen cap is 300/min; an atlas makes ~100 sequential calls, 5 rps keeps a full run at 300/min with headroom for a second visitor
    this.timeoutMs = opts.timeoutMs ?? 8000; // Nansen occasionally hangs on very large tokens; 8 s + one retry caps a call at ~17 s
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxCredits = opts.maxCredits ?? Infinity;
  }

  /** Listen to every call as it starts and ends (the page's live rail). Returns the unsubscribe function. */
  subscribe(fn: CallListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  protected nextCallId(): number {
    return ++this.seq;
  }
  protected notify(e: CallEvent): void {
    for (const fn of this.listeners) fn(e);
  }
  /** The one place a Call enters provenance: pushed to `calls` and announced to the rail in the same tick. */
  protected record(id: number, call: Call): void {
    this.calls.push(call);
    this.notify({ phase: "end", id, call });
  }

  /** Refuse (throw BudgetError) when one more live call to `endpoint` would cross the ceiling. Runs before every network attempt. */
  protected assertBudget(endpoint: string): void {
    const cost = CREDITS[endpoint] ?? 1;
    if (this.budgetUsed + cost > this.maxCredits) throw new BudgetError(endpoint, this.budgetUsed, cost, this.maxCredits);
    this.budgetUsed += cost;
  }

  /** POST `endpoint` with a JSON body; one retry on 429/5xx/timeout unless `retries: 0`; records the call. */
  async post<T = unknown>(endpoint: string, body: Record<string, unknown>, fieldsUsed: string[] = [], opts: CallOptions = {}): Promise<T> {
    const t0 = Date.now();
    const id = this.nextCallId();
    this.notify({ phase: "start", id, endpoint, body });
    try {
      const { text, ms, status, attempts, totalMs } = await this.postRaw(endpoint, body, opts);
      this.record(id, {
        endpoint,
        body,
        credits: CREDITS[endpoint] ?? 1,
        ms,
        cached: false,
        status,
        fieldsUsed,
        responseHash: sha256(text),
        attempts,
        totalMs,
        ok: true,
      });
      return JSON.parse(text) as T;
    } catch (e) {
      this.recordFailure(id, endpoint, body, fieldsUsed, e, Date.now() - t0);
      throw e;
    }
  }

  /** A call that failed every attempt still appears in provenance — a hidden 12 s timeout is a recording risk, not a detail. */
  protected recordFailure(id: number, endpoint: string, body: Record<string, unknown>, fieldsUsed: string[], e: unknown, totalMs: number) {
    const status = e instanceof NansenError ? e.status : 0;
    const error = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message.slice(0, 120)) : String(e);
    const attempts = (e as { attempts?: number })?.attempts ?? 1;
    this.record(id, { endpoint, body, credits: 0, ms: 0, cached: false, status, fieldsUsed, responseHash: "", attempts, totalMs, ok: false, error });
  }

  /** The network call itself, returning the raw body so callers (and the cache) hash exactly what Nansen sent. */
  protected async postRaw(
    endpoint: string,
    body: Record<string, unknown>,
    opts: CallOptions = {},
  ): Promise<{ text: string; ms: number; status: number; attempts: number; totalMs: number }> {
    this.assertBudget(endpoint);
    try {
      return await this.attempt(endpoint, body, opts);
    } catch (e) {
      this.budgetUsed -= CREDITS[endpoint] ?? 1; // a failed call is not billed (recordFailure stores it at 0 credits)
      throw e;
    }
  }

  private async attempt(
    endpoint: string,
    body: Record<string, unknown>,
    opts: CallOptions,
  ): Promise<{ text: string; ms: number; status: number; attempts: number; totalMs: number }> {
    const url = `${this.baseUrl}/${endpoint}`;
    const t0 = Date.now();
    const maxAttempts = 1 + (opts.retries ?? 1);
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    let lastErr: unknown;
    let attemptsMade = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attemptsMade = attempt + 1;
      await this.limiter.take();
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: { apikey: this.apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const text = await res.text();
        const ms = Date.now() - started;
        if (res.status === 429 || res.status >= 500) {
          lastErr = new NansenError(endpoint, res.status, text);
          if (attempt < maxAttempts - 1) {
            await new Promise((r) => setTimeout(r, 750));
            continue;
          }
          throw lastErr;
        }
        if (!res.ok) throw new NansenError(endpoint, res.status, text);
        return { text, ms, status: res.status, attempts: attempt + 1, totalMs: Date.now() - t0 };
      } catch (e) {
        lastErr = e;
        if (attempt === maxAttempts - 1 || !(e instanceof Error && e.name === "AbortError")) throw withAttempts(e, attemptsMade);
      } finally {
        clearTimeout(timer);
      }
    }
    throw withAttempts(lastErr, attemptsMade);
  }

  /** The client's default per-call timeout; engines derive their per-call overrides from it so tests can shrink it. */
  get defaultTimeoutMs(): number {
    return this.timeoutMs;
  }

  /** Credits spent through this client so far (from the static cost table; failed calls count 0). */
  get creditsSpent(): number {
    return this.calls.reduce((n, c) => n + c.credits, 0);
  }
}

/** Load the key from the environment; `source ~/.config/nansen/meridian.env` first. */
export function clientFromEnv(opts?: ClientOptions): NansenClient {
  const key = process.env.NANSEN_API_KEY ?? "";
  return new NansenClient(key, opts);
}
