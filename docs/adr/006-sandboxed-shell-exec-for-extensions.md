# ADR-006: Sandboxed Shell Execution for Extension IPC Bridge

**Date**: 2026-05-07
**Status**: Accepted (rule 2, the cwd pin, superseded by [ADR-102](102-shell-exec-runs-in-declared-roots.md))
**Branch**: `002-git-github-integration`

## Decision

The `shell:exec` IPC channel (and its `ExtensionAPI` surface `api.shell.exec`) runs shell commands in the main process using `child_process.execFile` with `shell: false`. The security model has five rules:

1. **Command allowlist**: Only `git` and `gh` are permitted (Zod enum enforced server-side).
2. **CWD pinning**: The `cwd` argument must be within the current workspace's `folderPath` (validated via `path.relative()`).
3. **No shell expansion**: `shell: false` passes arguments directly to the OS without a shell interpreter. This prevents shell injection via argument values.
4. **Env sanitization**: The child process environment is limited to a safe allowlist (`PATH`, `HOME`, `TERM`, `GH_TOKEN`).
5. **Timeout**: Default 10s, configurable per call. The process is forcefully killed on timeout.

The OS does not sandbox network access. Command scope bounds it: only `gh` makes network calls. `git` remote operations need explicit remote args that the extension supplies.

## Motivation

Extensions need to invoke `git` and `gh` to deliver the git integration feature (FR-024). The IPC bridge must balance power with safety:

- **Why `execFile` over `exec`**: `exec` accepts a full shell string and is vulnerable to injection via unsanitized arguments. `execFile` takes `command` and `args` separately and passes them directly to the OS, with no shell interpretation.
- **Why an allowlist over arbitrary commands**: Extensions are trusted code (shipped by the application vendor, or installed from a local path by a developer). Defense-in-depth still requires a limit on blast radius. If arbitrary shell commands were allowed, any supply-chain compromise of an extension would be catastrophic. The allowlist limits scope to git and GitHub operations only.
- **Why not OS-level sandboxing** (seccomp on Linux, sandbox profiles on macOS): It is too complex to implement cross-platform. It is incompatible with the existing Electron `contextIsolation` model. It is excessive for the current threat model (trusted extension code).

## Alternatives Considered

### Worker threads with restricted module access (rejected)

Extensions would have to run in worker threads, with `require()`/`import` restricted. This is incompatible with the existing extension model (extensions run in the main process via `ExtensionHost`) and significantly increases architectural complexity.

### `child_process.exec` with argument escaping (rejected)

Even with escaping, shell injection via edge-case characters is a historically proven attack vector. `execFile` eliminates the whole class.

### Full OS sandbox (seccomp / macOS sandbox profiles) (rejected)

Not cross-platform. It would need platform-specific code for macOS, Windows, and Linux. The threat model does not justify this complexity.

## Consequences

- Extensions can only invoke `git` and `gh` via the API bridge. An extension that needs other CLI tools would require a new ADR and an allowlist addition.
- The `shell:exec` handler in `src/main/ipc/shell.ipc.ts` is a security boundary. Reviewers MUST review any change to it carefully.
- If `gh` is not on PATH and `git.ghCliPath` is empty, `execFile` throws `ENOENT`. The handler catches it and surfaces a `'GH_NOT_FOUND'` error.
