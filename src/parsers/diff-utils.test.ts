import { describe, it, expect } from "vitest";
import { short, compactDiff } from "./diff-utils.js";

describe("short", () => {
  it("returns strings as-is", () => {
    expect(short("hello")).toBe("hello");
  });

  it("serializes objects with JSON.stringify", () => {
    expect(short({ a: 1 })).toBe('{"a":1}');
  });

  it("serializes arrays with JSON.stringify", () => {
    expect(short([1, 2, 3])).toBe("[1,2,3]");
  });

  it("serializes numbers", () => {
    expect(short(42)).toBe("42");
  });

  it("serializes booleans", () => {
    expect(short(true)).toBe("true");
  });

  it("serializes null", () => {
    expect(short(null)).toBe("null");
  });

  it("truncates long JSON to 50 chars with ellipsis", () => {
    const long = { key: "a".repeat(60) };
    const result = short(long);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
  });

  it("does not truncate JSON at exactly 50 chars", () => {
    // Build an object whose JSON is exactly 50 chars
    // {"x":"<44 a's>"} = 1+3+1+1+44+1+1 = wait, let's just test <= 50
    const obj = { k: "a".repeat(42) };
    const json = JSON.stringify(obj);
    expect(json.length).toBeLessThanOrEqual(50);
    expect(short(obj)).toBe(json);
  });
});

describe("compactDiff", () => {
  it("returns diffs for changed variables", () => {
    const src = { x: "1", y: "hello" };
    const tgt = { x: "2", y: "hello" };
    const diffs = compactDiff(src, tgt);
    expect(diffs).toEqual([["x", "1", "2"]]);
  });

  it("returns empty array when no changes", () => {
    const vars = { x: "1", y: "2" };
    expect(compactDiff(vars, vars)).toEqual([]);
  });

  it("detects variables that appear only in the target state", () => {
    const src = { x: "1" };
    const tgt = { x: "1", y: "new_val" };
    const diffs = compactDiff(src, tgt);
    expect(diffs).toEqual([["y", "(absent)", "new_val"]]);
  });
});
