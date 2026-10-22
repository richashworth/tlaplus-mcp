/**
 * Integration tests using the MCP SDK's Client + InMemoryTransport.
 *
 * These tests exercise the full MCP protocol round-trip: client -> transport ->
 * server -> tool handler -> response, verifying schema validation, tool
 * registration, and response shapes.
 *
 * Tools that require Java/TLC are tested up to their file-validation boundary
 * (missing file errors), which exercises the full MCP stack without needing
 * a JVM installed.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./server.js";

// -- Test helpers -------------------------------------------------------------

let client: Client;
// Sole allowed root for the whole suite (TLAPLUS_MCP_ROOTS).
let tempDir: string;
// A sibling directory outside the root.
let outsideDir: string;

async function setupClientServer() {
  const server = createServer();
  const c = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    c.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client: c, server };
}

function parseToolResult(
  result: Awaited<ReturnType<typeof client.callTool>>,
): any {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

function getResultText(
  result: Awaited<ReturnType<typeof client.callTool>>,
): string {
  return (result.content as Array<{ text: string }>)[0].text;
}

/** Call a tool with a non-absolute path and assert schema validation rejects it. */
async function expectAbsolutePathRequired(
  toolName: string,
  extraArgs: Record<string, unknown> = {},
) {
  const result = await client.callTool({
    name: toolName,
    arguments: { tla_file: "relative/Spec.tla", ...extraArgs },
  });
  expect(result.isError).toBe(true);
  expect(getResultText(result)).toContain("Path must be absolute");
}

/** Call a tool with a nonexistent absolute path and assert file-not-found error. */
async function expectFileNotFound(
  toolName: string,
  extraArgs: Record<string, unknown> = {},
) {
  const result = await client.callTool({
    name: toolName,
    arguments: { tla_file: join(tempDir, "missing", "Spec.tla"), ...extraArgs },
  });
  expect(result.isError).toBe(true);
  const parsed = parseToolResult(result);
  expect(parsed.error).toContain("not found");
}

// -- Tests --------------------------------------------------------------------

describe("MCP server integration", () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  const originalRoots = process.env.TLAPLUS_MCP_ROOTS;

  /** Allocate a temp output_file path used by json-format tla_state_graph calls. */
  function tempOutputFile(name = "graph.json"): string {
    return join(tempDir, `${Math.random().toString(36).slice(2)}-${name}`);
  }

  /** Read the JSON written by tla_state_graph at the given path. */
  function readOutputFile(path: string): any {
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  beforeAll(async () => {
    const setup = await setupClientServer();
    client = setup.client;
    server = setup.server;
    const base = realpathSync(mkdtempSync(join(tmpdir(), "tlaplus-mcp-it-")));
    tempDir = join(base, "root");
    outsideDir = join(base, "outside");
    mkdirSync(tempDir);
    mkdirSync(outsideDir);
    process.env.TLAPLUS_MCP_ROOTS = tempDir;
  });

  afterAll(async () => {
    if (originalRoots === undefined) delete process.env.TLAPLUS_MCP_ROOTS;
    else process.env.TLAPLUS_MCP_ROOTS = originalRoots;
    await client.close();
    await server.close();
    try {
      rmSync(join(tempDir, ".."), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  // -- Tool registration ------------------------------------------------------

  describe("tool registration", () => {
    it("lists all expected tools", async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "pcal_translate",
        "tla_evaluate",
        "tla_parse",
        "tla_state_graph",
        "tla_tex",
        "tlc_check",
        "tlc_coverage",
        "tlc_generate_trace_spec",
        "tlc_simulate",
      ]);
    });

    it("every tool has a description", async () => {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        expect(
          tool.description,
          `${tool.name} missing description`,
        ).toBeTruthy();
      }
    });

    it("every tool has an input schema with type=object", async () => {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        expect(tool.inputSchema.type, `${tool.name} schema type`).toBe(
          "object",
        );
      }
    });

    it("tla_state_graph has traces_only parameter in schema", async () => {
      const { tools } = await client.listTools();
      const stateGraph = tools.find((t) => t.name === "tla_state_graph")!;
      expect(stateGraph.inputSchema.properties).toHaveProperty("traces_only");
    });

    it("tla_state_graph has dot_file as optional", async () => {
      const { tools } = await client.listTools();
      const stateGraph = tools.find((t) => t.name === "tla_state_graph")!;
      const required = stateGraph.inputSchema.required ?? [];
      expect(required).not.toContain("dot_file");
    });
  });

  // -- Resource registration --------------------------------------------------

  describe("resource registration", () => {
    it("lists tla://specs resource", async () => {
      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain("tla://specs");
    });
  });

  // -- tla_state_graph --------------------------------------------------------

  describe("tla_state_graph — traces_only mode", () => {
    const TLC_OUTPUT_INVARIANT = `Error: Invariant TypeOK is violated.
State 1: <Init line 5, col 1 of module Spec>
/\\ x = 1
/\\ y = 2

State 2: <Next line 10, col 1 of module Spec>
/\\ x = 3
/\\ y = 4
`;

    const TLC_OUTPUT_LASSO = `Error: Temporal properties were violated.
Error: Liveness is violated
State 1: <Init line 5, col 1 of module Spec>
/\\ x = 1

State 2: <Step line 10, col 1 of module Spec>
/\\ x = 2

State 3: <Step line 10, col 1 of module Spec>
/\\ x = 3

Back to state 2
`;

    it("returns partial=true with synthetic state IDs", async () => {
      const outputFile = tempOutputFile();
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          tlc_output: TLC_OUTPUT_INVARIANT,
          output_file: outputFile,
        },
      });

      const summary = parseToolResult(result);
      expect(summary.status).toBe("success");
      expect(summary.partial).toBe(true);
      expect(summary.state_count).toBe(2);
      expect(summary.initialStateId).toBe("t1");

      const parsed = readOutputFile(outputFile);
      expect(parsed.states).toHaveProperty("t1");
      expect(parsed.states).toHaveProperty("t2");
      expect(parsed.states.t1.vars).toEqual({ x: 1, y: 2 });
      expect(parsed.states.t2.vars).toEqual({ x: 3, y: 4 });
      expect(parsed.initialStateId).toBe("t1");
    });

    it("includes violations with synthetic state IDs", async () => {
      const outputFile = tempOutputFile();
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          tlc_output: TLC_OUTPUT_INVARIANT,
          output_file: outputFile,
        },
      });
      expect(parseToolResult(result).violation_count).toBe(1);

      const parsed = readOutputFile(outputFile);
      expect(parsed.violations).toHaveLength(1);
      expect(parsed.violations[0].type).toBe("invariant");
      expect(parsed.violations[0].invariant).toBe("TypeOK");
      expect(parsed.violations[0].trace[0].stateId).toBe("t1");
      expect(parsed.violations[0].trace[1].stateId).toBe("t2");
    });

    it("includes transitions between trace states", async () => {
      const outputFile = tempOutputFile();
      await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          tlc_output: TLC_OUTPUT_INVARIANT,
          output_file: outputFile,
        },
      });

      const parsed = readOutputFile(outputFile);
      expect(parsed.transitions).toHaveProperty("t1");
      expect(parsed.transitions.t1).toHaveLength(1);
      expect(parsed.transitions.t1[0].target).toBe("t2");
    });

    it("includes happyPaths array", async () => {
      const outputFile = tempOutputFile();
      await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          tlc_output: TLC_OUTPUT_INVARIANT,
          output_file: outputFile,
        },
      });

      const parsed = readOutputFile(outputFile);
      expect(parsed).toHaveProperty("happyPaths");
      expect(Array.isArray(parsed.happyPaths)).toBe(true);
    });

    it("handles temporal violation with lasso", async () => {
      const outputFile = tempOutputFile();
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          tlc_output: TLC_OUTPUT_LASSO,
          output_file: outputFile,
        },
      });

      const summary = parseToolResult(result);
      expect(summary.partial).toBe(true);
      expect(summary.violation_count).toBe(1);

      const parsed = readOutputFile(outputFile);
      expect(parsed.violations).toHaveLength(1);
      expect(parsed.violations[0].type).toBe("temporal");
      expect(parsed.violations[0].property).toBe("Liveness");
      const lastEntry =
        parsed.violations[0].trace[parsed.violations[0].trace.length - 1];
      expect(lastEntry.action).toBe("Back to state");
    });

    it("errors when tlc_output is not provided", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          output_file: tempOutputFile(),
        },
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toContain("traces_only requires tlc_output");
    });

    it("errors when format is not json", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          format: "dot",
          tlc_output: TLC_OUTPUT_INVARIANT,
        },
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toContain(
        "traces_only mode only supports json format",
      );
    });

    it("errors when output_file is omitted in json format", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          tlc_output: TLC_OUTPUT_INVARIANT,
        },
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toContain("output_file is required for json format");
    });
  });

  describe("tla_state_graph — normal mode errors", () => {
    it("errors when dot_file is missing", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: { output_file: tempOutputFile() },
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toContain("dot_file is required");
    });

    it("errors when dot_file does not exist", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          dot_file: join(tempDir, "nonexistent", "states.dot"),
          output_file: tempOutputFile(),
        },
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toContain("not found");
    });
  });

  // -- tlc_check --------------------------------------------------------------

  describe("tlc_check", () => {
    it("errors when tla_file does not exist", () =>
      expectFileNotFound("tlc_check", {
        output_file: join(tempDir, "tlc.out"),
      }));
    it("rejects non-absolute tla_file path", () =>
      expectAbsolutePathRequired("tlc_check", {
        output_file: join(tempDir, "tlc.out"),
      }));
    it("rejects when output_file is missing", async () => {
      const result = await client.callTool({
        name: "tlc_check",
        arguments: { tla_file: "/some/Spec.tla" },
      });
      expect(result.isError).toBe(true);
    });
  });

  // -- tlc_simulate -----------------------------------------------------------

  describe("tlc_simulate", () => {
    it("errors when tla_file does not exist", () =>
      expectFileNotFound("tlc_simulate"));
    it("rejects non-absolute tla_file path", () =>
      expectAbsolutePathRequired("tlc_simulate"));
  });

  // -- tla_parse --------------------------------------------------------------

  describe("tla_parse", () => {
    it("errors when tla_file does not exist", () =>
      expectFileNotFound("tla_parse"));
    it("rejects non-absolute tla_file path", () =>
      expectAbsolutePathRequired("tla_parse"));
  });

  // -- tla_evaluate -----------------------------------------------------------

  describe("tla_evaluate", () => {
    it("rejects invalid module import names", async () => {
      const result = await client.callTool({
        name: "tla_evaluate",
        arguments: {
          expression: "1 + 1",
          imports: ["Valid", "not valid!", "../escape"],
        },
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toContain("Invalid module name");
    });

    it("rejects missing expression parameter", async () => {
      const result = await client.callTool({
        name: "tla_evaluate",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain("expression");
    });
  });

  // -- pcal_translate ---------------------------------------------------------

  describe("pcal_translate", () => {
    it("errors when tla_file does not exist", () =>
      expectFileNotFound("pcal_translate"));
    it("rejects non-absolute tla_file path", () =>
      expectAbsolutePathRequired("pcal_translate"));
  });

  // -- tlc_generate_trace_spec ------------------------------------------------

  describe("tlc_generate_trace_spec", () => {
    it("errors when tla_file does not exist", () =>
      expectFileNotFound("tlc_generate_trace_spec"));
    it("rejects non-absolute tla_file path", () =>
      expectAbsolutePathRequired("tlc_generate_trace_spec"));
  });

  // -- tlc_coverage -----------------------------------------------------------

  describe("tlc_coverage", () => {
    it("errors when tla_file does not exist", () =>
      expectFileNotFound("tlc_coverage"));
    it("rejects non-absolute tla_file path", () =>
      expectAbsolutePathRequired("tlc_coverage"));
  });

  // -- tla_tex ----------------------------------------------------------------

  describe("tla_tex", () => {
    it("errors when tla_file does not exist", () =>
      expectFileNotFound("tla_tex"));
    it("rejects non-absolute tla_file path", () =>
      expectAbsolutePathRequired("tla_tex"));
  });
  // -- Path confinement -------------------------------------------------------

  describe("path confinement", () => {
    function writeSpec(dir: string, name = "Spec"): string {
      const file = join(dir, `${name}.tla`);
      writeFileSync(file, `---- MODULE ${name} ----\n====\n`);
      writeFileSync(join(dir, `${name}.cfg`), "");
      return file;
    }

    async function expectOutsideRoots(
      name: string,
      args: Record<string, unknown>,
    ) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(parseToolResult(result).error).toContain(
        "outside the allowed roots",
      );
    }

    it("refuses to read a spec outside the roots", () =>
      expectOutsideRoots("tla_parse", { tla_file: writeSpec(outsideDir) }));

    it("refuses to write output_file outside the roots", async () => {
      const out = join(outsideDir, "tlc.out");
      await expectOutsideRoots("tlc_check", {
        tla_file: writeSpec(tempDir),
        output_file: out,
      });
      expect(existsSync(out)).toBe(false);
    });

    it("refuses a cfg_file outside the roots", () =>
      expectOutsideRoots("tlc_simulate", {
        tla_file: writeSpec(tempDir),
        cfg_file: join(outsideDir, "Spec.cfg"),
      }));

    it("refuses a dump_path outside the roots", () =>
      expectOutsideRoots("tlc_check", {
        tla_file: writeSpec(tempDir),
        output_file: join(tempDir, "tlc.out"),
        generate_states: true,
        dump_path: join(outsideDir, "states"),
      }));

    it("refuses a symlink inside the root that points outside", async () => {
      const link = join(tempDir, "Linked.tla");
      symlinkSync(writeSpec(outsideDir, "Linked"), link);
      await expectOutsideRoots("tla_parse", { tla_file: link });
    });

    it("refuses writing through a symlinked directory that points outside", async () => {
      const linkDir = join(tempDir, "escape");
      symlinkSync(outsideDir, linkDir);
      await expectOutsideRoots("tla_state_graph", {
        traces_only: true,
        tlc_output: "",
        output_file: join(linkDir, "graph.json"),
      });
      expect(existsSync(join(outsideDir, "graph.json"))).toBe(false);
    });

    it("refuses tla_state_graph reads outside the roots", () =>
      expectOutsideRoots("tla_state_graph", {
        dot_file: join(outsideDir, "states.dot"),
        output_file: tempOutputFile(),
      }));

    it("refuses a disallowed extra_args flag", async () => {
      const result = await client.callTool({
        name: "tlc_simulate",
        arguments: {
          tla_file: writeSpec(tempDir),
          extra_args: ["-dump", "dot", join(outsideDir, "x")],
        },
      });
      expect(result.isError).toBe(true);
      expect(parseToolResult(result).error).toContain("not allowed");
    });

    it("refuses to run TLC next to a Java class file", async () => {
      const dir = join(tempDir, "overrides");
      mkdirSync(dir);
      writeFileSync(join(dir, "Evil.class"), "");
      const result = await client.callTool({
        name: "tlc_simulate",
        arguments: { tla_file: writeSpec(dir) },
      });
      expect(result.isError).toBe(true);
      expect(parseToolResult(result).error).toContain("Java class files");
    });
  });
});
