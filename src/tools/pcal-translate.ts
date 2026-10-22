/**
 * pcal_translate — Translate PlusCal to TLA+.
 */

import { z } from "zod";
import { dirname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runJava } from "../lib/process.js";
import { absolutePath } from "../lib/schemas.js";
import {
  assertSafeSpecDir,
  resolveReadPath,
  resolveWritePath,
} from "../lib/paths.js";
import {
  combineOutput,
  formatToolResponse,
  formatToolError,
  writeOrInline,
} from "../lib/tool-helpers.js";

export function registerPcalTranslate(server: McpServer): void {
  server.tool(
    "pcal_translate",
    "Translate PlusCal algorithm embedded in a TLA+ file to TLA+. Modifies the .tla file in-place by inserting/updating the TLA+ translation between the \\* BEGIN TRANSLATION and \\* END TRANSLATION markers.",
    {
      tla_file: absolutePath.describe(
        "Absolute path to the .tla file containing PlusCal code",
      ),
      fairness: z
        .enum(["wf", "sf", "wfNext", "nof"])
        .default("nof")
        .describe(
          "Fairness condition: wf (weak), sf (strong), wfNext (weak on Next), nof (none)",
        ),
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
      output_file: absolutePath
        .optional()
        .describe(
          "Optional. If provided, raw pcal.trans output is written to this file and the response contains output_file instead of raw_output. (Note: this is the raw TRANSLATOR output — the translated TLA+ spec is always written in-place to tla_file, reported as translated_file.)",
        ),
    },
    async ({
      tla_file,
      fairness,
      termination,
      no_cfg,
      label,
      line_width,
      output_file,
    }) => {
      try {
        // Translated in place, so this is a write as well as a read.
        const tlaFile = resolveReadPath(tla_file, "TLA+ file");
        assertSafeSpecDir(dirname(tlaFile));
        const outputFile =
          output_file && resolveWritePath(output_file, "output_file");
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

        args.push(tlaFile);

        const result = await runJava({
          className: "pcal.trans",
          args,
          cwd: dirname(tlaFile),
        });

        const output = combineOutput(result);
        const errors: string[] = [];
        const labelsAdded: string[] = [];

        // Parse errors
        const errorRe =
          /(?:Unrecoverable error|PlusCal error|error):?\s*(.+)/gi;
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

        return formatToolResponse({
          status: success ? "success" : "error",
          success,
          errors,
          labels_added: labelsAdded,
          // PlusCal translation is in-place: the translated TLA+ spec is
          // written back to tla_file. Reporting it explicitly so callers
          // don't have to remember the in-place semantics.
          translated_file: tlaFile,
          ...writeOrInline(output, outputFile),
        });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    },
  );
}
