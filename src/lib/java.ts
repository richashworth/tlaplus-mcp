/**
 * Java detection, tla2tools.jar resolution and auto-download.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";

const JAR_URL = "https://nightly.tlapl.us/dist/tla2tools.jar";
const DEFAULT_JAR_DIR = join(homedir(), ".tlaplus-mcp", "lib");
const DEFAULT_JAR_PATH = join(DEFAULT_JAR_DIR, "tla2tools.jar");

/**
 * Parse the major Java version from `java -version` stderr output.
 *
 * Handles vendor formats:
 * - OpenJDK: `openjdk version "17.0.1"`
 * - Oracle old: `java version "1.8.0_311"` (1.x means major version x)
 * - GraalVM/modern: `openjdk version "21"`
 */
export function parseJavaVersion(versionOutput: string): number {
  const match = versionOutput.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) {
    throw new Error(
      `Could not parse Java version from output:\n${versionOutput}`
    );
  }

  const major = parseInt(match[1], 10);
  // "1.x.y" format: the real major version is x (e.g. 1.8 = Java 8)
  if (major === 1 && match[2] !== undefined) {
    return parseInt(match[2], 10);
  }
  return major;
}

const MIN_JAVA_VERSION = 11;

/** Check that java is on PATH and is JDK 11+. Throws a descriptive error if not. */
export function checkJava(): void {
  // java -version writes to stderr, so use spawnSync for direct stderr access
  const result = spawnSync("java", ["-version"], { encoding: "utf-8" });

  if (result.error) {
    throw new Error(
      "Java is required but not found on PATH (JDK 11+).\n" +
        "Install: brew install openjdk (macOS) or apt install default-jdk (Linux)"
    );
  }

  const output = result.stderr || result.stdout;
  const version = parseJavaVersion(output);
  if (version < MIN_JAVA_VERSION) {
    throw new Error(
      `Java ${MIN_JAVA_VERSION}+ is required but found Java ${version}.\n` +
        "Install: brew install openjdk (macOS) or apt install default-jdk (Linux)"
    );
  }
}

/**
 * Resolve the path to tla2tools.jar.
 *
 * Resolution order:
 * 1. TLC_JAR_PATH environment variable
 * 2. ~/.tlaplus-mcp/lib/tla2tools.jar (auto-download if missing)
 */
export async function resolveJar(): Promise<string> {
  const config = loadConfig();

  // 1. Explicit path from env
  if (config.jarPath) {
    if (!existsSync(config.jarPath)) {
      throw new Error(`TLC_JAR_PATH set but file not found: ${config.jarPath}`);
    }
    return config.jarPath;
  }

  // 2. Default location — download if missing
  if (existsSync(DEFAULT_JAR_PATH)) {
    return DEFAULT_JAR_PATH;
  }

  return downloadJar();
}

/** Download tla2tools.jar to ~/.tlaplus-mcp/lib/ */
async function downloadJar(): Promise<string> {
  mkdirSync(DEFAULT_JAR_DIR, { recursive: true });

  const response = await fetch(JAR_URL, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(
      `Failed to download tla2tools.jar from ${JAR_URL}: ${response.status} ${response.statusText}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Validate it's a ZIP/JAR (starts with PK magic bytes)
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error(
      `Downloaded file from ${JAR_URL} is not a valid JAR archive`
    );
  }

  writeFileSync(DEFAULT_JAR_PATH, buffer);
  return DEFAULT_JAR_PATH;
}

/** Get the jar path, throwing a user-friendly error if unavailable. */
let cachedJarPath: string | undefined;
export async function getJarPath(): Promise<string> {
  if (cachedJarPath) {
    if (!existsSync(cachedJarPath)) {
      cachedJarPath = undefined;
    } else {
      return cachedJarPath;
    }
  }
  checkJava();
  cachedJarPath = await resolveJar();
  return cachedJarPath;
}
