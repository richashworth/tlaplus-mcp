import { describe, it, expect } from "vitest";
import { generatePlaygroundJs, generatePlaygroundCss, type PlaygroundGraph } from "./playground-gen.js";

const FIXTURE: PlaygroundGraph = {
  status: "success",
  partial: false,
  initialStateId: "1",
  states: {
    "1": {
      label: "State 1",
      vars: {
        phase: "init",
        count: 0,
        enabled: true,
        tags: ["a", "b"],
        queue: [1, 2, 3],
        config: { host: "localhost", port: "8080" },
        scores: { alice: 10, bob: 20 },
        nested: { inner: { x: 1 } },
      },
    },
    "2": {
      label: "State 2",
      vars: {
        phase: "running",
        count: 1,
        enabled: false,
        tags: ["a", "b", "c"],
        queue: [2, 3],
        config: { host: "localhost", port: "9090" },
        scores: { alice: 15, bob: 20 },
        nested: { inner: { x: 2 } },
      },
    },
  },
  transitions: {
    "1": [{ action: "Start", label: "Start", target: "2" }],
  },
  invariants: ["TypeOK", "CountBound"],
  violations: [
    {
      id: "v1",
      type: "invariant",
      summary: "TypeOK violated",
      invariant: "TypeOK",
      trace: [
        { stateId: "1", action: null },
        { stateId: "2", action: "Start" },
      ],
    },
    {
      id: "v2",
      type: "deadlock",
      summary: "Deadlock reached",
      trace: [
        { stateId: "1", action: null },
        { stateId: "2", action: "Start" },
      ],
    },
  ],
  happyPaths: [
    {
      trace: [
        { stateId: "1", action: null },
        { stateId: "2", action: "Start" },
      ],
    },
  ],
};

describe("generatePlaygroundJs", () => {
  const js = generatePlaygroundJs({ title: "Test Playground", graph: FIXTURE });

  it("contains all required globals", () => {
    expect(js).toContain("var PLAYGROUND_TITLE");
    expect(js).toContain("var GRAPH");
    expect(js).toContain("var ACTION_LABELS");
    expect(js).toContain("var INVARIANT_LABELS");
    expect(js).toContain("var SCENARIO_LABELS");
    expect(js).toContain("var HAPPY_PATHS");
    expect(js).toContain("function renderState");
    expect(js).toContain("function renderStateVisual");
  });

  it("renders string vars with rs-badge-info", () => {
    expect(js).toContain("rs-badge rs-badge-info");
  });

  it("renders number vars with rs-kv", () => {
    expect(js).toContain("rs-kv");
    expect(js).toContain("rs-kv-key");
    expect(js).toContain("rs-kv-val");
  });

  it("renders boolean vars with green/grey dot", () => {
    expect(js).toContain("border-radius:50%");
    expect(js).toContain("var(--green)");
    expect(js).toContain("var(--text-3)");
  });

  it("renders string[] vars with rs-badge-muted", () => {
    expect(js).toContain("rs-badge rs-badge-muted");
  });

  it("renders generic arrays with rs-pipeline", () => {
    expect(js).toContain("rs-pipeline");
    expect(js).toContain("rs-pipeline-step");
  });

  it("renders record(string->string) with rs-table and badge values", () => {
    expect(js).toContain("rs-table");
  });

  it("renders nested records with nested rs-card", () => {
    // The nested var should produce a nested rs-card inside
    expect(js).toContain("rs-card");
  });

  it("generates SCENARIO_LABELS from violations correctly", () => {
    expect(js).toContain('"v1"');
    expect(js).toContain('"TypeOK"');
    expect(js).toContain('"Deadlock"');
    expect(js).toContain("Counterexample trace for TypeOK violation");
    expect(js).toContain("Counterexample trace for Deadlock violation");
  });

  it("generates HAPPY_PATHS with correct count and generic titles", () => {
    expect(js).toContain("Path 1 (2 steps)");
  });

  it("wraps each variable in a data-var card", () => {
    expect(js).toContain('data-var="phase"');
    expect(js).toContain('data-var="count"');
    expect(js).toContain('data-var="enabled"');
    expect(js).toContain('data-var="tags"');
    expect(js).toContain('data-var="queue"');
    expect(js).toContain('data-var="config"');
    expect(js).toContain('data-var="scores"');
    expect(js).toContain('data-var="nested"');
  });

  it("produces syntactically valid JS", () => {
    // Use Function constructor as a lightweight syntax check (no eval side effects)
    expect(() => new Function(js)).not.toThrow();
  });
});

describe("generatePlaygroundJs — empty vars", () => {
  it("returns rs-empty div for empty vars", () => {
    const emptyGraph: PlaygroundGraph = {
      ...FIXTURE,
      states: {
        "1": { label: "State 1", vars: {} },
      },
    };
    const js = generatePlaygroundJs({ title: "Empty", graph: emptyGraph });
    expect(js).toContain("rs-empty");
  });
});

describe("generatePlaygroundJs — missing initialStateId fallback", () => {
  it("falls back to first state when initialStateId not in states", () => {
    const graph: PlaygroundGraph = {
      ...FIXTURE,
      initialStateId: "missing",
    };
    const js = generatePlaygroundJs({ title: "Fallback", graph });
    // Should still produce renderState with var cards (using first state's vars)
    expect(js).toContain('data-var="phase"');
  });
});

describe("generatePlaygroundCss", () => {
  it("returns a non-empty string", () => {
    const css = generatePlaygroundCss();
    expect(css.length).toBeGreaterThan(0);
  });
});
