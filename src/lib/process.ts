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

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    // Timeout handling
    const timer = setTimeout(() => {
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

/**
 * Run a Java class using -jar mode (for tools like pcal.trans that need it).
 */
export async function runJavaJar(opts: Omit<RunJavaOptions, "className"> & { args: string[] }): Promise<RunJavaResult> {
  const config = loadConfig();
  const jarPath = await getJarPath();
  const timeoutSec = opts.timeout ?? config.timeout;

  const javaArgs = [
    ...config.javaOpts,
    "-cp",
    jarPath,
    ...opts.args,
  ];

  return new Promise<RunJavaResult>((resolve, reject) => {
    const child = spawn("java", javaArgs, {
      cwd: opts.cwd ?? config.workspace,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutSec * 1000);

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
