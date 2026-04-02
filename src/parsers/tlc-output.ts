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

export interface TlcMessage {
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
export function parseTlcMessages(output: string): TlcMessage[] | null {
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

/**
 * Extract the body of the first TLC message with the given code.
 * Returns the trimmed body, or null if not found or output is not tool-mode.
 */
export function extractMessageBody(output: string, code: number): string | null {
  const messages = parseTlcMessages(output);
  if (!messages) return null;
  const msg = messages.find(m => m.code === code);
  return msg ? msg.body.trim() : null;
}

// -- Regexes -----------------------------------------------------------------

const STATE_HEADER_RE = /^State\s+(\d+):\s*(?:<(.+?)>)?/;
const BACK_TO_STATE_RE = /^Back to state\s+(\d+)/;

// -- Helpers -----------------------------------------------------------------

function normalizeForCompare(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(normalizeForCompare);
  }
  if (v !== null && typeof v === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      result[key] = normalizeForCompare((v as Record<string, unknown>)[key]);
    }
    return result;
  }
  return v;
}

function buildStateLookup(
  graphStates: Record<string, { vars: VarMap }>
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [sid, sdata] of Object.entries(graphStates)) {
    const key = JSON.stringify(normalizeForCompare(sdata.vars));
    lookup.set(key, sid);
  }
  return lookup;
}

function lookupState(tvars: VarMap, lookup: Map<string, string>): string | null {
  const key = JSON.stringify(normalizeForCompare(tvars));
  return lookup.get(key) ?? null;
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

// -- Raw trace extraction (shared by both violation trace and graph builders) --

export interface RawTraceState {
  action: string | null;
  vars: VarMap;
  label: string;
}

export interface RawTrace {
  type: "invariant" | "deadlock" | "temporal";
  name: string | null;
  traceStates: RawTraceState[];
  backToIndex: number | null;  // 0-based index into traceStates, or null
}

function extractRawTracesLegacy(output: string): RawTrace[] {
  const lines = output.split("\n");
  const traces: RawTrace[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();

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

    i++;
    while (i < lines.length && !STATE_HEADER_RE.test(lines[i].trimEnd())) {
      if (vtype === "temporal" && vname === null) {
        const pm = lines[i].trimEnd().match(/^Error:\s+(\S+)\s+is violated/);
        if (pm) vname = pm[1];
      }
      i++;
    }

    const traceStates: RawTraceState[] = [];
    let backToIndex: number | null = null;

    while (i < lines.length) {
      const tline = lines[i].trimEnd();
      const sm = STATE_HEADER_RE.exec(tline);
      const bm = BACK_TO_STATE_RE.exec(tline);

      if (bm) {
        backToIndex = parseInt(bm[1], 10) - 1;
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

        const varLines: string[] = [];
        i++;
        while (i < lines.length) {
          const vl = lines[i].trimEnd();
          if (
            STATE_HEADER_RE.test(vl) ||
            BACK_TO_STATE_RE.test(vl) ||
            vl.startsWith("Error:")
          ) {
            break;
          }
          varLines.push(vl);
          i++;
        }
        // Trim trailing blank lines so they don't pollute the label
        while (varLines.length > 0 && varLines[varLines.length - 1] === "") {
          varLines.pop();
        }

        const label = varLines.join("\n");
        const tvars = parseStateLabel(label);
        traceStates.push({ action: actionName, vars: tvars, label });
      } else {
        if (tline === "") {
          i++;
          continue;
        }
        break;
      }
    }

    traces.push({ type: vtype, name: vname, traceStates, backToIndex });
  }

  return traces;
}

function extractRawTracesFromMessages(messages: TlcMessage[]): RawTrace[] {
  const traces: RawTrace[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (!VIOLATION_CODES.has(msg.code)) {
      i++;
      continue;
    }

    let vtype: "invariant" | "deadlock" | "temporal";
    let vname: string | null = null;

    if (msg.code === 2110 || msg.code === 2107) {
      vtype = "invariant";
      const invM = msg.body.match(/Invariant (\S+) is violated/);
      if (invM) vname = invM[1];
    } else if (msg.code === 2159) {
      vtype = "invariant";
      // Assertion failure — no named invariant, but treat as invariant violation
    } else if (msg.code === 2113) {
      vtype = "invariant";
      // Evaluation/type-check error — treat as invariant violation for trace extraction
    } else if (msg.code === 2114) {
      vtype = "deadlock";
    } else {
      vtype = "temporal";
    }

    i++;

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

    while (i < messages.length && !STATE_CODES.has(messages[i].code) && !SKIP_CODES.has(messages[i].code) && !VIOLATION_CODES.has(messages[i].code)) {
      i++;
    }

    const traceStates: RawTraceState[] = [];
    let backToIndex: number | null = null;

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
        const btM = sm.body.match(/Back to state\s*(?:<[^>]*>)?\s*(\d+)/);
        if (!btM) {
          const btM2 = sm.body.match(/(\d+)/);
          if (btM2) backToIndex = parseInt(btM2[1], 10) - 1;
        } else {
          backToIndex = parseInt(btM[1], 10) - 1;
        }
        i++;
        break;
      }

      if (sm.code === 2218) {
        i++;
        break;
      }

      const bodyLines = sm.body.split("\n");
      let actionName: string | null = null;

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
      traceStates.push({ action: actionName, vars: tvars, label });

      i++;
    }

    traces.push({ type: vtype, name: vname, traceStates, backToIndex });
  }

  return traces;
}

function extractRawTraces(output: string): RawTrace[] {
  const messages = parseTlcMessages(output);
  if (messages !== null) {
    return extractRawTracesFromMessages(messages);
  }
  return extractRawTracesLegacy(output);
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
        case 2159: { // TLC assertion failure
          success = false;
          const assertBody = msg.body.trim();
          violations.push({
            type: "invariant",
            summary: assertBody || "TLC assertion failure",
          });
          break;
        }
        case 2113: { // TLC evaluation error / type check failure
          success = false;
          const evalBody = msg.body.trim();
          errors.push({ message: evalBody || "TLC evaluation error" });
          break;
        }
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

// -- Tool-mode message code sets ---------------------------------------------

const VIOLATION_CODES = new Set([2110, 2107, 2114, 2116, 2159, 2113]);
const STATE_CODES = new Set([2216, 2217, 2218, 2122]);
const SKIP_CODES = new Set([2121, 2120]); // informational headers

// -- Violation trace builder (from raw traces + graph state lookup) -----------

function rawTracesToViolations(
  rawTraces: RawTrace[],
  stateLookup: Map<string, string>,
): ViolationTrace[] {
  const violations: ViolationTrace[] = [];
  let vid = 0;

  for (const raw of rawTraces) {
    const traceEntries: ViolationTraceEntry[] = [];
    for (const ts of raw.traceStates) {
      const sid = lookupState(ts.vars, stateLookup);
      traceEntries.push({ stateId: sid, action: ts.action });
    }

    if (raw.backToIndex !== null) {
      let backSid: string | null = null;
      if (raw.backToIndex >= 0 && raw.backToIndex < traceEntries.length) {
        backSid = traceEntries[raw.backToIndex].stateId;
      }
      traceEntries.push({ stateId: backSid, action: "Back to state" });
    }

    const summary = violationSummary(raw.type, raw.name, raw.traceStates);

    vid++;
    const violation: ViolationTrace = {
      id: `v${vid}`,
      type: raw.type,
      summary,
      trace: traceEntries,
    };
    if (raw.type === "invariant" && raw.name) {
      violation.invariant = raw.name;
    }
    if (raw.type === "temporal" && raw.name) {
      violation.property = raw.name;
    }

    violations.push(violation);
  }

  return violations;
}

/**
 * Extract violation traces from TLC stdout and match them to graph states.
 */
export function parseTlcViolationTraces(
  output: string,
  graphStates: Record<string, { vars: VarMap }>
): ViolationTrace[] {
  const rawTraces = extractRawTraces(output);
  const stateLookup = buildStateLookup(graphStates);
  return rawTracesToViolations(rawTraces, stateLookup);
}

// -- Traces-only graph builder -----------------------------------------------

export interface TraceOnlyGraph {
  states: Record<string, { label: string; vars: VarMap }>;
  edges: Array<{ source: string; target: string; action: string }>;
  initialStateId: string;
  violations: ViolationTrace[];
}

/**
 * Build a minimal graph from TLC output traces alone, without a DOT file.
 * Assigns synthetic state IDs (t1, t2, ...) and deduplicates by variable equality.
 */
export function buildGraphFromTraces(output: string): TraceOnlyGraph {
  const rawTraces = extractRawTraces(output);

  // Build a state registry with deduplication by variable map
  const varKeyToId = new Map<string, string>();
  const states: Record<string, { label: string; vars: VarMap }> = {};
  let nextId = 1;

  function getOrCreateStateId(ts: RawTraceState): string {
    const key = JSON.stringify(normalizeForCompare(ts.vars));
    let id = varKeyToId.get(key);
    if (!id) {
      id = `t${nextId++}`;
      varKeyToId.set(key, id);
      states[id] = { label: ts.label, vars: ts.vars };
    }
    return id;
  }

  // Build edges and synthetic lookup for violations
  const edgeSet = new Set<string>();
  const edges: Array<{ source: string; target: string; action: string }> = [];
  let initialStateId = "";

  const violations: ViolationTrace[] = [];
  let vid = 0;

  for (const raw of rawTraces) {
    const traceEntries: ViolationTraceEntry[] = [];
    const traceIds: string[] = [];

    for (let si = 0; si < raw.traceStates.length; si++) {
      const ts = raw.traceStates[si];
      const sid = getOrCreateStateId(ts);
      traceIds.push(sid);
      traceEntries.push({ stateId: sid, action: ts.action });

      if (initialStateId === "" && si === 0) {
        initialStateId = sid;
      }

      // Add edge from previous state
      if (si > 0) {
        const src = traceIds[si - 1];
        const action = ts.action ?? "Next";
        const edgeKey = `${src}->${sid}:${action}`;
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          edges.push({ source: src, target: sid, action });
        }
      }
    }

    // Handle back-to-state (lasso)
    if (raw.backToIndex !== null) {
      let backSid: string | null = null;
      if (raw.backToIndex >= 0 && raw.backToIndex < traceIds.length) {
        backSid = traceIds[raw.backToIndex];
        // Add loop edge
        const lastId = traceIds[traceIds.length - 1];
        const edgeKey = `${lastId}->${backSid}:Back`;
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          edges.push({ source: lastId, target: backSid, action: "Back" });
        }
      }
      traceEntries.push({ stateId: backSid, action: "Back to state" });
    }

    const summary = violationSummary(raw.type, raw.name, raw.traceStates);

    vid++;
    const violation: ViolationTrace = {
      id: `v${vid}`,
      type: raw.type,
      summary,
      trace: traceEntries,
    };
    if (raw.type === "invariant" && raw.name) {
      violation.invariant = raw.name;
    }
    if (raw.type === "temporal" && raw.name) {
      violation.property = raw.name;
    }
    violations.push(violation);
  }

  return { states, edges, initialStateId: initialStateId || "t1", violations };
}
