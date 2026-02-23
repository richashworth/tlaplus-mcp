import { describe, it, expect } from "vitest";
import { parseTlcOutput, parseTlcViolationTraces } from "./tlc-output.js";

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
