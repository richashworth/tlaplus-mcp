import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { absolutePath } from "../lib/schemas.js";
import { formatToolResponse, formatToolError, validateFileExists } from "../lib/tool-helpers.js";
import { generatePlaygroundJs, generatePlaygroundCss, type PlaygroundGraph } from "../generators/playground-gen.js";

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
    "Create a playground directory, copy the HTML template, and optionally generate playground-gen.js/css from a state graph JSON file. " +
      "When state_graph_file is provided, generates a complete working playground deterministically. " +
      "Returns { html_path, js_path?, css_path? }.",
    {
      target_dir: absolutePath.describe(
        "Absolute path to the playground directory (e.g., /Users/you/project/specs/MyModule/playground/)"
      ),
      state_graph_file: absolutePath.optional().describe(
        "Absolute path to a playground-format JSON file (written by tla_state_graph with output_file). " +
        "When provided, generates playground-gen.js and playground-gen.css automatically."
      ),
    },
    async (params) => {
      try {
        await mkdir(params.target_dir, { recursive: true });
        const htmlPath = join(params.target_dir, "playground.html");

        // Read template and inject cache-busting query params so browsers
        // pick up fresh playground-gen.js/css on every re-run.
        let html = await readFile(templatePath, "utf-8");
        const bust = "?v=" + Date.now();
        html = html
          .replace('href="playground-gen.css"', 'href="playground-gen.css' + bust + '"')
          .replace('src="playground-gen.js"', 'src="playground-gen.js' + bust + '"');
        await writeFile(htmlPath, html, "utf-8");

        // If state_graph_file provided, generate JS and CSS
        if (params.state_graph_file) {
          validateFileExists(params.state_graph_file, "State graph file");
          const graphJson = await readFile(params.state_graph_file, "utf-8");
          const graph: PlaygroundGraph = JSON.parse(graphJson);

          // Derive title from path: look for "playground" dir, use parent name
          const title = deriveTitle(params.state_graph_file);

          const jsContent = generatePlaygroundJs({ title, graph });
          const cssContent = generatePlaygroundCss();

          const jsPath = join(params.target_dir, "playground-gen.js");
          const cssPath = join(params.target_dir, "playground-gen.css");
          await writeFile(jsPath, jsContent, "utf-8");
          await writeFile(cssPath, cssContent, "utf-8");

          return formatToolResponse({ html_path: htmlPath, js_path: jsPath, css_path: cssPath });
        }

        return formatToolResponse({ html_path: htmlPath });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    }
  );
}
