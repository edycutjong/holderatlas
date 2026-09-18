# Contributing

Thanks for your interest in improving Holder Atlas! 🎉

## Getting Started
1. Fork the repo and branch from `main`: `git checkout -b feat/your-feature`
2. Install dependencies: `npm install` (npm workspaces: `packages/core`, `packages/cli`, `apps/web`)
3. Copy the env template: `cp .env.example .env` and paste your Nansen key (https://app.nansen.ai/api)
4. Try the CLI: `npm run holderatlas -- PEPE --explain` (≤ 26 credits) · web: `npm run dev` → http://localhost:3000

## Before You Open a PR
- `npm run ci` passes — audit, prettier, eslint, tsc, vitest with coverage, `verify` (12 fixtures replay offline), `check` (README claims vs tree).
- `npm run e2e` passes (Playwright, runs the built app with **no** key — never add a test that spends credits).
- Add or update tests for any behavior change. Regression tests are **named after the defect they pin**
  (`"F3: a candidate whose flow lookup failed is UNCHECKED — never crowned"`), not `test_3`.
- Anything that changes `score()`, `rank()` or the crown rule must keep `packages/core/test/property.test.ts` green and
  `npm run verify` at 12/12 — if a fixture legitimately changes, re-seed it with `npm run seed` and say so in the PR.
- Keep commits conventional: `feat:` (minor), `fix:`/`perf:` (patch), `docs:`, `test:`, `ci:`, `chore:` (no release).
  `release.yml` tags and publishes from these prefixes automatically.

## Credits are the constraint
Every live Nansen call costs credits (table in `packages/core/src/client.ts`). Cached calls are free and labelled.
Never add a call to a 100-credit endpoint; never put `NANSEN_OFFLINE=1` into a reproduce command.

## Reporting Bugs / Requesting Features
Open an issue using the provided templates. Include the ticker, the chain filter, the atlas hash from the drawer,
and the expected vs. actual card states.
