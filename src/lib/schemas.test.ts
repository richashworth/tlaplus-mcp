import { describe, it, expect } from "vitest";
import { absolutePath } from "./schemas.js";

describe("absolutePath schema", () => {
  it("accepts absolute paths", () => {
    expect(absolutePath.parse("/absolute/path/Spec.tla")).toBe("/absolute/path/Spec.tla");
  });

  it("accepts root path", () => {
    expect(absolutePath.parse("/")).toBe("/");
  });

  it("rejects relative paths", () => {
    expect(() => absolutePath.parse("relative/path")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => absolutePath.parse("")).toThrow();
  });

  it("rejects dot-relative paths", () => {
    expect(() => absolutePath.parse("./relative")).toThrow();
  });
});
