import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureToolHandler, mockRunJavaResult } from "../test-utils.js";

const mockRunJava = vi.fn();
vi.mock("../lib/process.js", () => ({
  runJava: (...args: any[]) => mockRunJava(...args),
}));

vi.mock("../lib/schemas.js", () => ({
  absolutePath: { describe: () => ({ _def: {} }) } as any,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

import { registerPcalTranslate } from "./pcal-translate.js";

describe("pcal_translate", () => {
  let handler: (params: any) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureToolHandler(registerPcalTranslate);
    mockRunJava.mockResolvedValue(mockRunJavaResult({
      stdout: "Translation completed successfully.\n",
    }));
  });

  it("calls pcal.trans with tla_file", async () => {
    await handler({ tla_file: "/specs/Algo.tla", fairness: "nof", termination: false, no_cfg: false, label: true, line_width: 78 });
    const call = mockRunJava.mock.calls[0][0];
    expect(call.className).toBe("pcal.trans");
    expect(call.args).toContain("/specs/Algo.tla");
  });

  it("adds -fairness flag when not nof", async () => {
    await handler({ tla_file: "/specs/Algo.tla", fairness: "wf", termination: false, no_cfg: false, label: true, line_width: 78 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-fairness");
    expect(args).toContain("wf");
  });

  it("omits -fairness flag for nof", async () => {
    await handler({ tla_file: "/specs/Algo.tla", fairness: "nof", termination: false, no_cfg: false, label: true, line_width: 78 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).not.toContain("-fairness");
  });

  it("adds -termination flag", async () => {
    await handler({ tla_file: "/specs/Algo.tla", fairness: "nof", termination: true, no_cfg: false, label: true, line_width: 78 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-termination");
  });

  it("adds -nocfg flag", async () => {
    await handler({ tla_file: "/specs/Algo.tla", fairness: "nof", termination: false, no_cfg: true, label: true, line_width: 78 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-nocfg");
  });

  it("adds -label flag", async () => {
    await handler({ tla_file: "/specs/Algo.tla", fairness: "nof", termination: false, no_cfg: false, label: true, line_width: 78 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-label");
  });

  it("adds -lineWidth when non-default", async () => {
    await handler({ tla_file: "/specs/Algo.tla", fairness: "nof", termination: false, no_cfg: false, label: true, line_width: 120 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-lineWidth");
    expect(args).toContain("120");
  });

  it("omits -lineWidth for default 78", async () => {
    await handler({ tla_file: "/specs/Algo.tla", fairness: "nof", termination: false, no_cfg: false, label: true, line_width: 78 });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).not.toContain("-lineWidth");
  });

  it("extracts labels added from output", async () => {
    mockRunJava.mockResolvedValue(mockRunJavaResult({
      stdout: "-- added label Lbl_1\n-- added label Lbl_2\n",
    }));
    const result = await handler({ tla_file: "/specs/Algo.tla", fairness: "nof", termination: false, no_cfg: false, label: true, line_width: 78 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.labels_added).toEqual(["Lbl_1", "Lbl_2"]);
  });

  it("returns success=false on errors", async () => {
    mockRunJava.mockResolvedValue(mockRunJavaResult({
      exitCode: 1,
      stdout: "Unrecoverable error: missing algorithm\n",
    }));
    const result = await handler({ tla_file: "/specs/Algo.tla", fairness: "nof", termination: false, no_cfg: false, label: true, line_width: 78 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });
});
