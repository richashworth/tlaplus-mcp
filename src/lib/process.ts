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

const UINT = /^\d+$/;
const POSITIVE = /^[1-9]\d*$/;

/**
 * TLC flags accepted in extra_args, mapped to the shape of their value
 * (null for flags that take none). Anything else is rejected, so extra_args
 * can never name a file path or change where TLC reads or writes.
 */
const ALLOWED_EXTRA_ARGS = new Map<string, RegExp | null>([
  ["-workers", /^(?:[1-9]\d*|auto)$/],
  ["-depth", UINT],
  ["-seed", /^-?\d+$/],
  ["-aril", /^-?\d+$/],
  ["-dfid", UINT],
  ["-fp", UINT],
  ["-fpbits", UINT],
  ["-fpmem", /^\d+(?:\.\d+)?$/],
  ["-maxSetSize", POSITIVE],
  ["-coverage", POSITIVE],
  ["-checkpoint", UINT],
  ["-simulate", /^num=[1-9]\d*$/],
  ["-deadlock", null],
  ["-continue", null],
  ["-difftrace", null],
  ["-noGenerateSpecTE", null],
  ["-nowarning", null],
]);

export const EXTRA_ARGS_DESCRIPTION =
  "Additional TLC flags. Only these are accepted, each followed by its value where it takes one: " +
  "-workers N|auto, -depth N, -seed N, -aril N, -dfid N, -fp N, -fpbits N, -fpmem N, " +
  "-maxSetSize N, -coverage N, -checkpoint N, -simulate num=N, -deadlock, -continue, " +
  "-difftrace, -noGenerateSpecTE, -nowarning";

/** Validate extra_args against the allowlist. Throws on any other token. */
export function sanitizeExtraArgs(args: string[]): string[] {
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!ALLOWED_EXTRA_ARGS.has(flag)) {
      throw new Error(
        `Flag "${flag}" is not allowed in extra_args. Allowed: ${[
          ...ALLOWED_EXTRA_ARGS.keys(),
        ].join(", ")}`,
      );
    }
    const shape = ALLOWED_EXTRA_ARGS.get(flag);
    if (shape) {
      const value = args[++i];
      if (value === undefined || !shape.test(value)) {
        throw new Error(
          `Flag "${flag}" in extra_args needs a value matching ${shape}, got ${JSON.stringify(value)}`,
        );
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
