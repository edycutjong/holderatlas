/**
 * Submission readiness: the repo a judge clones must have no placeholders, a README whose claims match the tree
 * (test count, fixture count), every mandatory file, and no kitchen file or secret anywhere in history. Exit 1 on any failure.
 *
 *   npm run check
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fails: string[] = [];
const ok = (cond: unknown, msg: string) => {
  if (!cond) fails.push(msg);
  else console.log(`✔ ${msg}`);
};
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

const MUST = [
  "README.md",
  "DEMO.md",
  "ARCHITECTURE.md",
  "JUDGE.md",
  "LICENSE",
  ".env.example",
  "docs/SCORING.md",
  "docs/BENCH.md",
  "docs/DX-REPORT.md",
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/gitleaks.yml",
  ".github/workflows/release.yml",
  ".github/dependabot.yml",
  ".github/SECURITY.md",
  ".github/CONTRIBUTING.md",
  ".github/CODE_OF_CONDUCT.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
  "scripts/seed.ts",
  "scripts/verify.ts",
  "scripts/bench.ts",
  "scripts/release.mjs",
  "scripts/bump-version.mjs",
  "packages/core/src/atlas.ts",
  "packages/core/src/exchanges.json",
  "packages/core/test/property.test.ts",
  "packages/core/test/boundary.test.ts",
  "packages/core/test/guard.test.ts",
  "packages/cli/src/cli.ts",
  "apps/web/app/page.tsx",
  "apps/web/app/judge/page.tsx",
  "apps/web/app/api/atlas/route.ts",
  "apps/web/app/api/og/route.tsx",
  "apps/web/lib/guard.ts",
  "docs/assets/icon.svg",
  "docs/assets/icon-animated.svg",
  "docs/assets/readme-hero-animated.svg",
];
for (const f of MUST) ok(existsSync(f), `exists: ${f}`);

const readme = read("README.md");
for (const bad of ["TODO", "TBD", "lorem", "xxx", "PLACEHOLDER", "<your", "coming soon"]) ok(!new RegExp(bad, "i").test(readme), `README has no "${bad}"`);
for (const section of ["Run it in under 10 minutes", "Nansen Integration", "Honesty", "Why only Nansen", "Honest limits"])
  ok(readme.includes(section), `README section: ${section}`);

const claimed = Number((readme.match(/tests-(\d+)%20passing/) ?? [])[1] ?? 0);
const report = join(tmpdir(), `holderatlas-vitest-${process.pid}.json`);
execSync(`npx vitest run --reporter=json --outputFile=${report}`, { stdio: "ignore" });
const vitest = JSON.parse(readFileSync(report, "utf8")) as { numTotalTests: number; numPassedTests: number };
const actual = vitest.numTotalTests;
ok(actual > 0 && vitest.numPassedTests === actual, `all ${actual} tests pass`);
ok(claimed === actual, `README claims ${claimed} tests; vitest runs ${actual}`);
ok(readme.includes(`**${actual} tests**`), `README prose states ${actual} tests`);
ok(read("JUDGE.md").includes(`**${actual} tests**`), `JUDGE.md states ${actual} tests`);
ok(read("apps/web/app/judge/page.tsx").includes(`TEST_COUNT = ${actual};`), `/judge page states ${actual} tests`);

const fixtures = readdirSync("fixtures").filter((f) => f.endsWith(".json")).length;
ok(readme.includes(`${fixtures}%2F${fixtures}`), `README badge says ${fixtures}/${fixtures} fixtures`);
const table = JSON.parse(read("packages/core/src/exchanges.json")) as { exchanges: Record<string, unknown> };
const rows = Object.keys(table.exchanges).length;
ok(readme.includes(`(${rows} exchanges)`), `README states the table size (${rows})`);

// kitchen and secrets never in the tree that is committed
const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n");
for (const bad of ["CLAUDE.md", "AGENTS.md", ".claude/", "specs/", "PROGRESS.md", "DEVIATIONS.md", "project.json", ".env", ".cache/", ".vercel/"])
  ok(!tracked.filter((f) => f !== ".env.example").some((f) => f === bad || f.startsWith(bad) || f.includes(`/${bad}`)), `not tracked: ${bad}`);
const leaks = execSync("git log -p --all | grep -c 'nsn_[A-Za-z0-9]\\{20,\\}' || true", { encoding: "utf8" }).trim();
ok(leaks === "0", `no API key in git history (${leaks} hits)`);
for (const f of readdirSync("fixtures")) ok(!/nsn_[A-Za-z0-9]{20,}/.test(read(`fixtures/${f}`)), `fixture clean: ${f}`);

for (const m of readme.matchAll(/docs\/screenshots\/([\w.-]+)/g)) ok(existsSync(`docs/screenshots/${m[1]}`), `screenshot: ${m[1]}`);

if (process.env.CHECK_LINKS === "1") {
  const links = [...new Set([...readme.matchAll(/\]\((https?:[^)\s]+)\)/g)].map((m) => m[1]))];
  for (const url of links) {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow" });
      ok(res.status < 400, `link ${res.status}: ${url}`);
    } catch (e) {
      fails.push(`link failed: ${url} (${(e as Error).message})`);
    }
  }
}

console.log(
  fails.length
    ? `\n✖ ${fails.length} problem(s):\n${fails.map((f) => `  - ${f}`).join("\n")}`
    : `\nready: ${MUST.length} files, ${actual} tests, ${fixtures} fixtures, ${rows} exchanges, history clean`,
);
process.exit(fails.length ? 1 : 0);
