import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TLC_JAR_PATH;
    delete process.env.TLC_JAR_SHA256;
    delete process.env.TLC_JAVA_OPTS;
    delete process.env.TLC_TIMEOUT;
    delete process.env.TLC_WORKSPACE;
    delete process.env.TLAPLUS_MCP_ROOTS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns defaults when no env vars set", () => {
    const config = loadConfig();
    expect(config.jarPath).toBeUndefined();
    expect(config.javaOpts).toEqual(["-Xmx4g", "-XX:+UseParallelGC"]);
    expect(config.timeout).toBe(300);
    expect(config.workspace).toBe(process.cwd());
  });

  it("reads TLC_JAR_PATH", () => {
    process.env.TLC_JAR_PATH = "/custom/tla2tools.jar";
    expect(loadConfig().jarPath).toBe("/custom/tla2tools.jar");
  });

  it("reads TLC_JAR_SHA256", () => {
    process.env.TLC_JAR_SHA256 = "ab".repeat(32);
    expect(loadConfig().jarSha256).toBe("ab".repeat(32));
  });

  it("splits TLC_JAVA_OPTS on whitespace", () => {
    process.env.TLC_JAVA_OPTS = "-Xmx8g  -Xms2g";
    expect(loadConfig().javaOpts).toEqual(["-Xmx8g", "-Xms2g"]);
  });

  it("filters empty strings from TLC_JAVA_OPTS", () => {
    process.env.TLC_JAVA_OPTS = "  ";
    expect(loadConfig().javaOpts).toEqual([]);
  });

  it("parses TLC_TIMEOUT as integer", () => {
    process.env.TLC_TIMEOUT = "60";
    expect(loadConfig().timeout).toBe(60);
  });

  it("falls back to default timeout when TLC_TIMEOUT is not a number", () => {
    process.env.TLC_TIMEOUT = "abc";
    expect(loadConfig().timeout).toBe(300);
  });

  it("falls back to default timeout when TLC_TIMEOUT is empty", () => {
    process.env.TLC_TIMEOUT = "";
    expect(loadConfig().timeout).toBe(300);
  });

  it("reads TLC_WORKSPACE", () => {
    process.env.TLC_WORKSPACE = "/my/specs";
    expect(loadConfig().workspace).toBe("/my/specs");
  });

  it("defaults roots to the workspace", () => {
    expect(loadConfig().roots).toEqual([process.cwd()]);
    process.env.TLC_WORKSPACE = "/my/specs";
    expect(loadConfig().roots).toEqual(["/my/specs"]);
  });

  it("splits TLAPLUS_MCP_ROOTS on colons", () => {
    process.env.TLAPLUS_MCP_ROOTS = "/a:/b::/c";
    expect(loadConfig().roots).toEqual(["/a", "/b", "/c"]);
  });

  it("defaults the workspace to the first root", () => {
    process.env.TLAPLUS_MCP_ROOTS = "/a:/b";
    expect(loadConfig().workspace).toBe("/a");
  });

  it("prefers TLC_WORKSPACE over the first root", () => {
    process.env.TLAPLUS_MCP_ROOTS = "/a:/b";
    process.env.TLC_WORKSPACE = "/b";
    expect(loadConfig().workspace).toBe("/b");
  });

  it("treats an empty TLAPLUS_MCP_ROOTS as unset", () => {
    process.env.TLAPLUS_MCP_ROOTS = "";
    expect(loadConfig().roots).toEqual([process.cwd()]);
    expect(loadConfig().workspace).toBe(process.cwd());
  });
});
