/**
 * Shared test utilities for tool handler tests.
 */

import { vi } from "vitest";
import type { RunJavaResult } from "./lib/process.js";

/**
 * Create a mock McpServer that captures the tool handler registered via server.tool().
 * Returns the captured async handler so it can be called directly in tests.
 */
export function captureToolHandler(
  registerFn: (server: any) => void,
): (params: any) => Promise<any> {
  let handler: ((params: any) => Promise<any>) | undefined;

  const mockServer = {
    tool: (_name: string, _desc: string, _schema: any, fn: any) => {
      handler = fn;
    },
  };

  registerFn(mockServer);

  if (!handler) {
    throw new Error("registerFn did not call server.tool()");
  }

  return handler;
}

/** Build a default RunJavaResult with optional overrides. */
export function mockRunJavaResult(
  overrides: Partial<RunJavaResult> = {},
): RunJavaResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    ...overrides,
  };
}
