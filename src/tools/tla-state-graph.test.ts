import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureToolHandler } from "../test-utils.js";
import fs from "node:fs";
import { existsSync } from "node:fs";

vi.mock("../lib/paths.js", async () =>
  (await import("../test-utils.js")).passthroughPathsMock(),
);

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

  it("writes json format with transitions to output_file and returns status=success summary", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

    const result = await handler({
      dot_file: "/specs/states.dot",
      format: "json",
      output_file: "/out/graph.json",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("success");
    expect(parsed.output_file).toBe("/out/graph.json");
    expect(parsed.invariants).toEqual([]);
    expect(parsed.violation_count).toBe(0);

    // The written file should contain the full structured data.
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const writtenData = JSON.parse(writeCall[1] as string);
    expect(writtenData).toHaveProperty("states");
    expect(writtenData).toHaveProperty("transitions");
    expect(writtenData).toHaveProperty("invariants");
    expect(writtenData).toHaveProperty("violations");
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
      output_file: "/out/graph.json",
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
      output_file: "/out/graph.json",
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
      output_file: "/out/graph.json",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.invariants).toEqual(
      expect.arrayContaining(["TypeOK", "Liveness"]),
    );
  });

  it("returns partial=false and happyPaths in json format summary", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

    const result = await handler({
      dot_file: "/specs/states.dot",
      format: "json",
      output_file: "/out/graph.json",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.partial).toBe(false);
    expect(parsed.happy_path_count).toBeGreaterThanOrEqual(1);

    // Full happyPaths data is in the written file.
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const writtenData = JSON.parse(writeCall[1] as string);
    expect(writtenData).toHaveProperty("happyPaths");
    expect(Array.isArray(writtenData.happyPaths)).toBe(true);
    expect(writtenData.happyPaths.length).toBeGreaterThanOrEqual(1);
    expect(writtenData.happyPaths[0].trace[0].stateId).toBe("1");
  });

  it("writes traces_only graph with partial=true from TLC output", async () => {
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
    expect(parsed.status).toBe("success");
    expect(parsed.partial).toBe(true);
    expect(parsed.violation_count).toBe(1);

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const writtenData = JSON.parse(writeCall[1] as string);
    expect(writtenData.states).toHaveProperty("t1");
    expect(writtenData.states).toHaveProperty("t2");
    expect(writtenData.violations).toHaveLength(1);
    expect(writtenData.violations[0].type).toBe("invariant");
    expect(writtenData).toHaveProperty("happyPaths");
  });

  it("rejects traces_only without TLC output", async () => {
    const result = await handler({
      format: "json",
      traces_only: true,
      output_file: "/out/traces.json",
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
    const result = await handler({
      format: "json",
      output_file: "/out/graph.json",
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("dot_file is required");
  });

  it("rejects json format when output_file is omitted", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

    const result = await handler({
      dot_file: "/specs/states.dot",
      format: "json",
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("output_file is required for json format");
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
