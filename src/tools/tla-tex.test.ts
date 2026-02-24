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

const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

import { registerTlaTex } from "./tla-tex.js";

describe("tla_tex", () => {
  let handler: (params: any) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureToolHandler(registerTlaTex);
    mockExecFileSync.mockReturnValue("pdflatex 3.14");
    mockRunJava.mockResolvedValue(mockRunJavaResult({ stdout: "Done.\n" }));
  });

  it("checks pdflatex availability for pdf format", async () => {
    await handler({ tla_file: "/specs/Spec.tla", shade: false, number: false, no_pcal_shade: false, gray_level: 0.85, output_format: "pdf" });
    expect(mockExecFileSync).toHaveBeenCalledWith("pdflatex", ["--version"], { stdio: "pipe" });
  });

  it("checks latex availability for dvi format", async () => {
    await handler({ tla_file: "/specs/Spec.tla", shade: false, number: false, no_pcal_shade: false, gray_level: 0.85, output_format: "dvi" });
    expect(mockExecFileSync).toHaveBeenCalledWith("latex", ["--version"], { stdio: "pipe" });
  });

  it("returns error when latex not found", async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error("not found"); });
    const result = await handler({ tla_file: "/specs/Spec.tla", shade: false, number: false, no_pcal_shade: false, gray_level: 0.85, output_format: "pdf" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("pdflatex not found");
  });

  it("adds -shade flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", shade: true, number: false, no_pcal_shade: false, gray_level: 0.85, output_format: "pdf" });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-shade");
  });

  it("adds -number flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", shade: false, number: true, no_pcal_shade: false, gray_level: 0.85, output_format: "pdf" });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-number");
  });

  it("adds -noPcalShade flag", async () => {
    await handler({ tla_file: "/specs/Spec.tla", shade: false, number: false, no_pcal_shade: true, gray_level: 0.85, output_format: "pdf" });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-noPcalShade");
  });

  it("adds -grayLevel when non-default", async () => {
    await handler({ tla_file: "/specs/Spec.tla", shade: false, number: false, no_pcal_shade: false, gray_level: 0.5, output_format: "pdf" });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-grayLevel");
    expect(args).toContain("0.5");
  });

  it("omits -grayLevel for default 0.85", async () => {
    await handler({ tla_file: "/specs/Spec.tla", shade: false, number: false, no_pcal_shade: false, gray_level: 0.85, output_format: "pdf" });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).not.toContain("-grayLevel");
  });

  it("adds -latexCommand pdflatex for pdf output", async () => {
    await handler({ tla_file: "/specs/Spec.tla", shade: false, number: false, no_pcal_shade: false, gray_level: 0.85, output_format: "pdf" });
    const args = mockRunJava.mock.calls[0][0].args;
    expect(args).toContain("-latexCommand");
    expect(args).toContain("pdflatex");
  });

  it("returns output_file with .pdf extension", async () => {
    const result = await handler({ tla_file: "/specs/Spec.tla", shade: false, number: false, no_pcal_shade: false, gray_level: 0.85, output_format: "pdf" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.output_file).toBe("/specs/Spec.pdf");
  });

  it("returns output_file with .dvi extension", async () => {
    const result = await handler({ tla_file: "/specs/Spec.tla", shade: false, number: false, no_pcal_shade: false, gray_level: 0.85, output_format: "dvi" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.output_file).toBe("/specs/Spec.dvi");
  });
});
