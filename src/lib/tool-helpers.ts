/**
 * Shared helper functions for MCP tool handlers.
 *
 * Reduces duplication of common patterns across tool files:
 * - default .cfg path derivation
 * - combining stdout + stderr
 * - deriving status from TLC results
 * - formatting tool responses and errors
 */

import type { RunJavaResult } from "./process.js";
import type { TlcResult } from "../parsers/tlc-output.js";

/** Derive the default .cfg path from a .tla file path. */
export function defaultCfgPath(tlaFile: string): string {
  return tlaFile.replace(/\.tla$/, ".cfg");
}

/** Combine stdout and stderr from a Java process result. */
export function combineOutput(result: RunJavaResult): string {
  return result.stdout + "\n" + result.stderr;
}

/** Derive a high-level status string from parsed TLC output. */
export function deriveStatus(
  parsed: TlcResult,
  timedOut: boolean,
): "timeout" | "violation" | "error" | "success" {
  if (timedOut) return "timeout";
  if (parsed.violations.length > 0) return "violation";
  if (parsed.errors.length > 0) return "error";
  return "success";
}

/** Format a successful tool response as MCP content. */
export function formatToolResponse(data: object) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Format an error as an MCP tool error response. */
export function formatToolError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
    isError: true as const,
  };
}
