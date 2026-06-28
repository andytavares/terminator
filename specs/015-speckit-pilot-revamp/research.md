# Research: SpecKit Pilot Revamp

**Date**: 2026-06-27
**Spec**: [spec.md](./spec.md)

---

## 1. Agent runner — `claude --headless` subprocess

**Decision**: Spawn `claude --headless` in the isolated worktree via Node.js `child_process.spawn()`. One process per phase.

**Rationale**: Reuses the same session model developers use manually. Hooks, permissions, worktree awareness, and CLAUDE.md injection all work identically to a developer running the command by hand. No additional SDK setup or network round-trip.

**How**: From the extension main process (`index.ts`), call `spawn('claude', ['--headless', '--print', phaseCommand], { cwd: worktreePath })`. Capture `stdout` line-by-line and push via `win.webContents.send('speckit:run-output', { line })`. Detect artifact creation by watching the output for phase-specific artifact paths (reusing existing `checkArtifacts` logic after the process exits).

**Alternatives considered**:

- Embedded `@anthropic-ai/sdk` — rejected: requires SDK setup, more complex lifecycle management, loses worktree/hook context
- Remote Claude Code session — rejected: networking overhead, session management complexity

---

## 2. Tracker API integration

### Linear

**Decision**: Use the official `@linear/sdk` npm package.

**Rationale**: Official, typed, maintained by Linear team. Supports personal API key auth. Query pattern: `linearClient.issues({ filter: { assignee: { isMe: { eq: true } } } })`.

**Credentials**: Personal API key stored via `electron-store` (keychain-backed on macOS). Main-process only — never serialized to disk in the repo or sent to the renderer.

**Reference**: https://developers.linear.app/docs/sdk/getting-started

### Jira

**Decision**: Use the Jira REST API v3 directly (no third-party SDK). Auth: Basic auth with email + API token encoded as Base64.

**Rationale**: Atlassian's own REST API is well-documented and stable. Third-party SDKs (jira.js) add a dependency without meaningful benefit for our narrow JQL search use case.

**JQL**: User-configurable per workspace, default `assignee = currentUser()`. Fetch via `GET /rest/api/3/search?jql={jql}&fields=summary,description,priority,status,acceptance`.

**Credentials**: Base64(email:api-token) stored in `electron-store`. Domain (e.g. `my-company.atlassian.net`) stored alongside as plain string.

**Reference**: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/

---

## 3. Run queue — one active run per workspace

**Decision**: In-memory queue `Map<workspacePath, RunQueueEntry[]>` in the main process. State serialized to `.pilot/state.json` as `queuePosition: 'active' | 'pending'`.

**Behavior**: When a dispatch arrives and a run is already active, the new entry is pushed to the queue and shown as `pending` in the Active runs sub-view. When the active run reaches a terminal state (`approved`, `failed`, `cancelled`), the queue is dequeued and the next run starts automatically.

---

## 4. Worktree lifecycle

**Decision**: Use the core Extension API's git worktree methods (`api.shell.run('git worktree add ...')` or `window.electronAPI.git.createWorktree()`). Worktree path: `.wt/<feature-slug>` relative to repo root.

**How**: Create worktree at dispatch time, before starting the first phase. Delete worktree when the run reaches a terminal state. The feature branch (`fix/<ticket-key>-<slug>`) is created at worktree-add time.

**Checkpoint**: Before Implement begins, create a checkpoint commit in the worktree (reuse existing `speckit:checkpoint-create` IPC handler, pointed at worktree path).

---

## 5. PR creation — `gh pr create`

**Decision**: Invoke `gh` CLI via `child_process.exec()` in the worktree. Check `gh auth status` before attempting.

**PR body template**:

```
## Summary
<agent-written summary from Self-Review>

## Testing
[x] Coverage: <pct>% · lint: <n> errors · /google-review: <n> BLOCKERs

Closes <ticket-key>
spec: specs/<NNN>-<slug>
🤖 SpecKit Pilot
```

**Write-back to tracker**: After PR opens, post a comment to the Linear issue or Jira ticket with the PR URL using the same API credentials.

---

## 6. Rate limiting for tracker APIs

**Decision**: Exponential back-off (100ms × 2^attempt), up to 3 retries. Toast only after all retries exhausted.

**Implementation**: Utility function `withRetry(fn, maxAttempts=3)` in `utils/retry.ts`. Detects HTTP 429 response and applies delay before retry.

---

## 7. Reuse inventory from existing extension

| Existing                        | Reuse decision                           |
| ------------------------------- | ---------------------------------------- |
| `phase-state-machine.ts`        | Keep + extend to 10 phases               |
| `state-persistence.ts`          | Keep as-is                               |
| `artifact-hash.ts`              | Keep as-is                               |
| `speckit:phase-approve` IPC     | Keep as-is                               |
| `speckit:phase-reject` IPC      | Keep as-is                               |
| `speckit:phase-revoke` IPC      | Keep as-is                               |
| `speckit:checkpoint-create` IPC | Keep, add worktree path param            |
| `speckit:history-load` IPC      | Keep as-is                               |
| `speckit:file-write` IPC        | Keep as-is                               |
| `speckit:artifact-read` IPC     | Keep as-is                               |
| `SpecKitPilotView.tsx`          | Replace entirely with new layout         |
| `SettingsPage.tsx`              | Replace with new 3-section settings      |
| `ApprovalPanel.tsx`             | Replace with new GatePanel               |
| `KanbanBoard.tsx`               | Reuse and extend for batch check-in      |
| `ImplementDashboard.tsx`        | Adapt to new run-dashboard layout        |
| `speckit-pilot.css`             | Replace with `--tm-*` token-based styles |

---

## 8. New npm dependencies (extension package.json only)

| Package          | Purpose                              |
| ---------------- | ------------------------------------ |
| `@linear/sdk`    | Linear API client                    |
| `electron-store` | Credential storage (keychain-backed) |

Jira uses raw `fetch()` / `node:https` — no SDK needed.
