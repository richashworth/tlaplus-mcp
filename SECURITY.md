# Security

## Threat model

An MCP client such as Claude Code may sandbox the agent's own shell commands, but MCP servers run outside that sandbox with the user's full permissions. Any tool argument that names a file, and any way of making Java run code, is therefore a way around the client's read and write limits. The server treats every tool argument as untrusted input from the model.

In scope: an agent (or a prompt injection steering it) using tool arguments or files it can write to read, write or execute outside the directories the user intended.

Out of scope: a local attacker who can already edit the server's environment variables, the jar, or the Java installation.

## Controls

### Path confinement

- `TLAPLUS_MCP_ROOTS` (colon-separated absolute paths) lists the directories tools may touch. It defaults to `TLC_WORKSPACE`, else the server's working directory; when it is set and `TLC_WORKSPACE` isn't, the workspace defaults to its first entry. Roots that don't exist are ignored; with none left, every path is refused.
- Every path a tool reads (`tla_file`, `cfg_file` and the resulting `-config`, `dot_file`, `tlc_output_file`, the `tla://` resources and the workspace) is resolved with `realpath`, following symlinks, and must lie inside a root. Regular files with more than one hard link are refused, since realpath can't tell whether a hard link aliases a file outside the roots.
- Every path a tool writes (`output_file`, `dump_path` and the `.dot` TLC appends, the `tla_state_graph` JSON, the in-place `pcal_translate` target) is resolved the same way, hard-link check included; for a file that doesn't exist yet, its deepest existing ancestor is resolved and checked. Dangling symlinks are refused, since a write would follow them.
- A missing path outside the roots is reported as outside the roots, not as missing, so tools can't be used to probe for files.
- SANY, TLC, PlusCal and TLATeX also open files in the spec's directory that the server never sees by name: `EXTENDS`/`INSTANCE` modules on the read side, and trace files, `SpecTE.*`, `.cfg`, `.tex`/`.dvi`/`.pdf` on the write side. Before running any of them, the server scans that directory (not recursively; none of these tools look in subdirectories) and refuses if any entry is a symlink resolving outside the roots, a dangling symlink, a hard-linked regular file or a `.class` file. Symlinks that stay inside the roots are fine.
- `tlc_generate_trace_spec` only reports the two file names TLC uses (`<Spec>_SpecTE.tla` and `SpecTE.tla`, with their `.cfg`) in the spec's directory, and never takes a path from TLC's output.
- Temporary files stay under `os.tmpdir()`: each TLC run gets a private `-metadir`, `tla_evaluate` a private directory, and each Java process a private `java.io.tmpdir` (where SANY extracts the standard modules and resolves them from).

### Code execution through TLC

- TLC loads a Java class named after any module it finds next to the spec and calls its methods as operator overrides. An agent that can write a `.class` file into a root could therefore run arbitrary code in the unsandboxed JVM. The spec-directory scan refuses any `.class` file.
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

- Checks and I/O are not atomic. A link (or `.class` file) planted in the spec directory or another write target after the check but while Java runs would be followed. The agent's sandboxed shell usually can write to the roots, so keep roots narrow. Future hardening: copy the spec directory's `.tla`/`.cfg` files into a private `mkdtemp` directory, run Java there, and copy each output back through the write check, so Java never touches the real directory during a run.
- `TLC_JAVA_OPTS` is trusted. Pointing `-DTLA-Library` at a directory the agent can write re-opens the `.class` override path, since TLC loads overrides from library paths too.
- `tla_tex` runs LaTeX on text derived from the spec. TeX Live's default restricted `\write18` limits shell escape to a whitelist, but the server doesn't enforce that.
- Within the roots, tools read and overwrite files freely; that is their purpose.

## Reporting

Report vulnerabilities privately through GitHub security advisories on this repository rather than public issues.
