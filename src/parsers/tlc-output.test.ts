import { describe, it, expect } from "vitest";
import { parseTlcOutput, parseTlcViolationTraces, parseTlcMessages, extractMessageBody } from "./tlc-output.js";

describe("parseTlcOutput", () => {
  it("parses successful run with state counts", () => {
    const output = `TLC2 Version 2.18
Starting... (2024-01-15 10:00:00)
Checking temporal properties...
42 states generated, 30 distinct states found, 0 states left on queue.
Finished in 01min 02s at (2024-01-15 10:01:02)`;

    const result = parseTlcOutput(output);
    expect(result.success).toBe(true);
    expect(result.statesFound).toBe(42);
    expect(result.statesDistinct).toBe(30);
    expect(result.violations).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("detects invariant violation", () => {
    const output = `Error: Invariant NoDoubleBooking is violated.
State 1: <Init>
/\\ x = 1
State 2: <Next>
/\\ x = 2`;

    const result = parseTlcOutput(output);
    expect(result.success).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("invariant");
    expect(result.violations[0].name).toBe("NoDoubleBooking");
  });

  it("detects deadlock", () => {
    const output = `Error: Deadlock reached.
State 1: <Init>
/\\ x = 1`;

    const result = parseTlcOutput(output);
    expect(result.success).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("deadlock");
    // Deadlock should NOT also appear as a general error
    expect(result.errors).toHaveLength(0);
  });

  it("detects temporal property violation", () => {
    const output = `Error: Temporal properties were violated.
Error: Liveness is violated`;

    const result = parseTlcOutput(output);
    expect(result.success).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("temporal");
    expect(result.violations[0].name).toBe("Liveness");
  });

  it("parses coverage data", () => {
    const output = `<Init line 10, col 1 of module Spec>: 5
<Next line 20, col 1 of module Spec>: 37`;

    const result = parseTlcOutput(output);
    expect(result.coverage).toHaveLength(2);
    expect(result.coverage[0]).toEqual({
      action: "Init",
      line: 10,
      module: "Spec",
      count: 5,
    });
    expect(result.coverage[1]).toEqual({
      action: "Next",
      line: 20,
      module: "Spec",
      count: 37,
    });
  });

  it("parses errors", () => {
    const output = `Error: TLC attempted to evaluate an expression of form CHOOSE.`;
    const result = parseTlcOutput(output);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("CHOOSE");
  });

  it("handles empty output", () => {
    const result = parseTlcOutput("");
    expect(result.success).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe("parseTlcOutput (tool mode)", () => {
  it("parses invariant violation with full metadata", () => {
    const output = [
      "@!@!@STARTMSG 2185:0 @!@!@",
      "2024-01-15 10:00:00",
      "@!@!@ENDMSG 2185 @!@!@",
      "@!@!@STARTMSG 2110:1 @!@!@",
      "Invariant NoOverlap is violated.",
      "@!@!@ENDMSG 2110 @!@!@",
      "@!@!@STARTMSG 2121:1 @!@!@",
      "The behavior up to this point is:",
      "@!@!@ENDMSG 2121 @!@!@",
      "@!@!@STARTMSG 2216:4 @!@!@",
      "1: /\\ x = 0",
      "@!@!@ENDMSG 2216 @!@!@",
      "@!@!@STARTMSG 2217:4 @!@!@",
      "2: <Next line 10, col 1 of module Spec>",
      "/\\ x = 1",
      "@!@!@ENDMSG 2217 @!@!@",
      "@!@!@STARTMSG 2199:0 @!@!@",
      "100 states generated, 50 distinct states found, 0 states left on queue.",
      "@!@!@ENDMSG 2199 @!@!@",
      "@!@!@STARTMSG 2186:0 @!@!@",
      "Finished in 00min 05s at (2024-01-15 10:00:05)",
      "@!@!@ENDMSG 2186 @!@!@",
    ].join("\n");

    const result = parseTlcOutput(output);
    expect(result.success).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("invariant");
    expect(result.violations[0].name).toBe("NoOverlap");
    expect(result.statesFound).toBe(100);
    expect(result.statesDistinct).toBe(50);
    expect(result.startTime).toBe("2024-01-15 10:00:00");
    expect(result.duration).toBe("00min 05s");
    expect(result.endTime).toBe("2024-01-15 10:00:05");
  });

  it("detects deadlock", () => {
    const output = [
      "@!@!@STARTMSG 2114:1 @!@!@",
      "Deadlock reached.",
      "@!@!@ENDMSG 2114 @!@!@",
    ].join("\n");

    const result = parseTlcOutput(output);
    expect(result.success).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("deadlock");
  });

  it("detects temporal violation with property name", () => {
    const output = [
      "@!@!@STARTMSG 2116:1 @!@!@",
      "Temporal properties were violated.",
      "@!@!@ENDMSG 2116 @!@!@",
      "@!@!@STARTMSG 2404:1 @!@!@",
      "Liveness is violated.",
      "@!@!@ENDMSG 2404 @!@!@",
    ].join("\n");

    const result = parseTlcOutput(output);
    expect(result.success).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("temporal");
    expect(result.violations[0].name).toBe("Liveness");
    expect(result.violations[0].summary).toBe("Liveness violated");
  });

  it("parses successful run (no violations)", () => {
    const output = [
      "@!@!@STARTMSG 2185:0 @!@!@",
      "2024-01-15 10:00:00",
      "@!@!@ENDMSG 2185 @!@!@",
      "@!@!@STARTMSG 2199:0 @!@!@",
      "42 states generated, 30 distinct states found, 0 states left on queue.",
      "@!@!@ENDMSG 2199 @!@!@",
      "@!@!@STARTMSG 2186:0 @!@!@",
      "Finished in 01min 02s at (2024-01-15 10:01:02)",
      "@!@!@ENDMSG 2186 @!@!@",
    ].join("\n");

    const result = parseTlcOutput(output);
    expect(result.success).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.statesFound).toBe(42);
    expect(result.statesDistinct).toBe(30);
  });

  it("parses coverage data", () => {
    const output = [
      "@!@!@STARTMSG 2221:0 @!@!@",
      "<Init line 10, col 1 of module Spec>: 5",
      "@!@!@ENDMSG 2221 @!@!@",
      "@!@!@STARTMSG 2221:0 @!@!@",
      "<Next line 20, col 1 of module Spec>: 37",
      "@!@!@ENDMSG 2221 @!@!@",
    ].join("\n");

    const result = parseTlcOutput(output);
    expect(result.coverage).toHaveLength(2);
    expect(result.coverage[0]).toEqual({
      action: "Init",
      line: 10,
      module: "Spec",
      count: 5,
    });
    expect(result.coverage[1]).toEqual({
      action: "Next",
      line: 20,
      module: "Spec",
      count: 37,
    });
  });
});

describe("parseTlcViolationTraces", () => {
  it("extracts violation trace and matches to graph states", () => {
    const output = `Error: Invariant TypeOK is violated.
State 1: <Init line 5, col 1 of module Spec>
/\\ x = 1
/\\ y = 2

State 2: <Next line 10, col 1 of module Spec>
/\\ x = 3
/\\ y = 4
`;

    const graphStates = {
      "a": { vars: { x: 1, y: 2 } },
      "b": { vars: { x: 3, y: 4 } },
      "c": { vars: { x: 5, y: 6 } },
    };

    const traces = parseTlcViolationTraces(output, graphStates);
    expect(traces).toHaveLength(1);
    expect(traces[0].type).toBe("invariant");
    expect(traces[0].invariant).toBe("TypeOK");
    expect(traces[0].trace).toHaveLength(2);
    expect(traces[0].trace[0].stateId).toBe("a");
    expect(traces[0].trace[1].stateId).toBe("b");
  });

  it("handles back-to-state for lasso traces", () => {
    const output = `Error: Temporal properties were violated.
Error: Liveness is violated
State 1: <Init line 5, col 1 of module Spec>
/\\ x = 1

State 2: <Next line 10, col 1 of module Spec>
/\\ x = 2

Back to state 1
`;

    const graphStates = {
      "s1": { vars: { x: 1 } },
      "s2": { vars: { x: 2 } },
    };

    const traces = parseTlcViolationTraces(output, graphStates);
    expect(traces).toHaveLength(1);
    expect(traces[0].type).toBe("temporal");
    expect(traces[0].trace).toHaveLength(3); // 2 states + back-to
    expect(traces[0].trace[2].stateId).toBe("s1"); // back to state 1 -> matches s1
    expect(traces[0].trace[2].action).toBe("Back to state");
  });

  it("returns empty array for no violations", () => {
    const output = "Model checking completed. No error has been found.";
    const traces = parseTlcViolationTraces(output, {});
    expect(traces).toHaveLength(0);
  });
});

describe("parseTlcViolationTraces (tool mode)", () => {
  it("extracts violation trace with graph state matching", () => {
    const output = [
      "@!@!@STARTMSG 2110:1 @!@!@",
      "Invariant TypeOK is violated.",
      "@!@!@ENDMSG 2110 @!@!@",
      "@!@!@STARTMSG 2121:1 @!@!@",
      "The behavior up to this point is:",
      "@!@!@ENDMSG 2121 @!@!@",
      "@!@!@STARTMSG 2216:4 @!@!@",
      "/\\ x = 1",
      "/\\ y = 2",
      "@!@!@ENDMSG 2216 @!@!@",
      "@!@!@STARTMSG 2217:4 @!@!@",
      "2: <Next line 10, col 1 of module Spec>",
      "/\\ x = 3",
      "/\\ y = 4",
      "@!@!@ENDMSG 2217 @!@!@",
    ].join("\n");

    const graphStates = {
      "a": { vars: { x: 1, y: 2 } },
      "b": { vars: { x: 3, y: 4 } },
      "c": { vars: { x: 5, y: 6 } },
    };

    const traces = parseTlcViolationTraces(output, graphStates);
    expect(traces).toHaveLength(1);
    expect(traces[0].type).toBe("invariant");
    expect(traces[0].invariant).toBe("TypeOK");
    expect(traces[0].trace).toHaveLength(2);
    expect(traces[0].trace[0].stateId).toBe("a");
    expect(traces[0].trace[1].stateId).toBe("b");
    expect(traces[0].trace[1].action).toBe("Next");
  });

  it("handles lasso trace (back-to-state)", () => {
    const output = [
      "@!@!@STARTMSG 2116:1 @!@!@",
      "Temporal properties were violated.",
      "@!@!@ENDMSG 2116 @!@!@",
      "@!@!@STARTMSG 2404:1 @!@!@",
      "Liveness is violated.",
      "@!@!@ENDMSG 2404 @!@!@",
      "@!@!@STARTMSG 2121:1 @!@!@",
      "The behavior up to this point is:",
      "@!@!@ENDMSG 2121 @!@!@",
      "@!@!@STARTMSG 2216:4 @!@!@",
      "/\\ x = 1",
      "@!@!@ENDMSG 2216 @!@!@",
      "@!@!@STARTMSG 2217:4 @!@!@",
      "2: <Next line 10, col 1 of module Spec>",
      "/\\ x = 2",
      "@!@!@ENDMSG 2217 @!@!@",
      "@!@!@STARTMSG 2122:4 @!@!@",
      "Back to state 1",
      "@!@!@ENDMSG 2122 @!@!@",
    ].join("\n");

    const graphStates = {
      "s1": { vars: { x: 1 } },
      "s2": { vars: { x: 2 } },
    };

    const traces = parseTlcViolationTraces(output, graphStates);
    expect(traces).toHaveLength(1);
    expect(traces[0].type).toBe("temporal");
    expect(traces[0].property).toBe("Liveness");
    expect(traces[0].trace).toHaveLength(3); // 2 states + back-to
    expect(traces[0].trace[0].stateId).toBe("s1");
    expect(traces[0].trace[1].stateId).toBe("s2");
    expect(traces[0].trace[2].stateId).toBe("s1"); // back to state 1
    expect(traces[0].trace[2].action).toBe("Back to state");
  });

  it("returns empty for no violations in tool mode", () => {
    const output = [
      "@!@!@STARTMSG 2185:0 @!@!@",
      "2024-01-15 10:00:00",
      "@!@!@ENDMSG 2185 @!@!@",
      "@!@!@STARTMSG 2199:0 @!@!@",
      "10 states generated, 5 distinct states found, 0 states left on queue.",
      "@!@!@ENDMSG 2199 @!@!@",
    ].join("\n");

    const traces = parseTlcViolationTraces(output, {});
    expect(traces).toHaveLength(0);
  });
});

describe("parseTlcMessages", () => {
  it("returns null for non-tool-mode output", () => {
    expect(parseTlcMessages("TLC2 Version 2.18\nFinished")).toBeNull();
  });

  it("parses tool-mode messages into structured array", () => {
    const output = [
      "@!@!@STARTMSG 2186:0 @!@!@",
      "42",
      "@!@!@ENDMSG 2186 @!@!@",
      "@!@!@STARTMSG 2199:0 @!@!@",
      "10 states generated",
      "@!@!@ENDMSG 2199 @!@!@",
    ].join("\n");
    const msgs = parseTlcMessages(output);
    expect(msgs).toHaveLength(2);
    expect(msgs![0]).toEqual({ code: 2186, severity: 0, body: "42" });
    expect(msgs![1]).toEqual({ code: 2199, severity: 0, body: "10 states generated" });
  });

  it("captures multi-line message bodies", () => {
    const output = [
      "@!@!@STARTMSG 2186:0 @!@!@",
      "<<1, 2,",
      "  3>>",
      "@!@!@ENDMSG 2186 @!@!@",
    ].join("\n");
    const msgs = parseTlcMessages(output);
    expect(msgs![0].body).toBe("<<1, 2,\n  3>>");
  });
});

describe("extractMessageBody", () => {
  const toolOutput = [
    "@!@!@STARTMSG 2186:0 @!@!@",
    "  hello world  ",
    "@!@!@ENDMSG 2186 @!@!@",
    "@!@!@STARTMSG 2199:0 @!@!@",
    "10 states",
    "@!@!@ENDMSG 2199 @!@!@",
  ].join("\n");

  it("returns trimmed body for matching code", () => {
    expect(extractMessageBody(toolOutput, 2186)).toBe("hello world");
  });

  it("returns null for non-matching code", () => {
    expect(extractMessageBody(toolOutput, 9999)).toBeNull();
  });

  it("returns null for non-tool-mode output", () => {
    expect(extractMessageBody("plain text output", 2186)).toBeNull();
  });
});
