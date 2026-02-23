import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TLC_JAR_PATH;
    delete process.env.TLC_JAVA_OPTS;
    delete process.env.TLC_TIMEOUT;
    delete process.env.TLC_WORKSPACE;
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
});
