/**
 * Shared diff utilities for comparing TLA+ variable maps.
 */

import type { VarMap } from "./types.js";

/** Stringify a value for human-readable display. */
export function short(v: unknown): string {
  if (typeof v === "string") return v;
  const s = JSON.stringify(v);
  return s.length > 50 ? s.slice(0, 47) + "..." : s;
}

/**
 * Compare two variable maps and return an array of [key, oldValue, newValue]
 * triples for each variable whose JSON representation changed.
 */
export function compactDiff(
  srcVars: VarMap,
  tgtVars: VarMap
): Array<[string, string, string]> {
  const diffs: Array<[string, string, string]> = [];
  for (const k of Object.keys(srcVars)) {
    if (k in tgtVars && JSON.stringify(srcVars[k]) !== JSON.stringify(tgtVars[k])) {
      diffs.push([k, short(srcVars[k]), short(tgtVars[k])]);
    }
  }
  return diffs;
}
