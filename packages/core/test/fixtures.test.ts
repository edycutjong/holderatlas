import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureName, writeFixture, readFixture, listFixtures, fixtureStore, type Fixture } from "../src/fixtures.js";
import type { Chain } from "../src/nansen.js";

function fixture(input: string, chain: Chain = "ethereum"): Fixture {
  return {
    edge: "unit test",
    input,
    options: { chain, holders: 100, custody: [] as never },
    now: Date.parse("2026-09-18T12:00:00Z"),
    recordedAt: "2026-09-18T12:00:00Z",
    live: { calls: 1, credits: 5, ms: 12 },
    responses: { k1: { storedAt: "2026-09-18T12:00:00Z", ttlMs: 1000, endpoint: "tgm/holders", body: {}, text: "{}" } },
    atlas: {} as never,
  };
}

describe("fixtureName", () => {
  it("uppercases, truncates to 24 chars and strips non [A-Z0-9_-] characters", () => {
    expect(fixtureName("pepe")).toBe("PEPE");
    expect(fixtureName("pepe", "ethereum")).toBe("PEPE--ethereum");
    expect(fixtureName("a very long token name that overruns")).toBe("A_VERY_LONG_TOKEN_NAME_T");
    expect(fixtureName("0x!!weird$$")).toBe("0X__WEIRD__");
  });
});

describe("writeFixture / readFixture round-trip", () => {
  it("writes JSON under fixtureName(input, chain).json and reads it back byte-for-byte", () => {
    const dir = mkdtempSync(join(tmpdir(), "holderatlas-fixtures-"));
    try {
      const f = fixture("PEPE");
      const path = writeFixture(f, dir);
      expect(path).toBe(join(dir, "PEPE--ethereum.json"));
      expect(readFixture(path)).toEqual(f);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("creates the directory if it does not exist yet", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "holderatlas-fixtures-")), "nested", "deeper");
    try {
      const path = writeFixture(fixture("MEW"), dir);
      expect(readFixture(path).input).toBe("MEW");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("listFixtures", () => {
  it("returns every .json file in the directory, sorted, skipping other files", () => {
    const dir = mkdtempSync(join(tmpdir(), "holderatlas-fixtures-"));
    try {
      writeFixture(fixture("MEW"), dir);
      writeFixture(fixture("PEPE"), dir);
      writeFixture(fixture("PEPE", "solana"), dir);
      const list = listFixtures(dir);
      expect(list).toEqual([join(dir, "MEW--ethereum.json"), join(dir, "PEPE--ethereum.json"), join(dir, "PEPE--solana.json")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("returns an empty array when the directory does not exist (never throws)", () => {
    expect(listFixtures(join(tmpdir(), "holderatlas-fixtures-does-not-exist-" + Date.now()))).toEqual([]);
  });
});

describe("fixtureStore", () => {
  it("pre-loads a MemoryCache with every recorded response, keyed the same way", () => {
    const f = fixture("PEPE");
    const store = fixtureStore(f);
    expect(store.get("k1")).toEqual(f.responses.k1);
    expect(store.get("missing")).toBeUndefined();
  });
});
