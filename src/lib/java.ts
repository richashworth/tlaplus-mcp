/**
 * Java detection and tla2tools.jar verification.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { loadConfig } from "./config.js";

// Version and checksum must be updated together.
export const TLAPLUS_VERSION = "1.7.4";
export const EXPECTED_SHA256 =
  "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";

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
      `Could not parse Java version from output:\n${versionOutput}`,
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
        "Install: brew install openjdk (macOS) or apt install default-jdk (Linux)",
    );
  }

  const output = result.stderr || result.stdout;
  const version = parseJavaVersion(output);
  if (version < MIN_JAVA_VERSION) {
    throw new Error(
      `Java ${MIN_JAVA_VERSION}+ is required but found Java ${version}.\n` +
        "Install: brew install openjdk (macOS) or apt install default-jdk (Linux)",
    );
  }
}

/**
 * Resolve TLC_JAR_PATH and verify its SHA-256 against the pinned value
 * (or TLC_JAR_SHA256). Throws on a missing variable, file or mismatch.
 */
export function resolveJar(): string {
  const config = loadConfig();

  if (!config.jarPath) {
    throw new Error(
      `TLC_JAR_PATH is not set. Download tla2tools.jar v${TLAPLUS_VERSION} from ` +
        `https://github.com/tlaplus/tlaplus/releases/tag/v${TLAPLUS_VERSION} ` +
        "and set TLC_JAR_PATH to its absolute path.",
    );
  }

  const expected = (config.jarSha256 ?? EXPECTED_SHA256).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error("TLC_JAR_SHA256 must be 64 hex characters");
  }

  let contents: Buffer;
  try {
    contents = readFileSync(config.jarPath);
  } catch {
    throw new Error(`TLC_JAR_PATH set but file not found: ${config.jarPath}`);
  }

  const actual = createHash("sha256").update(contents).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `SHA-256 mismatch for ${config.jarPath}.\n` +
        `Expected: ${expected}\n` +
        `Actual:   ${actual}\n` +
        `Use tla2tools.jar v${TLAPLUS_VERSION}, or set TLC_JAR_SHA256 to trust a different build.`,
    );
  }

  return config.jarPath;
}

// Re-hash when the file's size or mtime changes, so a swapped jar is caught.
let verified: { path: string; size: number; mtimeMs: number } | undefined;

/** Check Java and return the verified jar path. */
export async function getJarPath(): Promise<string> {
  const { jarPath } = loadConfig();
  if (verified && verified.path === jarPath) {
    try {
      const st = statSync(jarPath);
      if (st.size === verified.size && st.mtimeMs === verified.mtimeMs) {
        return verified.path;
      }
    } catch {
      /* fall through and re-verify */
    }
  }
  verified = undefined;
  checkJava();
  const path = resolveJar();
  const st = statSync(path);
  verified = { path, size: st.size, mtimeMs: st.mtimeMs };
  return path;
}
