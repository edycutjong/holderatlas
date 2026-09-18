# Security Policy

## Supported Versions
| Version | Supported |
|---|---|
| latest (`main`) | ✅ |

## The concrete claim — and the test that backs it
**The server-side Nansen API key never reaches a client, and malformed input is rejected before any network call.**

This is asserted, not described, in `packages/core/test/boundary.test.ts` and repeated over the wire in CI Stage 4
(`.github/workflows/ci.yml`, the built app probed with no key):

- a full atlas, every NDJSON stream event, the provenance log and the cache keys contain nothing key-shaped (`nsn_…`);
- the cached client stores responses under content-addressed keys, so a shared cache directory never holds the key;
- a Nansen HTTP error surfaces the endpoint and status, never request headers;
- a missing or malformed key is refused at client construction;
- `/api/atlas` returns **400** for every string that fails `SAFE_QUERY` — 7 named cases plus **10,000 generated
  queries** (fast-check) — with **zero** `fetch` calls, and an honest **500** naming `NANSEN_API_KEY` when the server has
  no key (again zero fetches);
- the page, `/judge`, a permalink and the OG image route are fetched from the built app in CI with no key (200), `/api/atlas`
  answers 500 without a key and 400 to garbage, and the server log is asserted to contain no `nsn_` string.

**The key cannot be drained through the public route** (`apps/web/lib/guard.ts`, `packages/core/test/guard.test.ts`):
only a request carrying the page's run marker (`x-atlas-run: 1`) may trigger Nansen calls — a bare GET (link unfurlers,
crawlers, link checkers, `curl`) gets the labelled fixture replay for a recorded token or a **202** "open the page" for any
other, with zero fetches;
4 atlases per minute per address (**429** + `Retry-After`), 3,000 live credits per UTC day counted from each atlas's
own provenance, and past that ceiling a query with a recorded fixture replays offline at 0 credits — labelled in
`warnings` and `degraded: true` — while one without gets a **503** that says why. Counters are per instance: a
ceiling, not accounting. Both limits are tunable with `GUARD_IP_PER_MIN` / `GUARD_DAILY_CREDITS`.

Secrets live in the environment only (`.env` is git-ignored; `.env.example` holds the names). `gitleaks` scans the
full history on every push; TruffleHog runs in Stage 2 of CI; `npm run check` greps the entire git history for
`nsn_` keys and fails on any hit.

## Reporting a Vulnerability
Please **do not** open a public issue for security vulnerabilities. Instead, report them privately:

- Email **edy.cu@live.com**, or
- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security → Report a vulnerability).

You'll get an acknowledgment within 48 hours and a resolution timeline after
triage. Please give us a reasonable window to patch before public disclosure.
