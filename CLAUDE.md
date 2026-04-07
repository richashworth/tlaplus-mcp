# CLAUDE.md

MCP server exposing TLA+ formal verification tools (TLC, SANY, PlusCal, TLATeX) as structured JSON over the Model Context Protocol.

## Release

```bash
npm version patch   # or minor / major — bumps version, commits, tags
git push --tags     # triggers publish workflow → publishes to @richashworth/tlaplus-mcp on npm
```

## Build & Test

```bash
npm run build          # TypeScript compilation
npm run dev            # Watch mode
npm test               # All tests (vitest)
npm start              # Run compiled server (stdio transport)
```

Run specific test suites:
```bash
npx vitest run src/integration.test.ts
npx vitest run src/parsers/
npx vitest run src/tools/
npx vitest run src/lib/
```

## Project Structure

- `src/index.ts` — Entry point (stdio transport, graceful shutdown)
- `src/server.ts` — Server factory, registers all 9 tools + resources
- `src/lib/` — Core infra: Java detection, subprocess spawning, config, schemas, shared helpers
- `src/parsers/` — Output parsers for TLC stdout, TLA+ values, DOT graphs, CFG files
- `src/tools/` — 9 MCP tool handlers (tlc_check, tlc_simulate, tla_parse, tla_evaluate, pcal_translate, tlc_coverage, tla_state_graph, tlc_generate_trace_spec, tla_tex)
- `src/resources/` — MCP resources (spec listing, file reading, latest output)
- `src/test-utils.ts` — Shared test utilities (captureToolHandler, mockRunJavaResult)

## Conventions

- **TypeScript strict mode**, ES modules, target ES2022, Node 18+
- **Files:** kebab-case. **Types/Interfaces:** PascalCase. **Functions/vars:** camelCase. **Tool names:** snake_case.
- Tests live alongside source files (`*.test.ts`) and are excluded from the build
- All tool handlers use `formatToolResponse()` / `formatToolError()` from `src/lib/tool-helpers.ts`
- Tool registration follows: `export function registerToolName(server: McpServer): void`
- Zod schemas for parameter validation; `absolutePath` schema enforces absolute paths
- No ESLint/Prettier configured — follow existing style

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `TLC_JAR_PATH` | Path to tla2tools.jar | Auto-downloads to `~/.tlaplus-mcp/lib/` |
| `TLC_JAVA_OPTS` | JVM options | `-Xmx4g -XX:+UseParallelGC` |
| `TLC_TIMEOUT` | Max seconds per TLC run | `300` |
| `TLC_WORKSPACE` | Base directory for specs | cwd |

## Key Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `zod` — Schema validation
- `vitest` — Test framework
- **Java 11+** required at runtime for TLA+ tools
