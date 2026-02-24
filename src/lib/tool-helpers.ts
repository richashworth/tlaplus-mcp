/**
 * Shared helper functions for MCP tool handlers.
 *
 * Reduces duplication of common patterns across tool files:
 * - default .cfg path derivation
 * - combining stdout + stderr
 * - deriving status from TLC results
 * - formatting tool responses and errors
 */

import { existsSync } from "node:fs";
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

/** Truncate output to stay within a byte-size budget. */
export function truncateOutput(output: string, maxBytes: number = 102400): string {
  const trimmed = output.trim();
  if (Buffer.byteLength(trimmed, "utf-8") <= maxBytes) return trimmed;
  let truncated = Buffer.from(trimmed).subarray(0, maxBytes).toString("utf-8");
  // Buffer.subarray can split a multi-byte codepoint, producing U+FFFD at the end
  if (truncated.endsWith("\uFFFD")) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "\n[truncated]";
}

/** Validate that a file exists, throwing a descriptive error if not. */
export function validateFileExists(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
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
    content: [{ type: "text" as const, text: JSON.stringify({ status: "error", error: msg }) }],
    isError: true as const,
  };
}
