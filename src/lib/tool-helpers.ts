/**
 * Shared helper functions for MCP tool handlers.
 *
 * Reduces duplication of common patterns across tool files:
 * - default .cfg path derivation
 * - combining stdout + stderr
 * - deriving status from TLC results
 * - formatting tool responses and errors
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
): "violation" | "error" | "success" {
  if (parsed.violations.length > 0) return "violation";
  if (timedOut || parsed.errors.length > 0) return "error";
  return "success";
}

/** Format a successful tool response as MCP content. */
export function formatToolResponse(data: object) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

/**
 * If `outputFile` is provided, write `output` to it (creating parent dirs)
 * and return `{ output_file }`. Otherwise return `{ raw_output: output }`.
 *
 * Used by tools that always have a `raw_output` to share but want to give
 * the caller the option of redirecting it to a file to avoid context flooding.
 */
export function writeOrInline(
  output: string,
  outputFile: string | undefined,
): { output_file: string } | { raw_output: string } {
  if (outputFile) {
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, output, "utf-8");
    return { output_file: outputFile };
  }
  return { raw_output: output };
}

/** Format an error as an MCP tool error response. */
export function formatToolError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ status: "error", error: msg }),
      },
    ],
    isError: true as const,
  };
}
