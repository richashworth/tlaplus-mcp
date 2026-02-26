/**
 * tlc_check — Run TLC model checker in exhaustive mode.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, basename, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runJava, sanitizeExtraArgs } from "../lib/process.js";
import { parseTlcOutput } from "../parsers/tlc-output.js";
import { absolutePath } from "../lib/schemas.js";
import { defaultCfgPath, combineOutput, deriveStatus, formatToolResponse, formatToolError, validateFileExists } from "../lib/tool-helpers.js";

export function registerTlcCheck(server: McpServer): void {
  server.tool(
    "tlc_check",
    "Run TLC model checker in exhaustive breadth-first mode to verify a TLA+ specification. Checks all reachable states against invariants, properties, and (optionally) deadlock freedom.",
    {
      tla_file: absolutePath.describe("Absolute path to the .tla specification file"),
      cfg_file: z.string().optional().describe("Path to .cfg file (defaults to same basename as tla_file with .cfg extension)"),
      workers: z.union([z.number().int().positive(), z.literal("auto")]).optional().describe("Number of worker threads, or 'auto' for all cores"),
      deadlock: z.boolean().default(true).describe("Check for deadlock (default true). Set false to disable deadlock checking."),
      continue: z.boolean().default(false).describe("Continue model checking after finding a violation"),
      dfid: z.number().int().positive().optional().describe("Use depth-first iterative deepening with given depth"),
      diff_trace: z.boolean().optional().describe("Show only changed variables between trace states"),
      max_set_size: z.number().int().positive().optional().describe("Override TLC's max set size (default 1000000)"),
      generate_states: z.boolean().optional().describe("Dump state graph in DOT format"),
      dump_path: z.string().optional().describe("Override directory path for DOT state graph dump (default: <cwd>/states). Parent directories are created if needed."),
      extra_args: z.array(z.string()).optional().describe("Additional raw arguments to pass to TLC"),
      output_file: absolutePath.optional().describe("Write raw TLC output to this file instead of returning it inline. Response will contain output_file path instead of raw_output."),
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

        // Workers
        if (params.workers !== undefined) {
          args.push("-workers", String(params.workers));
        }

        // Deadlock: TLC's -deadlock flag DISABLES deadlock checking
        if (!params.deadlock) {
          args.push("-deadlock");
        }

        // Continue after violation
        if (params.continue) {
          args.push("-continue");
        }

        // Depth-first iterative deepening
        if (params.dfid !== undefined) {
          args.push("-dfid", String(params.dfid));
        }

        // Diff trace
        if (params.diff_trace) {
          args.push("-difftrace");
        }

        // Max set size
        if (params.max_set_size !== undefined) {
          args.push("-maxSetSize", String(params.max_set_size));
        }

        // Generate state graph
        let dumpFile: string | undefined;
        if (params.generate_states) {
          const dumpPath = params.dump_path ?? join(cwd, "states");
          // Only create parent directories when a custom dump path is specified;
          // the default "states" path is relative to cwd which already exists.
          if (params.dump_path) {
            mkdirSync(dirname(dumpPath), { recursive: true });
          }
          args.push("-dump", "dot,actionlabels,colorize", dumpPath);
          dumpFile = dumpPath + ".dot";
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
          try { rmSync(metaDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }

        const output = combineOutput(result);
        const parsed = parseTlcOutput(output);
        if (result.timedOut) {
          parsed.errors.push({ message: "TLC process killed: timeout exceeded" });
        }
        const status = deriveStatus(parsed, result.timedOut);

        // Write output to file or return inline
        const outputFileField: Record<string, string> = {};
        if (params.output_file) {
          mkdirSync(dirname(params.output_file), { recursive: true });
          writeFileSync(params.output_file, output, "utf-8");
          outputFileField.output_file = params.output_file;
        }

        return formatToolResponse({
          status,
          states_found: parsed.statesFound ?? 0,
          distinct_states: parsed.statesDistinct ?? 0,
          duration: parsed.duration ?? null,
          violations: parsed.violations,
          errors: parsed.errors,
          coverage: parsed.coverage,
          ...(dumpFile ? { dump_file: dumpFile } : {}),
          ...outputFileField,
          ...(params.output_file ? {} : { raw_output: output }),
        });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    },
  );
}
