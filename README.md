# tlaplus-mcp

MCP server that exposes the TLA+ toolchain (TLC, SANY, PlusCal, TLATeX) as structured JSON tools over the [Model Context Protocol](https://modelcontextprotocol.io).

## Relationship to tlaplus-workflow

This server is the tooling backend for [tlaplus-workflow](https://github.com/richardashworth/tlaplus-workflow), a Claude Code plugin that hides TLA+ formal verification behind a conversational interface.

**tlaplus-workflow** provides the agents (specifier, verifier, animator, etc.) and the conversational skill. Agents call typed MCP tools that return structured JSON — violations with traces, state counts, parsed state graphs, coverage data.

```
tlaplus-workflow (plugin)          tlaplus-mcp (this repo)
┌──────────────────────┐           ┌──────────────────────┐
│  specifier agent     │           │  tla_parse            │
│  verifier agent      │──MCP────▶│  tlc_check            │
│  animator agent      │  tools   │  tlc_simulate          │
│  test-writer agent   │           │  tla_evaluate          │
│  extractor agent     │           │  tla_state_graph       │
│  implementer agent   │           │  pcal_translate        │
│                      │           │  tlc_coverage          │
│  /tlaplus-workflow   │           │  tlc_generate_trace_spec│
│  skill               │           │  tla_tex               │
└──────────────────────┘           └──────────────────────┘
```

## Installation

```bash
npm install
npm run build
```

### Configure in Claude Code

Add to your MCP server config (`.claude/settings.json` or per-project):

```json
{
  "mcpServers": {
    "tlaplus": {
      "command": "node",
      "args": ["/path/to/tlaplus-mcp/dist/index.js"],
      "env": {
        "TLC_JAR_PATH": "/path/to/tla2tools.jar"
      }
    }
  }
}
```

The server auto-downloads `tla2tools.jar` on first use if `TLC_JAR_PATH` is not set.

## Prerequisites

- **Node.js 18+**
- **Java 11+** on `PATH` (runs TLC and SANY)
- **LaTeX** (optional, for `tla_tex` only)

## Tools

| Tool | Description |
|---|---|
| `tla_parse` | Syntax-check a TLA+ module with SANY |
| `tlc_check` | Run TLC model checker (exhaustive) |
| `tlc_simulate` | Run TLC in random simulation mode |
| `tla_evaluate` | Evaluate a constant TLA+ expression |
| `pcal_translate` | Translate PlusCal to TLA+ |
| `tlc_generate_trace_spec` | Generate a trace exploration spec from a counterexample |
| `tlc_coverage` | Run TLC with action coverage reporting |
| `tla_tex` | Typeset a spec as PDF via TLATeX |
| `tla_state_graph` | Parse a TLC DOT state graph into structured JSON |

All tools return structured JSON with a `raw_output` field for fallback. Errors are returned as `isError` responses so the LLM can adapt.

## Resources

| URI | Description |
|---|---|
| `tla://specs` | List `.tla` and `.cfg` files in the workspace |
| `tla://spec/{filename}` | Read a specific spec file |
| `tla://output/latest` | Read the most recent TLC output log |

## Configuration

| Environment variable | Description | Default |
|---|---|---|
| `TLC_JAR_PATH` | Path to `tla2tools.jar` | Auto-download to `~/.tlaplus-mcp/lib/` |
| `TLC_JAVA_OPTS` | JVM options | `-Xmx4g -XX:+UseParallelGC` |
| `TLC_TIMEOUT` | Max seconds per TLC run | `300` |
| `TLC_WORKSPACE` | Base directory for specs | Current working directory |

## Development

```bash
npm run dev       # Watch mode (recompile on change)
npm test          # Run unit tests
npm run build     # Production build
```

## Project structure

```
src/
  index.ts                    # Entry point — registers tools, resources, starts stdio
  lib/
    config.ts                 # Environment variable config
    java.ts                   # Java detection, jar resolution, auto-download
    process.ts                # Spawn Java subprocess with timeout + cancellation
  parsers/
    tla-values.ts             # Recursive-descent parser for TLC-printed TLA+ values
    dot.ts                    # DOT state graph parser
    cfg.ts                    # CFG invariant/property parser
    tlc-output.ts             # TLC stdout parser (stats, violations, coverage)
    action-disambiguator.ts   # Disambiguate duplicate action labels with variable diffs
  tools/
    tlc-check.ts              # tlc_check tool
    tlc-simulate.ts           # tlc_simulate tool
    tla-parse.ts              # tla_parse tool
    tla-evaluate.ts           # tla_evaluate tool
    pcal-translate.ts         # pcal_translate tool
    tlc-generate-trace-spec.ts
    tlc-coverage.ts           # tlc_coverage tool
    tla-tex.ts                # tla_tex tool
    tla-state-graph.ts        # tla_state_graph tool
  resources/
    specs.ts                  # MCP resources for browsing specs and output
```
