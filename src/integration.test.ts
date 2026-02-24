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
import { createServer } from "./server.js";

// -- Test helpers -------------------------------------------------------------

let client: Client;

async function setupClientServer() {
  const server = createServer();
  const c = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    c.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client: c, server };
}

function parseToolResult(result: Awaited<ReturnType<typeof client.callTool>>): any {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

function getResultText(result: Awaited<ReturnType<typeof client.callTool>>): string {
  return (result.content as Array<{ text: string }>)[0].text;
}

/** Call a tool with a non-absolute path and assert schema validation rejects it. */
async function expectAbsolutePathRequired(toolName: string) {
  const result = await client.callTool({
    name: toolName,
    arguments: { tla_file: "relative/Spec.tla" },
  });
  expect(result.isError).toBe(true);
  expect(getResultText(result)).toContain("Path must be absolute");
}

/** Call a tool with a nonexistent absolute path and assert file-not-found error. */
async function expectFileNotFound(toolName: string) {
  const result = await client.callTool({
    name: toolName,
    arguments: { tla_file: "/nonexistent/Spec.tla" },
  });
  expect(result.isError).toBe(true);
  const parsed = parseToolResult(result);
  expect(parsed.error).toContain("not found");
}

// -- Tests --------------------------------------------------------------------

describe("MCP server integration", () => {
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    const setup = await setupClientServer();
    client = setup.client;
    server = setup.server;
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  // -- Tool registration ------------------------------------------------------

  describe("tool registration", () => {
    it("lists all expected tools", async () => {
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name).sort();
      expect(names).toEqual([
        "pcal_translate",
        "playground_init",
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
        expect(tool.description, `${tool.name} missing description`).toBeTruthy();
      }
    });

    it("every tool has an input schema with type=object", async () => {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        expect(tool.inputSchema.type, `${tool.name} schema type`).toBe("object");
      }
    });

    it("tla_state_graph has traces_only parameter in schema", async () => {
      const { tools } = await client.listTools();
      const stateGraph = tools.find(t => t.name === "tla_state_graph")!;
      expect(stateGraph.inputSchema.properties).toHaveProperty("traces_only");
    });

    it("tla_state_graph has dot_file as optional", async () => {
      const { tools } = await client.listTools();
      const stateGraph = tools.find(t => t.name === "tla_state_graph")!;
      const required = stateGraph.inputSchema.required ?? [];
      expect(required).not.toContain("dot_file");
    });
  });

  // -- Resource registration --------------------------------------------------

  describe("resource registration", () => {
    it("lists tla://specs resource", async () => {
      const { resources } = await client.listResources();
      const uris = resources.map(r => r.uri);
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
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          tlc_output: TLC_OUTPUT_INVARIANT,
        },
      });

      const parsed = parseToolResult(result);
      expect(parsed.status).toBe("success");
      expect(parsed.partial).toBe(true);
      expect(parsed.states).toHaveProperty("t1");
      expect(parsed.states).toHaveProperty("t2");
      expect(parsed.states.t1.vars).toEqual({ x: 1, y: 2 });
      expect(parsed.states.t2.vars).toEqual({ x: 3, y: 4 });
      expect(parsed.initialStateId).toBe("t1");
    });

    it("includes violations with synthetic state IDs", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          tlc_output: TLC_OUTPUT_INVARIANT,
        },
      });

      const parsed = parseToolResult(result);
      expect(parsed.violations).toHaveLength(1);
      expect(parsed.violations[0].type).toBe("invariant");
      expect(parsed.violations[0].invariant).toBe("TypeOK");
      expect(parsed.violations[0].trace[0].stateId).toBe("t1");
      expect(parsed.violations[0].trace[1].stateId).toBe("t2");
    });

    it("includes transitions between trace states", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          tlc_output: TLC_OUTPUT_INVARIANT,
        },
      });

      const parsed = parseToolResult(result);
      expect(parsed.transitions).toHaveProperty("t1");
      expect(parsed.transitions.t1).toHaveLength(1);
      expect(parsed.transitions.t1[0].target).toBe("t2");
    });

    it("includes happyPaths array", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          tlc_output: TLC_OUTPUT_INVARIANT,
        },
      });

      const parsed = parseToolResult(result);
      expect(parsed).toHaveProperty("happyPaths");
      expect(Array.isArray(parsed.happyPaths)).toBe(true);
    });

    it("handles temporal violation with lasso", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
          tlc_output: TLC_OUTPUT_LASSO,
        },
      });

      const parsed = parseToolResult(result);
      expect(parsed.partial).toBe(true);
      expect(parsed.violations).toHaveLength(1);
      expect(parsed.violations[0].type).toBe("temporal");
      expect(parsed.violations[0].property).toBe("Liveness");
      const lastEntry = parsed.violations[0].trace[parsed.violations[0].trace.length - 1];
      expect(lastEntry.action).toBe("Back to state");
    });

    it("errors when tlc_output is not provided", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          traces_only: true,
        },
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toContain("traces_only requires tlc_output");
    });

    it("errors when format is not playground", async () => {
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
      expect(parsed.error).toContain("traces_only mode only supports playground format");
    });
  });

  describe("tla_state_graph — normal mode errors", () => {
    it("errors when dot_file is missing", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toContain("dot_file is required");
    });

    it("errors when dot_file does not exist", async () => {
      const result = await client.callTool({
        name: "tla_state_graph",
        arguments: {
          dot_file: "/nonexistent/path/states.dot",
        },
      });

      expect(result.isError).toBe(true);
      const parsed = parseToolResult(result);
      expect(parsed.error).toContain("not found");
    });
  });

  // -- tlc_check --------------------------------------------------------------

  describe("tlc_check", () => {
    it("errors when tla_file does not exist", () => expectFileNotFound("tlc_check"));
    it("rejects non-absolute tla_file path", () => expectAbsolutePathRequired("tlc_check"));
  });

  // -- tlc_simulate -----------------------------------------------------------

  describe("tlc_simulate", () => {
    it("errors when tla_file does not exist", () => expectFileNotFound("tlc_simulate"));
    it("rejects non-absolute tla_file path", () => expectAbsolutePathRequired("tlc_simulate"));
  });

  // -- tla_parse --------------------------------------------------------------

  describe("tla_parse", () => {
    it("errors when tla_file does not exist", () => expectFileNotFound("tla_parse"));
    it("rejects non-absolute tla_file path", () => expectAbsolutePathRequired("tla_parse"));
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
    it("errors when tla_file does not exist", () => expectFileNotFound("pcal_translate"));
    it("rejects non-absolute tla_file path", () => expectAbsolutePathRequired("pcal_translate"));
  });

  // -- tlc_generate_trace_spec ------------------------------------------------

  describe("tlc_generate_trace_spec", () => {
    it("errors when tla_file does not exist", () => expectFileNotFound("tlc_generate_trace_spec"));
    it("rejects non-absolute tla_file path", () => expectAbsolutePathRequired("tlc_generate_trace_spec"));
  });

  // -- tlc_coverage -----------------------------------------------------------

  describe("tlc_coverage", () => {
    it("errors when tla_file does not exist", () => expectFileNotFound("tlc_coverage"));
    it("rejects non-absolute tla_file path", () => expectAbsolutePathRequired("tlc_coverage"));
  });

  // -- tla_tex ----------------------------------------------------------------

  describe("tla_tex", () => {
    it("errors when tla_file does not exist", () => expectFileNotFound("tla_tex"));
    it("rejects non-absolute tla_file path", () => expectAbsolutePathRequired("tla_tex"));
  });
});
