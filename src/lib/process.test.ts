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
  it("passes allowed flags and values through unchanged", () => {
    const args = [
      "-workers",
      "auto",
      "-depth",
      "50",
      "-seed",
      "-7",
      "-fpmem",
      "0.5",
      "-simulate",
      "num=3",
      "-deadlock",
      "-difftrace",
      "-continue",
      "-noGenerateSpecTE",
      "-coverage",
      "2",
      "-maxSetSize",
      "100",
      "-fp",
      "3",
    ];
    expect(sanitizeExtraArgs(args)).toEqual(args);
  });

  it("returns empty array for empty input", () => {
    expect(sanitizeExtraArgs([])).toEqual([]);
  });

  it.each([
    ["-dump"],
    ["-dumptrace"],
    ["-metadir"],
    ["-userFile"],
    ["-tlafile"],
    ["-config"],
    ["-generateSpecTE"],
    ["-DUMP"],
    ["-dump=dot"],
    ["-workers=4"],
    ["Spec.tla"],
    ["/etc/passwd"],
    ["--"],
  ])("rejects %s", (flag) => {
    expect(() => sanitizeExtraArgs([flag])).toThrow(/not allowed/);
  });

  it("includes the flag name in the error message", () => {
    expect(() => sanitizeExtraArgs(["-dump"])).toThrow('"-dump"');
  });

  it("is case-sensitive", () => {
    expect(() => sanitizeExtraArgs(["-Workers", "4"])).toThrow(/not allowed/);
  });

  it("rejects a missing value", () => {
    expect(() => sanitizeExtraArgs(["-workers"])).toThrow(/needs a value/);
  });

  it("rejects a malformed value", () => {
    expect(() => sanitizeExtraArgs(["-depth", "/tmp/x"])).toThrow(
      /needs a value/,
    );
    expect(() => sanitizeExtraArgs(["-workers", "0"])).toThrow(/needs a value/);
  });

  it("rejects simulate file= output", () => {
    expect(() =>
      sanitizeExtraArgs(["-simulate", "file=/tmp/out,num=1"]),
    ).toThrow(/needs a value/);
  });

  it("does not let a value smuggle a second flag", () => {
    expect(() => sanitizeExtraArgs(["-seed", "1", "-metadir", "/x"])).toThrow(
      /"-metadir"/,
    );
  });
});
