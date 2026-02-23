import { describe, it, expect } from "vitest";
import {
  defaultCfgPath,
  combineOutput,
  deriveStatus,
  formatToolResponse,
  formatToolError,
  truncateOutput,
  validateFileExists,
} from "./tool-helpers.js";
import type { TlcResult } from "../parsers/tlc-output.js";

describe("defaultCfgPath", () => {
  it("replaces .tla extension with .cfg", () => {
    expect(defaultCfgPath("/path/to/Spec.tla")).toBe("/path/to/Spec.cfg");
  });

  it("only replaces trailing .tla", () => {
    expect(defaultCfgPath("/tla/dir/Spec.tla")).toBe("/tla/dir/Spec.cfg");
  });

  it("returns unchanged path if no .tla extension", () => {
    expect(defaultCfgPath("/path/to/Spec.txt")).toBe("/path/to/Spec.txt");
  });
});

describe("combineOutput", () => {
  it("joins stdout and stderr with newline", () => {
    const result = { exitCode: 0, stdout: "out", stderr: "err", timedOut: false };
    expect(combineOutput(result)).toBe("out\nerr");
  });

  it("handles empty stdout/stderr", () => {
    const result = { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    expect(combineOutput(result)).toBe("\n");
  });
});

describe("deriveStatus", () => {
  const baseParsed: TlcResult = {
    success: true,
    violations: [],
    errors: [],
    coverage: [],
  };

  it("returns 'timeout' when timedOut is true (highest priority)", () => {
    const parsed = { ...baseParsed, violations: [{ type: "invariant" as const, name: "x", trace: [] }] };
    expect(deriveStatus(parsed, true)).toBe("timeout");
  });

  it("returns 'violation' when violations exist", () => {
    const parsed = { ...baseParsed, violations: [{ type: "invariant" as const, name: "x", trace: [] }] };
    expect(deriveStatus(parsed, false)).toBe("violation");
  });

  it("returns 'error' when errors exist but no violations", () => {
    const parsed = { ...baseParsed, errors: ["some error"] };
    expect(deriveStatus(parsed, false)).toBe("error");
  });

  it("returns 'success' when clean", () => {
    expect(deriveStatus(baseParsed, false)).toBe("success");
  });
});

describe("formatToolResponse", () => {
  it("wraps data as JSON in MCP content format", () => {
    const result = formatToolResponse({ status: "ok", count: 42 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ status: "ok", count: 42 });
  });

  it("does not set isError", () => {
    const result = formatToolResponse({});
    expect(result).not.toHaveProperty("isError");
  });
});

describe("formatToolError", () => {
  it("extracts message from Error instances", () => {
    const result = formatToolError(new Error("boom"));
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("boom");
  });

  it("converts non-Error values to string", () => {
    const result = formatToolError("string error");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("string error");
  });

  it("converts number to string", () => {
    const result = formatToolError(404);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("404");
  });
});

describe("truncateOutput", () => {
  it("returns short string as-is (trimmed)", () => {
    expect(truncateOutput("  hello world  ")).toBe("hello world");
  });

  it("truncates string exceeding maxBytes with suffix", () => {
    const input = "a".repeat(200);
    const result = truncateOutput(input, 100);
    expect(result).toContain("[truncated]");
    expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(100 + 15);
    expect(result.startsWith("a".repeat(100))).toBe(true);
  });

  it("respects custom maxBytes parameter", () => {
    const input = "abcdefghij";
    expect(truncateOutput(input, 5)).toContain("[truncated]");
    expect(truncateOutput(input, 20)).toBe("abcdefghij");
  });
});

describe("validateFileExists", () => {
  it("throws for non-existent file with descriptive message", () => {
    expect(() => validateFileExists("/no/such/file.tla", "TLA+ file")).toThrow(
      "TLA+ file not found: /no/such/file.tla",
    );
  });

  it("does not throw for existing file", () => {
    expect(() => validateFileExists("package.json", "Config")).not.toThrow();
  });
});
