/**
 * tla_parse — Parse a TLA+ module with SANY.
 */

import { dirname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runJava } from "../lib/process.js";
import { absolutePath } from "../lib/schemas.js";
import {
  combineOutput,
  formatToolResponse,
  formatToolError,
  validateFileExists,
} from "../lib/tool-helpers.js";

interface ParseError {
  message: string;
  location: { file: string; line: number; col: number } | null;
}

export function registerTlaParse(server: McpServer): void {
  server.tool(
    "tla_parse",
    "Parse and syntax-check a TLA+ module using SANY (Syntactic Analyzer). Returns parse errors and the list of modules parsed.",
    {
      tla_file: absolutePath.describe(
        "Absolute path to the .tla file to parse",
      ),
    },
    async ({ tla_file }) => {
      try {
        validateFileExists(tla_file, "TLA+ file");
        const result = await runJava({
          className: "tla2sany.SANY",
          args: [tla_file],
          cwd: dirname(tla_file),
        });

        const output = combineOutput(result);
        const errors: ParseError[] = [];
        const modulesParsed: string[] = [];

        // Parse "Parsing file" lines to find modules parsed
        // Also build a map from module name to file path for error locations
        const parsingFileRe = /Parsing file\s+(.+)/g;
        const moduleToPath = new Map<string, string>();
        let match: RegExpExecArray | null;
        while ((match = parsingFileRe.exec(output)) !== null) {
          const filePath = match[1].trim();
          modulesParsed.push(filePath);
          // Extract module name from file path (basename without .tla)
          const baseName = filePath
            .replace(/^.*[\\/]/, "")
            .replace(/\.tla$/, "");
          moduleToPath.set(baseName, filePath);
        }

        // Parse semantic errors: "Semantic error(s):" followed by error lines
        // Pattern: "line <line>, col <col> to line <line>, col <col> of module <mod>"
        // Walk backwards from each location match to find the actual error description
        const lines = output.split("\n");
        const semanticErrRe =
          /line\s+(\d+),\s*col\s+(\d+)\s+to\s+line\s+\d+,\s*col\s+\d+\s+of\s+module\s+(\S+)/;
        for (let i = 0; i < lines.length; i++) {
          match = semanticErrRe.exec(lines[i]);
          if (!match) continue;
          // Walk backwards to find the preceding non-empty line (the error description)
          let description = "";
          for (let j = i - 1; j >= 0; j--) {
            const prev = lines[j].trim();
            if (prev.length > 0) {
              description = prev;
              break;
            }
          }
          const locationStr = match[0];
          const moduleName = match[3];
          errors.push({
            message: description
              ? `${description} — ${locationStr}`
              : locationStr,
            location: {
              file: moduleToPath.get(moduleName) ?? moduleName,
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
        const encounteredRe =
          /Encountered\s+"(.+?)"\s+at\s+line\s+(\d+),\s*column\s+(\d+)/g;
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

        return formatToolResponse({
          status: valid ? "success" : "error",
          valid,
          errors,
          modules_parsed: modulesParsed,
          raw_output: output,
        });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    },
  );
}
