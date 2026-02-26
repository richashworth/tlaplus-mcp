import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureToolHandler } from "../test-utils.js";
import { registerPlaygroundInit } from "./playground-init.js";

describe("playground_init", () => {
  let handler: (params: any) => Promise<any>;
  let tempDir: string;

  beforeEach(async () => {
    handler = captureToolHandler(registerPlaygroundInit);
    tempDir = await mkdtemp(join(tmpdir(), "playground-init-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates target directory and copies template", async () => {
    const targetDir = join(tempDir, "playground");
    const result = await handler({ target_dir: targetDir });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.html_path).toBe(join(targetDir, "playground.html"));
    expect(existsSync(parsed.html_path)).toBe(true);

    // Verify content matches the bundled template
    const copied = await readFile(parsed.html_path, "utf-8");
    expect(copied).toContain("<!DOCTYPE html>");
    expect(copied).toContain("System Playground");
  });

  it("creates nested parent directories", async () => {
    const targetDir = join(tempDir, "a", "b", "c", "playground");
    const result = await handler({ target_dir: targetDir });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.html_path).toBe(join(targetDir, "playground.html"));
    expect(existsSync(parsed.html_path)).toBe(true);
  });

  it("overwrites existing playground.html", async () => {
    const targetDir = join(tempDir, "playground");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "playground.html"), "old content");

    const result = await handler({ target_dir: targetDir });
    const parsed = JSON.parse(result.content[0].text);

    const content = await readFile(parsed.html_path, "utf-8");
    expect(content).not.toBe("old content");
    expect(content).toContain("<!DOCTYPE html>");
  });

  it("returns correct html_path", async () => {
    const targetDir = join(tempDir, "pg");
    const result = await handler({ target_dir: targetDir });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.html_path).toBe(join(targetDir, "playground.html"));
  });

  it("returns error for unwritable target directory", async () => {
    // Create a read-only parent so mkdir fails
    const readonlyDir = join(tempDir, "readonly");
    await mkdir(readonlyDir);
    await chmod(readonlyDir, 0o444);

    const targetDir = join(readonlyDir, "sub", "playground");
    const result = await handler({ target_dir: targetDir });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("error");

    // Restore permissions for cleanup
    await chmod(readonlyDir, 0o755);
  });

  describe("with state_graph_file", () => {
    const GRAPH_FIXTURE = {
      status: "success",
      partial: false,
      initialStateId: "1",
      states: {
        "1": { label: "State 1", vars: { name: "alice", count: 0 } },
        "2": { label: "State 2", vars: { name: "bob", count: 1 } },
      },
      transitions: {
        "1": [{ action: "Step", label: "Step", target: "2" }],
      },
      invariants: ["TypeOK"],
      violations: [
        {
          id: "v1",
          type: "invariant",
          summary: "TypeOK violated",
          invariant: "TypeOK",
          trace: [
            { stateId: "1", action: null },
            { stateId: "2", action: "Step" },
          ],
        },
      ],
      happyPaths: [
        {
          trace: [
            { stateId: "1", action: null },
            { stateId: "2", action: "Step" },
          ],
        },
      ],
    };

    it("generates all 3 files when state_graph_file is provided", async () => {
      const targetDir = join(tempDir, "MySpec", "playground");
      const graphFile = join(tempDir, "MySpec", "playground", "graph.json");

      await mkdir(join(tempDir, "MySpec", "playground"), { recursive: true });
      await writeFile(graphFile, JSON.stringify(GRAPH_FIXTURE));

      const result = await handler({ target_dir: targetDir, state_graph_file: graphFile });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.html_path).toBe(join(targetDir, "playground.html"));
      expect(parsed.js_path).toBe(join(targetDir, "playground-gen.js"));
      expect(parsed.css_path).toBe(join(targetDir, "playground-gen.css"));

      expect(existsSync(parsed.html_path)).toBe(true);
      expect(existsSync(parsed.js_path)).toBe(true);
      expect(existsSync(parsed.css_path)).toBe(true);
    });

    it("generated JS contains all required globals", async () => {
      const targetDir = join(tempDir, "gen-globals", "playground");
      const graphFile = join(tempDir, "gen-globals", "graph.json");

      await mkdir(join(tempDir, "gen-globals"), { recursive: true });
      await writeFile(graphFile, JSON.stringify(GRAPH_FIXTURE));

      await handler({ target_dir: targetDir, state_graph_file: graphFile });

      const jsContent = await readFile(join(targetDir, "playground-gen.js"), "utf-8");
      expect(jsContent).toContain("var PLAYGROUND_TITLE");
      expect(jsContent).toContain("var GRAPH");
      expect(jsContent).toContain("var ACTION_LABELS");
      expect(jsContent).toContain("var INVARIANT_LABELS");
      expect(jsContent).toContain("var SCENARIO_LABELS");
      expect(jsContent).toContain("var HAPPY_PATHS");
      expect(jsContent).toContain("function renderState");
      expect(jsContent).toContain("function renderStateVisual");
    });

    it("returns error for missing state_graph_file", async () => {
      const targetDir = join(tempDir, "missing");
      const result = await handler({
        target_dir: targetDir,
        state_graph_file: join(tempDir, "nonexistent.json"),
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("State graph file not found");
    });

    it("backward compat: no state_graph_file returns only html_path", async () => {
      const targetDir = join(tempDir, "compat");
      const result = await handler({ target_dir: targetDir });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.html_path).toBeDefined();
      expect(parsed.js_path).toBeUndefined();
      expect(parsed.css_path).toBeUndefined();
    });
  });
});
