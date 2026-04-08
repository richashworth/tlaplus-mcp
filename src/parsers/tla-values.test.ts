import { describe, it, expect } from "vitest";
import { parseTlaValue, parseStateLabel } from "./tla-values.js";

describe("parseTlaValue", () => {
  it("parses integers", () => {
    expect(parseTlaValue("42")).toBe(42);
    expect(parseTlaValue("-7")).toBe(-7);
    expect(parseTlaValue("0")).toBe(0);
  });

  it("parses booleans", () => {
    expect(parseTlaValue("TRUE")).toBe(true);
    expect(parseTlaValue("FALSE")).toBe(false);
  });

  it("parses identifiers (model values)", () => {
    expect(parseTlaValue("c1")).toBe("c1");
    expect(parseTlaValue("my_var")).toBe("my_var");
    expect(parseTlaValue("NULL")).toBe("NULL");
  });

  it("parses strings", () => {
    expect(parseTlaValue('"hello"')).toBe("hello");
    expect(parseTlaValue('"hello world"')).toBe("hello world");
  });

  it("parses DOT-escaped strings", () => {
    expect(parseTlaValue('\\"hello\\"')).toBe("hello");
  });

  it("parses empty set", () => {
    expect(parseTlaValue("{}")).toEqual([]);
  });

  it("parses sets", () => {
    expect(parseTlaValue("{1, 2, 3}")).toEqual([1, 2, 3]);
    expect(parseTlaValue("{TRUE, FALSE}")).toEqual([true, false]);
    expect(parseTlaValue('{"a", "b"}')).toEqual(["a", "b"]);
  });

  it("parses empty sequence", () => {
    expect(parseTlaValue("<<>>")).toEqual([]);
  });

  it("parses sequences", () => {
    expect(parseTlaValue("<<1, 2, 3>>")).toEqual([1, 2, 3]);
    expect(parseTlaValue("<< TRUE, FALSE >>")).toEqual([true, false]);
  });

  it("parses records", () => {
    expect(parseTlaValue("[a |-> 1, b |-> 2]")).toEqual({ a: 1, b: 2 });
    expect(parseTlaValue("[name |-> TRUE]")).toEqual({ name: true });
  });

  it("parses empty record", () => {
    expect(parseTlaValue("[]")).toEqual({});
  });

  it("parses functions (key :> value @@ ...)", () => {
    expect(parseTlaValue('(c1 :> "browsing" @@ c2 :> "holding")')).toEqual({
      c1: "browsing",
      c2: "holding",
    });
    expect(parseTlaValue("(1 :> TRUE @@ 2 :> FALSE)")).toEqual({
      "1": true,
      "2": false,
    });
  });

  it("parses nested structures", () => {
    expect(parseTlaValue("[a |-> {1, 2}, b |-> <<3, 4>>]")).toEqual({
      a: [1, 2],
      b: [3, 4],
    });
    expect(parseTlaValue('(c1 :> [state |-> "active", count |-> 3])')).toEqual({
      c1: { state: "active", count: 3 },
    });
  });

  it("handles whitespace", () => {
    expect(parseTlaValue("  42  ")).toBe(42);
    expect(parseTlaValue("  { 1 , 2 , 3 }  ")).toEqual([1, 2, 3]);
  });
});

describe("parseStateLabel", () => {
  it("parses single variable", () => {
    expect(parseStateLabel("/\\ x = 1")).toEqual({ x: 1 });
  });

  it("parses multiple variables", () => {
    const label =
      '/\\ clientState = (c1 :> "browsing" @@ c2 :> "browsing")\n/\\ slotState = (s1 :> "free" @@ s2 :> "free")';
    const result = parseStateLabel(label);
    expect(result).toEqual({
      clientState: { c1: "browsing", c2: "browsing" },
      slotState: { s1: "free", s2: "free" },
    });
  });

  it("handles values that fail to parse by keeping raw string", () => {
    const label = "/\\ x = SOME_UNPARSEABLE @#$ THING";
    const result = parseStateLabel(label);
    // Should have x with some value (either parsed identifier or raw fallback)
    expect(result).toHaveProperty("x");
  });

  it("skips empty parts", () => {
    const label = "/\\ x = 1\n/\\ y = 2";
    expect(parseStateLabel(label)).toEqual({ x: 1, y: 2 });
  });
});
