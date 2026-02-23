/**
 * tlc_coverage — Run TLC model checker with action coverage reporting.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, basename } from "node:path";
import { runJava, sanitizeExtraArgs } from "../lib/process.js";
import { parseTlcOutput } from "../parsers/tlc-output.js";
import { defaultCfgPath, combineOutput, deriveStatus, formatToolResponse, formatToolError } from "../lib/tool-helpers.js";

export function registerTlcCoverage(server: McpServer): void {
  server.tool(
    "tlc_coverage",
    "Run TLC model checker with action coverage reporting. Shows how many times each action was taken and how many distinct states it produced, helping identify under-explored parts of the spec.",
    {
      tla_file: z.string().describe("Absolute path to the .tla specification file"),
      cfg_file: z.string().optional().describe("Path to .cfg file (defaults to same basename as tla_file with .cfg extension)"),
      interval_minutes: z.number().positive().default(1).describe("Coverage reporting interval in minutes (default 1)"),
      workers: z.union([z.number().int().positive(), z.literal("auto")]).optional().describe("Number of worker threads, or 'auto' for all cores"),
      extra_args: z.array(z.string()).optional().describe("Additional raw arguments to pass to TLC"),
    },
    async (params) => {
      try {
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

        // Spec file goes last
        args.push(specName);

        const result = await runJava({
          className: "tlc2.TLC",
          args,
          cwd,
        });

        const output = combineOutput(result);
        const parsed = parseTlcOutput(output);
        const status = deriveStatus(parsed, result.timedOut);

        return formatToolResponse({
          status,
          states_found: parsed.statesFound ?? 0,
          distinct_states: parsed.statesDistinct ?? 0,
          duration: parsed.duration ?? null,
          coverage: parsed.coverage,
          errors: parsed.errors,
          raw_output: output.trim(),
        });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    },
  );
}
