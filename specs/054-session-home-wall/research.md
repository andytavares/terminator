# Research: Session Home and Monitor Wall

Every decision below is grounded in the code as of `6e0adbff`. File references are the evidence.

## R1. Where a description and a session's own link live

**Decision**: A new main-process store, `src/main/sessions/session-record-store.ts`, holds `SessionRecord`s in memory and mirrors them to `userData/session-records.json`. It uses an atomic tmp-then-rename write and a load that tolerates a corrupt file, the same shape as `src/main/integrations/issue-link-store.ts`.

**Rationale**:

- `TerminalSession` is renderer-only Zustand state, and "sessions do not survive app restart" (`docs/ARCHITECTURE.md`, Persistence boundaries). Anything that must outlive a restart (FR-007, FR-009) has to be written by the main process.
- `issue-link-store.ts` already solved this problem for project links: an in-memory map that hot synchronous readers can use, an atomic write, garbage collection on project delete, and a change announcement. One pattern for two stores beats two patterns.

**Alternatives considered**:

- **PGlite (`src/main/db`)**: it exists, but only for the notepad tables migrated from `notepad.db`. It would put an async query on every render-time read, for a record set that caps at hundreds of rows.
- **electron-store `settings.json`**: that file holds settings, and records are data. Mixing them makes "reset settings" delete history.
- **Renderer `localStorage`**: survives restarts, but the main process cannot read it, and the main process is what stamps close times (R3).

## R2. Session-level work item link

**Decision**: A session's own link is a field on its `SessionRecord` (`link: { tracker, key } | null`). The work item a surface shows is `record.link ?? projectLink(session.projectId) ?? null`, computed by one pure function (`resolveWorkItem`). `issue-link-store.ts` is unchanged. Ticket details are fetched by key through the existing `integrations:issue-get` channel and cached by `tracker:key` in `integrations.store.ts`.

**Rationale**: The clarification was that a session inherits its project link and may override it. Keeping the project link where it is means the sidebar badge, `issueEnvFor`, and the SessionStart context injection (`src/main/integrations/session-hook.ts`) keep working untouched.

**Alternatives considered**:

- **Generalise `IssueLink` to `{ projectId | sessionId }`**: every existing reader of `getLink(projectId)` would need a guard, for a link kind they never use.
- **Inject the session's ticket into the agent's context**: context is injected at SessionStart, keyed by project, before any session link can exist. Re-injecting mid-session has no supported hook. So a session link is organisation and display only, and the plan says so in the ADR.

## R3. When a session becomes Closed

**Decision**:

- `terminal:close` in `src/main/ipc/terminal.ipc.ts` stamps `closedAt` on the session's record, if it has one.
- On startup, after `loadRecords()`, any record without `closedAt` gets `closedAt = updatedAt`. No session can be open at startup, because PTYs die with the app.
- Retention runs through a pure `pruneRecords(records, now)` from `src/shared/session-records/retention.ts`. It drops records whose `closedAt` is more than 30 days before `now`. It is applied on load and before every write.

**Rationale**:

- A quit does not fire `terminal:close` for each session, and `before-quit` handlers are not guaranteed to finish their writes.
- The startup sweep is deterministic, and `updatedAt` is the last moment the app is known to have seen the session.
- Exited (the process ended but the tab is still open) is not Closed (FR-024). That is why `terminal:process-exit` does not stamp a close time.

**Alternatives considered**:

- **Stamp on `before-quit`**: races the quit.
- **A daily prune timer**: an extra always-on side effect, for data that only matters when Home reads it.

## R4. Only described or own-linked sessions get a record

**Decision**: The first `description` or `link` set on a session creates its record, with a snapshot of workspace, project and branch names, shell and start time. When both are cleared while the session is still open, the record is deleted.

**Rationale**: FR-009 retains only sessions with context worth recovering. Snapshotting the names means a Closed entry still reads correctly after its project is deleted. The record does not garbage-collect on project delete, unlike links: history outlives the thing it describes, for 30 days.

## R5. Needs-you detection, and the choice prompt

**Decision**:

- Add a pure parser, `parseChoicePrompt(lines: string[]): ChoicePrompt | null`, that reads the visible rows of a session's xterm buffer.
- The renderer runs it once each time a session goes busy → idle (the existing `onIdle` hook in `TerminalInstance`), and stores the result as renderer view state, `session.choicePrompt`.
- `BellAndBusySource.derive` returns `awaiting-input` when `choicePrompt` is non-null, as well as when the bell rang.

**Rationale**:

- `awaiting-input` is inferred from the bell only (`src/renderer/sidebar/agent-state.ts`). Claude Code rings the bell only when the user has configured a terminal-bell notification channel.
- Without this, FR-034's answer buttons would require a signal most setups never produce: wired but inert, which is the failure `feedback_delete_unreachable_features` names.
- `AgentStateSource` exists precisely so a better signal can replace the bell without the UI changing.
- Parsing on the idle transition bounds the cost to one buffer read per burst of output, not one per chunk.

**Spec impact**: The spec's Assumptions said needs-you detection is unchanged. This plan widens it by one signal, a visible numbered prompt, and the spec is updated to match.

**Recognised shape**, from a real capture (`tests/unit/renderer/sidebar/fixtures/claude-prompt-1.txt`):

- A contiguous block of at least two option lines, `N. label`, with box-drawing edges stripped. A deeper-indented row continues the previous label.
- Exactly one option carries the `❯` cursor. This is what separates a select prompt from a numbered list in ordinary output.
- Numbers run 1..n in order.
- The block is the last thing on screen, apart from up to two footer lines such as "Esc to cancel · Tab to amend". The planned "bottom half of the rows" rule was dropped: the terminal usually has blank rows below the prompt, and a prompt that scrolled up under newer output has already been answered.
- The nearest non-empty line above the block is the question.

Anything else yields `null`.

**Alternatives considered**:

- **Consume Claude Code hooks (`Notification`)**: those hooks belong to extensions. Principle II forbids core reading them, and a shell-started `claude` has none.
- **Read `agentState` from the session store**: nothing writes it. The sidebar derives it locally, so Home, the wall and the badge derive it through the same `BellAndBusySource`, in `buildSessionFacts` and `App.tsx`.
- **Parse on every output chunk**: this is a render-time cost across 12+ live sessions, and SC-005 sets a 50 ms echo budget.

## R6. Answering in place

**Decision**:

- A choice press calls `answerChoice(sessionId, number)`. It re-reads the visible buffer, re-parses it, and sends only if the re-parsed prompt has the same labels in the same order.
- The send writes the number's digit through the existing `terminal:input` channel.
- Otherwise it clears `choicePrompt` and sends nothing (FR-035).

**Verified live** on Claude Code 2.1.273 (`tests/e2e/live/choice-prompt.spec.ts`, run with `E2E_LIVE=1`). With `--permission-mode default`, Claude paused on "Do you want to create a.txt?" with options 1–3. The first run pressed `1` and nothing else, and the prompt cleared within 4 seconds. The second run clicked the wall tile's **1. Yes** button, and `a.txt` was created and the Needs you band emptied. A bare digit is enough; no `\r` is sent.

**Rationale**: The re-read closes the race where the prompt changed between render and click. Reusing `terminal:input` means there is no new privileged path into a PTY.

## R7. The Home tab and launch view

**Decision**:

- Register `core.home` as a permanent global tab in `App.tsx`, next to `core.overview`, with the lucide `House` icon.
- Add an optional `badge?: number` to `GlobalTabRegistration`. `AppBand` already renders a `badge` for notifications, and `updateGlobalTab(id, { badge })` already exists to keep it current.
- On first mount, `App.tsx` calls `setActiveGlobalTab('core.home')` (FR-016).

**Rationale**: Uses the registry that Overview already uses, so Escape-to-terminal, the command palette and the tab ordering all work without new code paths.

## R8. Where preferences persist

**Decision**:

- `localStorage` under `terminator.home.prefs` and `terminator.wall.prefs`.
- Each has a pure `load*Prefs` that degrades to defaults on missing, corrupt or partially-unknown input, and a `save*Prefs` that never throws.

**Rationale**: This is the exact convention of `loadHiddenLanes` / `saveHiddenLanes` in `board-lanes.ts` and the sidebar's view keys. Preferences are per-machine view state, and nothing in the main process reads them.

**Note**: `OverviewScreen` deliberately did not persist its layout ("opening to a narrowed surface reads as data loss"). The spec overrides that for Home's layout and the wall's settings (FR-017, FR-032), and the ADR records the reversal.

## R9. What is removed

**Decision**:

- **Deleted, with their specs**:
  - `BoardScreen.tsx` and `BoardScreen.css`
  - `board-lanes.ts` (`buildLanes`, `loadHiddenLanes`, `saveHiddenLanes`, `LANES_STORAGE_KEY`)
  - `OverviewScreen`'s board/list toggle
  - `tests/e2e/board.spec.ts`
  - `tests/unit/renderer/sidebar/board-lanes.spec.ts`
  - `tests/unit/renderer/components/BoardScreen.spec.tsx`
  - `tests/unit/renderer/components/board-lane-visibility.spec.ts`
- **Reshaped**:
  - `SessionTile` becomes `WallTile`.
  - `OverviewScreen` becomes the wall.
- **Replaced by the description**:
  - `session.note`
  - `setSessionNote`
  - `NOTE_MAX_LENGTH`
  - the TabBar note editor
- **Superseded**:
  - ADR 036 ("the board is one grid") is superseded by ADR 054.
  - The one-live-node rule it established still holds for the wall.

**Rationale**: FR-028, plus Constitution X (dead code is a defect). The note is in memory only, so an upgrade restart leaves no notes to migrate. FR-008 reduces to "the TabBar's note control edits the description", which leaves one field.

## R10. Session facts the renderer lacks

**Decision**:

- `terminal:create` returns `{ sessionId, shell }`, and the renderer stores `shell` on `TerminalSession`. Adopted sessions have no shell in their payload, so their shell fact is omitted, never drawn empty.
- Tags are derived: `workspace.tags`, plus `agent` when `session.type === 'agent'`.
- A branch is `project.gitBranch`, via the existing `branchLabel`.

**Rationale**: The shell is known in the main process at spawn (`terminal.ipc.ts:99`), and nowhere else. Every other fact already exists in the renderer.

## R11. Keeping the wall's live previews alive

**Decision**: The wall keeps ADR 036's invariant: every tile is a direct child of one grid, emitted in a stable order by `sessionId`, and placed with `grid-column` / `grid-row` and `order`. Moving a tile into or out of the Needs you band changes styles only. A second grid for the band would re-parent the node that `mountPreview` moved in, and tear the live xterm out mid-transition.

**Rationale**: `mountPreview` appends the single `TerminalInstance.element` into its container, and the layout-effect cleanup removes it. Re-parenting is the one thing a tile must never do.

**Consequence for Home**: Home and the wall are different global tabs, so only one is mounted at a time. The Ledger's expanded row and the Logbook's detail pane each mount at most one preview.
