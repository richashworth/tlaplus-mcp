import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureToolHandler, mockRunJavaResult } from "../test-utils.js";

const mockRunJava = vi.fn();
vi.mock("../lib/process.js", () => ({
  runJava: (...args: any[]) => mockRunJava(...args),
  sanitizeExtraArgs: (args: string[]) => args,
}));

vi.mock("../lib/schemas.js", () => ({
  absolutePath: { describe: () => ({ _def: {} }) } as any,
}));

vi.mock("node:fs", () => ({
  mkdtempSync: vi.fn(() => "/tmp/tlc-meta-mock"),
  rmSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { registerTlcSimulate } from "./tlc-simulate.js";

describe("tlc_simulate", () => {
  let handler: (params: any) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureToolHandler(registerTlcSimulate);
    mockRunJava.mockResolvedValue(
      mockRunJavaResult({
        stdout:
          "Model checking completed. No error has been found.\nFinished in 00:00:01",
      }),
    );
  });

  it("passes -simulate with default num=1", async () => {
    await handler({ tla_file: "/specs/Spec.tla", depth: 100 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-simulate");
    expect(args).toContain("num=1");
  });

  it("passes -simulate with custom num_traces", async () => {
    await handler({ tla_file: "/specs/Spec.tla", depth: 100, num_traces: 50 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("num=50");
  });

  it("passes depth flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", depth: 200 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-depth");
    expect(args).toContain("200");
  });

  it("passes seed flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", depth: 100, seed: 42 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-seed");
    expect(args).toContain("42");
  });

  it("passes aril flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", depth: 100, aril: 7 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-aril");
    expect(args).toContain("7");
  });

  it("inverts deadlock flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", depth: 100, deadlock: false });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-deadlock");
  });

  it("uses default cfg path", async () => {
    await handler({ tla_file: "/specs/Spec.tla", depth: 100 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("/specs/Spec.cfg");
  });

  it("includes timeout error message when result.timedOut is true", async () => {
    mockRunJava.mockResolvedValue(
      mockRunJavaResult({
        stdout: "",
        timedOut: true,
        exitCode: 1,
      }),
    );
    const result = await handler({ tla_file: "/specs/Spec.tla", depth: 100 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("error");
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "TLC process killed: timeout exceeded",
        }),
      ]),
    );
  });
});
