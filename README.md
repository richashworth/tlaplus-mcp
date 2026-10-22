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
git clone https://github.com/richashworth/tlaplus-mcp.git
cd tlaplus-mcp && npm ci && npm run build
```

Download [`tla2tools.jar` v1.7.4](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4) yourself and point `TLC_JAR_PATH` at it. The server never downloads anything; it checks the jar's SHA-256 against the pinned v1.7.4 value before every run.

### Configure in Claude Code

Add to your MCP server config (`.claude/settings.json` or per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "tlaplus": {
      "command": "node",
      "args": ["/absolute/path/to/tlaplus-mcp/dist/index.js"],
      "env": {
        "TLC_JAR_PATH": "/absolute/path/to/tla2tools.jar",
        "TLAPLUS_MCP_ROOTS": "/absolute/path/to/specs"
      }
    }
  }
}
```

MCP servers run outside Claude Code's sandbox, so the tools only touch files under `TLAPLUS_MCP_ROOTS`. See [SECURITY.md](SECURITY.md).

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
| `TLC_JAR_PATH` | Path to `tla2tools.jar` (required) | None: the server refuses to run tools without it |
| `TLC_JAR_SHA256` | Expected SHA-256 of the jar, to trust a build other than v1.7.4 | The pinned v1.7.4 checksum |
| `TLAPLUS_MCP_ROOTS` | Colon-separated absolute directories the tools may read and write. Paths are resolved through symlinks; anything outside is refused | `TLC_WORKSPACE`, else the current working directory |
| `TLC_JAVA_OPTS` | JVM options | `-Xmx4g -XX:+UseParallelGC` |
| `TLC_TIMEOUT` | Max seconds per TLC run | `300` |
| `TLC_WORKSPACE` | Base directory for specs and the `tla://` resources | The first entry of `TLAPLUS_MCP_ROOTS`, else the current working directory |

`extra_args` on the TLC tools accepts only these flags: `-workers N|auto`, `-depth N`, `-seed N`, `-aril N`, `-dfid N`, `-fp N`, `-fpbits N`, `-fpmem N`, `-maxSetSize N`, `-coverage N`, `-checkpoint N`, `-simulate num=N`, `-deadlock`, `-continue`, `-difftrace`, `-nowarning`. Anything else is rejected.

The Java tools also open and create files in the spec's directory by names the server never sees (imported modules, `SpecTE.*`, TLATeX output), so they refuse to run when that directory contains a symlink leading outside the roots, a dangling symlink, a hard-linked file or a `.class` file (TLC loads those as operator overrides).

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

**Integration tests** (`src/integration.test.ts`) — use the MCP SDK's `Client` + `InMemoryTransport` to exercise the full protocol round-trip (client → transport → server → tool handler → response) without needing Java installed. These verify tool registration, schema validation, response shapes, and path confinement.

`.npmrc` sets `ignore-scripts=true`, so `npm install` doesn't run the `prepare` script that installs the husky pre-commit hook. Run `npm run prepare` once after cloning to enable it.

```bash
npm test                                    # Run everything
npx vitest run src/integration.test.ts      # Integration tests only
npx vitest run src/parsers/                 # Parser unit tests only
npx vitest run src/tools/                   # Tool handler unit tests only
```

