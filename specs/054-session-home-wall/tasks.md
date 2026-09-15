---
description: 'Task list for Session Home and Monitor Wall'
---

# Tasks: Session Home and Monitor Wall

**Input**: Design documents from `specs/054-session-home-wall/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED. Constitution VI (TDD, 80% patch coverage). In every phase, a test task comes before the code it covers and must fail first.

**Conventions**:

- Test paths follow the existing layout, which differs from the illustrative tree in plan.md:
  - `tests/unit/ipc/*.ipc.spec.ts`
  - `tests/unit/sessions/`, the sibling of `tests/unit/integrations/`
  - `tests/unit/shared/`
  - `tests/unit/renderer/sidebar/`
  - `tests/unit/renderer/components/`
  - `tests/e2e/`
- E2E specs address UI by role and name from `contracts/ui-surfaces.md`, never by CSS class.
- Icons are lucide only, sized in CSS. State is drawn through `src/renderer/sidebar/state-icons.tsx` with `--state-op-*` opacity.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: the user story the task serves (US1–US7)

---

## Phase 1: Setup

**Purpose**: Know the baseline before touching files that the patch-coverage gate measures whole.

- [x] T001 Record the current line coverage of every existing file this feature edits in `specs/054-session-home-wall/coverage-baseline.md`. Run `npx vitest run --coverage` and read the `coverage/` entries for these files:

  - `src/renderer/stores/session.store.ts`
  - `src/renderer/components/terminal/TabBar.tsx`
  - `src/renderer/components/terminal/TerminalSession.tsx`
  - `src/renderer/terminal/session-controller.ts`
  - `src/renderer/sidebar/agent-state.ts`
  - `src/renderer/stores/integrations.store.ts`
  - `src/renderer/extensions/registry.ts`
  - `src/renderer/components/sidebar/AppBand.tsx`
  - `src/renderer/App.tsx`
  - `src/main/ipc/terminal.ipc.ts`
  - `src/main/preload.ts`
  - `src/main/index.ts`

  List every file below 80% as pre-existing debt the phase touching it must cover.

- [x] T002 Confirm the pre-commit gate runs in this checkout. `git config core.hooksPath` must resolve to an existing `.husky/_` directory. If it doesn't, run `npm run prepare` before the first code commit.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: The record store, the session facts view model, and the shared session components every surface draws.

### Tests first

- [x] T003 [P] Write failing specs for `pruneRecords` in `tests/unit/shared/session-records/retention.spec.ts`:
  - Keeps open records.
  - Keeps a record closed exactly 30 days ago.
  - Drops one closed 30 days + 1 ms ago.
  - Never reorders.
- [x] T004 [P] Write failing specs for the store in `tests/unit/sessions/session-record-store.spec.ts`. Mock `electron` `app.getPath` to a tmp dir, as `tests/unit/integrations/issue-link-store.spec.ts` does. Cover:
  - `loadRecords` tolerates a missing, corrupt or non-array file, and entries with an unknown tracker.
  - `setDescription` creates a record with its snapshot.
  - Clearing both description and link on an open record deletes it.
  - A description over 500 chars rejects.
  - A write to a closed record rejects with `RECORD_CLOSED`.
  - `markClosed` stamps `closedAt`.
  - `sweepOpenRecords` sets `closedAt = updatedAt` on open records.
  - Every change calls `onRecordChange` handlers.
  - The file is written via tmp-then-rename.
- [x] T005 [P] Write failing specs for the IPC handlers in `tests/unit/ipc/session-records.ipc.spec.ts`:
  - `session-records:list` returns pruned records, closed newest first.
  - `set-description` and `set-link` return `VALIDATION_ERROR` on a bad payload and `RECORD_CLOSED` on a closed record.
  - A `session-records:changed` event is sent after each write.
- [x] T006 [P] Extend `tests/unit/ipc/terminal.ipc.spec.ts`:
  - `terminal:create` returns `{ sessionId, shell }` with the resolved shell.
  - `terminal:close` calls `markClosed(sessionId, …)` after `ptyManager.kill`.
- [x] T007 [P] Write failing specs for `resolveWorkItem` in `tests/unit/renderer/sidebar/work-item.spec.ts`:
  - The session link wins (`source: 'session'`).
  - Falls back to the project link (`source: 'project'`).
  - `null` when both are absent.
- [x] T008 [P] Write failing specs for `buildSessionFacts` in `tests/unit/renderer/sidebar/session-facts.spec.ts`:
  - One fact per open session.
  - A closed record is included only when no open session has its id.
  - A missing project yields workspace/project `null` and a "No project" group label, not a dropped session.
  - Tags are `workspace.tags` plus `agent` for `type === 'agent'`.
  - `workspaceColor` is `null` for scratch and closed.
  - `state` is `exited` for closed.
  - `shell` is omitted when unknown.
- [x] T009 [P] Write failing specs for the `integrations.store` `issueByKey` cache in `tests/unit/renderer/stores/integrations.store.spec.ts`:
  - One `integrations:issue-get` call per `tracker:key`, however many readers.
  - `undefined` while loading.
  - `null` on failure, with the key still readable.
- [x] T010 [P] Write failing specs for the session records renderer store in `tests/unit/renderer/stores/session-records.store.spec.ts`:
  - `load()` fills from `session-records:list`.
  - A `session-records:changed` event upserts or deletes one record.
  - `setDescription` and `setLink` build the snapshot from the session, project and workspace, then call the IPC.
- [x] T011 [P] Write failing component specs:
  - `tests/unit/renderer/components/StateIcon.spec.tsx`: the icon per state from `ICON_FOR_STATE`, no inline colour, accessible name.
  - `tests/unit/renderer/components/LivePreview.spec.tsx`: calls `mountPreview` once on mount and its cleanup on unmount, and keeps the same container node across a `state` prop change.
  - `tests/unit/renderer/components/WorkItemCell.spec.tsx`:
    - Renders a ticket key + title.
    - Renders `Details unavailable` beside the key when the issue is `null`.
    - Renders the description first line with an `Edit description` button.
    - Renders the `What is this session doing?` textbox when neither exists: Enter saves, Escape reverts, the input caps at 500 characters.
    - Renders `Link a work item` only when an `onLink` prop is given.

### Implementation

- [x] T012 Add `SessionRecord`, `SessionSnapshot`, `WorkItemRef` and `ChoicePrompt` to `src/shared/types/index.ts`. On `TerminalSession`, add `shell?: string` and `choicePrompt?: ChoicePrompt`, keeping `note` until T047 removes it. Shapes are in `data-model.md`.
- [x] T013 [P] Implement `pruneRecords` in `src/shared/session-records/retention.ts`, with `RETENTION_MS = 30 * 24 * 60 * 60 * 1000`, so T003 passes.
- [x] T014 [P] Add Zod schemas `SessionSnapshotSchema`, `SetDescriptionInputSchema` (description ≤ 500 after trim, or null) and `SetLinkInputSchema` in `src/shared/schemas/session-records.schema.ts`.
- [x] T015 Implement `src/main/sessions/session-record-store.ts` in the shape of `src/main/integrations/issue-link-store.ts`, so T004 passes:
  - In-memory `Map` and `userData/session-records.json`.
  - Exports `loadRecords`, `sweepOpenRecords`, `listRecords`, `setDescription`, `setLink`, `markClosed` and `onRecordChange`.
  - Applies `pruneRecords` on load and before every persist.
- [x] T016 Implement `src/main/ipc/session-records.ipc.ts` (`registerSessionRecordsHandlers(getWindow)`) using `handleChannel`, with `safeParse` returning `{ error, message }`. It forwards `onRecordChange` as `session-records:changed` via `sendToWindow`. T005 passes.
- [x] T017 In `src/main/ipc/terminal.ipc.ts`:

  - Return `shell: defaultShell` from `terminal:create`.
  - Call `markClosed(sessionId, new Date())` in `terminal:close` after the kill.

  T006 passes.

- [x] T018 In `src/main/index.ts`, `await loadRecords()` then `await sweepOpenRecords()` beside `loadLinks()`, and call `registerSessionRecordsHandlers` beside `registerIntegrationsHandlers`.
- [x] T019 Expose `electronAPI.sessionRecords.{ list, setDescription, setLink, onChanged }` in `src/main/preload.ts`, typed in `src/renderer/electron.d.ts`. Add the channels to the invoke table in `src/main/ipc/invoke-table.ts` if that table lists core channels. Do not add them to `src/shared/electron-api/manifest.ts` or any extension-view preload (Principle II).
- [x] T020 [P] Store `shell` from the `terminal:create` result on the new session in `createSession` in `src/renderer/stores/session.store.ts`. Extend `tests/unit/renderer/stores/session.store.spec.ts` first.
- [x] T021 [P] Implement `resolveWorkItem` in `src/renderer/sidebar/work-item.ts` (T007).
- [x] T022 Implement `buildSessionFacts` in `src/renderer/sidebar/session-facts.ts`, reusing `branchLabel` from `src/renderer/sidebar/branch-display.ts` (T008). `latestLine` is a parameter map `sessionId → string`, supplied by the caller, so the function stays pure.
- [x] T023 [P] Add `issueByKey(tracker, key)` and its cache to `src/renderer/stores/integrations.store.ts` (T009).
- [x] T024 Implement `src/renderer/stores/session-records.store.ts`, a Zustand store with `records: Map<string, SessionRecord>`, `load`, `subscribe`, `setDescription` and `setLink` (T010). Call `load()` and `subscribe()` once from `src/renderer/App.tsx`, beside the integrations subscription.
- [x] T025 [P] Implement `src/renderer/components/session/StateIcon.tsx` and `StateIcon.css` (T011).
- [x] T026 [P] Implement `src/renderer/components/session/LivePreview.tsx`, moving the `mountPreview` layout effect out of `src/renderer/components/overview/SessionTile.tsx` unchanged (T011).
- [x] T027 [P] Implement `src/renderer/components/session/WorkItemCell.tsx` and `WorkItemCell.css`, with props `{ facts, issue, onSaveDescription, onLink? }` (T011).
- [x] T028 Add a hook `src/renderer/components/session/useSessionFacts.ts`. It reads the session, workspace, records and integrations stores, calls `buildSessionFacts` with one `Date.now()` per render, and returns `SessionFacts[]`. Cover it in `tests/unit/renderer/components/useSessionFacts.spec.tsx`: an open session and a closed record come back together.

**Checkpoint**: Records persist and close correctly, and every surface can draw a session's facts. `npm test` exits 0.

---

## Phase 3: User Story 1 - See where every session is and what it is for (P1) 🎯 MVP

**Goal**: Home opens at launch as a Ledger of every open session, grouped by workspace and project, with needs-you first, and the app band shows a needs-you count.

**Independent Test**: With sessions in two workspaces and three projects (one project linked to a ticket), Home lists each session once, in the right group, with the right facts, and the Home badge shows the awaiting count.

### Tests first

- [x] T029 [P] [US1] Write failing specs for `loadHomePrefs` and `saveHomePrefs` in `tests/unit/renderer/sidebar/home-prefs.spec.ts`:
  - Defaults are as in `data-model.md`.
  - Missing, corrupt or non-object input falls back.
  - An unknown field value falls back per field, keeping the valid ones.
  - `save` swallows a throwing `localStorage`.
- [x] T030 [P] [US1] Write failing specs for `buildLedger` with default prefs and no filters in `tests/unit/renderer/sidebar/ledger-rows.spec.ts`:
  - Groups are labelled `<workspace> / <project>`.
  - A scratch session goes under `No project`.
  - Within a group: awaiting-input, working, idle, exited.
  - Ties break by `lastActivityAt` descending.
  - Empty groups are omitted.
- [x] T031 [P] [US1] Write failing component specs:
  - `tests/unit/renderer/components/LedgerView.spec.tsx`:
    - A `grid` named `Sessions` with one `rowgroup` per group and one `row` per session showing state, name, branch, work item and age.
    - Selecting a row sets `aria-selected` and renders `region` `Preview of <name>`, containing `LivePreview` and a `button` `Open <name>`.
    - Enter on a row opens the terminal.
  - `tests/unit/renderer/components/HomeScreen.spec.tsx`:
    - Renders the Ledger.
    - With zero sessions and no records, shows `No terminals are open` and `Open a terminal`.
- [x] T032 [P] [US1] Write failing specs for the tab badge:
  - `tests/unit/renderer/extensions/registry.spec.ts`: `updateGlobalTab(id, { badge })` stores the badge.
  - `tests/unit/renderer/components/AppBand.spec.tsx`:
    - A global tab's `badge` renders as a count, `9+` above 9, and nothing at 0.
    - The accessible name becomes `Home, 2 need you`.

### Implementation

- [x] T033 [P] [US1] Implement `src/renderer/sidebar/home-prefs.ts`, with the key `terminator.home.prefs` (T029). Add a comment naming its `localStorage` side effect, the same as `loadHiddenLanes` does today.
- [x] T034 [P] [US1] Implement `buildLedger(facts, prefs, filters)` and the `LedgerGroup` type in `src/renderer/sidebar/ledger-rows.ts`. This phase covers the default grouping and sort only (T030).
- [x] T035 [US1] Implement `src/renderer/components/home/LedgerView.tsx` and `LedgerView.css`. Columns use one CSS grid template, per the mockup A layout. Navigation reuses the `navigate(sessionId)` logic currently in `OverviewScreen.tsx`, extracted to `src/renderer/terminal/navigate-to-session.ts` and imported by both (T031).
- [x] T036 [US1] Implement `src/renderer/components/home/HomeScreen.tsx` and `HomeScreen.css`, with a toolbar holding the `Home` title and the session count, the Ledger body and the empty state (T031). `Open a terminal` closes the global tab, which is the same action the board's empty state used.
- [x] T037 [US1] Add `badge?: number` to `GlobalTabRegistration` in `src/renderer/extensions/registry.ts`, and render it in `src/renderer/components/sidebar/AppBand.tsx` through the existing `badge` prop (T032).
- [x] T038 [US1] In `src/renderer/App.tsx`:

  - Register `core.home` (label `Home`, lucide `House`, component `HomeScreen`, `permanent: true`), ordered before `core.overview`.
  - Call `setActiveGlobalTab('core.home')` once on first mount.
  - Keep the badge current with `updateGlobalTab('core.home', { badge })`, computed from the session store's awaiting-input count.

  Extend `tests/unit/renderer/App.spec.tsx`, or the nearest existing App spec, first.

- [x] T039 [US1] Write `tests/e2e/session-home.spec.ts` (US1 block) with `launchApp` and `closeApp` from `tests/e2e/helpers.ts`:
  - The app opens on Home.
  - Create two workspaces with projects and open terminals.
  - Assert the rowgroup names and row names by role.
  - Link a project to a ticket through the existing link flow, if a tracker fixture exists. Otherwise assert the describe textbox is present for an unlinked session.

**Checkpoint**: US1 is independently demoable: launch, see every session in place, badge count correct.

---

## Phase 4: User Story 2 - Describe a session so I don't lose context (P1)

**Goal**: Add, edit and clear a description from any surface. It survives restarts, and closed described sessions stay findable for 30 days.

**Independent Test**: Describe a session, close it, restart, find it under Closed by filtering on a word from its description.

### Tests first

- [x] T040 [P] [US2] Write failing specs for `matchesFilter` in `tests/unit/renderer/sidebar/session-filter.spec.ts`:
  - Case-insensitive.
  - Matches each of name, workspace, project, branch, ticket key, ticket title and description.
  - Empty text matches all.
  - A multi-line description matches on any line.
- [x] T041 [P] [US2] Extend `tests/unit/renderer/sidebar/ledger-rows.spec.ts`:
  - Closed facts form a final `Closed` group, ordered by `closedAt` descending.
  - The text filter applies to open and closed alike.
- [x] T042 [P] [US2] Extend `tests/unit/renderer/components/LedgerView.spec.tsx` and `HomeScreen.spec.tsx`:
  - Saving in the describe textbox calls `sessionRecords.setDescription` and the row then shows the description.
  - `Edit description`, then clearing it, brings the textbox back.
  - A `Closed` row is read-only, with no textbox and no Link.
  - `searchbox` `Filter sessions` narrows rows.
  - `No sessions match` with `Clear filters` appears when nothing matches.
- [x] T043 [P] [US2] Rewrite the note specs in `tests/unit/renderer/components/TabBar.spec.tsx` and `tests/unit/renderer/stores/session.store.spec.ts`:
  - The tab's note control edits the session's description through `sessionRecords.setDescription`.
  - `setSessionNote` no longer exists.

### Implementation

- [x] T044 [P] [US2] Implement `matchesFilter` in `src/renderer/sidebar/session-filter.ts` (T040).
- [x] T045 [US2] Add the Closed group and text filter to `buildLedger` in `src/renderer/sidebar/ledger-rows.ts` (T041).
- [x] T046 [US2] Wire `WorkItemCell.onSaveDescription` to `useSessionRecordsStore().setDescription` in `LedgerView.tsx`. Add the `Filter sessions` searchbox and the empty-match state to `HomeScreen.tsx`, with filter text in component state and not persisted (T042).
- [x] T047 [US2] Remove the session note:

  - Delete `note`, `NOTE_MAX_LENGTH` and `setSessionNote` from `src/shared/types/index.ts` and `src/renderer/stores/session.store.ts`.
  - Repoint the TabBar note editor in `src/renderer/components/terminal/TabBar.tsx` to read and write the record's description.
  - Retitle its tooltip to show the description.
  - Remove anything the removal orphans.

  T043 passes. `npm run lint` shows 0 unused.

- [x] T048 [US2] Extend `tests/e2e/session-home.spec.ts` (US2 block):
  - Describe a terminal from Home.
  - Assert the same text on the Overview tile once US3 lands. Until then, assert it on the TabBar tooltip.
  - `closeApp`, then `launchApp` again.
  - Assert the row is under rowgroup `Closed`.
  - Filter by a word from the description and assert it is the only row.

**Checkpoint**: US1 + US2 is the MVP. Commit and push, and the PR can be opened as draft here.

---

## Phase 5: User Story 3 - Monitor wall on the Overview tab (P2)

**Goal**: Overview is a wall of live tiles, with a Needs you band and persisted size, pin and ordering. The board is gone.

**Independent Test**: With one awaiting, one working, one idle and one exited session, Overview shows the band with a double-width tile, the order working, idle, exited, live output, and settings that survive a restart.

### Tests first

- [ ] T049 [P] [US3] Write failing specs for `loadWallPrefs` and `saveWallPrefs` in `tests/unit/renderer/sidebar/wall-prefs.spec.ts`, the same shape as T029, with key `terminator.wall.prefs`.
- [ ] T050 [P] [US3] Write failing specs for `placeWall` in `tests/unit/renderer/sidebar/wall-order.spec.ts`:
  - The output array order is by `sessionId` and identical before and after a session changes state (R11).
  - Awaiting sessions get `band: 'needs'`, `span: 2` when `pinNeeds`, and `band: 'rest'`, `span: 1` otherwise.
  - `order` follows `thenBy`: `state` (working, idle, exited), `workspace-project`, or `recent`.
  - Closed facts are excluded.
- [ ] T051 [P] [US3] Write failing component specs:
  - `tests/unit/renderer/components/WallTile.spec.tsx`:
    - `article` named `<workspace> / <project> / <branch>, <name>`.
    - Caption with state, path, name and age.
    - A `LivePreview`.
    - A `WorkItemCell` footer.
    - Click or Enter calls `onNavigate`.
    - Workspace colour only as `--tile-ws-color` inset rail.
  - `tests/unit/renderer/components/OverviewScreen.spec.tsx`, rewritten:
    - `heading` `Needs you` only when a needs placement exists.
    - Tiles are direct children of one grid, positioned by `order` and `grid-column: span N`.
    - The `radiogroup` `Tile size`, `switch` `Pin sessions that need you`, `combobox` `Then by` and `searchbox` `Filter sessions` update and persist prefs.
    - A state change does not unmount a tile's preview container (same DOM node).
    - The empty state reads `No terminals are open`.

### Implementation

- [ ] T052 [P] [US3] Implement `src/renderer/sidebar/wall-prefs.ts` (T049).
- [ ] T053 [P] [US3] Implement `placeWall` in `src/renderer/sidebar/wall-order.ts` (T050).
- [ ] T054 [US3] Create `src/renderer/components/overview/WallTile.tsx` and `WallTile.css` from `SessionTile.tsx`, using `StateIcon`, `LivePreview` and `WorkItemCell`. Tile size is a `data-size` attribute on the grid, with preview heights per size in CSS (T051).
- [ ] T055 [US3] Rewrite `src/renderer/components/overview/OverviewScreen.tsx` and `OverviewScreen.css` as the wall (T051):
  - One grid.
  - The band heading is a grid item spanning all columns at `order: -1`, rendered only when needed.
  - The "Everything else" heading follows the last needs tile.
  - Metrics polling is kept as it is today.
  - The Board/List toggle and its lucide `LayoutGrid`/`Rows3` imports are removed.
- [ ] T056 [US3] Delete the board, then run `npm run lint` and `npx vitest run` to confirm nothing still imports them:

  - `src/renderer/components/overview/BoardScreen.tsx`
  - `src/renderer/components/overview/BoardScreen.css`
  - `src/renderer/components/overview/SessionTile.tsx`
  - `src/renderer/components/overview/SessionTile.css`
  - `src/renderer/sidebar/board-lanes.ts`
  - `tests/unit/renderer/sidebar/board-lanes.spec.ts`
  - `tests/unit/renderer/components/BoardScreen.spec.tsx`
  - `tests/unit/renderer/components/board-lane-visibility.spec.ts`
  - `tests/unit/renderer/components/SessionTile.spec.tsx`
  - `tests/e2e/board.spec.ts`

  Note in the PR that the stored `terminator.board.lanes` localStorage key is abandoned.

- [ ] T057 [US3] Write `tests/e2e/monitor-wall.spec.ts`:
  - Open Overview, run `yes | head -n 100000` in a terminal, and read the tile's preview text twice to assert it changed.
  - Set `Large`, toggle the pin off, relaunch, and assert both are kept.
  - Close all terminals and assert `No terminals are open`.
  - Screenshot the wall to `test-results/monitor-wall.png` and look at it.

**Checkpoint**: US3 works on its own. The board is gone with nothing orphaned.

---

## Phase 6: User Story 4 - Answer a waiting session without opening it (P2)

**Goal**: A visible numbered-choice prompt marks a session as needing you, and its tile or expanded row answers it in one click, safely.

**Independent Test**: A live `claude` permission prompt shows buttons on its tile. Pressing one answers it, and the tile leaves Needs you.

### Tests first

- [ ] T058 [P] [US4] Write failing specs for `parseChoicePrompt` and `samePrompt` in `tests/unit/renderer/sidebar/choice-prompt.spec.ts`. Use fixtures copied verbatim from a real Claude Code permission prompt and a select prompt, with the `❯` cursor on option 1 and on option 2. Also cover:
  - Options numbered 1,2,4 give `null`.
  - A single option gives `null`.
  - A block in the top half of the rows gives `null`.
  - No question line above gives `null`.
  - Trailing blank rows below the block are ignored.
  - `samePrompt` ignores the question text and compares labels in order.
- [ ] T059 [P] [US4] Extend `tests/unit/renderer/sidebar/agent-state.spec.ts`:
  - `choicePrompt` set with `bellCount` 0 gives `awaiting-input`.
  - Closed with a `choicePrompt` gives `exited`.
- [ ] T060 [P] [US4] Write failing specs for the controller in `tests/unit/renderer/terminal/session-controller.spec.ts`:
  - On idle, the visible rows are parsed and `setChoicePrompt` is called.
  - On busy, the prompt is cleared.
  - `answerChoice(sessionId, n)` re-reads and re-parses. When `samePrompt` holds, it sends the digit via `electronAPI.terminal.input`. Otherwise it sends nothing and clears the prompt.
- [ ] T061 [P] [US4] Write failing component specs:
  - `tests/unit/renderer/components/ChoiceButtons.spec.tsx`: a `group` named by the question, containing one `button` per option named `<n>. <label>`, in order, and a press calls `onAnswer(n)`.
  - Extend `WallTile.spec.tsx` and `LedgerView.spec.tsx`:
    - Buttons render only when `facts.choicePrompt` is set.
    - An awaiting session without a prompt shows no buttons, and the `Open <name>` button remains.

### Implementation

- [ ] T062 [P] [US4] Implement `src/renderer/sidebar/choice-prompt.ts` (T058).
- [ ] T063 [P] [US4] Add `readVisibleRows(): string[]` to `TerminalInstance` in `src/renderer/components/terminal/TerminalSession.tsx`, reading `terminal.buffer.active` from `viewportY` for `rows` lines with `translateToString(true)`. Cover it in `tests/unit/renderer/components/TerminalSession.spec.ts` with a mocked buffer.
- [ ] T064 [US4] Add `setChoicePrompt(sessionId, prompt | null)` to `src/renderer/stores/session.store.ts`. Widen `BellAndBusySource.derive` in `src/renderer/sidebar/agent-state.ts` (T059), and make sure the store re-derives `agentState` when the prompt changes.
- [ ] T065 [US4] In `src/renderer/terminal/session-controller.ts` (T060):
  - `onIdle` parses `readVisibleRows()` into `setChoicePrompt`.
  - `onBusy` clears it.
  - Export `answerChoice(sessionId, n)`.
  - Also derive `latestLine` for `buildSessionFacts` from the same read, exposed through the session store as view state.
- [ ] T066 [US4] Implement `src/renderer/components/session/ChoiceButtons.tsx` and `ChoiceButtons.css`, and render it in `WallTile.tsx` and in the expanded row of `LedgerView.tsx`, wired to `answerChoice` (T061).
- [ ] T067 [US4] Run `quickstart.md` §5 against a live `claude`. If a bare digit only moves the cursor, change `answerChoice` to send `${n}\r` and update the spec in T060 to match. Record the observed behaviour in `specs/054-session-home-wall/research.md` R6, replacing `[UNVERIFIED]` with what was seen and the Claude Code version (`claude --version`).

**Checkpoint**: Answering in place has worked once for real. The wall's Needs you band fills from a real agent, not just the bell.

---

## Phase 7: User Story 5 - Switch Home between Ledger and Logbook (P2)

**Goal**: Home has a persisted Ledger/Logbook switch. The Logbook's list and detail pane carry description editing, ticket suggestions, facts and a live preview.

**Independent Test**: Switch to Logbook, restart, and it is still Logbook. Select an undescribed session and the editor is focused. Save, and the headline updates.

### Tests first

- [ ] T068 [P] [US5] Write failing specs for `buildLogbook` and `suggestWorkItems` in `tests/unit/renderer/sidebar/logbook-groups.spec.ts`:
  - Group order is Needs you, Working, Idle, Exited, Closed, with empty groups omitted.
  - The headline is the ticket title, else the description's first line, else `Add a description`.
  - The filter applies.
  - Suggestions put the project issue first when it differs from the session's own link.
  - Then `mine`, excluding the current work item, deduplicated by `tracker:key`, capped at 3.
- [ ] T069 [P] [US5] Write failing component specs:
  - `tests/unit/renderer/components/LogbookView.spec.tsx`:
    - A `listbox` `Sessions` with state `group`s.
    - Selecting renders `region` `Session details`, with workspace/project/branch, a `textbox` `What is this session doing?`, `Save description`, `Link a work item`, a `list` `Suggested work items`, the facts (shell, started, tags) and `LivePreview`.
    - An undescribed, unlinked selection focuses the textbox.
    - A closed selection shows `Closed <time>` instead of a preview, and no editor.
  - Extend `HomeScreen.spec.tsx`: a `radiogroup` `Layout` switches views and persists through `saveHomePrefs`.

### Implementation

- [ ] T070 [P] [US5] Implement `src/renderer/sidebar/logbook-groups.ts` (T068).
- [ ] T071 [US5] Implement `src/renderer/components/home/LogbookView.tsx` and `LogbookView.css`, per the mockup E layout:

  - Suggestions come from `integrationsStore.listMine({ limit: 10 })` plus the project issue, loaded once per selection.
  - A suggestion button calls `sessionRecords.setLink`.
  - Links render only when `isAnyConnected()`.

  T069 passes.

- [ ] T072 [US5] Add the `Layout` radiogroup to `HomeScreen.tsx`, reading and writing `HomePrefs.layout` (T069).
- [ ] T073 [US5] Extend `tests/e2e/session-home.spec.ts` (US5 block):
  - Switch to Logbook, relaunch, and assert the Logbook radio is checked.
  - Select an undescribed session and assert the textbox is focused.
  - Save a description and assert the list headline matches.

**Checkpoint**: Home offers both layouts, and each works on its own.

---

## Phase 8: User Story 6 - Link a session to a work item from Home (P3)

**Goal**: Link, replace or remove a session's own ticket from every surface, with the project link as the fallback.

**Independent Test**: In a project linked to A, link one of two sessions to B. One shows B and the other A. Remove the link, and both show A.

### Tests first

- [ ] T074 [P] [US6] Write failing specs in `tests/unit/renderer/components/SessionLinkControl.spec.tsx`:
  - With a tracker connected, `Link a work item` opens the existing issue picker, and choosing an issue calls `sessionRecords.setLink(session, { tracker, key })`.
  - A session with its own link shows `Remove session link`, which calls `setLink(session, null)`.
  - With no tracker connected, it renders `alert` `No issue tracker is connected` and `button` `Connect a tracker`, which opens Settings → Integrations.
- [ ] T075 [P] [US6] Extend the store spec in `tests/unit/sessions/session-record-store.spec.ts`: removing a session link never calls `issue-link-store` `clearLink` or `setLink`.

### Implementation

- [ ] T076 [US6] Implement `src/renderer/components/session/SessionLinkControl.tsx`, reusing `src/renderer/components/integrations/IssuePicker.tsx` for the search and choose step, and the existing settings-open action for `Connect a tracker` (T074, T075).
- [ ] T077 [US6] Pass `onLink` (rendering `SessionLinkControl`) to `WorkItemCell` in `LedgerView.tsx`, `LogbookView.tsx` and `WallTile.tsx`, so the Link control is present on all three surfaces. This completes US1 acceptance scenario 5.
- [ ] T078 [US6] Extend `tests/e2e/session-home.spec.ts` (US6 block), using the same tracker fixture approach as T039. Where no tracker fixture exists, assert the `No issue tracker is connected` alert path.

**Checkpoint**: A session-level link overrides the project link on every surface.

---

## Phase 9: User Story 7 - Configure the Ledger (P3)

**Goal**: A Display menu (grouping, sort, columns, preview, hide exited) and a Needs you filter, all persisted except the filters.

**Independent Test**: Hide Latest output and group by project, restart, and both hold.

### Tests first

- [ ] T079 [P] [US7] Extend `tests/unit/renderer/sidebar/ledger-rows.spec.ts`:
  - `groupBy: 'project'` and `'none'`.
  - `sort: 'recent'`.
  - `hideExited` drops exited open sessions but keeps Closed.
  - The Needs you filter keeps only awaiting-input.
- [ ] T080 [P] [US7] Write failing specs:
  - `tests/unit/renderer/components/DisplayMenu.spec.tsx`: `dialog` `Display options`, `combobox`es `Group by`/`Sort`, the seven `checkbox`es, and each change calls `onChange` with the new prefs.
  - Extend `LedgerView.spec.tsx`:
    - A hidden column removes its cells and header.
    - State and name cannot be hidden.
    - With `previewSelected: false`, selection does not expand.

### Implementation

- [ ] T081 [US7] Add grouping, sort, `hideExited` and the Needs you filter to `buildLedger` in `src/renderer/sidebar/ledger-rows.ts` (T079).
- [ ] T082 [US7] Implement `src/renderer/components/home/DisplayMenu.tsx` and `DisplayMenu.css`, using the shared dialog and popover primitives the core already uses (`src/renderer/components/sidebar/SidebarMenu.tsx` pattern) (T080).
- [ ] T083 [US7] Wire in `HomeScreen.tsx` and `LedgerView.tsx`:

  - `Display` and the `Needs you` toggle (`aria-pressed`, not persisted) in `HomeScreen.tsx`.
  - Column visibility in the grid template and `previewSelected` in `LedgerView.tsx`.

  T080 passes.

- [ ] T084 [US7] Extend `tests/e2e/session-home.spec.ts` (US7 block): uncheck `Latest output`, choose Group by `Project`, relaunch, and assert the column header is absent and the rowgroup names are project-only.

**Checkpoint**: Every story is complete.

---

## Phase 10: Polish & Cross-Cutting

- [ ] T085 [P] Update `docs/ARCHITECTURE.md`:
  - Persistence boundaries table: add the `SessionRecord` row, and make the TerminalSession row note that descriptions persist through records.
  - Replace the board/lanes text in "Navigation Chrome" and "One state vocabulary, three surfaces" with a "Session Home and Monitor Wall" section.
  - Terminal Session Lifecycle: `terminal:close` also stamps the record.
- [ ] T086 [P] Add a user guide page, `docs/user-guide/session-home.md`, covering Home, both layouts, describing and linking sessions, the Closed list's 30 days, and the wall and answering in place. Update the README feature list.
- [ ] T087 [P] Finalise `docs/adr/054-overview-is-a-wall-sessions-carry-context.md` with the R6 outcome from T067. Add a "Superseded by ADR 054 (layout)" line to `docs/adr/036-the-board-is-one-grid.md`'s status block, the only edit an immutable ADR allows.
- [ ] T088 Accessibility and motion pass:

  - Tab through Home (both layouts) and the wall. Every control is reachable with a visible focus ring.
  - With `prefers-reduced-motion` emulated, the state spinner and tile moves do not animate.

  Fix any gaps with a spec per fix in the relevant component spec (FR-037, FR-038).

- [ ] T089 Verify reachability: list every exported function and component this feature added, and `grep` for a caller outside tests for each. Delete any that have none (`feedback_wire_the_seams_not_the_tasks`, `feedback_audit_callers_not_existence`).
- [ ] T090 Screenshot the running app: `launchApp`, then capture Home Ledger, Home Logbook and the wall, with sessions in all four states, in both themes, to `test-results/054/`. Look at each image before claiming done (`feedback_screenshot_the_running_app`).
- [ ] T091 Run `quickstart.md` §1–§6 in order and put each command's output and exit code in the PR description:
  - `npm run format`
  - `npm run lint`
  - `npm test; echo "exit=$?"`
  - `npm run build`
  - `npx playwright test tests/e2e/session-home.spec.ts tests/e2e/monitor-wall.spec.ts`
  - The §6 keystroke timing
- [ ] T092 Open the PR from `054-session-home-wall`. The body names the deleted board files and tests, the abandoned `terminator.board.lanes` key, the needs-you widening, and the R6 finding. Check `git log --oneline -1` after the last commit to confirm the coverage gate did not refuse it (`feedback_report_the_gate_not_the_preview`).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. Blocks every story.
- **US1 (Phase 3)**: after Foundational.
- **US2 (Phase 4)**: after US1, because it extends `LedgerView` and `HomeScreen`.
- **US3 (Phase 5)**: after Foundational. Independent of US1 and US2. The T048 cross-surface assertion waits for it.
- **US4 (Phase 6)**: after US3 (wall buttons) and US1 (Ledger buttons). The parser and controller work (T058–T065) can start after Foundational.
- **US5 (Phase 7)**: after US2, because it needs the description save and Home toolbar.
- **US6 (Phase 8)**: after US3 and US5, since it wires all three surfaces.
- **US7 (Phase 9)**: after US2.
- **Polish (Phase 10)**: after every story.

### Story completion order

```
Setup → Foundational ─┬─► US1 ─► US2 ─┬─► US5 ─┐
                      │               └─► US7   ├─► US6 ─► Polish
                      └─► US3 ─► US4 ───────────┘
```

### Within each story

Tests are written and failing, then the pure layer, then stores and controller, then components, then e2e.

## Parallel Opportunities

- **Foundational**: T003–T011 are all separate spec files and run in parallel. T013, T014, T021, T023, T025, T026 and T027 run in parallel once T012 lands.
- **US1**: T029–T032 in parallel. T033 and T034 in parallel.
- **US3 alongside US1/US2**: a second person or agent can take Phase 5 right after Foundational. Its files do not overlap Home's except `WorkItemCell` (read-only use).
- **US4 early**: T058, T059, T062 and T063 have no UI dependency and can start after Foundational.

### Example: launching the Foundational tests together

```text
T003 tests/unit/shared/session-records/retention.spec.ts
T004 tests/unit/sessions/session-record-store.spec.ts
T005 tests/unit/ipc/session-records.ipc.spec.ts
T007 tests/unit/renderer/sidebar/work-item.spec.ts
T008 tests/unit/renderer/sidebar/session-facts.spec.ts
T011 tests/unit/renderer/components/{StateIcon,LivePreview,WorkItemCell}.spec.tsx
```

## Implementation Strategy

### MVP (US1 + US2)

1. Phases 1–2.
2. Phase 3 (US1): stop and demo launching into Home with every session in place.
3. Phase 4 (US2): stop and demo describe, restart, and find under Closed.

That answers the question the feature exists for, and fixes context loss, before the wall changes an existing surface.

### Incremental delivery

1. MVP.
2. US3 (the wall replaces the board).
3. US4 (answer in place, live-verified).
4. US5 (Logbook).
5. US6 and US7.
6. Polish and PR.

Every step leaves `npm test` at exit 0, lint at 0, and patch coverage ≥ 80%.
