/**
 * tla_evaluate — Evaluate a TLA+ expression using TLC.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runJava } from "../lib/process.js";
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
          args: ["-tool", "-config", cfgPath, tlaPath],
          cwd: dir,
          timeout: 30,
        });

        const output = result.stdout + "\n" + result.stderr;

        // Try structured tool-mode parsing first: look for @!@!@STARTMSG/@!@!@ENDMSG markers
        // and extract the body of message code 2186 (PrintT output).
        let evaluated: string | null = null;

        const MSG_START = /^@!@!@STARTMSG (\d+):(\d+) @!@!@$/;
        const MSG_END = /^@!@!@ENDMSG (\d+) @!@!@$/;
        const allLines = result.stdout.split("\n");
        let currentCode: number | null = null;
        const bodyLines: string[] = [];

        for (const line of allLines) {
          const startMatch = MSG_START.exec(line);
          if (startMatch) {
            currentCode = parseInt(startMatch[1], 10);
            bodyLines.length = 0;
            continue;
          }

          const endMatch = MSG_END.exec(line);
          if (endMatch && currentCode !== null) {
            if (currentCode === 2186) {
              evaluated = bodyLines.join("\n").trim();
            }
            currentCode = null;
            bodyLines.length = 0;
            continue;
          }

          if (currentCode !== null) {
            bodyLines.push(line);
          }
        }

        // Fallback: prefix-blocklist parsing for non-tool-mode output
        if (evaluated === null) {
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
        }

        // Check for errors
        let error: string | null = null;
        if (result.exitCode !== 0 && !evaluated) {
          // Look for TLC error messages
          const errMatch = output.match(/Error:\s*(.+?)(?:\n|$)/);
          error = errMatch ? errMatch[1].trim() : `TLC exited with code ${result.exitCode}`;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ result: evaluated, error, raw_output: output.trim() }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      } finally {
        // Clean up temp files
        try { unlinkSync(tlaPath); } catch { /* ignore */ }
        try { unlinkSync(cfgPath); } catch { /* ignore */ }
      }
    },
  );
}
