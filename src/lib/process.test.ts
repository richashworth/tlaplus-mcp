import { describe, it, expect } from "vitest";
import { sanitizeExtraArgs } from "./process.js";

describe("sanitizeExtraArgs", () => {
  it("passes safe args through unchanged", () => {
    const args = ["-workers", "4", "-difftrace"];
    expect(sanitizeExtraArgs(args)).toEqual(args);
  });

  it("returns empty array for empty input", () => {
    expect(sanitizeExtraArgs([])).toEqual([]);
  });

  it("blocks -dump", () => {
    expect(() => sanitizeExtraArgs(["-dump"])).toThrow(/not allowed/);
  });

  it("blocks -metadir", () => {
    expect(() => sanitizeExtraArgs(["-metadir"])).toThrow(/not allowed/);
  });

  it("blocks -userFile", () => {
    expect(() => sanitizeExtraArgs(["-userFile"])).toThrow(/not allowed/);
  });

  it("blocks -tlafile", () => {
    expect(() => sanitizeExtraArgs(["-tlafile"])).toThrow(/not allowed/);
  });

  it("blocks case-insensitively", () => {
    expect(() => sanitizeExtraArgs(["-DUMP"])).toThrow(/not allowed/);
    expect(() => sanitizeExtraArgs(["-Dump"])).toThrow(/not allowed/);
  });

  it("includes the flag name in the error message", () => {
    expect(() => sanitizeExtraArgs(["-dump"])).toThrow('"-dump"');
  });
});
