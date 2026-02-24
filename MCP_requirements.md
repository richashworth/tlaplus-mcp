# TLC MCP Server — Requirements

## Overview

An MCP (Model Context Protocol) server that exposes the TLA+ toolchain (`tla2tools.jar`) as a set of tools, enabling AI agents to author, check, simulate, and iterate on TLA+ and PlusCal specifications without manual command-line interaction.

## Motivation

The `tlaplus-workflow` plugin currently orchestrates TLC via bash scripts (`resolve-tlc.sh`, `check-tla-syntax.sh`, `setup-tlc.sh`) and a Python parser (`dot-to-json.py`). Agents call these through `Bash` tool invocations, parsing stdout text. This is fragile:

- Agents must parse unstructured TLC output themselves
- The verifier agent shells out with `timeout 120 run_tlc ...` and tees to a file
- `dot-to-json.py` is invoked via `python3` and communicates through exit codes (0=ok, 1=parse failed, 2=too large)
- Error handling is scattered across bash scripts, Python, and agent prompts

An MCP server replaces all of this with structured JSON tools. The plugin's agents get reliable typed responses; the scripts and Python parser move into the server.

## Migration from current plugin scripts

| Current plugin mechanism | Replaced by |
|---|---|
| `scripts/resolve-tlc.sh` (finds `tla2tools.jar`, provides `run_tlc`/`run_sany`) | MCP server owns jar resolution via `TLC_JAR_PATH` config |
| `scripts/setup-tlc.sh` (downloads `tla2tools.jar` to `lib/`) | MCP server auto-downloads on first use |
| `scripts/check-tla-syntax.sh` (post-write hook → SANY) | `tla_parse` tool (hook calls MCP instead of bash) |
| `scripts/dot-to-json.py` (DOT + CFG + TLC output → JSON) | `tla_state_graph` tool (embeds the parser logic) |
| Verifier agent bash: `timeout 120 run_tlc -modelcheck -workers auto -dump dot,actionlabels,colorize ...` | `tlc_check` tool with `generate_states: true` |
| Verifier agent bash: `run_sany` | `tla_parse` tool |

After migration, the plugin's `scripts/` directory can be removed entirely. The agents invoke MCP tools instead of bash.

## Scope

The server wraps the tools bundled in `tla2tools.jar`:

| Tool | Entry point | Purpose |
|------|------------|---------|
| TLC | `tlc2.TLC` | Model checker (exhaustive + simulation) |
| SANY | `tla2sany.SANY` | TLA+ parser / syntax checker |
| PlusCal translator | `pcal.trans` | PlusCal to TLA+ translation |
| TLATeX | `tla2tex.TLA` | Pretty-print specs as LaTeX/PDF |

It also absorbs the state graph parsing logic currently in `dot-to-json.py` (TLA+ value parser, DOT parser, CFG parser, TLC output/violation parser, action label disambiguator).

It does **not** reimplement the Java tools — it orchestrates them and parses their output into structured responses.

## Prerequisites

- Java runtime (JRE 11+) available on `PATH`
- `tla2tools.jar` available at a configurable path (or auto-downloaded on first use from `https://nightly.tlapl.us/dist/tla2tools.jar`)
- LaTeX installation (for `tla_tex` only — optional)

---

## Tools

### 1. `tlc_check` — Run TLC model checker

Run TLC in exhaustive breadth-first (or depth-first iterative deepening) mode against a TLA+ specification and return structured results.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tla_file` | string | yes | Absolute path to the `.tla` file |
| `cfg_file` | string | no | Absolute path to the `.cfg` file. Defaults to `<tla_file basename>.cfg` in the same directory |
| `workers` | integer | no | Number of TLC worker threads. Defaults to `auto` (number of cores) |
| `deadlock` | boolean | no | Check for deadlocks. Defaults to `true` |
| `continue` | boolean | no | Continue checking after first violation (find all violations). Defaults to `false` |
| `dfid` | integer | no | If set, use depth-first iterative deepening starting at this depth |
| `diff_trace` | boolean | no | Show only state deltas in traces. Defaults to `false` |
| `max_set_size` | integer | no | Largest set TLC will enumerate. Defaults to TLC default (10^6) |
| `generate_states` | boolean | no | Generate state graph (DOT format). Defaults to `false` |
| `extra_args` | string[] | no | Additional CLI flags passed directly to TLC |

**Returns:**

```json
{
  "status": "success" | "violation" | "error",
  "states_found": 42,
  "distinct_states": 30,
  "duration_seconds": 1.2,
  "violations": [
    {
      "type": "invariant" | "property" | "deadlock",
      "name": "NoDoubleBooking",
      "trace": [
        {
          "state_number": 1,
          "action": "Init",
          "variables": {
            "clientState": "(c1 :> \"browsing\" @@ c2 :> \"browsing\")",
            "slotState": "(s1 :> \"free\" @@ s2 :> \"free\")"
          }
        }
      ]
    }
  ],
  "errors": [
    {
      "message": "TLC attempted to evaluate an unbounded CHOOSE.",
      "location": { "file": "SalonBooking.tla", "line": 16, "col": 9 }
    }
  ],
  "warnings": ["Declaring symmetry during liveness checking is dangerous..."],
  "raw_output": "full TLC stdout+stderr as a single string"
}
```

### 2. `tlc_simulate` — Run TLC in simulation mode

Run TLC in random simulation mode, generating traces up to a configurable depth and count. Useful for large state spaces where exhaustive checking is infeasible.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tla_file` | string | yes | Absolute path to the `.tla` file |
| `cfg_file` | string | no | Path to `.cfg` file. Defaults to `<basename>.cfg` |
| `depth` | integer | no | Maximum depth of each simulation trace. Defaults to 100 |
| `num_traces` | integer | no | Maximum number of traces to generate. Defaults to unlimited |
| `seed` | integer | no | Random seed for reproducibility |
| `aril` | integer | no | Seed adjustment for random simulation |
| `workers` | integer | no | Number of simulation worker threads. Defaults to `auto` |
| `deadlock` | boolean | no | Check for deadlocks. Defaults to `true` |
| `diff_trace` | boolean | no | Show only state deltas in traces. Defaults to `false` |
| `extra_args` | string[] | no | Additional CLI flags |

**Returns:** Same structure as `tlc_check`.

### 3. `tla_parse` — Parse a TLA+ module with SANY

Syntax-check and semantically parse a TLA+ module. Returns parse errors or confirmation that the spec is valid. Faster than running TLC — use this for quick validation after edits.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tla_file` | string | yes | Absolute path to the `.tla` file |

**Returns:**

```json
{
  "valid": true | false,
  "errors": [
    {
      "message": "Unknown operator: Foo",
      "location": { "file": "SalonBooking.tla", "line": 10, "col": 5 }
    }
  ],
  "modules_parsed": ["Naturals", "Integers", "Sequences", "FiniteSets", "TLC", "SalonBooking"]
}
```

### 4. `tla_evaluate` — Evaluate a constant expression

Evaluate a TLA+ constant-level expression using TLC. Useful for quick sanity checks (e.g., testing set comprehensions, function definitions) without writing a full spec.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `expression` | string | yes | TLA+ expression to evaluate |
| `imports` | string[] | no | Standard modules to import (e.g., `["Integers", "FiniteSets"]`) |

**Returns:**

```json
{
  "result": "{1, 2, 3}",
  "error": null
}
```

### 5. `pcal_translate` — Translate PlusCal to TLA+

Run the PlusCal translator on a `.tla` file containing a PlusCal algorithm. The translator writes the TLA+ translation back into the same file (between the `\* BEGIN TRANSLATION` and `\* END TRANSLATION` markers).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tla_file` | string | yes | Absolute path to the `.tla` file containing PlusCal |
| `fairness` | string | no | Fairness conjunct: `"wf"` (weak), `"sf"` (strong), `"wfNext"` (weak on entire next-state), `"nof"` (none). Defaults to `"nof"` |
| `termination` | boolean | no | Add `PROPERTY Termination` to the `.cfg` and default to `-wf`. Defaults to `false` |
| `no_cfg` | boolean | no | Suppress writing the `.cfg` file. Defaults to `false` |
| `label` | boolean | no | Auto-add missing labels. Defaults to `true` for uniprocess algorithms without labels |
| `line_width` | integer | no | Target line width for translation output. Defaults to 78 |

**Returns:**

```json
{
  "success": true | false,
  "errors": [
    {
      "message": "Missing label before assignment",
      "location": { "file": "MyAlg.tla", "line": 22, "col": 5 }
    }
  ],
  "labels_added": ["Lbl_1", "Lbl_2"],
  "output_file": "/path/to/MyAlg.tla",
  "raw_output": "full translator stdout+stderr"
}
```

### 6. `tlc_generate_trace_spec` — Generate trace exploration spec

After a model checking violation, generate a SpecTE `.tla`/`.cfg` pair that encapsulates the error trace as a standalone specification. Useful for debugging and sharing counterexamples.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tla_file` | string | yes | Absolute path to the `.tla` file that produced the violation |
| `cfg_file` | string | no | Path to `.cfg` file. Defaults to `<basename>.cfg` |
| `monolith` | boolean | no | Embed all non-standard-module dependencies in the generated spec. Defaults to `true` |
| `extra_args` | string[] | no | Additional CLI flags |

**Returns:**

```json
{
  "success": true | false,
  "spec_te_tla": "/path/to/SpecTE.tla",
  "spec_te_cfg": "/path/to/SpecTE.cfg",
  "error": null,
  "raw_output": "full TLC stdout+stderr"
}
```

### 7. `tlc_coverage` — Run TLC with action coverage reporting

Run TLC and collect action coverage statistics, showing how many times each action was taken during state exploration. Useful for identifying under-explored parts of a spec.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tla_file` | string | yes | Absolute path to the `.tla` file |
| `cfg_file` | string | no | Path to `.cfg` file. Defaults to `<basename>.cfg` |
| `interval_minutes` | integer | no | Coverage collection interval. Defaults to 1 |
| `workers` | integer | no | Number of TLC worker threads. Defaults to `auto` |
| `extra_args` | string[] | no | Additional CLI flags |

**Returns:**

```json
{
  "status": "success" | "violation" | "error",
  "states_found": 42,
  "distinct_states": 30,
  "coverage": [
    {
      "module": "SalonBooking",
      "action": "SelectSlot",
      "location": { "line": 49, "col": 5 },
      "count": 120,
      "distinct": 18
    },
    {
      "module": "SalonBooking",
      "action": "ConfirmAppointment",
      "location": { "line": 61, "col": 5 },
      "count": 45,
      "distinct": 12
    }
  ],
  "raw_output": "full TLC stdout+stderr"
}
```

### 8. `tla_tex` — Pretty-print a spec as LaTeX/PDF

Run TLATeX to produce a typeset version of a TLA+ specification.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tla_file` | string | yes | Absolute path to the `.tla` file |
| `shade` | boolean | no | Shade comments in output. Defaults to `false` |
| `number` | boolean | no | Add line numbers. Defaults to `false` |
| `no_pcal_shade` | boolean | no | When shading, don't shade PlusCal algorithm blocks. Defaults to `false` |
| `gray_level` | number | no | Comment shading darkness (0=black, 1=white). Defaults to 0.85 |
| `output_format` | string | no | `"pdf"` or `"dvi"`. Defaults to `"pdf"` |

**Returns:**

```json
{
  "success": true | false,
  "output_file": "/path/to/SalonBooking.pdf",
  "error": null,
  "raw_output": "full tla2tex stdout+stderr"
}
```

### 9. `tla_state_graph` — Parse state graph into structured JSON

Replaces `dot-to-json.py`. Takes a TLC-generated DOT state graph dump, an optional CFG (for invariant/property names), and an optional TLC output capture (for violation traces), and returns the fully structured JSON that the playground template consumes.

This tool absorbs the following logic currently in `dot-to-json.py`:
- **TLA+ value recursive-descent parser** — parses TLC-printed values (strings, sets, sequences, records, functions, booleans, numbers, identifiers)
- **DOT parser** — extracts nodes (with variable assignments), edges (with action labels), detects initial state (filled style or lowest ID)
- **CFG parser** — extracts `INVARIANT`/`PROPERTY` names (single-line and multi-line indented forms)
- **TLC output parser** — extracts violation traces (invariant, deadlock, temporal), matches trace states to graph nodes by normalized variable comparison
- **Action label disambiguator** — when multiple edges with the same action leave a state, appends variable diffs to distinguish them (e.g., `"SelectSlot (c1: browsing→holding)"`)

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `dot_file` | string | yes | Absolute path to the `.dot` state graph file (from TLC `-dump dot,actionlabels,colorize`) |
| `cfg_file` | string | no | Absolute path to the `.cfg` file (for invariant/property names). If omitted, invariants array will be empty |
| `tlc_output_file` | string | no | Absolute path to TLC stdout capture (for violation trace extraction). If omitted, violations array will be empty |
| `format` | string | no | `"dot"` (raw DOT text), `"structured"` (parsed JSON), or `"playground"` (full playground-ready JSON matching current `dot-to-json.py` output). Defaults to `"playground"` |

**Returns (playground format — matches current `dot-to-json.py` output):**

```json
{
  "initialStateId": "1",
  "states": {
    "1": {
      "label": "/\\ clientState = ...",
      "vars": {
        "clientState": {"c1": "browsing", "c2": "browsing"},
        "slotState": {"s1": "free", "s2": "free"},
        "slotHolder": {"s1": null, "s2": null}
      }
    }
  },
  "transitions": {
    "1": [
      {
        "action": "SelectSlot (c1: browsing→holding)",
        "label": "SelectSlot",
        "target": "2"
      }
    ]
  },
  "invariants": ["TypeOK", "NoDoubleBooking", "NoHoarding"],
  "violations": [
    {
      "id": "v1",
      "type": "invariant",
      "name": "NoDoubleBooking",
      "summary": "Invariant violated: clientState changed to ...",
      "trace": ["1", "2", "5"]
    }
  ]
}
```

**Returns (structured format — simplified adjacency list):**

```json
{
  "node_count": 30,
  "edge_count": 85,
  "initial_state": "<id>",
  "nodes": [
    {
      "id": "<hash>",
      "variables": {
        "clientState": "...",
        "slotState": "...",
        "slotHolder": "..."
      }
    }
  ],
  "edges": [
    {
      "from": "<hash>",
      "to": "<hash>",
      "action": "SelectSlot"
    }
  ]
}
```

**Error behavior:**
- If the state graph exceeds 50,000 nodes, return an error with `"too_large": true` and the node count (mirrors current `dot-to-json.py` exit code 2). The caller can suggest Spectacle as an alternative.
- If DOT parsing fails, return a structured error (mirrors exit code 1).

---

## Resources

The server should expose MCP resources for read access to spec files within the working directory.

| URI pattern | Description |
|---|---|
| `tla://specs` | List all `.tla` and `.cfg` files in the workspace |
| `tla://spec/{filename}` | Read contents of a specific spec or config file |
| `tla://output/latest` | Read the most recent TLC output log |

---

## Error Handling

- **Java not found**: Return a clear error message with install instructions rather than a raw process failure.
- **tla2tools.jar not found**: Auto-download from `https://nightly.tlapl.us/dist/tla2tools.jar`. If that fails, return error with the URL.
- **LaTeX not found** (for `tla_tex` only): Return error suggesting install via `brew install --cask mactex` or equivalent.
- **TLC timeout**: Support a configurable timeout (default: 5 minutes). Kill the TLC process on timeout and return partial results if available.
- **Large state spaces**: If TLC runs out of memory, capture the OOM error and report the last known state count.
- **PlusCal parse failures**: Return structured error with line/col so the agent can fix the algorithm.

## Configuration

Server configuration via environment variables or MCP server config:

| Key | Description | Default |
|-----|-------------|---------|
| `TLC_JAR_PATH` | Path to `tla2tools.jar` | Plugin `lib/tla2tools.jar`, then system `PATH` |
| `TLC_JAVA_OPTS` | JVM options (e.g., `-Xmx8g`) | `-Xmx4g -XX:+UseParallelGC` |
| `TLC_TIMEOUT` | Max seconds before killing a TLC/SANY run | `300` |
| `TLC_WORKSPACE` | Default directory for resolving relative paths | Current working directory |

## Transport

- stdio (primary) — for use as a local MCP server launched by Claude Code or similar
- SSE (optional) — for remote/shared use

## Implementation Notes

### TLC output parsing
- Use TLC's `-tool` flag where possible. This produces machine-parseable output with message codes, making structured extraction far more reliable than parsing human-readable output.
- The server should parse TLC's stdout/stderr to extract structured data. Key patterns to handle:
  - State traces (multi-line, indented variable assignments)
  - Error messages with `file:line:col` references
  - Statistics lines (`N states generated, M distinct states found`)
  - Coverage lines (action name, location, count)
  - Warning lines
  - Progress output during long runs

### State graph parsing (from `dot-to-json.py`)
- The `tla_state_graph` tool should port the logic from `scripts/dot-to-json.py`. Key components:
  - **TLA+ value parser**: Recursive-descent parser for TLC-printed values. Handles strings, sets `{}`, sequences `<<>>`, records `[field |-> value]`, functions `key :> value @@ ...`, booleans, numbers, identifiers.
  - **DOT parser**: Regex-based extraction of nodes (ID, label, style) and edges (source, target, action label). Initial state detected by `style=filled` attribute or lowest numeric ID.
  - **Action label disambiguator**: When multiple edges from the same source share an action name, append the variable diff that distinguishes them (e.g., `"SelectSlot (c1: browsing→holding)"`). Try each diff key to find one that produces unique labels; fallback to first unique diff per edge.
  - **CFG parser**: Extract `INVARIANT`/`PROPERTY` names from `.cfg` files (handles both single-line and multi-line indented forms).
  - **TLC output violation parser**: Parse state traces from TLC stdout. Match `State N: <ActionName>` headers, collect `/\ var = value` lines, detect "Back to state" loop markers for temporal violations. Match trace states to graph nodes by comparing normalized variables (order-insensitive for sets).
- State graph DOT files can be large. Enforce a configurable node threshold (default 50,000) and return a structured error when exceeded.

### Process management
- TLC runs should be cancellable. The server must track the child Java process and kill it if the MCP client disconnects or sends a cancellation.
- PlusCal translation modifies the `.tla` file in place. The server should document this clearly (the translator already writes a `.tla.bak`).

### Jar management
- On first use, if `tla2tools.jar` is not found at `TLC_JAR_PATH` or in the plugin's `lib/` directory, auto-download from `https://nightly.tlapl.us/dist/tla2tools.jar` to the plugin's `lib/` directory. Do not search the user's filesystem.
- Verify the download is a valid JAR (zip archive check), matching what `setup-tlc.sh` currently does.

## Out of Scope (for now)

- TLAPS (proof system) integration
- Spec generation or modification (the agent handles that via normal file editing)
- Multi-spec orchestration (running TLC against multiple configs in parallel)
- TLC distributed mode (multi-machine model checking)
- Playground HTML generation (stays in the plugin's animator agent — the MCP server provides the structured JSON it needs via `tla_state_graph`)
