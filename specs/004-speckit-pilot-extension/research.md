# Research: SpecKit Pilot Extension

**Branch**: `004-speckit-pilot-extension` | **Date**: 2026-05-10

---

## 1. Terminal Command Injection

**Decision**: The extension renderer injects Spec-Kit slash commands by calling `window.electronAPI.terminal.input({ sessionId, data })`, which routes through the existing preload `terminal:input` channel to PtyManager.

**Rationale**: This channel is part of the published preload API surface (not an internal import) and is already used by the renderer for keyboard input. The extension renderer runs inside the main renderer process and shares the same `window` context. No ExtensionAPI additions required.

**How the session ID is obtained**: The extension's main-process `activate()` tracks sessions via `api.terminal.onSessionCreate`. It stores the current list of sessions in a registry accessible via a custom IPC handler `speckit:session-list`. The renderer reads this list and lets the user select the target Claude Code session if more than one agent session exists.

**Alternatives considered**:

- Add `api.terminal.sendInput()` to ExtensionAPI — requires a core API change; deferred since the window.electronAPI approach works without it.
- Shell-out CLI bridge (`claude --print "/speckit-specify ..."`) — would bypass the user's active Claude Code session context and lose session state.

---

## 2. Run Output Monitoring (No Streaming)

**Decision**: The extension does NOT attempt to stream PTY output into a custom run console. Instead, it relies on the file system watcher (`api.fs.watch`) to detect when Spec-Kit output artifacts appear on disk. Phase status transitions to `awaiting_review` when the expected output file(s) are created or modified.

**Rationale**: PTY output belongs to the terminal — intercepting it requires access to PtyManager internals, which violates Constitution Principle II. The file-detection approach gives the same end result (phase completion signal) without coupling to internals. The user can watch live output in the Terminator terminal tab where Claude Code is running.

**Timing**: The file watcher fires within milliseconds of a write. The extension computes the artifact hash immediately on the `fs:changed` event.

**Alternatives considered**:

- `api.terminal.onOutput(sessionId, handler)` — would require a new ExtensionAPI surface; out of scope for this extension.
- Polling: rejected (latency, wasteful).

---

## 3. Implement Phase Per-File Gate (Post-Write Review)

**Decision**: The per-file gate during Implement is a **post-write review-and-revert** model, not a pre-write intercept. When the extension detects a file change via `api.fs.watch` during an active Implement run, it pauses user interaction (showing the changed file's diff against git HEAD) and asks Approve (keep) or Reject (revert via `git checkout -- <file>`).

**Rationale**: True pre-write interception requires injecting a hook into Claude Code's tool execution pipeline (e.g., a `.claude/settings.json` PreToolUse hook). This is out of scope and would couple the extension to Claude Code internals. Post-write review achieves the same safety goal: no file survives an Implement run without explicit user approval. The pre-run checkpoint commit (via `api.shell.exec git commit`) ensures any rejected file can also be mass-reverted.

**Limitation**: Because writes are not pre-intercepted, a file is briefly on disk before the user reviews it. The checkpoint commit mitigates this — `git reset --hard` reverts everything.

**Alternatives considered**:

- Claude Code `.claude/settings.json` `PreToolUse` hook calling back to extension — technically feasible but not in scope for v1; would require the extension to run an HTTP server or named pipe listener.

---

## 4. Artifact Hash Computation

**Decision**: SHA-256 of file contents, computed in the main process using Node.js `crypto.createHash('sha256')` (stdlib, no dependency).

**Format**: First 8 hex characters used as the display hash (e.g., `7f3c2a1b`). Full 64-char hash stored in state.json for comparison.

**Rationale**: Built-in crypto is sufficient; no third-party hashing library needed.

---

## 5. Diff Display

**Decision**: Use the `diff` npm package (MIT, 15+ maintainers, actively maintained) to compute line-level diffs between the last approved artifact content and the current working copy. Rendered as a styled diff view in the React sidebar panel.

**Rationale**: Building a line diff algorithm from scratch would exceed YAGNI. `diff` is the de-facto standard for this in the Node.js ecosystem. Monaco editor (from Terminator's core) is not exposed via ExtensionAPI and cannot be imported directly.

**Alternatives considered**:

- Monaco diff viewer — not available without importing core internals (violation of Principle II).
- `jsdiff` (older) vs `diff` — same package, `diff` is the current name.

---

## 6. State Persistence Format

**`state.json`** (read/write on every gate decision):

```json
{
  "version": 1,
  "featureDir": "specs/004-...",
  "phases": {
    "constitution": {
      "status": "approved",
      "approvedHash": "7f3c2a1b...",
      "approvedAt": "2026-05-10T10:48:00Z",
      "approvedBy": "Andrew Tavares <andrew.tavares87@gmail.com>"
    }
  }
}
```

**`history.jsonl`** (append-only, one JSON object per line):

```json
{
  "ts": "2026-05-10T10:48:00Z",
  "actor": "Andrew Tavares",
  "action": "approved",
  "phase": "constitution",
  "hash": "7f3c2a1b...",
  "note": ""
}
```

**Rationale**: JSON is stdlib-parseable. JSONL is append-only, git-friendly, and auditable. No database needed.

---

## 7. Startup State Recovery

**Decision**: On extension activate, read `state.json`, then for each phase with `status: 'approved'`, compute the current on-disk hash of its output artifact(s) and compare to `approvedHash`. If hashes differ, transition the phase to `stale` (do not re-approve automatically). Write updated state back to `state.json` and emit `speckit:state-changed` to the renderer.

**Rationale**: Catches any out-of-band edits that occurred while Terminator was closed. Prevents stale artifacts from silently propagating through the pipeline.

---

## 8. ExtensionAPI Gaps — None Required

The full feature is achievable with ExtensionAPI v1.1.0 as-is:

| Need                                         | Solution                                                          |
| -------------------------------------------- | ----------------------------------------------------------------- |
| Register sidebar panel                       | `api.sidebar.registerPanel('right-sidebar', ...)`                 |
| File watching                                | `api.fs.watch(handler)`                                           |
| Shell commands (git hash, checkpoint commit) | `api.shell.exec({ command: 'git', args, cwd })`                   |
| Session tracking                             | `api.terminal.onSessionCreate/Close`                              |
| Terminal injection                           | `window.electronAPI.terminal.input` (renderer, published preload) |
| Settings                                     | `api.settings.register/get`                                       |
| Keyboard shortcuts                           | `api.keyboard.register`                                           |
| IPC handlers                                 | `api.ipc.registerHandler`                                         |

No new ExtensionAPI surface needed.

---

## 9. Dependencies

| Package | Version | Justification                    | Community                                  |
| ------- | ------- | -------------------------------- | ------------------------------------------ |
| `diff`  | `5.2.0` | Line-level artifact diff display | 6M weekly downloads, MIT, 15+ contributors |

All other needs met by stdlib (crypto, fs, path) or host-provided packages (React, Zustand, Zod).

---

## 10. Glob Matching for Disallowed Paths (D1 Resolution)

**Decision**: Use Node.js 18 built-in `fs.matchesGlob` (available since Node 22) is **not** used — it requires Node 22+. Instead use Node 18's `path`-based approach or the `minimatch` package.

**Revised Decision**: Use `minimatch@9.x` — it is the de-facto standard for glob matching in Node.js tooling, has 50M+ weekly downloads, is MIT-licensed, and has multiple active maintainers. Pin to `9.0.5` (latest stable as of 2026-05-10).

**Rationale**: Node.js built-in glob support (`fs.glob`, `path.matchesGlob`) requires Node 22+ — Terminator targets Node 20 LTS. `minimatch` is the right tool for this context. It is already a transitive dependency of many Terminator dev tools (Vite, ESLint), so the install footprint is minimal.

**Alternatives considered**:

- `micromatch` — also valid, but `minimatch` is simpler for single-pattern checks.
- `picomatch` — used internally by Rollup/Vite; not user-facing enough to prefer here.

**Updated dependency table:**

| Package     | Version | Justification                                   | Community                                                                                  |
| ----------- | ------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `diff`      | `5.2.0` | Line-level artifact diff display                | 6M weekly downloads, MIT, 15+ contributors                                                 |
| `minimatch` | `9.0.5` | Disallowed-path glob matching in Implement gate | 50M+ weekly downloads, MIT, 4+ maintainers, Node.js built-in alternative requires Node 22+ |
