/**
 * Confine tool file access to the directories in TLAPLUS_MCP_ROOTS.
 *
 * The server runs outside the MCP client's sandbox, so every path a tool
 * reads or writes is resolved through symlinks and checked against the roots.
 */

import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadConfig } from "./config.js";

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Real paths of the configured roots. Roots that don't exist are skipped. */
export function allowedRoots(): string[] {
  const roots: string[] = [];
  for (const root of loadConfig().roots) {
    if (!isAbsolute(root)) {
      throw new Error(`TLAPLUS_MCP_ROOTS entries must be absolute: ${root}`);
    }
    try {
      roots.push(realpathSync.native(root));
    } catch {
      /* a missing root cannot contain anything */
    }
  }
  return roots;
}

function assertInsideRoots(real: string, original: string, label: string) {
  const roots = allowedRoots();
  const inside = roots.some((root) => {
    const rel = relative(root, real);
    return (
      rel === "" ||
      (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel))
    );
  });
  if (!inside) {
    throw new Error(
      `${label} is outside the allowed roots: ${original}` +
        (real !== original ? ` (resolves to ${real})` : "") +
        `. Allowed roots: ${roots.join(", ") || "(none)"}. Set TLAPLUS_MCP_ROOTS to change them.`,
    );
  }
}

/**
 * Resolve an existing file or directory for reading. Returns its real path.
 * Throws "<label> not found" if it doesn't exist, or if it is outside the roots.
 */
export function resolveReadPath(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path: ${path}`);
  }
  let real: string;
  try {
    real = realpathSync.native(path);
  } catch (err) {
    if (!isNotFound(err)) throw err;
    // Check the roots first so a refusal doesn't reveal whether the file exists.
    resolveWritePath(path, label);
    throw new Error(`${label} not found: ${path}`, { cause: err });
  }
  assertInsideRoots(real, path, label);
  return real;
}

/**
 * Resolve a path that will be written (it may not exist yet). Resolves the
 * deepest existing ancestor through symlinks and returns the real path with
 * the missing components appended. Dangling symlinks are refused, since a
 * write would follow them.
 */
export function resolveWritePath(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path: ${path}`);
  }
  const missing: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      const real = join(realpathSync.native(current), ...missing);
      assertInsideRoots(real, path, label);
      return real;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    let exists = false;
    try {
      lstatSync(current);
      exists = true;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    if (exists) {
      throw new Error(`${label} is a dangling symlink: ${current}`);
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`${label} has no existing parent directory: ${path}`);
    }
    missing.unshift(current.slice(parent.length).replace(/^[/\\]+/, ""));
    current = parent;
  }
}

/**
 * TLC loads a Java class named after any module it finds next to the spec,
 * so a .class file in the spec directory would run arbitrary code in this
 * unsandboxed process. Refuse to run TLC on such a directory.
 */
export function assertNoJavaOverrides(specDir: string): void {
  const classes = readdirSync(specDir).filter((f) =>
    f.toLowerCase().endsWith(".class"),
  );
  if (classes.length > 0) {
    throw new Error(
      `Refusing to run TLC: ${specDir} contains Java class files (${classes.join(", ")}), ` +
        "which TLC would load and execute as module overrides.",
    );
  }
}
