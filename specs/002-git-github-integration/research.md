# Research: Git & GitHub Integration Extension

**Branch**: `002-git-github-integration` | **Date**: 2026-05-07

---

## Decision 1 — File System Change Detection

**Decision**: Use Node.js native `fs.watch` as primary mechanism; fall back to `setInterval` + `git status --porcelain` polling when `fs.watch` is unavailable or emits errors.

**Rationale**: The Terminator constitution requires using the standard library when it fully satisfies the requirement (Principle II). Node.js `fs.watch` is part of the stdlib and covers the primary use cases on macOS and Windows. On Linux, `fs.watch` uses `inotify` and is reliable for project-scale directories. The polling fallback handles edge cases (network mounts, Docker bind mounts) without requiring any third-party package.

**Alternatives considered**:

- `chokidar` (npm): Battle-tested file watcher with cross-platform normalization. Rejected because the constitution prohibits adding a third-party dependency when stdlib covers the requirement. Chokidar is also a dependency risk (single points of failure in maintainer transitions have historically affected it).
- `@parcel/watcher` (npm): Native bindings, very fast. Same rejection rationale as chokidar — stdlib suffices.

**Implementation notes** (from [Node.js fs docs](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)):

- `fs.watch(path, { recursive: true }, callback)` — `recursive` supported on macOS and Windows natively; on Linux requires wrapping with per-directory watchers or fallback to polling.
- `FSWatcher` emits `change` events with `(eventType, filename)`. `eventType` is `'rename'` or `'change'`.
- On error (e.g., path deleted), the watcher emits `'error'` and stops. The `FsWatcherService` must handle re-attachment on error.
- Polling fallback: every `git.sidebar.refreshIntervalMs` ms (default 3000), run `git status --porcelain=v1` and diff the result against last known state.

**Source**: [Node.js v20 LTS — fs.watch](https://nodejs.org/docs/latest-v20.x/api/fs.html#fswatchfilename-options-listener)

---

## Decision 2 — Sandboxed Shell Execution

**Decision**: Use `child_process.execFile` (stdlib, `shell: false`) for all extension-driven shell operations. CWD is pinned to the project root. Environment variables are sanitized to a safe allowlist (`PATH`, `HOME`, `TERM`, `GH_TOKEN`). Network access is not OS-sandboxed; it is limited by command scope: extensions may only invoke `git` and `gh` through the structured `shell.exec` API (command is validated server-side against an allowlist before `execFile` is called).

**Rationale**: `execFile` with `shell: false` prevents shell injection — arguments are passed directly to the OS without a shell interpreter. CWD pinning prevents directory traversal. The command allowlist is the practical network boundary (only `gh` has outbound network access; `git` remote operations require explicit remote args that extensions must supply). This is sufficient for the extension threat model (extensions are trusted code, not user-supplied scripts).

**Alternatives considered**:

- `child_process.exec` (string command): Rejected — allows shell injection via unsanitized arguments.
- OS-level sandboxing (seccomp, macOS sandbox profiles): Rejected — too complex for the current threat model and incompatible with cross-platform support. ADR-006 records this decision.
- Worker threads with restricted modules: Rejected — this is extension UI code running in the renderer, not worker context.

**Source**: [Node.js child_process.execFile](https://nodejs.org/docs/latest-v20.x/api/child_process.html#child_processexecfilefile-args-options-callback)

---

## Decision 3 — git status Parsing Strategy

**Decision**: Parse `git status --porcelain=v1` output. This format is explicitly documented as stable across git versions. Each line is `XY filename` where `X` is the index (staged) status and `Y` is the working-tree (unstaged) status.

**Status code reference** (from [git-status porcelain format](https://git-scm.com/docs/git-status#_short_format)):

```
' ' = unmodified
M   = modified
T   = file type changed
A   = added
D   = deleted
R   = renamed
C   = copied
U   = updated but unmerged (conflict)
?   = untracked (shown as '??' in porcelain)
!   = ignored
```

**Renamed files**: `--porcelain=v1` shows `R old\0new` when `-z` flag used; without `-z`, uses `R old -> new`. We use `-z` (null-terminated) to safely handle filenames with spaces.

**File cap enforcement**: After parsing, if `totalFiles > git.maxDisplayedFiles` (default 500), truncate the list and attach a `truncated: true` flag to the `GitStatus` response.

**Source**: [git-status documentation](https://git-scm.com/docs/git-status)

---

## Decision 4 — git diff Parsing Strategy

**Decision**: Parse unified diff output from `git diff --unified=3 -- <path>` (unstaged) and `git diff --cached --unified=3 -- <path>` (staged). The unified diff format is stable and well-documented.

**Binary file detection**: If output contains `Binary files a/<path> and b/<path> differ`, the diff is flagged as `isBinary: true` with no hunks.

**Large diff handling**: If the diff output exceeds 500KB, truncate and attach a `truncated: true` flag. The UI shows a "Diff too large to display" message.

**Hunk header regex**: `^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$`

**Source**: [git-diff documentation](https://git-scm.com/docs/git-diff)

---

## Decision 5 — gh CLI Interface

**Decision**: Use `gh` CLI for all GitHub API operations. The CLI is already available on developer machines (standard GitHub workflow tooling).

**Key commands** (from [gh CLI manual](https://cli.github.com/manual/)):

```bash
# Check auth status (exit 0 = authenticated)
gh auth status

# Check for existing PR on current branch
gh pr view --json url,state,number,title 2>&1

# Create a PR (returns PR URL on success)
gh pr create --title "..." --body "..." --base "main" [--draft]

# Custom gh binary path (respects git.ghCliPath setting)
/custom/path/to/gh pr create ...
```

**Error handling**: `gh` writes errors to stderr and exits non-zero. The `ShellResult` type captures both stdout and stderr. If `gh` is not installed, `execFile` throws `ENOENT` — this is caught and surfaced as a "gh CLI not found" error toast.

**PR duplicate detection**: `gh pr view` returns `{ error: "no pull requests found" }` on stderr and exits non-zero when no PR exists for the current branch. We treat this as "no PR" (not an error state).

**Source**: [gh CLI manual](https://cli.github.com/manual/)

---

## Decision 6 — Extension Distribution Model

**Decision**: Pre-bundle the git integration extension with the application. The extension lives at `extensions/git-integration/` in the repository root. The `ExtensionHost` loads all subdirectories of `extensions/` automatically at startup as built-in extensions. Third-party extensions are installed from a local path via `extension:install` (existing IPC channel, already supports `directoryPath`).

**Rationale**: No marketplace infrastructure needed for v1. The existing `extension:install` channel already supports local path installs. Bundled extensions load with the app and do not require a separate install step. ADR-007 records this decision.

**Source**: Existing `extension:install` IPC contract (`specs/001-extension-first-terminal/contracts/ipc-channels.md`).

---

## Decision 7 — Extension Scaffolding CLI Implementation

**Decision**: Implement the scaffolding CLI as a single plain Node.js script (`scripts/create-extension.js`) using only stdlib (`fs`, `path`, `process`). It generates the extension directory from embedded template strings rather than template files on disk.

**Rationale**: A standalone `.js` script requires no compilation step, no extra tooling, and runs cross-platform on any Node.js ≥ 20 installation — the same Node.js already used by the Electron app. Embedded template strings avoid a separate `templates/` directory that could drift out of sync with the actual hello-world structure. The script is small enough (< 200 lines) that readability is not compromised.

**Interface**:

```bash
node scripts/create-extension.js <name> [--id <reverse-domain-id>] [--dir <output-dir>]
# or via npm script:
npm run create-extension -- my-extension
npm run create-extension -- my-extension --id com.acme.my-extension
```

**Generated output** (for `npm run create-extension -- hello-world`):

```
extensions/hello-world/
├── manifest.json           # Pre-filled with name, id, version, description
└── src/
    └── index.ts            # Hello-world activate/deactivate using all v1.1.0 API surfaces
```

**Template content strategy**:

- `manifest.json`: derived from `<name>` argument; `id` defaults to `com.example.<name>` if not provided
- `index.ts`: a complete working hello-world that registers a settings section, a sidebar item, a keyboard shortcut, a terminal event listener, and (commented-out, with TODO markers) the v1.1.0 surfaces (shell, notifications, fs, topBar, sidebar.registerPanel)
- The hello-world uses `api.notifications.showToast` as the primary interaction so the user sees immediate feedback on first run

**Alternatives considered**:

- TypeScript script compiled via `ts-node`: Rejected — adds a dev dependency and a compile step. Plain JS is simpler for a dev tool.
- Separate `templates/` directory with file stubs: Rejected — template files can drift out of sync; embedded strings are co-located with the generation logic, making divergence immediately visible in code review.
- `yeoman` generator or `plop`: Rejected — third-party dependency; the Constitution prohibits adding packages when stdlib suffices (Principle II).

**Source**: [Node.js fs docs](https://nodejs.org/docs/latest-v20.x/api/fs.html), [Node.js path docs](https://nodejs.org/docs/latest-v20.x/api/path.html)

---

## Dependency Audit

| Package           | Purpose        | Community Health                  | Decision                                                                          |
| ----------------- | -------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| `chokidar`        | File watching  | Active, multiple maintainers      | ❌ Rejected — stdlib `fs.watch` suffices (Constitution II)                        |
| `@parcel/watcher` | File watching  | Active, Parcel team               | ❌ Rejected — same rationale                                                      |
| `simple-git`      | Git operations | Active, single primary maintainer | ❌ Rejected — single-maintainer violates Constitution II; raw `execFile` suffices |
| `parse-diff`      | Diff parsing   | Low activity                      | ❌ Rejected — simple pure parser is < 50 lines of code; no library needed         |

**Result**: Zero new dependencies. All new capabilities use Node.js stdlib (`fs`, `child_process`).
