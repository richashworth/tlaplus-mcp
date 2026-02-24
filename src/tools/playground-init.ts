import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, copyFile } from "node:fs/promises";
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
      "Call this after the animator writes playground-gen.js and playground-gen.css.",
    {
      target_dir: absolutePath.describe(
        "Absolute path to the playground directory (e.g., specs/MyModule/playground/)"
      ),
    },
    async (params) => {
      try {
        await mkdir(params.target_dir, { recursive: true });
        const htmlPath = join(params.target_dir, "playground.html");
        await copyFile(templatePath, htmlPath);
        return formatToolResponse({ html_path: htmlPath });
      } catch (err: unknown) {
        return formatToolError(err);
      }
    }
  );
}
