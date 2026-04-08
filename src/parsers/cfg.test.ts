import { describe, it, expect } from "vitest";
import { parseCfg } from "./cfg.js";

describe("parseCfg", () => {
  it("parses single-line INVARIANT", () => {
    const result = parseCfg("INVARIANT TypeOK\n");
    expect(result.invariants).toEqual(["TypeOK"]);
    expect(result.properties).toEqual([]);
  });

  it("parses multiple invariants on one line", () => {
    const result = parseCfg("INVARIANT TypeOK NoDoubleBooking\n");
    expect(result.invariants).toEqual(["TypeOK", "NoDoubleBooking"]);
  });

  it("parses INVARIANTS keyword", () => {
    const result = parseCfg("INVARIANTS TypeOK Safety\n");
    expect(result.invariants).toEqual(["TypeOK", "Safety"]);
  });

  it("parses multi-line invariants", () => {
    const cfg = `INVARIANTS
  TypeOK
  NoDoubleBooking
  NoHoarding
`;
    const result = parseCfg(cfg);
    expect(result.invariants).toEqual([
      "TypeOK",
      "NoDoubleBooking",
      "NoHoarding",
    ]);
  });

  it("parses PROPERTY", () => {
    const result = parseCfg("PROPERTY Liveness\n");
    expect(result.properties).toEqual(["Liveness"]);
  });

  it("parses PROPERTIES", () => {
    const cfg = `PROPERTIES
  EventuallyDone
  AlwaysResponds
`;
    const result = parseCfg(cfg);
    expect(result.properties).toEqual(["EventuallyDone", "AlwaysResponds"]);
  });

  it("parses mixed invariants and properties", () => {
    const cfg = `SPECIFICATION Spec
INVARIANT TypeOK
PROPERTY Liveness
`;
    const result = parseCfg(cfg);
    expect(result.invariants).toEqual(["TypeOK"]);
    expect(result.properties).toEqual(["Liveness"]);
  });

  it("stops multi-line on other keyword", () => {
    const cfg = `INVARIANTS
  TypeOK
SPECIFICATION Spec
PROPERTY Liveness
`;
    const result = parseCfg(cfg);
    expect(result.invariants).toEqual(["TypeOK"]);
    expect(result.properties).toEqual(["Liveness"]);
  });

  it("ignores comments", () => {
    const cfg = `\\* This is a comment
INVARIANT TypeOK
`;
    const result = parseCfg(cfg);
    expect(result.invariants).toEqual(["TypeOK"]);
  });

  it("handles empty input", () => {
    const result = parseCfg("");
    expect(result.invariants).toEqual([]);
    expect(result.properties).toEqual([]);
  });

  it("handles bare INVARIANT keyword with no following names inline", () => {
    const cfg = `INVARIANT
  TypeOK
  Safety
`;
    const result = parseCfg(cfg);
    expect(result.invariants).toEqual(["TypeOK", "Safety"]);
  });
});
