/**
 * Disambiguate action labels for edges that share the same action name
 * from the same source state.
 *
 * Ported from Python: tlaplus-workflow/scripts/dot-to-json.py (disambiguate_actions)
 */

import type { VarMap } from "./types.js";
import { compactDiff } from "./diff-utils.js";

export interface TransitionEdge {
  source: string;
  target: string;
  action: string;
}

export interface DisambiguatedTransition {
  action: string;
  label: string;
  target: string;
}

function disambiguateGroup(
  action: string,
  edgeDiffs: Array<[TransitionEdge, Array<[string, string, string]>]>
): DisambiguatedTransition[] {
  // Collect all diff keys across edges
  const allKeys: string[] = [];
  for (const [, diffs] of edgeDiffs) {
    for (const [k] of diffs) {
      if (!allKeys.includes(k)) {
        allKeys.push(k);
      }
    }
  }

  // Try each key: does it produce unique labels for all edges?
  for (const key of allKeys) {
    const labels: string[] = [];
    for (const [, diffs] of edgeDiffs) {
      const entry = diffs.find((d) => d[0] === key);
      if (entry) {
        labels.push(`${key}: ${entry[1]}\u2192${entry[2]}`);
      } else {
        labels.push(`${key}: (unchanged)`);
      }
    }
    if (new Set(labels).size === labels.length) {
      return edgeDiffs.map(([e], i) => ({
        action,
        label: `${action} (${labels[i]})`,
        target: e.target,
      }));
    }
  }

  // Fallback: pick the first diff per edge that is unique
  const result: DisambiguatedTransition[] = [];
  const usedLabels = new Set<string>();

  for (const [e, diffs] of edgeDiffs) {
    let lbl: string | null = null;
    for (const d of diffs) {
      const candidate = `${action} (${d[0]}: ${d[1]}\u2192${d[2]})`;
      if (!usedLabels.has(candidate)) {
        lbl = candidate;
        break;
      }
    }
    if (lbl === null) {
      lbl = `${action} (\u2192 ${e.target})`;
    }
    usedLabels.add(lbl);
    result.push({ action, label: lbl, target: e.target });
  }
  return result;
}

/**
 * Build transitions dict with disambiguated labels where needed.
 */
export function disambiguateActions(
  states: Record<string, { vars: VarMap }>,
  edges: TransitionEdge[]
): Record<string, DisambiguatedTransition[]> {
  // Group edges by source
  const bySource: Record<string, TransitionEdge[]> = {};
  for (const e of edges) {
    if (!bySource[e.source]) bySource[e.source] = [];
    bySource[e.source].push(e);
  }

  const transitions: Record<string, DisambiguatedTransition[]> = {};

  for (const [src, srcEdges] of Object.entries(bySource)) {
    // Group by action name
    const actionGroups: Record<string, TransitionEdge[]> = {};
    for (const e of srcEdges) {
      if (!actionGroups[e.action]) actionGroups[e.action] = [];
      actionGroups[e.action].push(e);
    }

    const result: DisambiguatedTransition[] = [];
    for (const [action, group] of Object.entries(actionGroups)) {
      if (group.length === 1) {
        result.push({
          action,
          label: action,
          target: group[0].target,
        });
      } else {
        // Need disambiguation
        const srcVars = states[src].vars;
        const edgeDiffs: Array<[TransitionEdge, Array<[string, string, string]>]> = [];
        for (const e of group) {
          const tgtVars = states[e.target].vars;
          const diffs = compactDiff(srcVars, tgtVars);
          edgeDiffs.push([e, diffs]);
        }
        result.push(...disambiguateGroup(action, edgeDiffs));
      }
    }

    transitions[src] = result;
  }

  return transitions;
}
