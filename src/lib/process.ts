/**
 * Spawn Java subprocesses with timeout and output capture.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  ["-nowarning", null],
]);

export const EXTRA_ARGS_DESCRIPTION =
  "Additional TLC flags. Only these are accepted, each followed by its value where it takes one: " +
  "-workers N|auto, -depth N, -seed N, -aril N, -dfid N, -fp N, -fpbits N, -fpmem N, " +
  "-maxSetSize N, -coverage N, -checkpoint N, -simulate num=N, -deadlock, -continue, " +
  "-difftrace, -nowarning";

/** Refused flags that a tool parameter covers, keyed by lowercased flag. */
const DEDICATED_ROUTES = new Map<string, string>([
  ["-dump", "use tlc_check with generate_states / dump_path instead"],
  ["-config", "use the cfg_file parameter instead"],
  ["-generatespecte", "use the tlc_generate_trace_spec tool instead"],
  ["-nomonolith", "use tlc_generate_trace_spec with monolith: false instead"],
]);

/** Validate extra_args against the allowlist. Throws on any other token. */
export function sanitizeExtraArgs(args: string[]): string[] {
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!ALLOWED_EXTRA_ARGS.has(flag)) {
      const route = DEDICATED_ROUTES.get(flag.toLowerCase().split("=")[0]);
      throw new Error(
        `Flag "${flag}" is not allowed in extra_args` +
          (route ? `; ${route}` : "") +
          `. Allowed: ${[...ALLOWED_EXTRA_ARGS.keys()].join(", ")}`,
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

  // SANY extracts the standard modules into java.io.tmpdir and resolves
  // modules from there, so give each run a private one rather than a shared
  // directory where modules could be planted. TLC_JAVA_OPTS can override it.
  const javaTmp = mkdtempSync(join(tmpdir(), "tlaplus-mcp-java-"));
  const cleanup = () => {
    try {
      rmSync(javaTmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };

  const javaArgs = [
    `-Djava.io.tmpdir=${javaTmp}`,
    ...config.javaOpts,
    "-cp",
    jarPath,
    opts.className,
    ...opts.args,
  ];

  return new Promise<RunJavaResult>((resolve, reject) => {
    // argv array and no shell: nothing in args is ever shell-interpreted.
    const child = spawn("java", javaArgs, {
      cwd: opts.cwd ?? config.workspace,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
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
      cleanup();
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
      cleanup();
      if (opts.signal) {
        opts.signal.removeEventListener("abort", onAbort);
      }
      reject(err);
    });
  });
}
