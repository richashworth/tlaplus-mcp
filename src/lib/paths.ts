/**
 * Confine tool file access to the directories in TLAPLUS_MCP_ROOTS.
 *
 * The server runs outside the MCP client's sandbox, so every path a tool
 * reads or writes is resolved through symlinks and checked against the roots.
 */

import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
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

function isInsideRoots(real: string, roots: string[]): boolean {
  return roots.some((root) => {
    const rel = relative(root, real);
    return (
      rel === "" ||
      (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel))
    );
  });
}

/**
 * A hard link shares its inode with a file that may live outside the roots,
 * and realpath can't tell, so refuse regular files with more than one link.
 */
function assertNotHardLinked(real: string, original: string, label: string) {
  const st = statSync(real);
  if (st.isFile() && st.nlink > 1) {
    throw new Error(
      `${label} has ${st.nlink} hard links and may alias a file outside the allowed roots: ${original}`,
    );
  }
}

function assertInsideRoots(real: string, original: string, label: string) {
  const roots = allowedRoots();
  if (!isInsideRoots(real, roots)) {
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
  assertNotHardLinked(real, path, label);
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
      if (missing.length === 0) assertNotHardLinked(real, path, label);
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
 * SANY, TLC, PlusCal and TLATeX open files in the spec directory that the
 * server never sees by name: EXTENDS/INSTANCE modules on the read side, and
 * SpecTE, TTrace, .cfg, .tex/.dvi/.pdf files on the write side. Refuse to run
 * them unless every entry stays inside the roots:
 * - no .class files, which TLC loads and executes as module overrides;
 * - no symlinks resolving outside the roots, and no dangling symlinks;
 * - no hard-linked regular files.
 * The scan isn't recursive: none of these tools look in subdirectories.
 */
export function assertSafeSpecDir(specDir: string): void {
  const roots = allowedRoots();
  const problems: string[] = [];
  for (const name of readdirSync(specDir)) {
    const entry = join(specDir, name);
    if (name.toLowerCase().endsWith(".class")) {
      problems.push(`${name} is a Java class file`);
      continue;
    }
    const st = lstatSync(entry);
    if (st.isSymbolicLink()) {
      let real: string;
      try {
        real = realpathSync.native(entry);
      } catch (err) {
        if (!isNotFound(err)) throw err;
        problems.push(`${name} is a dangling symlink`);
        continue;
      }
      if (!isInsideRoots(real, roots)) {
        problems.push(`${name} links outside the allowed roots (${real})`);
        continue;
      }
      const target = statSync(real);
      if (target.isFile() && target.nlink > 1) {
        problems.push(`${name} links to a hard-linked file`);
      }
    } else if (st.isFile() && st.nlink > 1) {
      problems.push(`${name} has ${st.nlink} hard links`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to run Java tools in ${specDir}: ${problems.join("; ")}.`,
    );
  }
}
