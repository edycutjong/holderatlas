// release.mjs [--dry-run] — the release.yml algorithm, run locally (GitHub Actions is billing-blocked on this account).
//   last v* tag → Conventional Commits since it: "!" / BREAKING CHANGE → major · feat → minor · fix/perf → patch · else no release
//   → bump every package.json + package-lock.json (scripts/bump-version.mjs) → `npm ci --ignore-scripts` proves the lockfile
//   → commit "chore(release): vX.Y.Z [skip ci]" → annotated tag → push main + tag → `gh release create vX.Y.Z --generate-notes`.
// No dependencies. Refuses to run on a dirty tree or off main. `--dry-run` prints the decision and touches nothing.
import { execFileSync } from "node:child_process";
import process from "node:process";

const dry = process.argv.includes("--dry-run");
const sh = (cmd, args, opts = {}) => (execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }) ?? "").trim();
const git = (...args) => sh("git", args);
const fail = (msg) => {
  process.stderr.write(`release: ${msg}\n`);
  process.exit(1);
};

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") fail(`on ${branch}, releases are cut from main`);
if (!dry && git("status", "--porcelain") !== "") fail("working tree is not clean");

const last = (() => {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*");
  } catch {
    return "";
  }
})();
const range = last ? `${last}..HEAD` : "HEAD";
const cur = last ? last.slice(1) : "0.0.0";
const log = git("log", "--format=%B", range);
if (log.replace(/\s/g, "") === "") {
  process.stdout.write(`No commits since ${last || "the beginning"}.\n`);
  process.exit(0);
}
let bump = "none";
if (/^[a-z]+(\(.+\))?!:|^BREAKING CHANGE:/m.test(log)) bump = "major";
else if (/^feat(\(.+\))?:/m.test(log)) bump = "minor";
else if (/^(fix|perf)(\(.+\))?:/m.test(log)) bump = "patch";
if (bump === "none") {
  process.stdout.write(`No releasable commits since ${last || "the beginning"}.\n`);
  process.exit(0);
}
let [ma, mi, pa] = cur.split(".").map(Number);
if (bump === "major") [ma, mi, pa] = [ma + 1, 0, 0];
else if (bump === "minor") [mi, pa] = [mi + 1, 0];
else pa += 1;
const next = `v${ma}.${mi}.${pa}`;
process.stdout.write(`Bump: ${bump}  ${last || "none"} -> ${next}\n`);
if (dry) {
  process.stdout.write(git("log", "--format=%h %s", range).replace(/^/gm, "  ") + "\n(dry run — nothing changed)\n");
  process.exit(0);
}

sh("node", ["scripts/bump-version.mjs", next.slice(1)], { stdio: "inherit" });
sh("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { stdio: ["ignore", "ignore", "inherit"] }); // proves the lockfile still satisfies npm ci
process.stdout.write(git("diff", "--stat", "--", "package.json", "package-lock.json", "apps/*/package.json", "packages/*/package.json") + "\n");
git("add", "-A");
git("commit", "-q", "-m", `chore(release): ${next} [skip ci]`);
git("tag", "-a", next, "-m", next);
git("push", "-q", "origin", "HEAD:main");
git("push", "-q", "origin", next);
sh("gh", ["release", "create", next, "--generate-notes", "--title", next], { stdio: "inherit" });
process.stdout.write(`Released ${next} (${bump})\n`);
