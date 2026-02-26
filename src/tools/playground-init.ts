import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { absolutePath } from "../lib/schemas.js";
import { formatToolResponse, formatToolError } from "../lib/tool-helpers.js";

export function registerPlaygroundInit(server: McpServer): void {
  const __filename = fileURLToPath(import.meta.url);
  const templatePath = join(dirname(__filename), "..", "templates", "playground.html");

  server.tool(
    "playground_init",
    "Create a playground directory and copy the HTML template into it. " +
      "Call this after the animator writes playground-gen.js and playground-gen.css. " +
      "Returns { html_path: string } with the absolute path to the copied playground.html.",
    {
      target_dir: absolutePath.describe(
        "Absolute path to the playground directory (e.g., /Users/you/project/specs/MyModule/playground/)"
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

        return formatToolResponse({ html_path: htmlPath });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    }
  );
}
