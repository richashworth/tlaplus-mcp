import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureToolHandler } from "../test-utils.js";
import fs from "node:fs";
import { existsSync } from "node:fs";

vi.mock("../lib/schemas.js", () => ({
  absolutePath: {
    describe: () => ({ _def: {} }),
    optional: () => ({ describe: () => ({ _def: {} }) }),
  } as any,
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  const mockExistsSync = vi.fn(() => true);
  const mockReadFileSync = vi.fn();
  const mockWriteFileSync = vi.fn();
  const mockMkdirSync = vi.fn();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
      writeFileSync: mockWriteFileSync,
      mkdirSync: mockMkdirSync,
    },
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
  };
});

import { registerTlaStateGraph } from "./tla-state-graph.js";

// TLC-format DOT (parseDot expects /\ var = value labels)
const TLC_DOT = `digraph StateGraph {
1 [label="/\\\\ x = 1\\n/\\\\ y = \\"hello\\"" style = filled]
2 [label="/\\\\ x = 2\\n/\\\\ y = \\"world\\""]
1 -> 2 [label="Next"]
}`;

describe("tla_state_graph", () => {
  let handler: (params: any) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureToolHandler(registerTlaStateGraph);
  });

  it("returns raw DOT content for dot format", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

    const result = await handler({
      dot_file: "/specs/states.dot",
      format: "dot",
    });
    expect(result.content[0].text).toBe(TLC_DOT);
  });

  it("returns structured format with nodes, edges, and status=success", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

    const result = await handler({
      dot_file: "/specs/states.dot",
      format: "structured",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("success");
    expect(parsed.node_count).toBe(2);
    expect(parsed.edge_count).toBe(1);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].action).toBe("Next");
  });

  it("returns json format with transitions and status=success", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

    const result = await handler({
      dot_file: "/specs/states.dot",
      format: "json",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("success");
    expect(parsed).toHaveProperty("states");
    expect(parsed).toHaveProperty("transitions");
    expect(parsed).toHaveProperty("invariants");
    expect(parsed).toHaveProperty("violations");
    expect(parsed.invariants).toEqual([]);
    expect(parsed.violations).toEqual([]);
  });

  it("validates dot_file exists", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await handler({
      dot_file: "/missing/states.dot",
      format: "dot",
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("DOT file not found");
  });

  it("validates cfg_file exists when provided", async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      if (String(p) === "/specs/missing.cfg") return false;
      return true;
    });

    const result = await handler({
      dot_file: "/specs/states.dot",
      cfg_file: "/specs/missing.cfg",
      format: "json",
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("CFG file not found");
  });

  it("validates tlc_output_file exists when provided", async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      if (String(p) === "/specs/missing.out") return false;
      return true;
    });

    const result = await handler({
      dot_file: "/specs/states.dot",
      tlc_output_file: "/specs/missing.out",
      format: "json",
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("TLC output file not found");
  });

  it("parses cfg_file for invariants in json format", async () => {
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(TLC_DOT)
      .mockReturnValueOnce("INVARIANT TypeOK\nPROPERTY Liveness\n");

    const result = await handler({
      dot_file: "/specs/states.dot",
      cfg_file: "/specs/Spec.cfg",
      format: "json",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.invariants).toEqual(
      expect.arrayContaining(["TypeOK", "Liveness"]),
    );
  });

  it("returns partial=false and happyPaths in json format", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

    const result = await handler({
      dot_file: "/specs/states.dot",
      format: "json",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.partial).toBe(false);
    expect(parsed).toHaveProperty("happyPaths");
    expect(Array.isArray(parsed.happyPaths)).toBe(true);
    // The TLC_DOT graph has 1->2 with action "Next", so there should be a terminal path
    expect(parsed.happyPaths.length).toBeGreaterThanOrEqual(1);
    expect(parsed.happyPaths[0].trace[0].stateId).toBe("1");
  });

  it("returns traces_only graph with partial=true from TLC output", async () => {
    const tlcOutput = `Error: Invariant TypeOK is violated.
State 1: <Init line 5, col 1 of module Spec>
/\\ x = 1

State 2: <Next line 10, col 1 of module Spec>
/\\ x = 2
`;

    const result = await handler({
      format: "json",
      traces_only: true,
      tlc_output: tlcOutput,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("success");
    expect(parsed.partial).toBe(true);
    expect(parsed.states).toHaveProperty("t1");
    expect(parsed.states).toHaveProperty("t2");
    expect(parsed.violations).toHaveLength(1);
    expect(parsed.violations[0].type).toBe("invariant");
    expect(parsed).toHaveProperty("happyPaths");
  });

  it("rejects traces_only without TLC output", async () => {
    const result = await handler({
      format: "json",
      traces_only: true,
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("traces_only requires tlc_output");
  });

  it("rejects traces_only with non-json format", async () => {
    const result = await handler({
      format: "dot",
      traces_only: true,
      tlc_output: "some output",
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain(
      "traces_only mode only supports json format",
    );
  });

  it("requires dot_file when traces_only is false", async () => {
    const result = await handler({ format: "json" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("dot_file is required");
  });

  describe("output_file", () => {
    it("writes JSON to file and returns compact summary", async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

      const result = await handler({
        dot_file: "/specs/states.dot",
        format: "json",
        output_file: "/out/graph.json",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.output_file).toBe("/out/graph.json");
      expect(parsed.state_count).toBe(2);
      expect(parsed.transition_count).toBe(1);
      expect(parsed.violation_count).toBe(0);
      expect(parsed.happy_path_count).toBeGreaterThanOrEqual(1);
      expect(parsed.sample_state).toBeDefined();
      expect(parsed.sample_state.vars).toHaveProperty("x");
      // Should NOT contain full states/transitions inline
      expect(parsed.states).toBeUndefined();
      expect(parsed.transitions).toBeUndefined();
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        "/out/graph.json",
        expect.any(String),
        "utf-8",
      );
    });

    it("returns full response when output_file is omitted", async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

      const result = await handler({
        dot_file: "/specs/states.dot",
        format: "json",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.states).toBeDefined();
      expect(parsed.transitions).toBeDefined();
      expect(parsed.output_file).toBeUndefined();
      expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
    });

    it("rejects output_file with non-json format", async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

      const result = await handler({
        dot_file: "/specs/states.dot",
        format: "structured",
        output_file: "/out/graph.json",
      });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain(
        "output_file is only supported with json format",
      );
    });

    it("works with traces_only mode", async () => {
      const tlcOutput = `Error: Invariant TypeOK is violated.
State 1: <Init line 5, col 1 of module Spec>
/\\ x = 1

State 2: <Next line 10, col 1 of module Spec>
/\\ x = 2
`;

      const result = await handler({
        format: "json",
        traces_only: true,
        tlc_output: tlcOutput,
        output_file: "/out/traces.json",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.output_file).toBe("/out/traces.json");
      expect(parsed.partial).toBe(true);
      expect(parsed.state_count).toBe(2);
      expect(parsed.states).toBeUndefined();
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
    });
  });
});
