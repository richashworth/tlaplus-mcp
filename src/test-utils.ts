/**
 * Shared test utilities for tool handler tests.
 */

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

/**
 * vi.mock factory for lib/paths.js that skips root confinement but keeps the
 * "not found" check, using whatever node:fs mock the test file installs.
 */
export async function passthroughPathsMock() {
  const { existsSync } = await import("node:fs");
  return {
    resolveReadPath: (p: string, label: string) => {
      if (!existsSync(p)) throw new Error(`${label} not found: ${p}`);
      return p;
    },
    resolveWritePath: (p: string) => p,
    assertSafeSpecDir: () => {},
  };
}
