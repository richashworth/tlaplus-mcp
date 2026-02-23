/**
 * tla_evaluate — Evaluate a TLA+ expression using TLC.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runJava } from "../lib/process.js";
import { combineOutput, formatToolResponse, formatToolError } from "../lib/tool-helpers.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";

export function registerTlaEvaluate(server: McpServer): void {
  server.tool(
    "tla_evaluate",
    "Evaluate a constant TLA+ expression using TLC. Creates a temporary spec that prints the result of the expression.",
    {
      expression: z.string().describe("TLA+ expression to evaluate (e.g., '1 + 2', '{1,2,3} \\\\union {4,5}')"),
      imports: z
        .array(z.string())
        .optional()
        .describe("Modules to EXTEND (e.g., ['Integers', 'Sequences']). Defaults to ['Integers', 'Sequences', 'FiniteSets', 'TLC']"),
    },
    async ({ expression, imports }) => {
      const modules = imports ?? ["Integers", "Sequences", "FiniteSets", "TLC"];
      const id = randomUUID().replace(/-/g, "").slice(0, 12);
      const moduleName = `TlaEval_${id}`;
      const dir = tmpdir();
      const tlaPath = join(dir, `${moduleName}.tla`);
      const cfgPath = join(dir, `${moduleName}.cfg`);

      const tlaContent = [
        `---- MODULE ${moduleName} ----`,
        modules.length > 0 ? `EXTENDS ${modules.join(", ")}` : "",
        `ASSUME PrintT(${expression})`,
        `====`,
      ]
        .filter(Boolean)
        .join("\n");

      const cfgContent = "\\* empty config\n";

      try {
        writeFileSync(tlaPath, tlaContent, "utf-8");
        writeFileSync(cfgPath, cfgContent, "utf-8");

        const result = await runJava({
          className: "tlc2.TLC",
          args: ["-config", cfgPath, tlaPath],
          cwd: dir,
          timeout: 30,
        });

        const output = combineOutput(result);

        // TLC PrintT outputs the value on its own line to stdout.
        // Look for the printed value — it appears before the "Finished" or after the
        // "Starting..." line. We look for lines that are not TLC banners.
        let evaluated: string | null = null;

        // PrintT output appears in stdout, typically as a line by itself
        const lines = result.stdout.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip TLC banner/status lines
          if (
            !trimmed ||
            trimmed.startsWith("TLC2") ||
            trimmed.startsWith("Starting") ||
            trimmed.startsWith("Finished") ||
            trimmed.startsWith("@!@!@") ||
            trimmed.startsWith("\\*") ||
            trimmed.startsWith("Warning:") ||
            trimmed.startsWith("Model-checking") ||
            trimmed.startsWith("Running") ||
            trimmed.startsWith("Implied-temporal") ||
            trimmed.startsWith("The") ||
            trimmed.startsWith("Checking") ||
            trimmed.startsWith("Progress") ||
            trimmed.startsWith("Semantic processing")
          ) {
            continue;
          }
          evaluated = trimmed;
          break;
        }

        // Check for errors
        let error: string | null = null;
        if (result.exitCode !== 0 && !evaluated) {
          // Look for TLC error messages
          const errMatch = output.match(/Error:\s*(.+?)(?:\n|$)/);
          error = errMatch ? errMatch[1].trim() : `TLC exited with code ${result.exitCode}`;
        }

        return formatToolResponse({ result: evaluated, error, raw_output: output.trim() });
      } catch (err: unknown) {
        return formatToolError(err);
      } finally {
        // Clean up temp files
        try { unlinkSync(tlaPath); } catch { /* ignore */ }
        try { unlinkSync(cfgPath); } catch { /* ignore */ }
      }
    },
  );
}
