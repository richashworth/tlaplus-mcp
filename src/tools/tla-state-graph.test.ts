import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureToolHandler } from "../test-utils.js";
import fs from "node:fs";

vi.mock("../lib/schemas.js", () => ({
  absolutePath: { describe: () => ({ _def: {} }) } as any,
}));

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
    vi.restoreAllMocks();
    handler = captureToolHandler(registerTlaStateGraph);
  });

  it("returns raw DOT content for dot format", async () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue(TLC_DOT);

    const result = await handler({ dot_file: "/specs/states.dot", format: "dot" });
    expect(result.content[0].text).toBe(TLC_DOT);
  });

  it("returns structured format with nodes and edges", async () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue(TLC_DOT);

    const result = await handler({ dot_file: "/specs/states.dot", format: "structured" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.node_count).toBe(2);
    expect(parsed.edge_count).toBe(1);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].action).toBe("Next");
  });

  it("returns playground format with transitions", async () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue(TLC_DOT);

    const result = await handler({ dot_file: "/specs/states.dot", format: "playground" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("states");
    expect(parsed).toHaveProperty("transitions");
    expect(parsed).toHaveProperty("invariants");
    expect(parsed).toHaveProperty("violations");
    expect(parsed.invariants).toEqual([]);
    expect(parsed.violations).toEqual([]);
  });

  it("enforces MAX_NODES limit", async () => {
    // Build a DOT with >50000 TLC-format nodes
    const lines = ["digraph StateGraph {"];
    for (let i = 0; i < 50_001; i++) {
      lines.push(`${i} [label="/\\\\ x = ${i}"]`);
    }
    lines.push("}");
    vi.spyOn(fs, "readFileSync").mockReturnValue(lines.join("\n"));

    const result = await handler({ dot_file: "/specs/states.dot", format: "structured" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("too large");
  });

  it("handles file read errors", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = await handler({ dot_file: "/missing/states.dot", format: "dot" });
    expect(result.isError).toBe(true);
  });

  it("parses cfg_file for invariants in playground format", async () => {
    vi.spyOn(fs, "readFileSync")
      .mockReturnValueOnce(TLC_DOT)
      .mockReturnValueOnce("INVARIANT TypeOK\nPROPERTY Liveness\n");

    const result = await handler({ dot_file: "/specs/states.dot", cfg_file: "/specs/Spec.cfg", format: "playground" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.invariants).toEqual(expect.arrayContaining(["TypeOK", "Liveness"]));
  });
});
