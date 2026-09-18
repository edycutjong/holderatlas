/**
 * Replay every fixture OFFLINE and prove the engine is deterministic: same responses + same clock → same atlas hash,
 * same countries, same number, zero network calls, zero credits. Exit 1 on any mismatch.
 *
 *   npm run verify                # NANSEN_OFFLINE is forced; no API key needed
 */
import { CachedNansenClient, atlas, listFixtures, readFixture, fixtureStore, AtlasError, type Atlas } from "../packages/core/src/index.js";

process.env.NANSEN_OFFLINE = "1";
const files = listFixtures();
if (files.length === 0) {
  console.error("no fixtures/ — run `npm run seed` first");
  process.exit(1);
}

/** The parts of an atlas a replay must reproduce exactly. Cost, timing and cache metadata are excluded by design. */
function projection(a: Atlas) {
  return {
    hash: a.hash,
    token: a.token ? `${a.token.chain}:${a.token.address}` : null,
    attributable: Number(a.attributable?.toFixed(6)),
    byWallets: Number(a.attributableByWallets?.toFixed(6)),
    countries: a.countries?.map((c) => [c.code, Number(c.share.toFixed(6)), c.wallets, c.exchanges]),
    global: a.global && [Number(a.global.share.toFixed(6)), a.global.wallets],
    untraced: a.untraced && [Number(a.untraced.share.toFixed(6)), a.untraced.wallets],
    unnamed: a.unnamed && [Number(a.unnamed.share.toFixed(6)), a.unnamed.wallets],
    examined: a.examined,
    rows: a.rows?.map((r) => [r.address, r.kind, r.exchange, r.country, r.bucket, r.via]),
    warnings: a.warnings,
  };
}

let ok = 0;
const failures: string[] = [];
for (const path of files) {
  const f = readFixture(path);
  const client = new CachedNansenClient("nsn_offline_replay_000000000000000", { store: fixtureStore(f), offline: true });
  const problems: string[] = [];
  let replay: Atlas | undefined;
  const recordedError = (f.atlas as unknown as { error?: { code: string } }).error;
  try {
    replay = await atlas(client, f.input, { ...f.options, now: f.now });
    if (recordedError) problems.push(`recorded as ${recordedError.code} but the replay produced an atlas`);
  } catch (e) {
    if (e instanceof AtlasError && recordedError?.code === e.code) replay = { ...(f.atlas as Atlas), calls: client.calls, credits: client.creditsSpent };
    else problems.push(`threw: ${(e as Error).message.slice(0, 120)}`);
  }

  if (replay) {
    const want = JSON.stringify(projection(f.atlas)),
      got = JSON.stringify(projection(replay));
    if (replay.hash !== f.atlas.hash) problems.push(`hash ${replay.hash} ≠ recorded ${f.atlas.hash}`);
    if (want !== got) problems.push("countries/rows differ from the recorded atlas");
    const network = replay.calls.filter((c) => !c.cached);
    if (network.length) problems.push(`${network.length} call(s) left the cache: ${network.map((c) => `${c.endpoint}${c.ok ? "" : " (failed)"}`).join(", ")}`);
    if (replay.credits !== 0) problems.push(`${replay.credits} credits spent on a replay`);
    const recordedHashes = new Set(f.atlas.calls.filter((c) => c.ok).map((c) => c.responseHash));
    for (const c of replay.calls) if (c.ok && !recordedHashes.has(c.responseHash)) problems.push(`${c.endpoint} served a response the live run never saw`);
  }

  const label = `${f.input.slice(0, 14)}${f.options.chain ? ` --chain ${f.options.chain}` : ""}`.padEnd(32);
  if (problems.length === 0) {
    ok++;
    const out = recordedError ? `no-token ✔` : `${(replay!.attributable * 100).toFixed(1)}% · ${replay!.countries.map((c) => c.code).join(" ") || "—"}`;
    console.log(
      `✔ ${label} ${replay!.hash.padEnd(14)} ${String(replay!.calls.length).padStart(3)} calls replayed · ${out} · recorded ${f.recordedAt.slice(0, 16)}Z · ${f.edge}`,
    );
  } else {
    failures.push(path);
    console.log(`✖ ${label} ${problems.join("; ")}`);
  }
}
console.log(`\n${ok}/${files.length} atlases reproduced offline`);
if (failures.length) process.exit(1);
