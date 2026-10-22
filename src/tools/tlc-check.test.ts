import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureToolHandler, mockRunJavaResult } from "../test-utils.js";

const mockRunJava = vi.fn();
vi.mock("../lib/process.js", () => ({
  EXTRA_ARGS_DESCRIPTION: "",
  runJava: (...args: any[]) => mockRunJava(...args),
  sanitizeExtraArgs: (args: string[]) => {
    for (const a of args) {
      if (
        ["-dump", "-metadir", "-userfile", "-tlafile"].includes(a.toLowerCase())
      ) {
        throw new Error(`Flag "${a}" is not allowed`);
      }
    }
    return args;
  },
}));

vi.mock("../lib/schemas.js", () => ({
  absolutePath: {
    describe: () => ({ _def: {} }),
    optional: () => ({ describe: () => ({ _def: {} }) }),
  } as any,
}));

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn(() => "/tmp/tlc-meta-mock"),
  rmSync: vi.fn(),
  existsSync: vi.fn(() => true),
  writeFileSync: vi.fn(),
}));

import { mkdirSync, writeFileSync } from "node:fs";
import { registerTlcCheck } from "./tlc-check.js";

describe("tlc_check", () => {
  let rawHandler: (params: any) => Promise<any>;
  // output_file is required at the schema level; tests bypass Zod and call the
  // handler directly, so we inject a default here unless the test overrides it.
  const handler = (params: any): Promise<any> =>
    rawHandler({ output_file: "/tmp/test-tlc.out", ...params });

  beforeEach(() => {
    vi.clearAllMocks();
    rawHandler = captureToolHandler(registerTlcCheck);
    mockRunJava.mockResolvedValue(
      mockRunJavaResult({
        stdout:
          "Model checking completed. No error has been found.\nFinished in 00:00:01",
      }),
    );
  });

  it("passes default args correctly", async () => {
    await handler({ tla_file: "/specs/Spec.tla" });

    const call = mockRunJava.mock.calls[0][0];
    expect(call.className).toBe("tlc2.TLC");
    expect(call.args).toContain("-modelcheck");
    expect(call.args).toContain("-tool");
    expect(call.args).toContain("-config");
    expect(call.args).toContain("/specs/Spec.cfg");
    expect(call.args[call.args.length - 1]).toBe("Spec.tla");
    expect(call.cwd).toBe("/specs");
  });

  it("uses custom cfg_file when provided", async () => {
    await handler({
      tla_file: "/specs/Spec.tla",
      cfg_file: "/other/Custom.cfg",
    });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("/other/Custom.cfg");
  });

  it("adds -workers flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", workers: 4 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-workers");
    expect(args).toContain("4");
  });

  it("adds -workers auto", async () => {
    await handler({ tla_file: "/specs/Spec.tla", workers: "auto" });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("auto");
  });

  it("adds -deadlock flag when deadlock checking disabled (inverted)", async () => {
    await handler({ tla_file: "/specs/Spec.tla", deadlock: false });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-deadlock");
  });

  it("does NOT add -deadlock flag when deadlock checking enabled", async () => {
    await handler({ tla_file: "/specs/Spec.tla", deadlock: true });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).not.toContain("-deadlock");
  });

  it("adds -continue flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", continue: true });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-continue");
  });

  it("adds -dfid flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", dfid: 5 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-dfid");
    expect(args).toContain("5");
  });

  it("adds -difftrace flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", diff_trace: true });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-difftrace");
  });

  it("adds -maxSetSize flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", max_set_size: 5000 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-maxSetSize");
    expect(args).toContain("5000");
  });

  it("adds -dump for generate_states", async () => {
    await handler({ tla_file: "/specs/Spec.tla", generate_states: true });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-dump");
    expect(args).toContain("dot,actionlabels,colorize");
  });

  it("passes extra_args through sanitization", async () => {
    await handler({ tla_file: "/specs/Spec.tla", extra_args: ["-seed", "42"] });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-seed");
    expect(args).toContain("42");
  });

  it("returns formatted response with status", async () => {
    const result = await handler({ tla_file: "/specs/Spec.tla" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("success");
  });

  it("catches errors and returns formatted error", async () => {
    mockRunJava.mockRejectedValue(new Error("Java not found"));
    const result = await handler({ tla_file: "/specs/Spec.tla" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Java not found");
  });

  describe("output_file", () => {
    it("writes raw TLC output to file and returns output_file", async () => {
      const result = await handler({
        tla_file: "/specs/Spec.tla",
        output_file: "/out/dir/tlc.out",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.output_file).toBe("/out/dir/tlc.out");
      // raw_output must never appear inline (it can flood the agent context).
      expect(parsed.raw_output).toBeUndefined();
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        "/out/dir/tlc.out",
        expect.any(String),
        "utf-8",
      );
    });

    it("creates parent directory for output_file", async () => {
      await handler({
        tla_file: "/specs/Spec.tla",
        output_file: "/out/deep/dir/tlc.out",
      });
      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith("/out/deep/dir", {
        recursive: true,
      });
    });

    it("never returns raw_output inline (always writes to file)", async () => {
      const result = await handler({
        tla_file: "/specs/Spec.tla",
        output_file: "/out/dir/tlc.out",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.raw_output).toBeUndefined();
      expect(parsed.output_file).toBe("/out/dir/tlc.out");
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledOnce();
    });
  });
});
