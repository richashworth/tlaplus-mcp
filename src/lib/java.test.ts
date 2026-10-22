import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJavaVersion, resolveJar, EXPECTED_SHA256 } from "./java.js";

describe("parseJavaVersion", () => {
  it("parses OpenJDK 17", () => {
    const output = `openjdk version "17.0.1" 2021-10-19
OpenJDK Runtime Environment (build 17.0.1+12-39)
OpenJDK 64-Bit Server VM (build 17.0.1+12-39, mixed mode, sharing)`;
    expect(parseJavaVersion(output)).toBe(17);
  });

  it("parses OpenJDK 11", () => {
    const output = `openjdk version "11.0.11" 2021-04-20
OpenJDK Runtime Environment AdoptOpenJDK-11.0.11+9 (build 11.0.11+9)
OpenJDK 64-Bit Server VM AdoptOpenJDK-11.0.11+9 (build 11.0.11+9, mixed mode)`;
    expect(parseJavaVersion(output)).toBe(11);
  });

  it("parses Oracle old-style 1.8 as Java 8", () => {
    const output = `java version "1.8.0_311"
Java(TM) SE Runtime Environment (build 1.8.0_311-b11)
Java HotSpot(TM) 64-Bit Server VM (build 25.311-b11, mixed mode)`;
    expect(parseJavaVersion(output)).toBe(8);
  });

  it("parses GraalVM / bare major version 21", () => {
    const output = `openjdk version "21" 2023-09-19
OpenJDK Runtime Environment GraalVM CE 21+35.1 (build 21+35-jvmci-23.1-b15)
OpenJDK 64-Bit Server VM GraalVM CE 21+35.1 (build 21+35-jvmci-23.1-b15, mixed mode, sharing)`;
    expect(parseJavaVersion(output)).toBe(21);
  });

  it("parses Oracle new-style Java 17", () => {
    const output = `java version "17.0.1" 2021-10-19 LTS
Java(TM) SE Runtime Environment (build 17.0.1+12-LTS-39)
Java HotSpot(TM) 64-Bit Server VM (build 17.0.1+12-LTS-39, mixed mode, sharing)`;
    expect(parseJavaVersion(output)).toBe(17);
  });

  it("parses Adoptium/Temurin Java 11", () => {
    const output = `openjdk version "11.0.17" 2022-10-18
OpenJDK Runtime Environment Temurin-11.0.17+8 (build 11.0.17+8)
OpenJDK 64-Bit Server VM Temurin-11.0.17+8 (build 11.0.17+8, mixed mode)`;
    expect(parseJavaVersion(output)).toBe(11);
  });

  it("parses Oracle old-style 1.7 as Java 7", () => {
    const output = `java version "1.7.0_80"
Java(TM) SE Runtime Environment (build 1.7.0_80-b15)
Java HotSpot(TM) 64-Bit Server VM (build 24.80-b11, mixed mode)`;
    expect(parseJavaVersion(output)).toBe(7);
  });

  it("throws on unparseable output", () => {
    expect(() => parseJavaVersion("not a version string")).toThrow(
      "Could not parse Java version",
    );
  });

  it("throws on empty string", () => {
    expect(() => parseJavaVersion("")).toThrow("Could not parse Java version");
  });
});

describe("resolveJar", () => {
  const originalEnv = { ...process.env };
  let dir: string;
  let jar: string;
  const contents = Buffer.from("PK\x03\x04 not really a jar");
  const sha = createHash("sha256").update(contents).digest("hex");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tlaplus-mcp-jar-"));
    jar = join(dir, "tla2tools.jar");
    writeFileSync(jar, contents);
    delete process.env.TLC_JAR_PATH;
    delete process.env.TLC_JAR_SHA256;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(dir, { recursive: true, force: true });
  });

  it("requires TLC_JAR_PATH", () => {
    expect(() => resolveJar()).toThrow(/TLC_JAR_PATH is not set/);
  });

  it("fails on a missing file", () => {
    process.env.TLC_JAR_PATH = join(dir, "missing.jar");
    expect(() => resolveJar()).toThrow(/file not found/);
  });

  it("fails closed when the SHA-256 does not match the pin", () => {
    expect(sha).not.toBe(EXPECTED_SHA256);
    process.env.TLC_JAR_PATH = jar;
    expect(() => resolveJar()).toThrow(/SHA-256 mismatch/);
  });

  it("fails when TLC_JAR_SHA256 does not match", () => {
    process.env.TLC_JAR_PATH = jar;
    process.env.TLC_JAR_SHA256 = "0".repeat(64);
    expect(() => resolveJar()).toThrow(/SHA-256 mismatch/);
  });

  it("accepts a jar matching TLC_JAR_SHA256", () => {
    process.env.TLC_JAR_PATH = jar;
    process.env.TLC_JAR_SHA256 = sha.toUpperCase();
    expect(resolveJar()).toBe(jar);
  });

  it("rejects a malformed TLC_JAR_SHA256", () => {
    process.env.TLC_JAR_PATH = jar;
    process.env.TLC_JAR_SHA256 = "abc";
    expect(() => resolveJar()).toThrow(/64 hex/);
  });
});
