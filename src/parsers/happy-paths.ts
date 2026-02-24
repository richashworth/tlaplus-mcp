/**
 * Discover "happy paths" — successful execution paths through a state graph.
 *
 * Uses BFS from the initial state to find shortest paths to terminal states
 * (no outgoing transitions) or loop-back states. Excludes paths whose final
 * state matches a violation trace's final state. Deduplicates by action sequence.
 */

import type { DisambiguatedTransition } from "./action-disambiguator.js";

export interface HappyPathEntry {
  stateId: string;
  action: string | null;
}

export interface HappyPath {
  trace: HappyPathEntry[];
}

interface BfsNode {
  stateId: string;
  actions: string[];   // action labels along the path (length = stateIds.length - 1)
  stateIds: string[];  // all state IDs along the path (including this one)
}

/**
 * Discover happy paths via BFS from the initial state.
 *
 * @param initialStateId - The starting state
 * @param transitions - Map from state ID to its disambiguated transitions
 * @param violationFinalStates - Set of state IDs that are final states of violations (excluded)
 * @param maxPaths - Maximum number of paths to return (default 5)
 */
export function discoverHappyPaths(
  initialStateId: string,
  transitions: Record<string, DisambiguatedTransition[]>,
  violationFinalStates: Set<string>,
  maxPaths: number = 5,
): HappyPath[] {
  const MAX_DEPTH = 100;
  const paths: HappyPath[] = [];
  const seenActionSeqs = new Set<string>();

  const queue: BfsNode[] = [{
    stateId: initialStateId,
    actions: [],
    stateIds: [initialStateId],
  }];

  while (queue.length > 0 && paths.length < maxPaths) {
    const node = queue.shift()!;
    const outgoing = transitions[node.stateId];

    // Terminal state: no outgoing transitions (or only to violation states)
    if (!outgoing || outgoing.length === 0) {
      if (!violationFinalStates.has(node.stateId) && node.stateIds.length > 1) {
        const actionSeqKey = JSON.stringify(node.actions);
        if (!seenActionSeqs.has(actionSeqKey)) {
          seenActionSeqs.add(actionSeqKey);
          paths.push(buildHappyPath(node));
        }
      }
      continue;
    }

    // Check if all outgoing targets are violation final states
    const validTransitions = outgoing.filter(t => !violationFinalStates.has(t.target));

    if (validTransitions.length === 0 && !violationFinalStates.has(node.stateId) && node.stateIds.length > 1) {
      const actionSeqKey = JSON.stringify(node.actions);
      if (!seenActionSeqs.has(actionSeqKey)) {
        seenActionSeqs.add(actionSeqKey);
        paths.push(buildHappyPath(node));
      }
      continue;
    }

    if (node.stateIds.length > MAX_DEPTH) {
      continue;
    }

    for (const t of validTransitions) {
      // Loop detection: if target is already in the path, this is a loop path
      if (node.stateIds.includes(t.target)) {
        const loopActions = [...node.actions, t.action];
        const actionSeqKey = JSON.stringify(loopActions);
        if (!seenActionSeqs.has(actionSeqKey)) {
          seenActionSeqs.add(actionSeqKey);
          const loopPath = buildHappyPath({
            stateId: t.target,
            actions: loopActions,
            stateIds: [...node.stateIds, t.target],
          });
          paths.push(loopPath);
          if (paths.length >= maxPaths) break;
        }
        continue;
      }

      queue.push({
        stateId: t.target,
        actions: [...node.actions, t.action],
        stateIds: [...node.stateIds, t.target],
      });
    }
  }

  return paths;
}

function buildHappyPath(node: BfsNode): HappyPath {
  const trace: HappyPathEntry[] = [];
  const allIds = node.stateIds;

  for (let i = 0; i < allIds.length; i++) {
    trace.push({
      stateId: allIds[i],
      action: i === 0 ? null : node.actions[i - 1],
    });
  }

  return { trace };
}
