import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

vi.mock("../lib/config.js", () => ({
  loadConfig: () => ({ workspace: "/mock/workspace" }),
}));

// We need to test the handler logic, so we capture it via a mock McpServer
function captureResourceHandlers(registerFn: (server: any) => void) {
  const handlers = new Map<string, Function>();

  const mockServer = {
    resource: (name: string, _uriOrTemplate: any, _opts: any, handler: Function) => {
      handlers.set(name, handler);
    },
  };

  registerFn(mockServer);
  return handlers;
}

describe("specs resources", () => {
  let handlers: Map<string, Function>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const { registerResources } = await import("./specs.js");
    handlers = captureResourceHandlers(registerResources);
  });

  describe("tla://specs", () => {
    it("lists .tla and .cfg files sorted", () => {
      vi.spyOn(fs, "readdirSync").mockReturnValue(
        ["Spec.tla", "README.md", "Spec.cfg", "Other.tla"] as any,
      );

      const result = handlers.get("specs")!(new URL("tla://specs"));
      expect(result.contents[0].text).toBe("Other.tla\nSpec.cfg\nSpec.tla");
    });

    it("shows placeholder when no matching files", () => {
      vi.spyOn(fs, "readdirSync").mockReturnValue(["README.md"] as any);

      const result = handlers.get("specs")!(new URL("tla://specs"));
      expect(result.contents[0].text).toContain("no .tla or .cfg files");
    });

    it("handles missing workspace directory", () => {
      vi.spyOn(fs, "readdirSync").mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const result = handlers.get("specs")!(new URL("tla://specs"));
      expect(result.contents[0].text).toContain("no .tla or .cfg files");
    });
  });

  describe("tla://spec/{filename}", () => {
    it("reads a valid .tla file", () => {
      vi.spyOn(fs, "readFileSync").mockReturnValue("---- MODULE Spec ----\n====");

      const result = handlers.get("spec")!(
        new URL("tla://spec/Spec.tla"),
        { filename: "Spec.tla" },
      );
      expect(result.contents[0].text).toBe("---- MODULE Spec ----\n====");
    });

    it("rejects path traversal with ..", () => {
      const result = handlers.get("spec")!(
        new URL("tla://spec/foo"),
        { filename: "../etc/passwd" },
      );
      expect(result.contents[0].text).toContain("invalid filename");
    });

    it("rejects path traversal with /", () => {
      const result = handlers.get("spec")!(
        new URL("tla://spec/foo"),
        { filename: "sub/Spec.tla" },
      );
      expect(result.contents[0].text).toContain("invalid filename");
    });

    it("rejects path traversal with backslash", () => {
      const result = handlers.get("spec")!(
        new URL("tla://spec/foo"),
        { filename: "sub\\Spec.tla" },
      );
      expect(result.contents[0].text).toContain("invalid filename");
    });

    it("rejects non-.tla/.cfg extensions", () => {
      const result = handlers.get("spec")!(
        new URL("tla://spec/foo"),
        { filename: "secret.json" },
      );
      expect(result.contents[0].text).toContain("invalid filename");
    });

    it("allows .cfg files", () => {
      vi.spyOn(fs, "readFileSync").mockReturnValue("SPECIFICATION Spec");

      const result = handlers.get("spec")!(
        new URL("tla://spec/Spec.cfg"),
        { filename: "Spec.cfg" },
      );
      expect(result.contents[0].text).toBe("SPECIFICATION Spec");
    });

    it("handles file not found", () => {
      vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const result = handlers.get("spec")!(
        new URL("tla://spec/Missing.tla"),
        { filename: "Missing.tla" },
      );
      expect(result.contents[0].text).toContain("file not found");
    });
  });

  describe("tla://output/latest", () => {
    it("returns placeholder when no output found", () => {
      vi.spyOn(fs, "readdirSync").mockReturnValue([] as any);

      const result = handlers.get("latest-output")!(new URL("tla://output/latest"));
      expect(result.contents[0].text).toContain("no TLC output found");
    });

    it("finds and reads tlc-output.txt", () => {
      const mockDirents = [
        { name: "tlc-output.txt", isDirectory: () => false, isFile: () => true },
      ];
      vi.spyOn(fs, "readdirSync").mockReturnValue(mockDirents as any);
      vi.spyOn(fs, "statSync").mockReturnValue({ mtimeMs: 1000 } as any);
      vi.spyOn(fs, "readFileSync").mockReturnValue("Model checking completed.");

      const result = handlers.get("latest-output")!(new URL("tla://output/latest"));
      expect(result.contents[0].text).toBe("Model checking completed.");
    });
  });
});
