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

import { registerTlaParse } from "./tla-parse.js";

describe("tla_parse", () => {
  let handler: (params: any) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureToolHandler(registerTlaParse);
  });

  it("calls SANY with the tla_file", async () => {
    mockRunJava.mockResolvedValue(mockRunJavaResult({
      stdout: "Parsing file /specs/Spec.tla\n",
    }));

    await handler({ tla_file: "/specs/Spec.tla" });

    const call = mockRunJava.mock.calls[0][0];
    expect(call.className).toBe("tla2sany.SANY");
    expect(call.args).toEqual(["/specs/Spec.tla"]);
  });

  it("extracts parsed modules from output", async () => {
    mockRunJava.mockResolvedValue(mockRunJavaResult({
      stdout: "Parsing file /specs/Spec.tla\nParsing file /specs/Other.tla\n",
    }));

    const result = await handler({ tla_file: "/specs/Spec.tla" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.modules_parsed).toEqual(["/specs/Spec.tla", "/specs/Other.tla"]);
  });

  it("reports valid=true on clean exit", async () => {
    mockRunJava.mockResolvedValue(mockRunJavaResult({
      exitCode: 0,
      stdout: "Parsing file /specs/Spec.tla\n",
    }));

    const result = await handler({ tla_file: "/specs/Spec.tla" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it("extracts semantic errors", async () => {
    mockRunJava.mockResolvedValue(mockRunJavaResult({
      exitCode: 1,
      stdout: "line 10, col 5 to line 10, col 20 of module Spec\n",
    }));

    const result = await handler({ tla_file: "/specs/Spec.tla" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.errors[0].location.line).toBe(10);
  });

  it("extracts parse errors", async () => {
    mockRunJava.mockResolvedValue(mockRunJavaResult({
      exitCode: 1,
      stdout: '*** Parse Error ***\nEncountered "+" at line 5, column 3\n',
    }));

    const result = await handler({ tla_file: "/specs/Spec.tla" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("captures SANY error description from preceding line", async () => {
    const sanyOutput = [
      "Parsing file /specs/Test.tla",
      "",
      "Semantic errors:",
      "",
      "*** Errors: 1",
      "",
      "Unknown operator: `Foo'.",
      "",
      "line 5, col 3 to line 5, col 5 of module Test",
      "",
    ].join("\n");

    mockRunJava.mockResolvedValue(mockRunJavaResult({
      exitCode: 1,
      stdout: sanyOutput,
    }));

    const result = await handler({ tla_file: "/specs/Test.tla" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.length).toBe(1);
    expect(parsed.errors[0].message).toContain("Unknown operator: `Foo'.");
    expect(parsed.errors[0].message).toContain("line 5, col 3 to line 5, col 5 of module Test");
    expect(parsed.errors[0].location).toEqual({ file: "Test", line: 5, col: 3 });
  });

  it("catches thrown errors", async () => {
    mockRunJava.mockRejectedValue(new Error("spawn failed"));

    const result = await handler({ tla_file: "/specs/Spec.tla" });
    expect(result.isError).toBe(true);
  });
});
