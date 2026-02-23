import { describe, it, expect } from "vitest";
import { disambiguateActions } from "./action-disambiguator.js";

describe("disambiguateActions", () => {
  it("passes through unique actions unchanged", () => {
    const states = {
      "1": { vars: { x: 1 } },
      "2": { vars: { x: 2 } },
      "3": { vars: { x: 3 } },
    };
    const edges = [
      { source: "1", target: "2", action: "A" },
      { source: "1", target: "3", action: "B" },
    ];
    const result = disambiguateActions(states, edges);
    expect(result["1"]).toEqual([
      { action: "A", label: "A", target: "2" },
      { action: "B", label: "B", target: "3" },
    ]);
  });

  it("disambiguates duplicate actions with variable diffs", () => {
    const states = {
      "1": { vars: { x: 1, y: "a" } },
      "2": { vars: { x: 2, y: "a" } },
      "3": { vars: { x: 3, y: "a" } },
    };
    const edges = [
      { source: "1", target: "2", action: "Step" },
      { source: "1", target: "3", action: "Step" },
    ];
    const result = disambiguateActions(states, edges);
    expect(result["1"]).toHaveLength(2);
    // Both should have "Step" as the action but different labels
    expect(result["1"][0].action).toBe("Step");
    expect(result["1"][1].action).toBe("Step");
    expect(result["1"][0].label).not.toBe(result["1"][1].label);
    // Labels should contain the variable diff
    expect(result["1"][0].label).toContain("Step");
    expect(result["1"][0].label).toContain("x:");
  });

  it("handles edges with no variable diffs (fallback to target)", () => {
    const states = {
      "1": { vars: { x: 1 } },
      "2": { vars: { x: 1 } },
      "3": { vars: { x: 1 } },
    };
    const edges = [
      { source: "1", target: "2", action: "Same" },
      { source: "1", target: "3", action: "Same" },
    ];
    const result = disambiguateActions(states, edges);
    expect(result["1"]).toHaveLength(2);
    // Should still be disambiguated somehow
    expect(result["1"][0].label).not.toBe(result["1"][1].label);
  });

  it("handles empty edges", () => {
    const result = disambiguateActions({ "1": { vars: { x: 1 } } }, []);
    expect(result).toEqual({});
  });
});
