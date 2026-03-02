import { describe, it, expect } from "vitest";
import { generatePlaygroundDataJs, generatePlaygroundGenJs, generatePlaygroundCss, type PlaygroundGraph } from "./playground-gen.js";

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

describe("generatePlaygroundDataJs", () => {
  const dataJs = generatePlaygroundDataJs({ title: "Test Playground", graph: FIXTURE });

  it("contains PLAYGROUND_TITLE and GRAPH", () => {
    expect(dataJs).toContain("var PLAYGROUND_TITLE");
    expect(dataJs).toContain("var GRAPH");
  });

  it("does not contain presentation globals or functions", () => {
    expect(dataJs).not.toContain("var ACTION_LABELS");
    expect(dataJs).not.toContain("var INVARIANT_LABELS");
    expect(dataJs).not.toContain("var SCENARIO_LABELS");
    expect(dataJs).not.toContain("var HAPPY_PATHS");
    expect(dataJs).not.toContain("function renderState");
    expect(dataJs).not.toContain("function renderStateVisual");
  });

  it("produces syntactically valid JS", () => {
    expect(() => new Function(dataJs)).not.toThrow();
  });
});

describe("generatePlaygroundGenJs", () => {
  const genJs = generatePlaygroundGenJs({ graph: FIXTURE });

  it("contains all presentation globals and functions", () => {
    expect(genJs).toContain("var ACTION_LABELS");
    expect(genJs).toContain("var INVARIANT_LABELS");
    expect(genJs).toContain("var SCENARIO_LABELS");
    expect(genJs).toContain("var HAPPY_PATHS");
    expect(genJs).toContain("function renderState");
    expect(genJs).toContain("function renderStateVisual");
  });

  it("does not contain GRAPH or PLAYGROUND_TITLE", () => {
    expect(genJs).not.toContain("var GRAPH");
    expect(genJs).not.toContain("var PLAYGROUND_TITLE");
  });

  it("renders string vars with rs-badge-info", () => {
    expect(genJs).toContain("rs-badge rs-badge-info");
  });

  it("renders number vars with rs-kv", () => {
    expect(genJs).toContain("rs-kv");
    expect(genJs).toContain("rs-kv-key");
    expect(genJs).toContain("rs-kv-val");
  });

  it("renders boolean vars with green/grey dot", () => {
    expect(genJs).toContain("border-radius:50%");
    expect(genJs).toContain("var(--green)");
    expect(genJs).toContain("var(--text-3)");
  });

  it("renders string[] vars with rs-badge-muted", () => {
    expect(genJs).toContain("rs-badge rs-badge-muted");
  });

  it("renders generic arrays with rs-pipeline", () => {
    expect(genJs).toContain("rs-pipeline");
    expect(genJs).toContain("rs-pipeline-step");
  });

  it("renders record(string->string) with rs-table and badge values", () => {
    expect(genJs).toContain("rs-table");
  });

  it("renders nested records with nested rs-card", () => {
    expect(genJs).toContain("rs-card");
  });

  it("generates SCENARIO_LABELS from violations correctly", () => {
    expect(genJs).toContain('"v1"');
    expect(genJs).toContain('"TypeOK"');
    expect(genJs).toContain('"Deadlock"');
    expect(genJs).toContain("Counterexample trace for TypeOK violation");
    expect(genJs).toContain("Counterexample trace for Deadlock violation");
  });

  it("generates HAPPY_PATHS with correct count and generic titles", () => {
    expect(genJs).toContain("Path 1 (2 steps)");
  });

  it("wraps each variable in a data-var card", () => {
    expect(genJs).toContain('data-var="phase"');
    expect(genJs).toContain('data-var="count"');
    expect(genJs).toContain('data-var="enabled"');
    expect(genJs).toContain('data-var="tags"');
    expect(genJs).toContain('data-var="queue"');
    expect(genJs).toContain('data-var="config"');
    expect(genJs).toContain('data-var="scores"');
    expect(genJs).toContain('data-var="nested"');
  });

  it("produces syntactically valid JS", () => {
    expect(() => new Function(genJs)).not.toThrow();
  });
});

describe("data + gen concatenated", () => {
  it("produces syntactically valid JS when concatenated", () => {
    const dataJs = generatePlaygroundDataJs({ title: "Test", graph: FIXTURE });
    const genJs = generatePlaygroundGenJs({ graph: FIXTURE });
    expect(() => new Function(dataJs + "\n" + genJs)).not.toThrow();
  });
});

describe("generatePlaygroundGenJs — empty vars", () => {
  it("returns rs-empty div for empty vars", () => {
    const emptyGraph: PlaygroundGraph = {
      ...FIXTURE,
      states: {
        "1": { label: "State 1", vars: {} },
      },
    };
    const genJs = generatePlaygroundGenJs({ graph: emptyGraph });
    expect(genJs).toContain("rs-empty");
  });
});

describe("generatePlaygroundGenJs — missing initialStateId fallback", () => {
  it("falls back to first state when initialStateId not in states", () => {
    const graph: PlaygroundGraph = {
      ...FIXTURE,
      initialStateId: "missing",
    };
    const genJs = generatePlaygroundGenJs({ graph });
    // Should still produce renderState with var cards (using first state's vars)
    expect(genJs).toContain('data-var="phase"');
  });
});

describe("generatePlaygroundCss", () => {
  it("returns a non-empty string", () => {
    const css = generatePlaygroundCss();
    expect(css.length).toBeGreaterThan(0);
  });
});
