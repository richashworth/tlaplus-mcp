# Security

## Threat model

An MCP client such as Claude Code may sandbox the agent's own shell commands, but MCP servers run outside that sandbox with the user's full permissions. Any tool argument that names a file, and any way of making Java run code, is therefore a way around the client's read and write limits. The server treats every tool argument as untrusted input from the model.

In scope: an agent (or a prompt injection steering it) using tool arguments or files it can write to read, write or execute outside the directories the user intended.

Out of scope: a local attacker who can already edit the server's environment variables, the jar, or the Java installation.

## Controls

### Path confinement

- `TLAPLUS_MCP_ROOTS` (colon-separated absolute paths) lists the directories tools may touch. It defaults to `TLC_WORKSPACE`, else the server's working directory. Roots that don't exist are ignored; with none left, every path is refused.
- Every path a tool reads (`tla_file`, `cfg_file` and the resulting `-config`, `dot_file`, `tlc_output_file`, the `tla://` resources and the workspace) is resolved with `realpath`, following symlinks, and must lie inside a root.
- Every path a tool writes (`output_file`, `dump_path` and the `.dot` TLC appends, the `tla_state_graph` JSON, the in-place `pcal_translate` target) is resolved the same way; for a file that doesn't exist yet, its deepest existing ancestor is resolved and checked. Dangling symlinks are refused, since a write would follow them.
- A missing path outside the roots is reported as outside the roots, not as missing, so tools can't be used to probe for files.
- Files TLC, PlusCal and TLATeX create on their own (trace files, `SpecTE.*`, `.cfg`, `.tex`/`.pdf`) land in the spec's directory, which is inside a root.
- Temporary files stay under `os.tmpdir()`: each TLC run gets a private `-metadir`, `tla_evaluate` a private directory, and each Java process a private `java.io.tmpdir` (where SANY extracts the standard modules and resolves them from).

### Code execution through TLC

- TLC loads a Java class named after any module it finds next to the spec and calls its methods as operator overrides. An agent that can write a `.class` file into a root could therefore run arbitrary code in the unsandboxed JVM. The TLC tools refuse to run when the spec's directory contains any `.class` file.
- `extra_args` is an allowlist of TLC flags with fixed value shapes (`-workers N|auto`, `-depth N`, `-seed N`, `-aril N`, `-dfid N`, `-fp N`, `-fpbits N`, `-fpmem N`, `-maxSetSize N`, `-coverage N`, `-checkpoint N`, `-simulate num=N`, `-deadlock`, `-continue`, `-difftrace`, `-nowarning`). No accepted flag takes a path, so `extra_args` cannot redirect TLC's reads or writes (`-dump`, `-metadir`, `-userFile`, `-config`, `-simulate file=`, ...).
- `tla_evaluate` only accepts module names matching `[A-Za-z_][A-Za-z0-9_]*`, and runs in a fresh directory so `EXTENDS` can't pick up planted modules.
- Java, `pdflatex`/`latex` and `java -version` are started with an argv array and no shell.

### Supply chain

- The server never downloads anything. `TLC_JAR_PATH` is required, and the jar's SHA-256 must match the pinned tla2tools v1.7.4 checksum (`936a2620...0e88`), or `TLC_JAR_SHA256` if the user sets it. Any mismatch fails closed, and the jar is re-hashed when its size or mtime changes.
- npm dependencies are pinned to exact versions, each at least 7 days old when chosen, with a committed lockfile. `.npmrc` sets `ignore-scripts=true` and `save-exact=true`. CI runs `npm audit --audit-level=high`.
- GitHub Actions are pinned to full commit SHAs, workflows default to `permissions: contents: read`, and checkout doesn't persist credentials.

### Resource limits

- `TLC_TIMEOUT` (default 300 s) kills each TLC/SANY run; `tla_evaluate` is capped at 30 s.
- The default heap is `-Xmx4g`. It bounds memory per run but doesn't stop several concurrent runs; lower it with `TLC_JAVA_OPTS` on small machines.

## Residual risks

- Path checks and the subsequent I/O are not atomic. A process that can modify a root concurrently could swap in a symlink between the check and the write. The agent's sandboxed shell usually can write to the roots, so keep roots narrow.
- Files TLC writes on its own in the spec directory are not checked individually; a pre-planted symlink with exactly the name TLC will write (for example `SpecTE.tla`) would be followed.
- `TLC_JAVA_OPTS` is trusted. Pointing `-DTLA-Library` at a directory the agent can write re-opens the `.class` override path, since TLC loads overrides from library paths too.
- `tla_tex` runs LaTeX on text derived from the spec. TeX Live's default restricted `\write18` limits shell escape to a whitelist, but the server doesn't enforce that.
- Within the roots, tools read and overwrite files freely; that is their purpose.

## Reporting

Report vulnerabilities privately through GitHub security advisories on this repository rather than public issues.
