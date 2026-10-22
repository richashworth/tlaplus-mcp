/**
 * tlc_generate_trace_spec — Generate a trace exploration spec from a TLC error trace.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  runJava,
  sanitizeExtraArgs,
  EXTRA_ARGS_DESCRIPTION,
} from "../lib/process.js";
import { dirname, basename, join, resolve } from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { absolutePath } from "../lib/schemas.js";
import { assertSafeSpecDir, resolveReadPath } from "../lib/paths.js";
import {
  combineOutput,
  formatToolResponse,
  formatToolError,
} from "../lib/tool-helpers.js";

export function registerTlcGenerateTraceSpec(server: McpServer): void {
  server.tool(
    "tlc_generate_trace_spec",
    "Run TLC model-checking on a TLA+ spec with -generateSpecTE to produce a Trace Explorer spec (SpecTE.tla / SpecTE.cfg). This is useful for debugging counter-examples: it generates a standalone spec that replays the error trace.",
    {
      tla_file: absolutePath.describe("Absolute path to the .tla file"),
      cfg_file: z
        .string()
        .optional()
        .describe(
          "Path to the .cfg configuration file. Defaults to <tla_file>.cfg",
        ),
      monolith: z
        .boolean()
        .default(true)
        .describe(
          "Generate a monolithic SpecTE (single file). Set false for multi-file output.",
        ),
      extra_args: z
        .array(z.string())
        .optional()
        .describe(EXTRA_ARGS_DESCRIPTION),
    },
    async ({ tla_file, cfg_file, monolith, extra_args }) => {
      try {
        const specFile = resolveReadPath(tla_file, "TLA+ file");
        const dir = dirname(specFile);
        assertSafeSpecDir(dir);
        const args: string[] = [];

        args.push("-generateSpecTE");

        if (!monolith) {
          args.push("-nomonolith");
        }

        args.push("-tool", "-modelcheck");

        if (cfg_file) {
          args.push(
            "-config",
            resolveReadPath(resolve(dir, cfg_file), "Config file"),
          );
        }

        if (extra_args) {
          args.push(...sanitizeExtraArgs(extra_args));
        }

        // Redirect TLC checkpoint metadata to a temp directory so it
        // doesn't pollute the user's project with states/ subdirectories.
        const metaDir = mkdtempSync(join(tmpdir(), "tlc-meta-"));
        args.push("-metadir", metaDir);

        args.push(specFile);

        let result;
        try {
          result = await runJava({
            className: "tlc2.TLC",
            args,
            cwd: dir,
          });
        } finally {
          try {
            rmSync(metaDir, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        }

        const output = combineOutput(result);

        // Only look at the two names TLC uses, both in the (scanned) spec
        // directory; never take a path from TLC's output.
        const baseName = basename(specFile, ".tla");
        const firstExisting = (...names: string[]): string | null =>
          names.map((n) => join(dir, n)).find((p) => existsSync(p)) ?? null;
        const generated = output.includes("SpecTE");
        const tlaFile = generated
          ? firstExisting(`${baseName}_SpecTE.tla`, "SpecTE.tla")
          : null;
        const cfgFile = tlaFile
          ? firstExisting(`${baseName}_SpecTE.cfg`, "SpecTE.cfg")
          : null;

        const success = result.exitCode === 0 || tlaFile !== null;

        let error: string | null = null;
        if (!success) {
          const errMatch = output.match(/Error:\s*(.+?)(?:\n|$)/);
          error = errMatch
            ? errMatch[1].trim()
            : `TLC exited with code ${result.exitCode}`;
        }

        return formatToolResponse({
          status: success ? "success" : "error",
          success,
          spec_te_tla: tlaFile,
          spec_te_cfg: cfgFile,
          error,
          raw_output: output,
        });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    },
  );
}
