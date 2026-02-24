/**
 * tlc_check — Run TLC model checker in exhaustive mode.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, basename, join } from "node:path";
import { runJava } from "../lib/process.js";
import { parseTlcOutput } from "../parsers/tlc-output.js";

export function registerTlcCheck(server: McpServer): void {
  server.tool(
    "tlc_check",
    "Run TLC model checker in exhaustive breadth-first mode to verify a TLA+ specification. Checks all reachable states against invariants, properties, and (optionally) deadlock freedom.",
    {
      tla_file: z.string().describe("Absolute path to the .tla specification file"),
      cfg_file: z.string().optional().describe("Path to .cfg file (defaults to same basename as tla_file with .cfg extension)"),
      workers: z.union([z.number().int().positive(), z.literal("auto")]).optional().describe("Number of worker threads, or 'auto' for all cores"),
      deadlock: z.boolean().default(true).describe("Check for deadlock (default true). Set false to disable deadlock checking."),
      continue: z.boolean().default(false).describe("Continue model checking after finding a violation"),
      dfid: z.number().int().positive().optional().describe("Use depth-first iterative deepening with given depth"),
      diff_trace: z.boolean().optional().describe("Show only changed variables between trace states"),
      max_set_size: z.number().int().positive().optional().describe("Override TLC's max set size (default 1000000)"),
      generate_states: z.boolean().optional().describe("Dump state graph in DOT format"),
      extra_args: z.array(z.string()).optional().describe("Additional raw arguments to pass to TLC"),
    },
    async (params) => {
      try {
        const cwd = dirname(params.tla_file);
        const specName = basename(params.tla_file);

        const args: string[] = ["-modelcheck", "-tool"];

        // Config file
        const cfgFile = params.cfg_file ?? params.tla_file.replace(/\.tla$/, ".cfg");
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
        if (params.generate_states) {
          const dumpPath = join(cwd, "states");
          args.push("-dump", "dot,actionlabels,colorize", dumpPath);
        }

        // Extra args
        if (params.extra_args) {
          args.push(...params.extra_args);
        }

        // Spec file goes last
        args.push(specName);

        const result = await runJava({
          className: "tlc2.TLC",
          args,
          cwd,
        });

        const output = result.stdout + "\n" + result.stderr;
        const parsed = parseTlcOutput(output);

        const status = parsed.violations.length > 0
          ? "violation"
          : parsed.errors.length > 0
            ? "error"
            : "success";

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status,
                  states_found: parsed.statesFound ?? 0,
                  distinct_states: parsed.statesDistinct ?? 0,
                  duration: parsed.duration ?? null,
                  violations: parsed.violations,
                  errors: parsed.errors,
                  coverage: parsed.coverage,
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
