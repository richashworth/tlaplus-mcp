/**
 * Parse TLC stdout output for results, violations, and coverage.
 *
 * Ported from Python: tlaplus-workflow/scripts/dot-to-json.py (parse_tlc_output)
 */

import { parseStateLabel } from "./tla-values.js";
import type { VarMap } from "./types.js";
import { short, compactDiff } from "./diff-utils.js";

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

// -- Tool-mode message parsing -----------------------------------------------

interface TlcMessage {
  code: number;
  severity: number;
  body: string;
}

const MSG_START_RE = /^@!@!@STARTMSG (\d+):(\d+) @!@!@$/;
const MSG_END_RE = /^@!@!@ENDMSG (\d+) @!@!@$/;

/**
 * Parse TLC `-tool` mode output into structured message blocks.
 * Returns `null` if the output doesn't contain any tool-mode markers,
 * allowing callers to fall back to the legacy plain-text parser.
 */
function parseTlcMessages(output: string): TlcMessage[] | null {
  const lines = output.split("\n");
  const messages: TlcMessage[] = [];
  let current: { code: number; severity: number; bodyLines: string[] } | null = null;
  let found = false;

  for (const line of lines) {
    const startM = MSG_START_RE.exec(line);
    if (startM) {
      found = true;
      current = {
        code: parseInt(startM[1], 10),
        severity: parseInt(startM[2], 10),
        bodyLines: [],
      };
      continue;
    }

    const endM = MSG_END_RE.exec(line);
    if (endM && current) {
      messages.push({
        code: current.code,
        severity: current.severity,
        body: current.bodyLines.join("\n"),
      });
      current = null;
      continue;
    }

    if (current) {
      current.bodyLines.push(line);
    }
  }

  return found ? messages : null;
}

// -- Regexes -----------------------------------------------------------------

const STATE_HEADER_RE = /^State\s+(\d+):\s*(?:<(.+?)>)?/;
const BACK_TO_STATE_RE = /^Back to state\s+(\d+)/;

// -- Helpers -----------------------------------------------------------------

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

  // Try tool-mode parsing first
  const messages = parseTlcMessages(output);

  if (messages !== null) {
    // Tool-mode: parse by message code
    for (const msg of messages) {
      switch (msg.code) {
        case 2110: // Invariant violated (behavior)
        case 2107: { // Invariant violated (initial state)
          success = false;
          const invM = msg.body.match(/Invariant (\S+) is violated/);
          violations.push({
            type: "invariant",
            name: invM ? invM[1] : undefined,
            summary: invM ? `Invariant ${invM[1]} violated` : "Invariant violated",
          });
          break;
        }
        case 2114: // Deadlock
          success = false;
          violations.push({
            type: "deadlock",
            summary: "Deadlock reached",
          });
          break;
        case 2116: // Temporal property violated
          success = false;
          violations.push({
            type: "temporal",
            summary: "Temporal property violated",
          });
          break;
        case 2199: { // State statistics
          const sm = msg.body.match(/(\d+) states generated, (\d+) distinct states found/);
          if (sm) {
            statesFound = parseInt(sm[1], 10);
            statesDistinct = parseInt(sm[2], 10);
          }
          break;
        }
        case 2185: // Start time
          startTime = msg.body.trim();
          break;
        case 2186: { // Finish time
          const fm = msg.body.match(/Finished in (.+?) at \((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\)/);
          if (fm) {
            duration = fm[1];
            endTime = fm[2];
          } else {
            endTime = msg.body.trim();
          }
          break;
        }
        case 2221: { // Coverage value
          const covM = msg.body.match(/<(\w+) line (\d+), col \d+ of module (\w+)>:\s*(\d+)/);
          if (covM) {
            coverage.push({
              action: covM[1],
              line: parseInt(covM[2], 10),
              module: covM[3],
              count: parseInt(covM[4], 10),
            });
          }
          break;
        }
        default:
          // Skip known informational codes that aren't errors
          if (msg.code === 2121 || msg.code === 2120 || msg.code === 2217 ||
              msg.code === 2216 || msg.code === 2218 || msg.code === 2122) {
            break;
          }
          if (msg.severity === 1) {
            // Check if this carries a temporal property name
            const tempM = msg.body.match(/(\S+)\s+is violated/);
            if (tempM) {
              // Patch the last unnamed temporal violation
              const lastTemp = [...violations].reverse().find(
                v => v.type === "temporal" && !v.name
              );
              if (lastTemp) {
                lastTemp.name = tempM[1];
                lastTemp.summary = `${tempM[1]} violated`;
              }
            } else if (msg.body.trim()) {
              success = false;
              errors.push({ message: msg.body.trim() });
            }
          }
          break;
      }
    }
  } else {
    // Legacy plain-text parsing
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
      if (errMatch && !invMatch && !line.includes("Temporal") && !line.includes("is violated") && !line.includes("Deadlock")) {
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
  // Try tool-mode parsing first
  const messages = parseTlcMessages(output);
  if (messages !== null) {
    return parseTlcViolationTracesFromMessages(messages, graphStates);
  }

  // Legacy plain-text parsing
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

// -- Tool-mode violation trace parser ----------------------------------------

const VIOLATION_CODES = new Set([2110, 2107, 2114, 2116]);
const STATE_CODES = new Set([2216, 2217, 2218, 2122]);
const SKIP_CODES = new Set([2121, 2120]); // informational headers

function parseTlcViolationTracesFromMessages(
  messages: TlcMessage[],
  graphStates: Record<string, { vars: VarMap }>
): ViolationTrace[] {
  const violations: ViolationTrace[] = [];
  let i = 0;
  let vid = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (!VIOLATION_CODES.has(msg.code)) {
      i++;
      continue;
    }

    // Determine violation type and name
    let vtype: "invariant" | "deadlock" | "temporal";
    let vname: string | null = null;

    if (msg.code === 2110 || msg.code === 2107) {
      vtype = "invariant";
      const invM = msg.body.match(/Invariant (\S+) is violated/);
      if (invM) vname = invM[1];
    } else if (msg.code === 2114) {
      vtype = "deadlock";
    } else {
      vtype = "temporal";
    }

    i++;

    // For temporal violations, look for the property name in subsequent error messages
    if (vtype === "temporal") {
      for (let j = i; j < messages.length && !VIOLATION_CODES.has(messages[j].code) && !STATE_CODES.has(messages[j].code); j++) {
        if (messages[j].severity === 1) {
          const tempM = messages[j].body.match(/(\S+)\s+is violated/);
          if (tempM) {
            vname = tempM[1];
            break;
          }
        }
      }
    }

    // Advance past non-state, non-skip messages (e.g., property name errors)
    while (i < messages.length && !STATE_CODES.has(messages[i].code) && !SKIP_CODES.has(messages[i].code) && !VIOLATION_CODES.has(messages[i].code)) {
      i++;
    }

    // Collect trace states
    const traceStates: Array<{ action: string | null; vars: VarMap }> = [];
    let backTo: string | null = null;

    while (i < messages.length) {
      const sm = messages[i];

      if (SKIP_CODES.has(sm.code)) {
        i++;
        continue;
      }

      if (!STATE_CODES.has(sm.code)) {
        break;
      }

      if (sm.code === 2122) {
        // Back to state (lasso)
        const btM = sm.body.match(/Back to state\s*(?:<[^>]*>)?\s*(\d+)/);
        if (!btM) {
          // Try simpler pattern
          const btM2 = sm.body.match(/(\d+)/);
          if (btM2) backTo = btM2[1];
        } else {
          backTo = btM[1];
        }
        i++;
        break;
      }

      if (sm.code === 2218) {
        // Stuttering state — treat as end marker, no vars to parse
        i++;
        break;
      }

      // 2216 (initial state, no action) or 2217 (state with action)
      const bodyLines = sm.body.split("\n");
      let actionName: string | null = null;

      // First line may contain state number and action info
      // Format: "N: <ActionName line L, col C of module M>"
      // or just variable lines for 2216
      let varStartIdx = 0;
      if (bodyLines.length > 0) {
        const headerM = bodyLines[0].match(/^\d+:\s*<(.+?)>/);
        if (headerM) {
          const am = headerM[1].match(/^(\w+)/);
          if (am && am[1] !== "Initial") {
            actionName = am[1];
          }
          varStartIdx = 1;
        }
      }

      const varLines = bodyLines.slice(varStartIdx).filter(l => l.trim());
      const label = varLines.join("\n");
      const tvars = parseStateLabel(label);
      traceStates.push({ action: actionName, vars: tvars });

      i++;
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
