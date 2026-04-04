# tlaplus-mcp

MCP server that exposes the TLA+ toolchain (TLC, SANY, PlusCal, TLATeX) as structured JSON tools over the [Model Context Protocol](https://modelcontextprotocol.io).

## Relationship to tlaplus-workflow

This server is the tooling backend for [tlaplus-workflow](https://github.com/richashworth/tlaplus-workflow), a Claude Code plugin that hides TLA+ formal verification behind a conversational interface.

**tlaplus-workflow** provides the agents (extractor, specifier, reviewer, verifier) and the conversational skill. Agents call typed MCP tools that return structured JSON — violations with traces, state counts, parsed state graphs, coverage data.

```
tlaplus-workflow (plugin)          tlaplus-mcp (this repo)
┌──────────────────────┐           ┌──────────────────────┐
│  extractor agent     │           │  tla_parse            │
│  specifier agent     │           │  tlc_check            │
│  reviewer agent      │──MCP────▶│  tlc_simulate          │
│  verifier agent      │  tools   │  tla_evaluate          │
│                      │           │  tla_state_graph       │
│  /tlaplus-workflow   │           │  pcal_translate        │
│  skill               │           │  tlc_coverage          │
│                      │           │  tlc_generate_trace_spec│
│                      │           │  tla_tex               │
└──────────────────────┘           └──────────────────────┘
```

## Installation

```bash
npx tlaplus-mcp
```

Or install globally:

```bash
npm install -g tlaplus-mcp
```

### Configure in Claude Code

Add to your MCP server config (`.claude/settings.json` or per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "tlaplus": {
      "command": "npx",
      "args": ["-y", "tlaplus-mcp"]
    }
  }
}
```

The server auto-downloads `tla2tools.jar` to `~/.tlaplus-mcp/lib/` on first use. Set `TLC_JAR_PATH` to override.

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
npm test          # Run all tests (unit + integration)
npm run build     # Production build
```

### Testing

The project has two layers of tests:

**Unit tests** (`src/**/*.test.ts` alongside source files) — test individual parsers and tool handlers in isolation with mocked Java/filesystem calls.

**Integration tests** (`src/integration.test.ts`) — use the MCP SDK's `Client` + `InMemoryTransport` to exercise the full protocol round-trip (client → transport → server → tool handler → response) without needing Java installed. These verify tool registration, schema validation, and response shapes.

```bash
npm test                                    # Run everything
npx vitest run src/integration.test.ts      # Integration tests only
npx vitest run src/parsers/                 # Parser unit tests only
npx vitest run src/tools/                   # Tool handler unit tests only
```

## Project structure

```
src/
  index.ts                    # Entry point — starts stdio transport
  server.ts                   # Server factory — registers tools + resources
  integration.test.ts         # MCP protocol integration tests
  lib/
    config.ts                 # Environment variable config
    java.ts                   # Java detection, jar resolution, auto-download
    process.ts                # Spawn Java subprocess with timeout + cancellation
  parsers/
    tla-values.ts             # Recursive-descent parser for TLC-printed TLA+ values
    dot.ts                    # DOT state graph parser
    cfg.ts                    # CFG invariant/property parser
    tlc-output.ts             # TLC stdout parser (stats, violations, coverage, trace graphs)
    action-disambiguator.ts   # Disambiguate duplicate action labels with variable diffs
    diff-utils.ts             # Shared diff utilities for comparing TLA+ variable maps
    happy-paths.ts            # BFS discovery of successful execution paths
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
