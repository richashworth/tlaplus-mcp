/**
 * pcal_translate — Translate PlusCal to TLA+.
 */

import { z } from "zod";
import { dirname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runJava } from "../lib/process.js";
import { absolutePath } from "../lib/schemas.js";
import { combineOutput, formatToolResponse, formatToolError, truncateOutput, validateFileExists } from "../lib/tool-helpers.js";

export function registerPcalTranslate(server: McpServer): void {
  server.tool(
    "pcal_translate",
    "Translate PlusCal algorithm embedded in a TLA+ file to TLA+. Modifies the .tla file in-place by inserting/updating the TLA+ translation between the \\* BEGIN TRANSLATION and \\* END TRANSLATION markers.",
    {
      tla_file: absolutePath.describe("Absolute path to the .tla file containing PlusCal code"),
      fairness: z
        .enum(["wf", "sf", "wfNext", "nof"])
        .default("nof")
        .describe("Fairness condition: wf (weak), sf (strong), wfNext (weak on Next), nof (none)"),
      termination: z
        .boolean()
        .default(false)
        .describe("Add termination detection to the spec"),
      no_cfg: z
        .boolean()
        .default(false)
        .describe("Do not generate a .cfg file"),
      label: z
        .boolean()
        .default(true)
        .describe("Add missing labels automatically"),
      line_width: z
        .number()
        .int()
        .default(78)
        .describe("Line width for the translation output"),
    },
    async ({ tla_file, fairness, termination, no_cfg, label, line_width }) => {
      try {
        validateFileExists(tla_file, "TLA+ file");
        const args: string[] = [];

        if (fairness !== "nof") {
          args.push("-fairness", fairness);
        }
        if (termination) {
          args.push("-termination");
        }
        if (no_cfg) {
          args.push("-nocfg");
        }
        if (label) {
          args.push("-label");
        }
        if (line_width !== 78) {
          args.push("-lineWidth", String(line_width));
        }

        args.push(tla_file);

        const result = await runJava({
          className: "pcal.trans",
          args,
          cwd: dirname(tla_file),
        });

        const output = combineOutput(result);
        const errors: string[] = [];
        const labelsAdded: string[] = [];

        // Parse errors
        const errorRe = /(?:Unrecoverable error|PlusCal error|error):?\s*(.+)/gi;
        let match: RegExpExecArray | null;
        while ((match = errorRe.exec(output)) !== null) {
          errors.push(match[1].trim());
        }

        // Parse labels added
        const labelRe = /--\s*added\s+label\s+(\w+)/gi;
        while ((match = labelRe.exec(output)) !== null) {
          labelsAdded.push(match[1]);
        }

        const success = result.exitCode === 0 && errors.length === 0;

        // Determine output file (same as input for in-place translation)
        const outputFile = tla_file;

        return formatToolResponse({
          status: success ? "success" : "error",
          success,
          errors,
          labels_added: labelsAdded,
          output_file: outputFile,
          raw_output: truncateOutput(output),
        });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    },
  );
}
