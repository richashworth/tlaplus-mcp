/**
 * MCP resources for browsing TLA+ specs and TLC output.
 */

import fs from "node:fs";
import path from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../lib/config.js";

export function registerResources(server: McpServer): void {
  // tla://specs — list all .tla and .cfg files in the workspace
  server.resource(
    "specs",
    "tla://specs",
    { description: "List all .tla and .cfg files in the TLA+ workspace directory" },
    (uri) => {
      const { workspace } = loadConfig();

      let files: string[] = [];
      try {
        const entries = fs.readdirSync(workspace);
        files = entries.filter(
          (f) => f.endsWith(".tla") || f.endsWith(".cfg"),
        ).sort();
      } catch {
        // workspace dir may not exist
      }

      const text =
        files.length > 0
          ? files.join("\n")
          : "(no .tla or .cfg files found in workspace)";

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text,
          },
        ],
      };
    },
  );

  // tla://spec/{filename} — read a specific .tla or .cfg file
  server.resource(
    "spec",
    new ResourceTemplate("tla://spec/{filename}", { list: undefined }),
    { description: "Read a specific .tla or .cfg file from the workspace" },
    (uri, variables) => {
      const { workspace } = loadConfig();
      const filename = String(variables.filename);

      // Validate: no path traversal
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: "Error: invalid filename (path traversal not allowed)",
            },
          ],
        };
      }

      const filePath = path.join(workspace, filename);

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: content,
            },
          ],
        };
      } catch {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Error: file not found: ${filename}`,
            },
          ],
        };
      }
    },
  );

  // tla://output/latest — read the most recent TLC output
  server.resource(
    "latest-output",
    "tla://output/latest",
    { description: "Read the most recent TLC output file from the workspace" },
    (uri) => {
      const { workspace } = loadConfig();

      // Search for tlc-output.txt files in workspace and subdirectories
      let latestFile: string | null = null;
      let latestMtime = 0;

      function scanDir(dir: string, depth: number): void {
        if (depth > 3) return; // limit recursion
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            scanDir(fullPath, depth + 1);
          } else if (entry.isFile() && entry.name === "tlc-output.txt") {
            try {
              const stat = fs.statSync(fullPath);
              if (stat.mtimeMs > latestMtime) {
                latestMtime = stat.mtimeMs;
                latestFile = fullPath;
              }
            } catch {
              // skip inaccessible files
            }
          }
        }
      }

      scanDir(workspace, 0);

      if (!latestFile) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: "(no TLC output found in workspace)",
            },
          ],
        };
      }

      const content = fs.readFileSync(latestFile, "utf-8");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: content,
          },
        ],
      };
    },
  );
}
