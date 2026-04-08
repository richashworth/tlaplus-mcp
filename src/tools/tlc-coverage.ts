/**
 * tlc_coverage — Run TLC model checker with action coverage reporting.
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

export function registerTlcCoverage(server: McpServer): void {
  server.tool(
    "tlc_coverage",
    "Run TLC model checker with action coverage reporting. Shows how many times each action was taken and how many distinct states it produced, helping identify under-explored parts of the spec.",
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
      interval_minutes: z
        .number()
        .positive()
        .default(1)
        .describe("Coverage reporting interval in minutes (default 1)"),
      workers: z
        .union([z.number().int().positive(), z.literal("auto")])
        .optional()
        .describe("Number of worker threads, or 'auto' for all cores"),
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

        const args: string[] = ["-modelcheck", "-tool"];

        // Config file
        const cfgFile = params.cfg_file ?? defaultCfgPath(params.tla_file);
        args.push("-config", cfgFile);

        // Coverage interval
        args.push("-coverage", String(params.interval_minutes));

        // Workers
        if (params.workers !== undefined) {
          args.push("-workers", String(params.workers));
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
          coverage: parsed.coverage,
          errors: parsed.errors,
          raw_output: output,
        });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    },
  );
}
