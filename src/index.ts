#!/usr/bin/env node

/**
 * TLA+ MCP Server
 *
 * Exposes TLA+ toolchain (TLC, SANY, PlusCal, TLATeX) as MCP tools
 * with structured JSON responses.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();

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
