/**
 * Parse TLC stdout output for results, violations, and coverage.
 *
 * Ported from Python: tlaplus-workflow/scripts/dot-to-json.py (parse_tlc_output)
 */

import { parseStateLabel } from "./tla-values.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VarMap = Record<string, any>;

// -- Types -------------------------------------------------------------------

export interface TlcError {
  message: string;
  line?: number;
  column?: number;
  module?: string;
}

export interface TlcCoverage {
  module: string;
  action: string;
  line: number;
  count: number;
}

export interface TlcViolation {
  type: "invariant" | "deadlock" | "temporal";
  name?: string;
  summary: string;
}

export interface TlcResult {
  success: boolean;
  statesFound?: number;
  statesDistinct?: number;
  errors: TlcError[];
  violations: TlcViolation[];
  coverage: TlcCoverage[];
  startTime?: string;
  endTime?: string;
  duration?: string;
}

export interface ViolationTraceEntry {
  stateId: string | null;
  action: string | null;
}

export interface ViolationTrace {
  id: string;
  type: "invariant" | "deadlock" | "temporal";
  summary: string;
  invariant?: string;
  property?: string;
  trace: ViolationTraceEntry[];
}

// -- Regexes -----------------------------------------------------------------

const STATE_HEADER_RE = /^State\s+(\d+):\s*(?:<(.+?)>)?/;
const BACK_TO_STATE_RE = /^Back to state\s+(\d+)/;

// -- Helpers -----------------------------------------------------------------

function short(v: unknown): string {
  return typeof v === "string" ? v : String(v);
}

function compactDiff(
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

function normalizeForCompare(v: unknown): unknown {
  if (Array.isArray(v)) {
    const normed = v.map(normalizeForCompare);
    try {
      normed.sort((a, b) => String(a).localeCompare(String(b)));
    } catch {
      // ignore sort failures
    }
    return normed;
  }
  if (v !== null && typeof v === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
      result[key] = normalizeForCompare(val);
    }
    return result;
  }
  return v;
}

function findMatchingState(
  tvars: VarMap,
  graphStates: Record<string, { vars: VarMap }>
): string | null {
  const normTvars = normalizeForCompare(tvars);
  const normTvarsStr = JSON.stringify(normTvars);
  for (const [sid, sdata] of Object.entries(graphStates)) {
    if (JSON.stringify(normalizeForCompare(sdata.vars)) === normTvarsStr) {
      return sid;
    }
  }
  return null;
}

function violationSummary(
  vtype: string,
  vname: string | null,
  traceStates: Array<{ action: string | null; vars: VarMap }>
): string {
  if (vtype === "deadlock") {
    if (traceStates.length > 0) {
      const last = traceStates[traceStates.length - 1].vars;
      const parts = Object.entries(last)
        .slice(0, 3)
        .map(([k, v]) => `${k} = ${short(v)}`);
      return `Deadlock reached with ${parts.join(", ")}`;
    }
    return "Deadlock reached";
  }

  const prefix = vname || vtype;
  if (traceStates.length >= 2) {
    const prev = traceStates[traceStates.length - 2].vars;
    const last = traceStates[traceStates.length - 1].vars;
    const diffs = compactDiff(prev, last);
    if (diffs.length > 0) {
      const parts = diffs.slice(0, 3).map(([k, , nv]) => `${k} changed to ${nv}`);
      return `${prefix} violated: ${parts.join("; ")}`;
    }
  }
  return `${prefix} violated`;
}

// -- Main parsers ------------------------------------------------------------

/**
 * Parse TLC stdout for high-level results: success/failure, state counts,
 * errors, violations summary, and coverage.
 */
export function parseTlcOutput(output: string): TlcResult {
  const lines = output.split("\n");
  const errors: TlcError[] = [];
  const violations: TlcViolation[] = [];
  const coverage: TlcCoverage[] = [];
  let success = true;
  let statesFound: number | undefined;
  let statesDistinct: number | undefined;
  let startTime: string | undefined;
  let endTime: string | undefined;
  let duration: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // State counts
    const stateMatch = line.match(/(\d+) states generated, (\d+) distinct states found/);
    if (stateMatch) {
      statesFound = parseInt(stateMatch[1], 10);
      statesDistinct = parseInt(stateMatch[2], 10);
    }

    // Start/end timestamps
    const startMatch = line.match(/^Starting\.\.\. \((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\)/);
    if (startMatch) startTime = startMatch[1];

    const endMatch = line.match(/^Finished in (\S+) at \((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\)/);
    if (endMatch) {
      duration = endMatch[1];
      endTime = endMatch[2];
    }

    // Invariant violations
    const invMatch = line.match(/^Error: Invariant (\S+) is violated\./);
    if (invMatch) {
      success = false;
      violations.push({
        type: "invariant",
        name: invMatch[1],
        summary: `Invariant ${invMatch[1]} violated`,
      });
    }

    // Deadlock
    if (line.includes("Deadlock reached")) {
      success = false;
      violations.push({
        type: "deadlock",
        summary: "Deadlock reached",
      });
    }

    // Temporal violations
    if (line.includes("Temporal properties were violated")) {
      success = false;
      // Try to find the property name on subsequent lines
      let propName: string | undefined;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const pm = lines[j].match(/^Error:\s+(\S+)\s+is violated/);
        if (pm) {
          propName = pm[1];
          break;
        }
      }
      violations.push({
        type: "temporal",
        name: propName,
        summary: propName ? `${propName} violated` : "Temporal property violated",
      });
    }

    // General errors (syntax, etc)
    const errMatch = line.match(/^Error:\s*(.+)/);
    if (errMatch && !invMatch && !line.includes("Temporal") && !line.includes("is violated")) {
      success = false;
      errors.push({ message: errMatch[1] });
    }

    // Coverage lines: <ActionName line N, col C of module M>: count
    const covMatch = line.match(/<(\w+) line (\d+), col \d+ of module (\w+)>:\s*(\d+)/);
    if (covMatch) {
      coverage.push({
        action: covMatch[1],
        line: parseInt(covMatch[2], 10),
        module: covMatch[3],
        count: parseInt(covMatch[4], 10),
      });
    }
  }

  return {
    success,
    statesFound,
    statesDistinct,
    errors,
    violations,
    coverage,
    startTime,
    endTime,
    duration,
  };
}

/**
 * Extract violation traces from TLC stdout and match them to graph states.
 */
export function parseTlcViolationTraces(
  output: string,
  graphStates: Record<string, { vars: VarMap }>
): ViolationTrace[] {
  const lines = output.split("\n");
  const violations: ViolationTrace[] = [];

  let i = 0;
  let vid = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    // Detect violation type
    let vtype: "invariant" | "deadlock" | "temporal" | null = null;
    let vname: string | null = null;

    const invM = line.match(/^Error: Invariant (\S+) is violated\./);
    if (invM) {
      vtype = "invariant";
      vname = invM[1];
    }

    if (line.includes("Deadlock reached")) {
      vtype = "deadlock";
    }

    if (line.includes("Temporal properties were violated")) {
      vtype = "temporal";
    }

    if (vtype === null) {
      i++;
      continue;
    }

    // Advance to trace
    i++;
    while (i < lines.length && !STATE_HEADER_RE.test(lines[i].trimEnd())) {
      if (vtype === "temporal" && vname === null) {
        const pm = lines[i].trimEnd().match(/^Error:\s+(\S+)\s+is violated/);
        if (pm) vname = pm[1];
      }
      i++;
    }

    // Parse trace states
    const traceStates: Array<{ action: string | null; vars: VarMap }> = [];
    let backTo: string | null = null;

    while (i < lines.length) {
      const tline = lines[i].trimEnd();
      const sm = STATE_HEADER_RE.exec(tline);
      const bm = BACK_TO_STATE_RE.exec(tline);

      if (bm) {
        backTo = bm[1];
        i++;
        break;
      }

      if (sm) {
        const actionInfo = sm[2] || null;
        let actionName: string | null = null;
        if (actionInfo) {
          const am = actionInfo.match(/^(\w+)/);
          if (am && am[1] !== "Initial") {
            actionName = am[1];
          }
        }

        // Gather variable lines
        const varLines: string[] = [];
        i++;
        while (i < lines.length) {
          const vl = lines[i].trimEnd();
          if (
            !vl ||
            STATE_HEADER_RE.test(vl) ||
            BACK_TO_STATE_RE.test(vl) ||
            vl.startsWith("Error:")
          ) {
            break;
          }
          varLines.push(vl);
          i++;
        }

        const label = varLines.join("\n");
        const tvars = parseStateLabel(label);
        traceStates.push({ action: actionName, vars: tvars });
      } else {
        if (tline === "") {
          i++;
          continue;
        }
        break;
      }
    }

    // Match trace states to graph states
    const traceEntries: ViolationTraceEntry[] = [];
    for (const ts of traceStates) {
      const sid = findMatchingState(ts.vars, graphStates);
      traceEntries.push({ stateId: sid, action: ts.action });
    }

    if (backTo !== null) {
      const backIdx = parseInt(backTo, 10) - 1;
      let backSid: string | null = null;
      if (backIdx >= 0 && backIdx < traceEntries.length) {
        backSid = traceEntries[backIdx].stateId;
      }
      traceEntries.push({ stateId: backSid, action: "Back to state" });
    }

    // Generate summary
    const summary = violationSummary(vtype, vname, traceStates);

    vid++;
    const violation: ViolationTrace = {
      id: `v${vid}`,
      type: vtype,
      summary,
      trace: traceEntries,
    };
    if (vtype === "invariant" && vname) {
      violation.invariant = vname;
    }
    if (vtype === "temporal" && vname) {
      violation.property = vname;
    }

    violations.push(violation);
  }

  return violations;
}
