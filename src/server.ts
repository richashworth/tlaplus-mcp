/**
 * TLA+ MCP Server factory.
 *
 * Separates server construction from transport so it can be used
 * both by the stdio entry point and by integration tests.
 */

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTlcCheck } from "./tools/tlc-check.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
import { registerTlcSimulate } from "./tools/tlc-simulate.js";
import { registerTlaParse } from "./tools/tla-parse.js";
import { registerTlaEvaluate } from "./tools/tla-evaluate.js";
import { registerPcalTranslate } from "./tools/pcal-translate.js";
import { registerTlcGenerateTraceSpec } from "./tools/tlc-generate-trace-spec.js";
import { registerTlcCoverage } from "./tools/tlc-coverage.js";
import { registerTlaTex } from "./tools/tla-tex.js";
import { registerTlaStateGraph } from "./tools/tla-state-graph.js";
import { registerPlaygroundInit } from "./tools/playground-init.js";
import { registerResources } from "./resources/specs.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "tlaplus-mcp",
    version: pkg.version,
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
  registerPlaygroundInit(server);
  // Register resources
  registerResources(server);

  return server;
}
