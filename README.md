# tlaplus-mcp

MCP server that exposes the TLA+ toolchain (TLC, SANY, PlusCal, TLATeX) as structured JSON tools over the [Model Context Protocol](https://modelcontextprotocol.io).

```
Any MCP client               tlaplus-mcp                    TLA+ toolchain
┌────────────┐           ┌──────────────────┐           ┌──────────────────┐
│ Claude Code│           │  tla_parse       │           │  TLC (checker)   │
│ Cursor     │───MCP────▶│  tlc_check       │───Java───▶│  SANY (parser)   │
│ custom app │  (stdio)  │  tlc_simulate    │           │  PlusCal         │
└────────────┘           │  tla_evaluate    │           │  TLATeX          │
                         │  pcal_translate  │           └──────────────────┘
                         │  tlc_coverage    │
                         │  tla_state_graph │
                         │  tlc_trace_spec  │
                         │  tla_tex         │
                         │                  │
                         │  tla://specs     │
                         │  tla://spec/{f}  │
                         │  tla://output    │
                         └──────────────────┘
```

## Installation

```bash
npx -y @richashworth/tlaplus-mcp
```

### Configure in Claude Code

Add to your MCP server config (`.claude/settings.json` or per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "tlaplus": {
      "command": "npx",
      "args": ["-y", "@richashworth/tlaplus-mcp"]
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
npm run dev          # Watch mode (recompile on change)
npm test             # Run all tests (unit + integration)
npm run build        # Production build
npm run lint         # Run ESLint
npm run format:check # Check Prettier formatting
```

A pre-commit hook (husky + lint-staged) runs ESLint and Prettier on staged files automatically. CI also gates on both.

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

