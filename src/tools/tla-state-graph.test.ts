import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureToolHandler } from "../test-utils.js";
import fs from "node:fs";
import { existsSync } from "node:fs";

vi.mock("../lib/schemas.js", () => ({
  absolutePath: { describe: () => ({ _def: {} }), optional: () => ({ describe: () => ({ _def: {} }) }) } as any,
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  const mockExistsSync = vi.fn(() => true);
  const mockReadFileSync = vi.fn();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
    },
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
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

    const result = await handler({ dot_file: "/specs/states.dot", format: "dot" });
    expect(result.content[0].text).toBe(TLC_DOT);
  });

  it("returns structured format with nodes, edges, and status=success", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

    const result = await handler({ dot_file: "/specs/states.dot", format: "structured" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("success");
    expect(parsed.node_count).toBe(2);
    expect(parsed.edge_count).toBe(1);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].action).toBe("Next");
  });

  it("returns playground format with transitions and status=success", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(TLC_DOT);

    const result = await handler({ dot_file: "/specs/states.dot", format: "playground" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("success");
    expect(parsed).toHaveProperty("states");
    expect(parsed).toHaveProperty("transitions");
    expect(parsed).toHaveProperty("invariants");
    expect(parsed).toHaveProperty("violations");
    expect(parsed.invariants).toEqual([]);
    expect(parsed.violations).toEqual([]);
  });

  it("returns structured too_large response when exceeding MAX_NODES", async () => {
    // Build a DOT with >50000 TLC-format nodes
    const lines = ["digraph StateGraph {"];
    for (let i = 0; i < 50_001; i++) {
      lines.push(`${i} [label="/\\\\ x = ${i}"]`);
    }
    lines.push("}");
    vi.mocked(fs.readFileSync).mockReturnValue(lines.join("\n"));

    const result = await handler({ dot_file: "/specs/states.dot", format: "structured" });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("too_large");
    expect(parsed.too_large).toBe(true);
    expect(parsed.node_count).toBe(50_001);
    expect(parsed.max_nodes).toBe(50_000);
  });

  it("validates dot_file exists", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await handler({ dot_file: "/missing/states.dot", format: "dot" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("DOT file not found");
  });

  it("validates cfg_file exists when provided", async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      if (String(p) === "/specs/missing.cfg") return false;
      return true;
    });

    const result = await handler({ dot_file: "/specs/states.dot", cfg_file: "/specs/missing.cfg", format: "playground" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("CFG file not found");
  });

  it("validates tlc_output_file exists when provided", async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      if (String(p) === "/specs/missing.out") return false;
      return true;
    });

    const result = await handler({ dot_file: "/specs/states.dot", tlc_output_file: "/specs/missing.out", format: "playground" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("TLC output file not found");
  });

  it("parses cfg_file for invariants in playground format", async () => {
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(TLC_DOT)
      .mockReturnValueOnce("INVARIANT TypeOK\nPROPERTY Liveness\n");

    const result = await handler({ dot_file: "/specs/states.dot", cfg_file: "/specs/Spec.cfg", format: "playground" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.invariants).toEqual(expect.arrayContaining(["TypeOK", "Liveness"]));
  });
});
