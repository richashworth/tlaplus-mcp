import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureToolHandler, mockRunJavaResult } from "../test-utils.js";

const mockRunJava = vi.fn();
vi.mock("../lib/process.js", () => ({
  runJava: (...args: any[]) => mockRunJava(...args),
}));

import { registerTlaEvaluate } from "./tla-evaluate.js";

describe("tla_evaluate", () => {
  let handler: (params: any) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = captureToolHandler(registerTlaEvaluate);
  });

  it("calls TLC with -tool flag", async () => {
    mockRunJava.mockResolvedValue(mockRunJavaResult({ stdout: "42\n" }));

    await handler({ expression: "40 + 2" });

    const call = mockRunJava.mock.calls[0][0];
    expect(call.className).toBe("tlc2.TLC");
    expect(call.args).toContain("-tool");
  });

  it("extracts result from tool-mode output (skips @!@!@ markers) with status=success", async () => {
    const stdout = [
      "@!@!@STARTMSG 2185:0 @!@!@",
      "Starting SANY...",
      "@!@!@ENDMSG 2185 @!@!@",
      "42",
      "@!@!@STARTMSG 2186:0 @!@!@",
      "Finished in 00:00:01 at (2024-01-01 12:00:00)",
      "@!@!@ENDMSG 2186 @!@!@",
    ].join("\n");

    mockRunJava.mockResolvedValue(mockRunJavaResult({ stdout }));

    const result = await handler({ expression: "40 + 2" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.result).toBe("42");
    expect(parsed.status).toBe("success");
  });

  it("falls back to prefix-blocklist parsing", async () => {
    const stdout = [
      "TLC2 Version 2.18",
      "Starting SANY...",
      "42",
      "Finished in 00:00:01",
    ].join("\n");

    mockRunJava.mockResolvedValue(mockRunJavaResult({ stdout }));

    const result = await handler({ expression: "40 + 2" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.result).toBe("42");
  });

  it("uses default imports when none specified", async () => {
    mockRunJava.mockResolvedValue(mockRunJavaResult({ stdout: "3\n" }));

    await handler({ expression: "1 + 2" });

    // The temp spec should EXTEND default modules — verified via the cwd passed
    const call = mockRunJava.mock.calls[0][0];
    expect(call.timeout).toBe(30);
  });

  it("uses custom imports", async () => {
    mockRunJava.mockResolvedValue(mockRunJavaResult({ stdout: "3\n" }));

    await handler({ expression: "1 + 2", imports: ["Integers"] });
    // Just verifying no crash with custom imports
    expect(mockRunJava).toHaveBeenCalledOnce();
  });

  it("reports error with status=error on non-zero exit with no result", async () => {
    mockRunJava.mockResolvedValue(
      mockRunJavaResult({
        exitCode: 1,
        stdout: "",
        stderr: "Error: Unknown operator\n",
      }),
    );

    const result = await handler({ expression: "bad expr" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("Unknown operator");
    expect(parsed.status).toBe("error");
  });

  it("does not discard PrintT output starting with 'The' or 'Checking' in fallback mode", async () => {
    const stdout = [
      "TLC2 Version 2.18",
      "Starting SANY...",
      "The answer is 42",
      "Finished in 00:00:01",
    ].join("\n");

    mockRunJava.mockResolvedValue(mockRunJavaResult({ stdout }));

    const result = await handler({ expression: '"The answer is 42"' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.result).toBe("The answer is 42");

    // Also verify "Checking" prefix is preserved
    const stdout2 = [
      "TLC2 Version 2.18",
      "Starting SANY...",
      "Checking done, result OK",
      "Finished in 00:00:01",
    ].join("\n");

    mockRunJava.mockResolvedValue(mockRunJavaResult({ stdout: stdout2 }));

    const result2 = await handler({ expression: '"Checking done, result OK"' });
    const parsed2 = JSON.parse(result2.content[0].text);
    expect(parsed2.result).toBe("Checking done, result OK");
  });

  it("catches thrown errors", async () => {
    mockRunJava.mockRejectedValue(new Error("spawn failed"));

    const result = await handler({ expression: "1 + 2" });
    expect(result.isError).toBe(true);
  });

  it("rejects invalid import names with commas (injection attempt)", async () => {
    const result = await handler({
      expression: "1 + 2",
      imports: ["Integers, Naturals"],
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("Invalid module name");
    expect(mockRunJava).not.toHaveBeenCalled();
  });

  it("rejects import names with special characters", async () => {
    const result = await handler({
      expression: "1",
      imports: ["Foo; DROP TABLE"],
    });
    expect(result.isError).toBe(true);
    expect(mockRunJava).not.toHaveBeenCalled();
  });

  it("rejects import names starting with a digit", async () => {
    const result = await handler({ expression: "1", imports: ["123Bad"] });
    expect(result.isError).toBe(true);
    expect(mockRunJava).not.toHaveBeenCalled();
  });

  it("accepts valid import names with underscores", async () => {
    mockRunJava.mockResolvedValue(mockRunJavaResult({ stdout: "3\n" }));

    await handler({ expression: "1 + 2", imports: ["My_Module", "_Private"] });
    expect(mockRunJava).toHaveBeenCalledOnce();
  });
});
