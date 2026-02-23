/**
 * tla_tex — Typeset a TLA+ module with TLATeX.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runJava } from "../lib/process.js";
import { execFileSync } from "node:child_process";

export function registerTlaTex(server: McpServer): void {
  server.tool(
    "tla_tex",
    "Typeset a TLA+ specification into a PDF or DVI file using TLATeX. Requires a LaTeX installation (pdflatex or latex) to be available.",
    {
      tla_file: z.string().describe("Absolute path to the .tla file to typeset"),
      shade: z
        .boolean()
        .default(false)
        .describe("Add shading to comments"),
      number: z
        .boolean()
        .default(false)
        .describe("Add line numbers"),
      no_pcal_shade: z
        .boolean()
        .default(false)
        .describe("Do not shade PlusCal code"),
      gray_level: z
        .number()
        .default(0.85)
        .describe("Gray level for shading (0 = black, 1 = white)"),
      output_format: z
        .enum(["pdf", "dvi"])
        .default("pdf")
        .describe("Output format"),
    },
    async ({ tla_file, shade, number, no_pcal_shade, gray_level, output_format }) => {
      try {
        // Check for LaTeX availability
        const latexCmd = output_format === "pdf" ? "pdflatex" : "latex";
        try {
          execFileSync("which", [latexCmd], { stdio: "pipe" });
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `${latexCmd} not found on PATH. Install a LaTeX distribution (e.g., texlive or mactex) to use TLATeX.`,
                }),
              },
            ],
            isError: true,
          };
        }

        const args: string[] = [];

        if (shade) {
          args.push("-shade");
        }
        if (number) {
          args.push("-number");
        }
        if (no_pcal_shade) {
          args.push("-noPcalShade");
        }
        if (gray_level !== 0.85) {
          args.push("-grayLevel", String(gray_level));
        }
        if (output_format === "pdf") {
          args.push("-latexCommand", "pdflatex");
        }

        args.push(tla_file);

        const result = await runJava({
          className: "tla2tex.TLA",
          args,
        });

        const output = result.stdout + "\n" + result.stderr;
        const success = result.exitCode === 0;

        // Determine output file path
        const ext = output_format === "pdf" ? ".pdf" : ".dvi";
        const outputFile = tla_file.replace(/\.tla$/, ext);

        let error: string | null = null;
        if (!success) {
          const errMatch = output.match(/(?:Error|Exception|error):\s*(.+?)(?:\n|$)/i);
          error = errMatch ? errMatch[1].trim() : `TLATeX exited with code ${result.exitCode}`;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success,
                  output_file: success ? outputFile : null,
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
