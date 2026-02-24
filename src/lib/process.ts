/**
 * Spawn Java subprocesses with timeout and output capture.
 */

import { spawn } from "node:child_process";
import { loadConfig } from "./config.js";
import { getJarPath } from "./java.js";

export interface RunJavaOptions {
  /** Java class to run (e.g., "tlc2.TLC") */
  className: string;
  /** Arguments to pass to the class */
  args: string[];
  /** Working directory */
  cwd?: string;
  /** Timeout in seconds (overrides config) */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

export interface RunJavaResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * TLC flags that are already managed by explicit tool parameters.
 * Allowing these via extra_args would bypass validation or cause conflicts.
 */
const BLOCKED_EXTRA_ARGS = [
  "-dump",         // managed via generate_states/dump_path
  "-dumptrace",    // writes trace to arbitrary disk paths
  "-metadir",      // could redirect metadata to arbitrary paths
  "-userfile",     // could write to arbitrary paths
  "-tlafile",      // could overwrite arbitrary files
];

/**
 * Validate extra_args against blocked flags.
 * Throws if any blocked flag is found.
 */
export function sanitizeExtraArgs(args: string[]): string[] {
  for (const arg of args) {
    const normalized = arg.toLowerCase();
    for (const blocked of BLOCKED_EXTRA_ARGS) {
      if (normalized === blocked || normalized.startsWith(blocked + "=")) {
        throw new Error(`Flag "${arg}" is not allowed in extra_args (use the dedicated tool parameter instead)`);
      }
    }
  }
  return args;
}

/**
 * Run a Java class from tla2tools.jar with timeout and output capture.
 */
export async function runJava(opts: RunJavaOptions): Promise<RunJavaResult> {
  const config = loadConfig();
  const jarPath = await getJarPath();
  const timeoutSec = opts.timeout ?? config.timeout;

  const javaArgs = [
    ...config.javaOpts,
    "-cp",
    jarPath,
    opts.className,
    ...opts.args,
  ];

  return new Promise<RunJavaResult>((resolve, reject) => {
    const child = spawn("java", javaArgs, {
      cwd: opts.cwd ?? config.workspace,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let didTimeout = false;

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    // Timeout handling
    const timer = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGKILL");
    }, timeoutSec * 1000);

    // AbortSignal handling
    const onAbort = () => {
      child.kill("SIGKILL");
    };
    if (opts.signal) {
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("close", (code) => {
      clearTimeout(timer);
      if (opts.signal) {
        opts.signal.removeEventListener("abort", onAbort);
      }
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        timedOut: didTimeout,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (opts.signal) {
        opts.signal.removeEventListener("abort", onAbort);
      }
      reject(err);
    });
  });
}
