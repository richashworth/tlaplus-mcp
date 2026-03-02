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

  it("contains presentation globals and renderStateVisual stub", () => {
    expect(genJs).toContain("var ACTION_LABELS");
    expect(genJs).toContain("var INVARIANT_LABELS");
    expect(genJs).toContain("var SCENARIO_LABELS");
    expect(genJs).toContain("var HAPPY_PATHS");
    expect(genJs).not.toContain("function renderState(");
    expect(genJs).toContain("function renderStateVisual");
  });

  it("does not contain GRAPH or PLAYGROUND_TITLE", () => {
    expect(genJs).not.toContain("var GRAPH");
    expect(genJs).not.toContain("var PLAYGROUND_TITLE");
  });

  it("renderStateVisual stub contains rs-empty and not customized", () => {
    expect(genJs).toContain("rs-empty");
    expect(genJs).toContain("not customized");
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

describe("generatePlaygroundCss", () => {
  it("returns a non-empty string", () => {
    const css = generatePlaygroundCss();
    expect(css.length).toBeGreaterThan(0);
  });
});
