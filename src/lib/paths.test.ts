import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allowedRoots,
  assertSafeSpecDir,
  resolveReadPath,
  resolveWritePath,
} from "./paths.js";

describe("path confinement", () => {
  const originalEnv = { ...process.env };
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "tlaplus-mcp-paths-")));
    root = join(base, "root");
    outside = join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(root, "Spec.tla"), "");
    writeFileSync(join(outside, "Secret.tla"), "");
    process.env.TLAPLUS_MCP_ROOTS = root;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(base, { recursive: true, force: true });
  });

  describe("allowedRoots", () => {
    it("defaults to TLC_WORKSPACE", () => {
      delete process.env.TLAPLUS_MCP_ROOTS;
      process.env.TLC_WORKSPACE = outside;
      expect(allowedRoots()).toEqual([outside]);
    });

    it("splits TLAPLUS_MCP_ROOTS on colons and skips missing roots", () => {
      process.env.TLAPLUS_MCP_ROOTS = `${root}:${join(base, "nope")}:${outside}`;
      expect(allowedRoots()).toEqual([root, outside]);
    });

    it("rejects relative roots", () => {
      process.env.TLAPLUS_MCP_ROOTS = "relative/dir";
      expect(() => allowedRoots()).toThrow(/must be absolute/);
    });
  });

  describe("resolveReadPath", () => {
    it("accepts a file inside a root", () => {
      expect(resolveReadPath(join(root, "Spec.tla"), "TLA+ file")).toBe(
        join(root, "Spec.tla"),
      );
    });

    it("refuses a file outside the roots", () => {
      expect(() =>
        resolveReadPath(join(outside, "Secret.tla"), "TLA+ file"),
      ).toThrow(/TLA\+ file is outside the allowed roots/);
    });

    it("refuses .. traversal out of a root", () => {
      expect(() =>
        resolveReadPath(join(root, "..", "outside", "Secret.tla"), "TLA+ file"),
      ).toThrow(/outside the allowed roots/);
    });

    it("refuses a symlink inside a root that points outside", () => {
      symlinkSync(join(outside, "Secret.tla"), join(root, "Link.tla"));
      expect(() =>
        resolveReadPath(join(root, "Link.tla"), "TLA+ file"),
      ).toThrow(/outside the allowed roots.*resolves to/);
    });

    it("refuses a file under a symlinked directory that points outside", () => {
      symlinkSync(outside, join(root, "linkdir"));
      expect(() =>
        resolveReadPath(join(root, "linkdir", "Secret.tla"), "TLA+ file"),
      ).toThrow(/outside the allowed roots/);
    });

    it("reports a missing file inside a root as not found", () => {
      expect(() =>
        resolveReadPath(join(root, "Missing.tla"), "TLA+ file"),
      ).toThrow(/TLA\+ file not found/);
    });

    it("doesn't reveal whether a file outside the roots exists", () => {
      expect(() =>
        resolveReadPath(join(outside, "Missing.tla"), "TLA+ file"),
      ).toThrow(/outside the allowed roots/);
    });

    it("names the roots but not how to widen them", () => {
      let message = "";
      try {
        resolveReadPath(join(outside, "Secret.tla"), "TLA+ file");
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(
        new RegExp(`Allowed roots: ${root}; ask the user to change them\\.$`),
      );
      expect(message).not.toContain("TLAPLUS_MCP_ROOTS");
    });

    it("refuses everything when no root exists", () => {
      process.env.TLAPLUS_MCP_ROOTS = join(base, "nope");
      expect(() =>
        resolveReadPath(join(root, "Spec.tla"), "TLA+ file"),
      ).toThrow(/outside the allowed roots.*\(none\)/);
    });

    it("rejects a relative path", () => {
      expect(() => resolveReadPath("Spec.tla", "TLA+ file")).toThrow(
        /must be an absolute path/,
      );
    });
  });

  describe("resolveWritePath", () => {
    it("accepts a new file in a new subdirectory of a root", () => {
      expect(
        resolveWritePath(join(root, "a", "b", "out.txt"), "output_file"),
      ).toBe(join(root, "a", "b", "out.txt"));
    });

    it("refuses a new file outside the roots", () => {
      expect(() =>
        resolveWritePath(join(outside, "out.txt"), "output_file"),
      ).toThrow(/output_file is outside the allowed roots/);
    });

    it("refuses writing through a symlinked directory that points outside", () => {
      symlinkSync(outside, join(root, "linkdir"));
      expect(() =>
        resolveWritePath(
          join(root, "linkdir", "new", "out.txt"),
          "output_file",
        ),
      ).toThrow(/outside the allowed roots/);
    });

    it("refuses an existing symlink that points outside", () => {
      symlinkSync(join(outside, "Secret.tla"), join(root, "out.txt"));
      expect(() =>
        resolveWritePath(join(root, "out.txt"), "output_file"),
      ).toThrow(/outside the allowed roots/);
    });

    it("refuses a dangling symlink", () => {
      symlinkSync(join(outside, "new.txt"), join(root, "out.txt"));
      expect(() =>
        resolveWritePath(join(root, "out.txt"), "output_file"),
      ).toThrow(/dangling symlink/);
    });

    it("accepts a symlink that stays inside the root", () => {
      symlinkSync(join(root, "Spec.tla"), join(root, "alias.tla"));
      expect(resolveWritePath(join(root, "alias.tla"), "output_file")).toBe(
        join(root, "Spec.tla"),
      );
    });
  });

  describe("hard links", () => {
    it("refuses to read a hard-linked file", () => {
      linkSync(join(outside, "Secret.tla"), join(root, "Hard.tla"));
      expect(() =>
        resolveReadPath(join(root, "Hard.tla"), "TLA+ file"),
      ).toThrow(/2 hard links/);
    });

    it("refuses a hard-linked output_file", () => {
      linkSync(join(outside, "Secret.tla"), join(root, "out.txt"));
      expect(() =>
        resolveWritePath(join(root, "out.txt"), "output_file"),
      ).toThrow(/output_file has 2 hard links/);
    });

    it("accepts an existing output_file with a single link", () => {
      writeFileSync(join(root, "out.txt"), "");
      expect(resolveWritePath(join(root, "out.txt"), "output_file")).toBe(
        join(root, "out.txt"),
      );
    });
  });

  describe("assertSafeSpecDir", () => {
    it("passes a plain directory and symlinks that stay inside the roots", () => {
      mkdirSync(join(root, "sub"));
      symlinkSync(join(root, "Spec.tla"), join(root, "Alias.tla"));
      expect(() => assertSafeSpecDir(root)).not.toThrow();
    });

    it("refuses a class file", () => {
      writeFileSync(join(root, "Spec.class"), "");
      expect(() => assertSafeSpecDir(root)).toThrow(
        /Spec\.class is a Java class file/,
      );
    });

    it("refuses a symlink that points outside", () => {
      symlinkSync(join(outside, "Secret.tla"), join(root, "Helper.tla"));
      expect(() => assertSafeSpecDir(root)).toThrow(
        /Helper\.tla links outside the allowed roots/,
      );
    });

    it("refuses a symlinked directory that points outside", () => {
      symlinkSync(outside, join(root, "linkdir"));
      expect(() => assertSafeSpecDir(root)).toThrow(
        /linkdir links outside the allowed roots/,
      );
    });

    it("refuses a dangling symlink", () => {
      symlinkSync(
        join(outside, "Spec_SpecTE.tla"),
        join(root, "Spec_SpecTE.tla"),
      );
      expect(() => assertSafeSpecDir(root)).toThrow(
        /Spec_SpecTE\.tla is a dangling symlink/,
      );
    });

    it("refuses a hard-linked file", () => {
      linkSync(join(outside, "Secret.tla"), join(root, "Helper.tla"));
      expect(() => assertSafeSpecDir(root)).toThrow(
        /Helper\.tla has 2 hard links/,
      );
    });

    it("lists every problem", () => {
      writeFileSync(join(root, "A.class"), "");
      symlinkSync(join(outside, "nope"), join(root, "B.tla"));
      expect(() => assertSafeSpecDir(root)).toThrow(/A\.class.*; B\.tla/);
      expect(() => assertSafeSpecDir(root)).toThrow(
        /ask the user to change them\.$/,
      );
    });
  });
});
