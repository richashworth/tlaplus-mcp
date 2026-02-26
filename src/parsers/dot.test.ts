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

  it("parses negative fingerprint node IDs (real TLC output)", () => {
    const dot = `digraph StateGraph {
8557055779591771203 [label="/\\\\ x = 1" style = filled]
-5088583475362684799 [label="/\\\\ x = 2"]
8557055779591771203 -> -5088583475362684799 [label="Next"]
-5088583475362684799 -> 8557055779591771203 [label="Reset"]
}`;
    const result = parseDot(dot);
    expect(Object.keys(result.states)).toHaveLength(2);
    expect(result.states["8557055779591771203"].vars).toEqual({ x: 1 });
    expect(result.states["-5088583475362684799"].vars).toEqual({ x: 2 });
    expect(result.initialStateId).toBe("8557055779591771203");
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0]).toEqual({
      source: "8557055779591771203",
      target: "-5088583475362684799",
      action: "Next",
    });
  });

  it("parses record-valued variables with negative node IDs", () => {
    const dot = `digraph StateGraph {
100 [label="/\\\\ workerState = (w1 :> \\"idle\\" @@ w2 :> \\"idle\\")\\n/\\\\ resourceInfo = (r1 :> [holder |-> \\"none\\", locked |-> FALSE])" style = filled]
-200 [label="/\\\\ workerState = (w1 :> \\"working\\" @@ w2 :> \\"idle\\")\\n/\\\\ resourceInfo = (r1 :> [holder |-> w1, locked |-> TRUE])"]
100 -> -200 [label="Acquire"]
}`;
    const result = parseDot(dot);
    expect(Object.keys(result.states)).toHaveLength(2);
    expect(result.states["-200"].vars).toEqual({
      workerState: { w1: "working", w2: "idle" },
      resourceInfo: { r1: { holder: "w1", locked: true } },
    });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].target).toBe("-200");
  });
});
