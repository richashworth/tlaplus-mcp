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

const mockExistsSync = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  mkdtempSync: vi.fn((prefix: string) => prefix + "test"),
  rmSync: vi.fn(),
}));

import { registerTlcGenerateTraceSpec } from "./tlc-generate-trace-spec.js";

describe("tlc_generate_trace_spec", () => {
  let handler: (params: any) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    handler = captureToolHandler(registerTlcGenerateTraceSpec);
    mockRunJava.mockResolvedValue(
      mockRunJavaResult({
        stdout: "SpecTE.tla written to /specs/SpecTE.tla\n",
      }),
    );
  });

  it("includes -generateSpecTE flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", monolith: true });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-generateSpecTE");
  });

  it("includes -nomonolith when monolith is false", async () => {
    await handler({ tla_file: "/specs/Spec.tla", monolith: false });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-nomonolith");
  });

  it("omits -nomonolith when monolith is true", async () => {
    await handler({ tla_file: "/specs/Spec.tla", monolith: true });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).not.toContain("-nomonolith");
  });

  it("includes -tool and -modelcheck", async () => {
    await handler({ tla_file: "/specs/Spec.tla", monolith: true });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-tool");
    expect(args).toContain("-modelcheck");
  });

  it("passes custom cfg_file", async () => {
    await handler({
      tla_file: "/specs/Spec.tla",
      monolith: true,
      cfg_file: "/other/Spec.cfg",
    });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-config");
    expect(args).toContain("/other/Spec.cfg");
  });

  it("sets cwd to dirname of tla_file", async () => {
    await handler({ tla_file: "/specs/sub/Spec.tla", monolith: true });
    expect(mockRunJava.mock.calls[0][0].cwd).toBe("/specs/sub");
  });

  it("reports status=success on successful generation", async () => {
    const result = await handler({
      tla_file: "/specs/Spec.tla",
      monolith: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("success");
    expect(parsed.success).toBe(true);
  });

  it("reports error on failure with no SpecTE", async () => {
    mockRunJava.mockResolvedValue(
      mockRunJavaResult({
        exitCode: 1,
        stdout: "Error: Spec has no behaviors\n",
      }),
    );

    const result = await handler({
      tla_file: "/specs/Spec.tla",
      monolith: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.status).toBe("error");
    expect(parsed.error).toBeTruthy();
  });

  it("reports failure when SpecTE.tla appears in error output but file does not exist", async () => {
    mockExistsSync.mockReturnValueOnce(true).mockReturnValue(false);
    mockRunJava.mockResolvedValue(
      mockRunJavaResult({
        exitCode: 1,
        stdout: "Error: failed to generate SpecTE.tla\n",
      }),
    );

    const result = await handler({
      tla_file: "/specs/Spec.tla",
      monolith: true,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });

  it("catches thrown errors", async () => {
    mockRunJava.mockRejectedValue(new Error("boom"));
    const result = await handler({
      tla_file: "/specs/Spec.tla",
      monolith: true,
    });
    expect(result.isError).toBe(true);
  });
});
