/**
 * Configuration from environment variables.
 */

export interface Config {
  /** Path to tla2tools.jar */
  jarPath: string | undefined;
  /** Expected SHA-256 of tla2tools.jar, overriding the pinned value */
  jarSha256: string | undefined;
  /** JVM options for TLC */
  javaOpts: string[];
  /** Max seconds before killing a TLC/SANY run */
  timeout: number;
  /** Default directory for resolving relative paths */
  workspace: string;
  /** Directories that tools may read from and write to */
  roots: string[];
}

function parseIntOrDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  const parsed = parseInt(value ?? String(defaultValue), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function loadConfig(): Config {
  const javaOptsStr = process.env.TLC_JAVA_OPTS ?? "-Xmx4g -XX:+UseParallelGC";
  const workspace = process.env.TLC_WORKSPACE ?? process.cwd();
  const rootsStr = process.env.TLAPLUS_MCP_ROOTS;
  return {
    jarPath: process.env.TLC_JAR_PATH,
    jarSha256: process.env.TLC_JAR_SHA256,
    javaOpts: javaOptsStr.split(/\s+/).filter(Boolean),
    timeout: parseIntOrDefault(process.env.TLC_TIMEOUT, 300),
    workspace,
    roots: rootsStr ? rootsStr.split(":").filter(Boolean) : [workspace],
  };
}
