# Contributing

Thanks for your interest in improving Holder Atlas! 🎉

## Getting Started
1. Fork the repo and branch from `main`: `git checkout -b feat/your-feature`
2. Install dependencies: `npm install` (npm workspaces: `packages/core`, `packages/cli`, `apps/web`)
3. Copy the env template: `cp .env.example .env` and paste your Nansen key (https://app.nansen.ai/api)
4. Try the CLI: `npm run holderatlas -- PEPE --chain ethereum --explain` (~120 credits cold, 0 warm) · web: `npm run dev` → http://localhost:3000
5. Free path first: `npm run verify` replays the 12 recorded atlases offline — no key, no credits.

## Before You Open a PR
- `npm run ci` passes — prettier, eslint, tsc, vitest with coverage, `verify` (12 fixtures replay offline), `check` (README claims vs tree, kitchen/secret scan).
- Add or update tests for any behavior change. Regression tests are **named after the defect they pin**
  (`"audit 2026-09-19: examined counts the rows in the denominator — a reclassified contract is not 'analysed' in the caption"`), not `test_3`.
- Anything that changes `partition()`, `exchangeLabelFor()`, `aggregate()` or `atlasHash()` must keep
  `packages/core/test/property.test.ts` green and `npm run verify` at 12/12 — if a fixture legitimately changes, re-seed it with
  `npm run seed -- <TOKEN>` (live credits — say how many in the PR) and never edit a recorded response by hand.
- A new exchange goes into `packages/core/src/exchanges.json` with a `source` (regulator licence, HQ, or dominant-market evidence)
  and a test in `labels.test.ts` pinning the exact Nansen label string to its key. Global exchanges are `"global"`, never a country.
- Keep commits conventional: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`.

## Credits are the constraint
Every live Nansen call costs credits (table in `packages/core/src/client.ts`). Cached calls are free and labelled.
Never add a call to a 100-credit endpoint; never put `NANSEN_OFFLINE=1` into a reproduce command; scripts that should be free
(`seed --reuse-cache`) run under a credit ceiling (`--max-credits`) so a cold cache aborts instead of re-billing the set.

## Reporting Bugs / Requesting Features
Open an issue using the provided templates. Include the ticker, the chain, the atlas hash from the provenance drawer
(or the last line of the CLI output), and the expected vs. actual placement.
