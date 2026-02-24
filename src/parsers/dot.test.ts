import { describe, it, expect } from "vitest";
import { parseDot } from "./dot.js";

const SAMPLE_DOT = `digraph StateGraph {
1 [label="/\\\\ x = 1\\n/\\\\ y = \\"hello\\"" style = filled]
2 [label="/\\\\ x = 2\\n/\\\\ y = \\"world\\""]
3 [label="/\\\\ x = 3\\n/\\\\ y = \\"done\\""]
1 -> 2 [label="Next"]
2 -> 3 [label="Next"]
3 -> 1 [label="Reset"]
}`;

describe("parseDot", () => {
  it("parses nodes and edges", () => {
    const result = parseDot(SAMPLE_DOT);
    expect(Object.keys(result.states)).toHaveLength(3);
    expect(result.edges).toHaveLength(3);
  });

  it("detects initial state by style=filled", () => {
    const result = parseDot(SAMPLE_DOT);
    expect(result.initialStateId).toBe("1");
  });

  it("parses state variables", () => {
    const result = parseDot(SAMPLE_DOT);
    expect(result.states["1"].vars).toHaveProperty("x", 1);
    expect(result.states["1"].vars).toHaveProperty("y", "hello");
  });

  it("parses edge actions", () => {
    const result = parseDot(SAMPLE_DOT);
    expect(result.edges[0]).toEqual({
      source: "1",
      target: "2",
      action: "Next",
    });
  });

  it("unescapes DOT sequences in labels", () => {
    const result = parseDot(SAMPLE_DOT);
    // The label should have real newlines (from \\n in DOT)
    expect(result.states["1"].label).toContain("\n");
  });

  it("falls back to lowest ID when no filled style", () => {
    const dot = `digraph StateGraph {
3 [label="/\\\\ x = 3"]
1 [label="/\\\\ x = 1"]
2 [label="/\\\\ x = 2"]
1 -> 2 [label="A"]
}`;
    const result = parseDot(dot);
    expect(result.initialStateId).toBe("1");
  });

  it("throws on empty DOT", () => {
    expect(() => parseDot("digraph {}")).toThrow("Could not parse any states");
  });
});
