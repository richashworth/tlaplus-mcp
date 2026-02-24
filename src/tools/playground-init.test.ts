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
});
