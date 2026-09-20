import { describe, it, expect } from "vitest";
import { nansen } from "../src/nansen.js";
import { fakeClient } from "./helpers.js";

describe("parse() — schema validation on every Nansen response", () => {
  it("throws a descriptive error when the live shape does not match the schema, instead of returning garbage", async () => {
    const c = fakeClient(() => ({ tokens: [{ address: 12345 }] })); // address must be a string
    await expect(nansen.search(c, "PEPE")).rejects.toThrow(/Nansen search\/general: unexpected response shape/);
  });
});
