#!/usr/bin/env node

/**
 * TLA+ MCP Server
 *
 * Exposes TLA+ toolchain (TLC, SANY, PlusCal, TLATeX) as MCP tools
 * with structured JSON responses.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerTlcCheck } from "./tools/tlc-check.js";
import { registerTlcSimulate } from "./tools/tlc-simulate.js";
import { registerTlaParse } from "./tools/tla-parse.js";
import { registerTlaEvaluate } from "./tools/tla-evaluate.js";
import { registerPcalTranslate } from "./tools/pcal-translate.js";
import { registerTlcGenerateTraceSpec } from "./tools/tlc-generate-trace-spec.js";
import { registerTlcCoverage } from "./tools/tlc-coverage.js";
import { registerTlaTex } from "./tools/tla-tex.js";
import { registerTlaStateGraph } from "./tools/tla-state-graph.js";
import { registerResources } from "./resources/specs.js";

const server = new McpServer({
  name: "tlaplus-mcp",
  version: "0.1.0",
});

// Register all tools
registerTlcCheck(server);
registerTlcSimulate(server);
registerTlaParse(server);
registerTlaEvaluate(server);
registerPcalTranslate(server);
registerTlcGenerateTraceSpec(server);
registerTlcCoverage(server);
registerTlaTex(server);
registerTlaStateGraph(server);

// Register resources
registerResources(server);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
