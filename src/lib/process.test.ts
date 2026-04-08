import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { sanitizeExtraArgs } from "./process.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));
vi.mock("./config.js", () => ({
  loadConfig: () => ({
    javaOpts: [],
    timeout: 300,
    workspace: "/tmp",
  }),
}));
vi.mock("./java.js", () => ({
  getJarPath: async () => "/fake/tla2tools.jar",
}));

import { spawn } from "node:child_process";
import { runJava } from "./process.js";

describe("runJava timeout", () => {
  it("sets timedOut=true and kills process when timeout expires", async () => {
    vi.useFakeTimers();

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const childProcess = new EventEmitter() as any;
    childProcess.stdout = stdout;
    childProcess.stderr = stderr;
    childProcess.kill = vi.fn(() => {
      // Simulate process closing after SIGKILL
      stdout.end();
      stderr.end();
      process.nextTick(() => childProcess.emit("close", null));
    });

    vi.mocked(spawn).mockReturnValue(childProcess);

    const resultPromise = runJava({
      className: "tlc2.TLC",
      args: ["-modelcheck", "Spec.tla"],
      timeout: 10,
    });

    // Advance past the timeout (10s = 10000ms)
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await resultPromise;

    expect(result.timedOut).toBe(true);
    expect(childProcess.kill).toHaveBeenCalledWith("SIGKILL");

    vi.useRealTimers();
  });
});

describe("sanitizeExtraArgs", () => {
  it("passes safe args through unchanged", () => {
    const args = ["-workers", "4", "-difftrace"];
    expect(sanitizeExtraArgs(args)).toEqual(args);
  });

  it("returns empty array for empty input", () => {
    expect(sanitizeExtraArgs([])).toEqual([]);
  });

  it("blocks -dump", () => {
    expect(() => sanitizeExtraArgs(["-dump"])).toThrow(/not allowed/);
  });

  it("blocks -metadir", () => {
    expect(() => sanitizeExtraArgs(["-metadir"])).toThrow(/not allowed/);
  });

  it("blocks -userFile", () => {
    expect(() => sanitizeExtraArgs(["-userFile"])).toThrow(/not allowed/);
  });

  it("blocks -tlafile", () => {
    expect(() => sanitizeExtraArgs(["-tlafile"])).toThrow(/not allowed/);
  });

  it("blocks case-insensitively", () => {
    expect(() => sanitizeExtraArgs(["-DUMP"])).toThrow(/not allowed/);
    expect(() => sanitizeExtraArgs(["-Dump"])).toThrow(/not allowed/);
  });

  it("includes the flag name in the error message", () => {
    expect(() => sanitizeExtraArgs(["-dump"])).toThrow('"-dump"');
  });

  it("blocks flags using = syntax (e.g. -dump=dot)", () => {
    expect(() => sanitizeExtraArgs(["-dump=dot"])).toThrow(/not allowed/);
    expect(() => sanitizeExtraArgs(["-metadir=/tmp/meta"])).toThrow(
      /not allowed/,
    );
    expect(() =>
      sanitizeExtraArgs(["-DUMP=dot,colorize,actionlabels"]),
    ).toThrow(/not allowed/);
  });

  it("blocks -dumptrace", () => {
    expect(() => sanitizeExtraArgs(["-dumptrace"])).toThrow(/not allowed/);
    expect(() => sanitizeExtraArgs(["-dumptrace=tla"])).toThrow(/not allowed/);
  });
});
