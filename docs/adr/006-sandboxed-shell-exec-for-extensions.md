# ADR-006: Sandboxed Shell Execution for Extension IPC Bridge

**Date**: 2026-05-07
**Status**: Accepted
**Branch**: `002-git-github-integration`

## Decision

The `shell:exec` IPC channel (and its `ExtensionAPI` surface `api.shell.exec`) executes shell commands in the main process using `child_process.execFile` with `shell: false`. The security model is:

1. **Command allowlist**: Only `git` and `gh` are permitted (Zod enum enforced server-side).
2. **CWD pinning**: The `cwd` argument must be within the current workspace's `folderPath` (validated via `path.relative()`).
3. **No shell expansion**: `shell: false` passes arguments directly to the OS without invoking a shell interpreter — prevents shell injection via argument values.
4. **Env sanitization**: Child process environment is limited to a safe allowlist (`PATH`, `HOME`, `TERM`, `GH_TOKEN`).
5. **Timeout**: Default 10s; configurable per call; forcefully killed on timeout.

Network access is not OS-sandboxed. It is bounded by command scope: only `gh` makes network calls; `git` remote operations require explicit remote args that the extension supplies.

## Motivation

Extensions need to invoke `git` and `gh` to deliver the git integration feature (FR-024). The IPC bridge must balance power with safety:

- **Why `execFile` over `exec`**: `exec` accepts a full shell string and is vulnerable to injection via unsanitized arguments. `execFile` takes `command` and `args` separately, passing them directly to the OS — no shell interpretation.
- **Why an allowlist over arbitrary commands**: Extensions are trusted code (shipped by the application vendor or installed from a local path by a developer). However, defense-in-depth requires limiting blast radius. Allowing arbitrary shell commands would make any supply-chain compromise of an extension catastrophic. The allowlist limits scope to git and GitHub operations only.
- **Why not OS-level sandboxing** (seccomp on Linux, sandbox profiles on macOS): Too complex to implement cross-platform, incompatible with the existing Electron `contextIsolation` model, and excessive for the current threat model (trusted extension code).

## Alternatives Considered

### Worker threads with restricted module access (rejected)

Would require extensions to run in worker threads and restrict `require()`/`import`. Incompatible with the existing extension model (extensions run in the main process via `ExtensionHost`) and significantly increases architectural complexity.

### `child_process.exec` with argument escaping (rejected)

Even with escaping, shell injection via edge-case characters is a historically proven attack vector. `execFile` eliminates the class entirely.

### Full OS sandbox (seccomp / macOS sandbox profiles) (rejected)

Not cross-platform. Would require platform-specific code for macOS, Windows, and Linux. The threat model does not justify this complexity.

## Consequences

- Extensions can only invoke `git` and `gh` via the API bridge. Extensions that need other CLI tools would require a new ADR and an allowlist addition.
- The `shell:exec` handler in `src/main/ipc/shell.ipc.ts` is a security boundary. It MUST be reviewed carefully on any change.
- If `gh` is not on PATH and `git.ghCliPath` is empty, `execFile` throws `ENOENT` — caught and surfaced as a `'GH_NOT_FOUND'` error.
