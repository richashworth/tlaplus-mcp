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

import { registerTlcCoverage } from "./tlc-coverage.js";

describe("tlc_coverage", () => {
  let handler: (params: any) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureToolHandler(registerTlcCoverage);
    mockRunJava.mockResolvedValue(
      mockRunJavaResult({
        stdout: "Model checking completed. No error has been found.\nFinished in 00:00:01",
      }),
    );
  });

  it("includes -coverage flag with interval", async () => {
    await handler({ tla_file: "/specs/Spec.tla", interval_minutes: 2 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-coverage");
    expect(args).toContain("2");
  });

  it("uses default cfg path", async () => {
    await handler({ tla_file: "/specs/Spec.tla", interval_minutes: 1 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("/specs/Spec.cfg");
  });

  it("passes workers flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", interval_minutes: 1, workers: "auto" });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-workers");
    expect(args).toContain("auto");
  });

  it("returns coverage in response", async () => {
    const result = await handler({ tla_file: "/specs/Spec.tla", interval_minutes: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("coverage");
    expect(parsed).toHaveProperty("status", "success");
  });
});
