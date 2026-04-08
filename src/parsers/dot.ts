/**
 * Parse TLC DOT state graph files.
 *
 * Ported from Python: tlaplus-workflow/scripts/dot-to-json.py (parse_dot)
 */

import { parseStateLabel } from "./tla-values.js";
import type { VarMap } from "./types.js";

export interface DotState {
  label: string;
  vars: VarMap;
}

export interface DotEdge {
  source: string;
  target: string;
  action: string;
}

export interface DotGraph {
  states: Record<string, DotState>;
  edges: DotEdge[];
  initialStateId: string;
}

const EDGE_RE = /(-?\d+)\s*->\s*(-?\d+)\s*\[label="((?:[^"\\]|\\.)*)"\s*.*?\]/g;
const NODE_RE = /^(-?\d+)\s*\[label="((?:[^"\\]|\\.)*)"\s*(.*?)\]/gm;

/**
 * Parse TLC DOT file content into a structured graph.
 */
export function parseDot(content: string): DotGraph {
  const states: Record<string, DotState> = {};
  const edges: DotEdge[] = [];
  let initialId: string | null = null;

  // Parse nodes
  for (const m of content.matchAll(NODE_RE)) {
    const nid = m[1];
    const rawLabel = m[2];
    const attrs = m[3];

    // Unescape DOT string escapes: \\ -> \, \n -> newline, \" -> "
    const label = rawLabel
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"');

    const vars = parseStateLabel(label);
    states[nid] = { label, vars };

    if (attrs.includes("style = filled") || attrs.includes("style=filled")) {
      initialId = nid;
    }
  }

  // Parse edges
  for (const m of content.matchAll(EDGE_RE)) {
    edges.push({ source: m[1], target: m[2], action: m[3] });
  }

  if (initialId === null && Object.keys(states).length > 0) {
    // Fallback: pick smallest numeric id
    initialId = Object.keys(states).reduce((a, b) =>
      parseInt(a, 10) < parseInt(b, 10) ? a : b,
    );
  }

  if (Object.keys(states).length === 0) {
    throw new Error("Could not parse any states from DOT file.");
  }

  return { states, edges, initialStateId: initialId! };
}
