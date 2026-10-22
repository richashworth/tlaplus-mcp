#!/usr/bin/env node

/**
 * TLA+ MCP Server
 *
 * Exposes TLA+ toolchain (TLC, SANY, PlusCal, TLATeX) as MCP tools
 * with structured JSON responses.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { getJarPath } from "./lib/java.js";

const server = createServer();

// Verify tla2tools.jar at startup so misconfiguration shows in the MCP log.
// Non-fatal: every tool call re-verifies and returns the error to the client.
getJarPath().catch((err: unknown) => {
  console.error(
    "tlaplus-mcp:",
    err instanceof Error ? err.message : String(err),
  );
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport).catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});
