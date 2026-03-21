import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { absolutePath } from "../lib/schemas.js";
import { formatToolResponse, formatToolError } from "../lib/tool-helpers.js";
import { generatePlaygroundDataJs, generatePlaygroundGenJs, generatePlaygroundCss, type PlaygroundGraph, type DomainLabels } from "../generators/playground-gen.js";

export function replaceOrThrow(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(
      `Template cache-bust failed: could not find ${JSON.stringify(search)} in playground.html. ` +
      `The template may have been modified — update the replacement strings in playground-init.ts.`
    );
  }
  return source.replace(search, replacement);
}

function deriveTitle(filePath: string): string {
  // Look for a "playground" directory component and use the parent name
  const parts = filePath.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].toLowerCase() === "playground" && i > 0) {
      return parts[i - 1];
    }
  }
  // Fallback: use parent directory name of the file
  return basename(dirname(filePath));
}

export function registerPlaygroundInit(server: McpServer): void {
  const __filename = fileURLToPath(import.meta.url);
  const templatePath = join(dirname(__filename), "..", "templates", "playground.html");

  server.tool(
    "playground_init",
    "Create a playground directory, copy the HTML template, and optionally generate playground-data.js, playground-gen.js, and playground-gen.css from a state graph JSON file. " +
      "When state_graph_file is provided, generates a complete working playground deterministically. " +
      "Returns { html_path, data_js_path?, gen_js_path?, js_path?, css_path? }.",
    {
      target_dir: absolutePath.describe(
        "Absolute path to the playground directory (e.g., /Users/you/project/specs/MyModule/playground/)"
      ),
      state_graph_file: absolutePath.optional().describe(
        "Absolute path to a playground-format JSON file (written by tla_state_graph with output_file). " +
        "When provided, generates playground-data.js, playground-gen.js, and playground-gen.css automatically."
      ),
      title: z.string().optional().describe(
        "Title for the playground (e.g., the system name). Falls back to path-based heuristic if not provided."
      ),
      domain_labels: z.string().optional().describe(
        "JSON string containing domain-language labels: { actionLabels, invariantLabels, scenarioLabels, happyPathLabels }. " +
        "When provided, the generated playground-gen.js uses these instead of generic defaults."
      ),
    },
    async (params) => {
      try {
        await mkdir(params.target_dir, { recursive: true });
        const htmlPath = join(params.target_dir, "playground.html");

        // Read template and inject cache-busting query params so browsers
        // pick up fresh playground-data.js/playground-gen.js/css on every re-run.
        let html = await readFile(templatePath, "utf-8");
        const bust = "?v=" + Date.now();
        html = replaceOrThrow(html, 'href="playground-gen.css"', 'href="playground-gen.css' + bust + '"');
        html = replaceOrThrow(html, 'src="playground-data.js"', 'src="playground-data.js' + bust + '"');
        html = replaceOrThrow(html, 'src="playground-gen.js"', 'src="playground-gen.js' + bust + '"');
        await writeFile(htmlPath, html, "utf-8");

        // If state_graph_file provided, generate JS and CSS
        if (params.state_graph_file) {
          const graphJson = await readFile(params.state_graph_file, "utf-8");
          const graph: PlaygroundGraph = JSON.parse(graphJson);

          const title = params.title || deriveTitle(params.state_graph_file);
          const domainLabels: DomainLabels | undefined = params.domain_labels
            ? JSON.parse(params.domain_labels)
            : undefined;

          const dataJsContent = generatePlaygroundDataJs({ title, graph });
          const genJsContent = generatePlaygroundGenJs({ graph, domainLabels });
          const cssContent = generatePlaygroundCss();

          const dataJsPath = join(params.target_dir, "playground-data.js");
          const genJsPath = join(params.target_dir, "playground-gen.js");
          const cssPath = join(params.target_dir, "playground-gen.css");
          await Promise.all([
            writeFile(dataJsPath, dataJsContent, "utf-8"),
            writeFile(genJsPath, genJsContent, "utf-8"),
            writeFile(cssPath, cssContent, "utf-8"),
          ]);

          return formatToolResponse({
            html_path: htmlPath,
            data_js_path: dataJsPath,
            gen_js_path: genJsPath,
            js_path: genJsPath,
            css_path: cssPath,
          });
        }

        return formatToolResponse({ html_path: htmlPath });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    }
  );
}
