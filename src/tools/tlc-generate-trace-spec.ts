/**
 * tlc_generate_trace_spec — Generate a trace exploration spec from a TLC error trace.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runJava, sanitizeExtraArgs } from "../lib/process.js";
import { dirname, basename, join } from "node:path";
import { absolutePath } from "../lib/schemas.js";

export function registerTlcGenerateTraceSpec(server: McpServer): void {
  server.tool(
    "tlc_generate_trace_spec",
    "Run TLC model-checking on a TLA+ spec with -generateSpecTE to produce a Trace Explorer spec (SpecTE.tla / SpecTE.cfg). This is useful for debugging counter-examples: it generates a standalone spec that replays the error trace.",
    {
      tla_file: absolutePath.describe("Absolute path to the .tla file"),
      cfg_file: z
        .string()
        .optional()
        .describe("Path to the .cfg configuration file. Defaults to <tla_file>.cfg"),
      monolith: z
        .boolean()
        .default(true)
        .describe("Generate a monolithic SpecTE (single file). Set false for multi-file output."),
      extra_args: z
        .array(z.string())
        .optional()
        .describe("Additional TLC arguments"),
    },
    async ({ tla_file, cfg_file, monolith, extra_args }) => {
      try {
        const dir = dirname(tla_file);
        const args: string[] = [];

        args.push("-generateSpecTE");

        if (!monolith) {
          args.push("-nomonolith");
        }

        args.push("-tool", "-modelcheck");

        if (cfg_file) {
          args.push("-config", cfg_file);
        }

        if (extra_args) {
          args.push(...sanitizeExtraArgs(extra_args));
        }

        args.push(tla_file);

        const result = await runJava({
          className: "tlc2.TLC",
          args,
          cwd: dir,
        });

        const output = result.stdout + "\n" + result.stderr;

        // Look for generated SpecTE files
        const baseName = basename(tla_file, ".tla");
        const specTeTla = join(dir, `${baseName}_SpecTE.tla`);
        const specTeCfg = join(dir, `${baseName}_SpecTE.cfg`);

        // Also check for the standard "SpecTE" naming
        let tlaFile: string | null = null;
        let cfgFile: string | null = null;

        // TLC outputs the generated file paths
        const teFileMatch = output.match(/SpecTE(?:\.tla)?\s+(?:written to|generated|created)\s+(.+?)(?:\n|$)/i);
        if (teFileMatch) {
          tlaFile = teFileMatch[1].trim();
        }

        // Check common output patterns for the generated files
        if (!tlaFile) {
          if (output.includes("SpecTE.tla") || output.includes("_SpecTE.tla")) {
            tlaFile = output.includes("_SpecTE.tla") ? specTeTla : join(dir, "SpecTE.tla");
            cfgFile = output.includes("_SpecTE.cfg") ? specTeCfg : join(dir, "SpecTE.cfg");
          }
        }

        const success = result.exitCode === 0 || tlaFile !== null;

        let error: string | null = null;
        if (!success) {
          const errMatch = output.match(/Error:\s*(.+?)(?:\n|$)/);
          error = errMatch ? errMatch[1].trim() : `TLC exited with code ${result.exitCode}`;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success,
                  spec_te_tla: tlaFile,
                  spec_te_cfg: cfgFile,
                  error,
                  raw_output: output.trim(),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    },
  );
}
