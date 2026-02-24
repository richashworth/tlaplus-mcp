import { describe, it, expect } from "vitest";
import { discoverHappyPaths } from "./happy-paths.js";
import type { DisambiguatedTransition } from "./action-disambiguator.js";

function t(action: string, target: string): DisambiguatedTransition {
  return { action, label: action, target };
}

describe("discoverHappyPaths", () => {
  it("finds a terminal path in a linear graph", () => {
    const transitions: Record<string, DisambiguatedTransition[]> = {
      "1": [t("Step", "2")],
      "2": [t("Step", "3")],
      // "3" has no outgoing transitions -> terminal
    };

    const paths = discoverHappyPaths("1", transitions, new Set());
    expect(paths).toHaveLength(1);
    expect(paths[0].trace).toEqual([
      { stateId: "1", action: null },
      { stateId: "2", action: "Step" },
      { stateId: "3", action: "Step" },
    ]);
  });

  it("finds a loop path", () => {
    const transitions: Record<string, DisambiguatedTransition[]> = {
      "1": [t("Step", "2")],
      "2": [t("Step", "1")],
    };

    const paths = discoverHappyPaths("1", transitions, new Set());
    expect(paths).toHaveLength(1);
    expect(paths[0].trace).toEqual([
      { stateId: "1", action: null },
      { stateId: "2", action: "Step" },
      { stateId: "1", action: "Step" },
    ]);
  });

  it("finds paths through branches", () => {
    const transitions: Record<string, DisambiguatedTransition[]> = {
      "1": [t("Left", "2"), t("Right", "3")],
      // "2" and "3" are terminal
    };

    const paths = discoverHappyPaths("1", transitions, new Set());
    expect(paths).toHaveLength(2);
    const traceActions = paths.map(p => p.trace.map(e => e.action));
    expect(traceActions).toContainEqual([null, "Left"]);
    expect(traceActions).toContainEqual([null, "Right"]);
  });

  it("excludes paths ending at violation final states", () => {
    const transitions: Record<string, DisambiguatedTransition[]> = {
      "1": [t("Bad", "2"), t("Good", "3")],
      // "2" (violation) and "3" (terminal) have no outgoing
    };

    const violationFinals = new Set(["2"]);
    const paths = discoverHappyPaths("1", transitions, violationFinals);
    expect(paths).toHaveLength(1);
    expect(paths[0].trace[1].stateId).toBe("3");
  });

  it("limits to maxPaths", () => {
    const transitions: Record<string, DisambiguatedTransition[]> = {
      "1": [t("A", "2"), t("B", "3"), t("C", "4"), t("D", "5"), t("E", "6"), t("F", "7")],
    };

    const paths = discoverHappyPaths("1", transitions, new Set(), 3);
    expect(paths).toHaveLength(3);
  });

  it("deduplicates by action sequence", () => {
    // Two different paths with the same action sequence
    const transitions: Record<string, DisambiguatedTransition[]> = {
      "1": [t("Step", "2"), t("Step", "3")],
      // Both use action "Step" -> same action sequence [null, "Step"]
    };

    const paths = discoverHappyPaths("1", transitions, new Set());
    expect(paths).toHaveLength(1);
  });

  it("returns empty for initial-only graph", () => {
    const transitions: Record<string, DisambiguatedTransition[]> = {};
    const paths = discoverHappyPaths("1", transitions, new Set());
    // Single state with no transitions and path length = 1 (not > 1), so no paths
    expect(paths).toHaveLength(0);
  });

  it("handles self-loop", () => {
    const transitions: Record<string, DisambiguatedTransition[]> = {
      "1": [t("Loop", "1")],
    };

    const paths = discoverHappyPaths("1", transitions, new Set());
    expect(paths).toHaveLength(1);
    expect(paths[0].trace).toEqual([
      { stateId: "1", action: null },
      { stateId: "1", action: "Loop" },
    ]);
  });

  it("skips transitions to violation states when finding terminal paths", () => {
    const transitions: Record<string, DisambiguatedTransition[]> = {
      "1": [t("A", "2"), t("B", "3")],
      "2": [t("C", "4")],
      // "3" is a violation final, "4" is terminal
    };

    const violationFinals = new Set(["3"]);
    const paths = discoverHappyPaths("1", transitions, violationFinals);
    // Should find path 1->2->4, but not 1->3
    expect(paths.length).toBeGreaterThanOrEqual(1);
    const allStateIds = paths.flatMap(p => p.trace.map(e => e.stateId));
    expect(allStateIds).not.toContain("3");
  });
});
