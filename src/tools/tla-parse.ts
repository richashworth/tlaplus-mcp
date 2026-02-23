/**
 * tla_parse — Parse a TLA+ module with SANY.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runJava } from "../lib/process.js";

interface ParseError {
  message: string;
  location: { file: string; line: number; col: number } | null;
}

export function registerTlaParse(server: McpServer): void {
  server.tool(
    "tla_parse",
    "Parse and syntax-check a TLA+ module using SANY (Syntactic Analyzer). Returns parse errors and the list of modules parsed.",
    {
      tla_file: z.string().describe("Absolute path to the .tla file to parse"),
    },
    async ({ tla_file }) => {
      try {
        const result = await runJava({
          className: "tla2sany.SANY",
          args: [tla_file],
        });

        const output = result.stdout + "\n" + result.stderr;
        const errors: ParseError[] = [];
        const modulesParsed: string[] = [];

        // Parse "Parsing file" lines to find modules parsed
        const parsingFileRe = /Parsing file\s+(.+)/g;
        let match: RegExpExecArray | null;
        while ((match = parsingFileRe.exec(output)) !== null) {
          modulesParsed.push(match[1].trim());
        }

        // Parse semantic errors: "Semantic error(s):" followed by error lines
        // Pattern: "line <line>, col <col> to line <line>, col <col> of module <mod>"
        const semanticErrRe = /line\s+(\d+),\s*col\s+(\d+)\s+to\s+line\s+\d+,\s*col\s+\d+\s+of\s+module\s+(\S+)/g;
        while ((match = semanticErrRe.exec(output)) !== null) {
          // Get the message from the line(s) before this location
          errors.push({
            message: match[0],
            location: {
              file: match[3],
              line: parseInt(match[1], 10),
              col: parseInt(match[2], 10),
            },
          });
        }

        // Parse error lines like "***Parse Error***" or "Semantic error"
        const parseErrRe = /\*\*\*\s*Parse Error\s*\*\*\*.*$/gm;
        while ((match = parseErrRe.exec(output)) !== null) {
          errors.push({
            message: match[0].trim(),
            location: null,
          });
        }

        // Look for "Encountered" error lines from SANY
        const encounteredRe = /Encountered\s+"(.+?)"\s+at\s+line\s+(\d+),\s*column\s+(\d+)/g;
        while ((match = encounteredRe.exec(output)) !== null) {
          errors.push({
            message: `Encountered "${match[1]}" at line ${match[2]}, column ${match[3]}`,
            location: {
              file: tla_file,
              line: parseInt(match[2], 10),
              col: parseInt(match[3], 10),
            },
          });
        }

        // Check for abort/fatal messages
        const abortRe = /(?:Fatal|Abort|Could not parse).*$/gm;
        let abortMatch: RegExpExecArray | null;
        while ((abortMatch = abortRe.exec(output)) !== null) {
          const msg = abortMatch[0].trim();
          if (!errors.some((e) => e.message === msg)) {
            errors.push({ message: msg, location: null });
          }
        }

        const valid = result.exitCode === 0 && errors.length === 0;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { valid, errors, modules_parsed: modulesParsed, raw_output: output.trim() },
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
