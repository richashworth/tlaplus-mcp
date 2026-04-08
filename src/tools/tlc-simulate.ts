/**
 * tlc_simulate — Run TLC in simulation mode for random trace exploration.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, basename, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { runJava, sanitizeExtraArgs } from "../lib/process.js";
import { parseTlcOutput } from "../parsers/tlc-output.js";
import { absolutePath } from "../lib/schemas.js";
import {
  defaultCfgPath,
  combineOutput,
  deriveStatus,
  formatToolResponse,
  formatToolError,
  validateFileExists,
} from "../lib/tool-helpers.js";

export function registerTlcSimulate(server: McpServer): void {
  server.tool(
    "tlc_simulate",
    "Run TLC in simulation mode to randomly explore execution traces. Faster than exhaustive checking but not complete — useful for large state spaces or quick smoke tests.",
    {
      tla_file: absolutePath.describe(
        "Absolute path to the .tla specification file",
      ),
      cfg_file: z
        .string()
        .optional()
        .describe(
          "Path to .cfg file (defaults to same basename as tla_file with .cfg extension)",
        ),
      depth: z
        .number()
        .int()
        .positive()
        .default(100)
        .describe("Maximum depth of each simulation trace (default 100)"),
      num_traces: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of traces to generate"),
      seed: z
        .number()
        .int()
        .optional()
        .describe("Random seed for reproducibility"),
      aril: z
        .number()
        .int()
        .optional()
        .describe("Aril (adjusts the random seed)"),
      workers: z
        .union([z.number().int().positive(), z.literal("auto")])
        .optional()
        .describe("Number of worker threads, or 'auto' for all cores"),
      deadlock: z
        .boolean()
        .default(true)
        .describe(
          "Check for deadlock (default true). Set false to disable deadlock checking.",
        ),
      diff_trace: z
        .boolean()
        .optional()
        .describe("Show only changed variables between trace states"),
      extra_args: z
        .array(z.string())
        .optional()
        .describe("Additional raw arguments to pass to TLC"),
    },
    async (params) => {
      try {
        validateFileExists(params.tla_file, "TLA+ file");
        const cwd = dirname(params.tla_file);
        const specName = basename(params.tla_file);

        // Build simulate flag with optional num traces
        let simulateFlag = "num=1";
        if (params.num_traces !== undefined) {
          simulateFlag = `num=${params.num_traces}`;
        }

        const args: string[] = ["-simulate", simulateFlag, "-tool"];

        // Config file
        const cfgFile = params.cfg_file ?? defaultCfgPath(params.tla_file);
        args.push("-config", cfgFile);

        // Depth
        args.push("-depth", String(params.depth));

        // Seed
        if (params.seed !== undefined) {
          args.push("-seed", String(params.seed));
        }

        // Aril
        if (params.aril !== undefined) {
          args.push("-aril", String(params.aril));
        }

        // Workers
        if (params.workers !== undefined) {
          args.push("-workers", String(params.workers));
        }

        // Deadlock: TLC's -deadlock flag DISABLES deadlock checking
        if (!params.deadlock) {
          args.push("-deadlock");
        }

        // Diff trace
        if (params.diff_trace) {
          args.push("-difftrace");
        }

        // Extra args
        if (params.extra_args) {
          args.push(...sanitizeExtraArgs(params.extra_args));
        }

        // Redirect TLC checkpoint metadata to a temp directory so it
        // doesn't pollute the user's project with states/ subdirectories.
        const metaDir = mkdtempSync(join(tmpdir(), "tlc-meta-"));
        args.push("-metadir", metaDir);

        // Spec file goes last
        args.push(specName);

        let result;
        try {
          result = await runJava({
            className: "tlc2.TLC",
            args,
            cwd,
          });
        } finally {
          try {
            rmSync(metaDir, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        }

        const output = combineOutput(result);
        const parsed = parseTlcOutput(output);
        if (result.timedOut) {
          parsed.errors.push({
            message: "TLC process killed: timeout exceeded",
          });
        }
        const status = deriveStatus(parsed, result.timedOut);

        return formatToolResponse({
          status,
          states_found: parsed.statesFound ?? 0,
          distinct_states: parsed.statesDistinct ?? 0,
          duration: parsed.duration ?? null,
          violations: parsed.violations,
          errors: parsed.errors,
          coverage: parsed.coverage,
          raw_output: output,
        });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    },
  );
}
