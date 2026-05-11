# Tasks: SpecKit Pilot Extension

**Input**: Design documents from `specs/004-speckit-pilot-extension/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: Per Constitution Principle VI (TDD is NON-NEGOTIABLE), every production task is preceded by a failing test task. Write the test first, confirm it fails, then implement.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US7)
- Exact file paths are required in every description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the extension, install dependencies, wire test infrastructure.

- [x] T001 Scaffold extension directory by running `npm run create-extension -- speckit-pilot` from repo root; verify `extensions/speckit-pilot/` is created
- [x] T002 Update `extensions/speckit-pilot/manifest.json` with id `terminator.speckit-pilot`, name `SpecKit Pilot`, version `0.1.0`, description, and `minAppVersion: "0.1.0"`
- [x] T003 [P] Create `extensions/speckit-pilot/package.json` with `@terminator/extension-speckit-pilot` name, `diff@5.2.0` and `minimatch@9.0.5` pinned dependencies; run `npm install` from repo root
- [x] T004 [P] Add `speckit-pilot` project entry to root `vitest.config.ts` (or equivalent config) so `npm run test -- --project=speckit-pilot` targets the extension's test files
- [x] T005 Create `extensions/speckit-pilot/src/index.ts` with `activate(api: ExtensionAPI)` and `deactivate()` stubs; import `ExtensionAPI` type only from `../../../src/main/extensions/api`
- [x] T006 [P] Create `extensions/speckit-pilot/src/renderer.tsx` with a `SpecKitPilotPanel` React stub component that renders `<div>SpecKit Pilot</div>`

**Checkpoint**: `npm run build:extensions` compiles without errors; extension loads in `npm run dev`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Types, schemas, state machine, persistence, file watcher, and IPC skeleton — must be complete before any user story UI can be built.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T007 [P] Create `extensions/speckit-pilot/src/types/speckit.types.ts` with all types: `PhaseId`, `PhaseStatus`, `PhaseState`, `PilotState`, `PilotSettings`, `PhaseGateConfig`, `HistoryEntry`, `RunRecord`, `PendingFileWrite`, `Feature` — exact shapes from `data-model.md`
- [x] T008 [P] Create `extensions/speckit-pilot/src/schemas/speckit.schemas.ts` with Zod schemas for every IPC payload defined in `contracts/ipc-channels-speckit.md`, plus `PilotStateSchema` for `state.json` validation
- [x] T009 [P] Write failing unit tests for `speckit.schemas.ts` in `extensions/speckit-pilot/tests/schemas/speckit.schemas.spec.ts` — valid and invalid payloads for each IPC channel schema
- [x] T010 Write failing unit tests for `phase-state-machine.ts` in `extensions/speckit-pilot/tests/state/phase-state-machine.spec.ts` — all 12 valid transitions, invalid-transition throws, `isUpstreamApproved()` DAG check, `computeStalePhases()` DAG traversal, `applyHashVerification()` divergence detection
- [x] T011 Create `extensions/speckit-pilot/src/state/phase-state-machine.ts` — pure functions: `transition(state, phase, event)`, `isUpstreamApproved(state, phase)`, `computeStalePhases(state, changedPhase)`, `applyHashVerification(state, diskHashes)` — make T010 tests pass
- [x] T012 [P] Write failing unit tests for `artifact-hash.ts` in `extensions/speckit-pilot/tests/state/artifact-hash.spec.ts` — known file content produces known SHA-256 prefix; missing file returns null
- [x] T013 [P] Create `extensions/speckit-pilot/src/state/artifact-hash.ts` — `computeHash(filePath: string): Promise<string | null>` using Node.js `crypto.createHash('sha256')`; return first 8 hex chars for display, full 64-char for storage — make T012 tests pass
- [x] T014 Write failing unit tests for `state-persistence.ts` in `extensions/speckit-pilot/tests/state/state-persistence.spec.ts` — `readState` round-trip, `writeState` atomicity, `appendHistory` idempotency, corrupt file recovery
- [x] T015 Create `extensions/speckit-pilot/src/state/state-persistence.ts` — `readState(featureDir)`, `writeState(featureDir, state)`, `appendHistory(featureDir, entry)`, `ensurePilotDir(featureDir)` — make T014 tests pass
- [x] T016 Create `extensions/speckit-pilot/src/stores/speckit.store.ts` — Zustand store with: `pilotState`, `activeFeatureDir`, `activeSessions`, `activeRunRecord`, `pendingFileWrites`; actions: `setPilotState`, `setActiveFeature`, `addSession`, `removeSession`, `setRunRecord`, `addPendingWrite`, `updateWriteDecision`, `clearPendingWrites`
- [x] T017 Create `extensions/speckit-pilot/src/ipc/speckit.ipc.ts` with `registerAll(registerFn)` skeleton and `speckit:initialize` handler — reads `state.json`, calls `applyHashVerification()`, writes updated state if hashes diverged, returns `PilotState`
- [x] T018 Add `speckit:feature-list` handler to `speckit.ipc.ts` — scan `specs/` directory for subdirs containing `spec.md`, return `Feature[]` sorted by `lastModified` descending
- [x] T019 Add `speckit:session-list` handler to `speckit.ipc.ts` — return current `SessionSnapshot[]` from in-memory session registry populated by `api.terminal.onSessionCreate/Close`
- [x] T020 Add session tracking to `extensions/speckit-pilot/src/index.ts` `activate()` — call `api.terminal.onSessionCreate` to push to session registry; `onSessionClose` to remove by id
- [x] T021 Add `api.fs.watch` handler to `index.ts` `activate()` — on each `FsChangeEvent`: compute hash of changed file, find all `PhaseState` entries whose `artifactPaths` include the file, apply transition logic (`running→awaiting_review` or `approved→modified`), write updated `state.json`, push `speckit:state-changed` via `BrowserWindow.webContents.send`
- [x] T022 Wire `registerAll(registerFn)` and `api.fs.watch` into `index.ts` `activate()`; ensure all disposables are collected and disposed in `deactivate()`
- [x] T023 Write failing unit tests for `speckit:initialize`, `speckit:feature-list`, and `speckit:session-list` handlers in `extensions/speckit-pilot/tests/ipc/speckit.ipc.spec.ts`

**Checkpoint**: All foundational tests pass; `speckit:initialize` returns valid `PilotState` for a test feature directory

---

## Phase 3: User Story 1 — Lifecycle View & Phase Navigation (Priority: P1) 🎯 MVP

**Goal**: Developer opens SpecKit Pilot sidebar and sees all 8 phases with accurate status glyphs for the current feature. No actions needed — pure read-only display.

**Independent Test**: Open Terminator in a repo with `.specify/` initialized and a feature in `specs/`. The SpecKit Pilot sidebar panel renders, all 8 phases appear with correct status glyphs, clicking a phase shows its detail panel with artifact path and input hashes.

### Tests for User Story 1

- [x] T024 [P] [US1] Write failing component tests for `PhaseRow.tsx` in `extensions/speckit-pilot/tests/components/PhaseRow.spec.tsx` — status glyph maps to each `PhaseStatus`, locked phases show lock icon, approved phases show checkmark
- [x] T025 [P] [US1] Write failing component tests for `LifecycleSidebar.tsx` in `extensions/speckit-pilot/tests/components/LifecycleSidebar.spec.tsx` — all 8 phases rendered, empty state shown when no feature, feature picker shown when multiple features exist

### Implementation for User Story 1

- [x] T026 [P] [US1] Create `extensions/speckit-pilot/src/components/PhaseRow.tsx` — renders phase id label, status glyph (✓/⟳/◐/!/~/✗/·/🔒), status text, and a CTA slot prop — make T024 pass
- [x] T027 [US1] Create `extensions/speckit-pilot/src/components/LifecycleSidebar.tsx` — feature picker dropdown (calls `speckit:feature-list`), list of 8 `PhaseRow` components driven by `PilotState`, empty state for no `.specify/` folder, "Initialize" CTA — make T025 pass
- [x] T028 [US1] Create `extensions/speckit-pilot/src/components/PhaseDetail.tsx` — shows selected phase: artifact path(s), approved hash, upstream dependency list, locked-state explanation with "Jump to upstream" link; switches content based on `PhaseStatus`
- [x] T029 [US1] Register sidebar panel in `renderer.tsx` via registry (`speckit-lifecycle` panel, `LifecycleSidebar` component)
- [x] T030 [US1] Wire `speckit:initialize` call in `LifecycleSidebar` on feature select — dispatch result to Zustand store; listen for `speckit:state-changed` push event via `window.electronAPI` and update store
- [x] T031 [US1] Add `api.nativeMenu.addViewMenuItem` in `index.ts` for "SpecKit Pilot" — toggles sidebar panel visibility
- [x] T032 [US1] Add `api.topBar.registerMenuItem` in `index.ts` for "SpecKit" quick-access button in project top bar

**Checkpoint**: User Story 1 is fully functional — sidebar shows accurate phase state for any Spec-Kit repo

---

## Phase 4: User Story 2 — Human-in-the-Loop Approval Gates (Priority: P1)

**Goal**: After a phase completes, developer sees the artifact and must explicitly Approve, Reject, or Revoke before any downstream phase can run. Every decision is recorded in `history.jsonl`.

**Independent Test**: Run `/speckit-specify` from a Claude Code session. Verify the Specify phase transitions to `awaiting_review`, the Clarify phase remains `locked`, and clicking Approve writes a `history.jsonl` entry and unlocks Clarify.

### Tests for User Story 2

- [ ] T033 [US2] Write failing unit tests for `speckit:phase-approve`, `speckit:phase-reject`, `speckit:phase-revoke` handlers in `extensions/speckit-pilot/tests/ipc/speckit.ipc.test.ts` — state transitions, history entries written, downstream effects

### Implementation for User Story 2

- [ ] T034 [US2] Add `speckit:phase-approve` handler to `speckit.ipc.ts` — compute artifact hash, call `transition(state, phase, 'approve')`, call `computeStalePhases` on any now-stale downstreams, write `state.json`, append `HistoryEntry`, return updated `PilotState`
- [ ] T035 [US2] Add `speckit:phase-reject` handler to `speckit.ipc.ts` — delete phase output artifacts via `fs.unlink`, call `transition(state, phase, 'reject')`, write `state.json`, append `HistoryEntry` (reason required), return updated `PilotState`
- [ ] T036 [US2] Add `speckit:phase-revoke` handler to `speckit.ipc.ts` — call `transition(state, phase, 'revoke')`, call `computeStalePhases` for all downstreams, write `state.json`, append `HistoryEntry`, return updated `PilotState`
- [ ] T037 [P] [US2] Write failing component tests for `ApprovalPanel.tsx` in `extensions/speckit-pilot/tests/components/ApprovalPanel.test.tsx` — Approve button calls onApprove; Reject shows dialog requiring reason; note field appears; Revoke shows confirmation
- [ ] T038 [P] [US2] Create `extensions/speckit-pilot/src/components/ApprovalPanel.tsx` — four actions: Approve & continue, Request changes, Reject & rerun, Revoke approval; note textarea; provenance panel (input hashes, command, model, run id, token cost); auto-unlock-next checkbox — make T037 pass
- [ ] T039 [US2] Create `extensions/speckit-pilot/src/components/RejectDialog.tsx` — confirmation modal with required reason textarea, "Modify prompt before rerun" checkbox, Cancel / Reject & rerun CTAs
- [ ] T040 [US2] Create `extensions/speckit-pilot/src/components/RevokeDialog.tsx` — confirmation modal showing downstream phases that will be staled, optional note textarea, Cancel / Revoke approval CTAs
- [ ] T041 [US2] Integrate `ApprovalPanel` into `PhaseDetail.tsx` — show when `status === 'awaiting_review'`; show revoke action when `status === 'approved'`; wire `onApprove/onReject/onRevoke` to `speckit:phase-approve/reject/revoke` IPC calls
- [ ] T042 [US2] Register `CmdOrCtrl+Shift+A` (approve current phase) and `CmdOrCtrl+Shift+R` (reject current phase) keyboard shortcuts in `index.ts` via `api.keyboard.register`

**Checkpoint**: Gate flow works end-to-end — Specify → approve → Clarify unlocks; Revoke → downstream stale; all in history.jsonl

---

## Phase 5: User Story 3 — Run Phase with Prompt Input (Priority: P2)

**Goal**: Developer triggers any unlocked phase from the sidebar, sees a prompt dialog, injects the command into the active Claude Code session, and the phase transitions on artifact detection.

**Independent Test**: Click "Run /speckit-plan" in the sidebar. Prompt dialog appears, user clicks Run, the slash command appears in the Claude Code terminal, and when `plan.md` is written the phase transitions to `awaiting_review` without any manual action.

### Tests for User Story 3

- [ ] T043 [US3] Write failing unit tests for file-watcher phase-transition logic in `extensions/speckit-pilot/tests/state/phase-state-machine.test.ts` — `running → awaiting_review` on artifact detection, `running → failed` on timeout
- [ ] T044 [P] [US3] Write failing component tests for `RunPromptDialog.tsx` in `extensions/speckit-pilot/tests/components/RunPromptDialog.test.tsx` — prompt textarea pre-filled, model selector present, Run CTA disabled when no session selected

### Implementation for User Story 3

- [ ] T045 [US3] Add artifact-detection logic to `fs.watch` handler in `index.ts` — when a `running` phase's artifact path appears (`eventType === 'change'`), compute hash, call `transition(state, phase, 'artifact_detected')`, write `state.json`, push `speckit:state-changed`
- [ ] T046 [US3] Add run-timeout logic to `index.ts` — when a phase transitions to `running`, set a `setTimeout` for `PilotSettings.commandTimeoutMs`; on fire, if phase still `running`, call `transition(state, phase, 'timeout')`, write `state.json`, push `speckit:state-changed`; clear timeout on earlier transition
- [ ] T047 [P] [US3] Create `extensions/speckit-pilot/src/components/RunPromptDialog.tsx` — feature and phase label, resolved inputs list, editable prompt textarea, model selector dropdown, dry-run checkbox, "Refuse on dirty tree" checkbox, session selector (from `speckit:session-list`), Cancel / Run CTAs — make T044 pass
- [ ] T048 [US3] Create `extensions/speckit-pilot/src/components/RunConsole.tsx` — shows "Command injected — watching for artifact…", elapsed timer, Stop button that calls `speckit:implement-stop`; replaces phase detail during `running` status
- [ ] T049 [US3] Implement run trigger in renderer — on Run click in `RunPromptDialog`: call `speckit:session-list`, inject command string via `window.electronAPI.terminal.input({ sessionId, data: '/speckit-<phase> ...\n' })`, update store phase status to `running`
- [ ] T050 [US3] Add dirty-tree check in renderer before Implement run — call `speckit:artifact-read` with a git-status check; if dirty, show `DirtyTreeDialog` instead of `RunPromptDialog`
- [ ] T051 [US3] Create `extensions/speckit-pilot/src/components/DirtyTreeDialog.tsx` — lists modified/untracked files, Stash & retry (calls `api.shell.exec git stash`) / Cancel CTAs
- [ ] T052 [US3] Add failed-phase UI to `PhaseDetail.tsx` — shows last-run error summary placeholder, Retry, Edit prompt, Open full log CTAs when `status === 'failed'`
- [ ] T053 [US3] Register `CmdOrCtrl+Shift+S` (stop current run) keyboard shortcut in `index.ts` via `api.keyboard.register`

**Checkpoint**: Full run cycle works — click Run → command injected into terminal → artifact detected → phase awaits review

---

## Phase 6: User Story 4 — Artifact Editing with Diff View (Priority: P2)

**Goal**: Developer edits any approved artifact inline. Changes are shown as a diff against the last approved version. Saving marks the phase modified and stales downstream phases.

**Independent Test**: Edit `plan.md` through the artifact editor in `PhaseDetail`. Verify the diff renders, saving marks Plan as `modified`, Tasks and Analyze change to `stale`, and re-approving Plan in the same step moves it directly to `approved`.

### Tests for User Story 4

- [ ] T054 [US4] Write failing unit tests for `speckit:artifact-read` and `speckit:artifact-save` handlers in `extensions/speckit-pilot/tests/ipc/speckit.ipc.test.ts` — read returns current + approved content; save writes file and marks phase modified; approveInSameStep transitions to approved
- [ ] T055 [P] [US4] Write failing component tests for `ArtifactDiff.tsx` in `extensions/speckit-pilot/tests/components/ArtifactDiff.test.tsx` — added lines render with `+` prefix and green styling; removed lines render with `-` prefix and red; unchanged lines neutral

### Implementation for User Story 4

- [ ] T056 [US4] Add `speckit:artifact-read` handler to `speckit.ipc.ts` — read current file content, call `api.shell.exec git show HEAD:<relPath>` for approved version (fall back to empty string if new file), compute current hash, return `{ current, approved, hash }`
- [ ] T057 [US4] Add `speckit:artifact-save` handler to `speckit.ipc.ts` — write file to disk, call `transition(state, phase, 'modify')`, optionally call approve transition if `approveInSameStep`, call `computeStalePhases` for downstreams, write `state.json`, append `HistoryEntry`, return updated `PilotState`
- [ ] T058 [P] [US4] Create `extensions/speckit-pilot/src/components/ArtifactDiff.tsx` — use `diff` package `createPatch()` to compute unified diff; render line-by-line with `+`/`-` prefixes and CSS color classes; "Hide unchanged" toggle; "Open in editor" and "Save & re-approve" CTAs — make T055 pass
- [ ] T059 [P] [US4] Create `extensions/speckit-pilot/src/components/ArtifactEditor.tsx` — `<textarea>` with full artifact content, unsaved-changes dot indicator, Show diff / Discard changes / Save CTAs
- [ ] T060 [US4] Create `extensions/speckit-pilot/src/components/SaveConfirmDialog.tsx` — lists downstream phases that will be staled, "Approve in same step" checkbox, optional note, Cancel / Save CTAs
- [ ] T061 [US4] Integrate `ArtifactDiff` and `ArtifactEditor` into `PhaseDetail.tsx` — "Open diff" and "Edit" buttons visible for approved/modified phases; fetch artifact via `speckit:artifact-read` on open; wire save to `speckit:artifact-save`
- [ ] T062 [US4] Extend `fs.watch` handler in `index.ts` — when an `approved` phase's artifact hash diverges from `approvedHash`, call `transition(state, phase, 'external_edit')`, call `computeStalePhases`, write `state.json`, push `speckit:state-changed`

**Checkpoint**: Edit `plan.md` in editor → diff renders → save marks Plan modified → Tasks/Analyze stale → re-approve in same step works

---

## Phase 7: User Story 5 — Implement Run with Per-File Gate (Priority: P2)

**Goal**: Implement phase pauses before each proposed file write; developer reviews a diff and approves or skips. A checkpoint commit before the run ensures full rollback is always possible.

**Independent Test**: Start an Implement run. Verify a file change triggers the per-file gate diff, approving writes the file, skipping reverts it, stopping leaves already-approved files intact, and the pre-run checkpoint commit exists in git log.

### Tests for User Story 5

- [ ] T063 [US5] Write failing unit tests for `speckit:checkpoint-create`, `speckit:implement-file-decision`, `speckit:implement-stop` handlers in `extensions/speckit-pilot/tests/ipc/speckit.ipc.test.ts` — checkpoint creates a commit; file-decision approve = no-op; skip = git checkout; stop clears active run
- [ ] T064 [P] [US5] Write failing component tests for `ImplementFileGate.tsx` in `extensions/speckit-pilot/tests/components/ImplementFileGate.test.tsx` — diff renders, Approve calls onApprove, Skip calls onSkip, Stop calls onStop, "Approve next N" batch action present

### Implementation for User Story 5

- [ ] T065 [US5] Add `speckit:checkpoint-create` handler to `speckit.ipc.ts` — call `api.shell.exec({ command: 'git', args: ['add', '-A'], cwd })` then `api.shell.exec({ command: 'git', args: ['commit', '--allow-empty', '-m', '[SpecKit] checkpoint before implement run'], cwd })`; return `{ commitHash }` or `{ error }`
- [ ] T066 [US5] Add `speckit:implement-file-decision` handler to `speckit.ipc.ts` — `approve`: no-op + append `HistoryEntry {action:'file_approved'}`; `skip`: call `api.shell.exec git checkout -- <filePath>` + append `HistoryEntry {action:'file_skipped'}`; return `{ ok: true }`
- [ ] T067 [US5] Add `speckit:implement-stop` handler to `speckit.ipc.ts` — clear active run from in-memory run registry; append `HistoryEntry {action:'run_failed', note:'stopped by user'}`; return `{ ok: true }`
- [ ] T068 [US5] Add Implement-specific file-watch logic in `index.ts` — when Implement run is active, for each `fs:changed` event on non-artifact paths: compute diff via `api.shell.exec git diff HEAD -- <file>`; check disallowed-path globs; if allowed, emit `speckit:implement-file-proposal` push event with diff content; if disallowed, emit `speckit:implement-file-blocked`
- [ ] T069 [US5] Add disallowed-path glob matching in `index.ts` file-watch handler — compare changed `filename` against `PilotSettings.disallowedPaths` using `minimatch`; block and emit `speckit:implement-file-blocked` if matched
- [ ] T070 [US5] Add `PendingFileWrite` tracking in `speckit.store.ts` — add `addPendingWrite`, `resolveWrite(filePath, decision)`, `clearPendingWrites` actions; derive counts for progress bar
- [ ] T071 [P] [US5] Create `extensions/speckit-pilot/src/components/ImplementDashboard.tsx` — task table (task id, description, files, status), progress bar, elapsed time, estimated remaining, token count display, Pause/Stop/Open tasks.md actions
- [ ] T072 [P] [US5] Create `extensions/speckit-pilot/src/components/ImplementFileGate.tsx` — diff display (reuse `ArtifactDiff`), file path + new/modified label, Approve write / Skip this file / Stop run / Approve next N CTAs, keyboard hints (CmdOrCtrl+Shift+A/K/S) — make T064 pass
- [ ] T073 [US5] Create `extensions/speckit-pilot/src/components/DisallowedPathDialog.tsx` — shows blocked path, matched glob rule, Edit task / Skip task / Stop run CTAs
- [ ] T074 [US5] Integrate `ImplementDashboard` and `ImplementFileGate` into `PhaseDetail.tsx` for Implement phase — show dashboard when `running`, file gate overlay when `speckit:implement-file-proposal` received
- [ ] T075 [US5] Wire checkpoint creation into run trigger — before injecting Implement command, call `speckit:checkpoint-create`; if checkpoint fails, surface error toast and abort

**Checkpoint**: Implement run → checkpoint commit in git → file changes trigger per-file gate → approve writes / skip reverts → stop leaves approved files intact

---

## Phase 8: User Story 6 — Stale Propagation & Partial Re-Run (Priority: P3)

**Goal**: When an approved artifact is modified, all downstream phases are automatically marked stale. Developer sees a modal listing affected phases and can choose which to re-run.

**Independent Test**: Approve Specify and Plan, then re-approve Specify with a different artifact. Verify Plan, Checklist, Tasks, Analyze, and Implement all become stale, and the stale propagation modal offers targeted re-run options per phase.

### Tests for User Story 6

- [ ] T076 [US6] Write failing unit tests for `computeStalePhases()` full DAG traversal in `extensions/speckit-pilot/tests/state/phase-state-machine.test.ts` — modifying Specify stales Plan, Checklist, Tasks, Analyze, Implement; modifying Plan stales Checklist, Tasks, Analyze, Implement; modifying Clarify stales Plan and below
- [ ] T077 [P] [US6] Write failing component tests for `StalePropagationModal.tsx` in `extensions/speckit-pilot/tests/components/StalePropagationModal.test.tsx` — table lists stale phases, regenerate checkboxes present, Start queue / Re-approve only / Revert CTAs

### Implementation for User Story 6

- [ ] T078 [US6] Verify `computeStalePhases()` in `phase-state-machine.ts` fully traverses the 8-phase DAG (Constitution → Specify → Clarify → Plan → Checklist/Tasks → Analyze → Implement) — make T076 pass
- [ ] T079 [US6] Create `extensions/speckit-pilot/src/components/StalePropagationModal.tsx` — stale phase table with last-generated-against hash, per-phase Regenerate/Defer checkbox, Re-approve + queue / Re-approve only / Revert artifact CTAs — make T077 pass
- [ ] T080 [US6] Create `extensions/speckit-pilot/src/components/RunQueue.tsx` — ordered queue of pending phase runs and gate markers, each showing phase name, action (agent run / human gate), Start / Clear queue CTAs
- [ ] T081 [US6] Wire `StalePropagationModal` trigger — after `speckit:phase-approve` or `speckit:artifact-save` that changes an upstream hash and marks downstream phases stale, push `speckit:stale-propagated` event to renderer; renderer shows `StalePropagationModal`
- [ ] T082 [US6] Add "Mark stale-approved anyway" action to `PhaseDetail.tsx` stale state — calls `speckit:phase-approve` with current (unchanged) artifact hash

**Checkpoint**: Full stale propagation cycle works — approve upstream → downstream stale modal → queue selected re-runs → all gates still enforced

---

## Phase 9: User Story 7 — Audit History (Priority: P3)

**Goal**: Developer views a full chronological history of all phase events, filterable by phase and date. Any two runs of the same phase can be compared as a side-by-side diff.

**Independent Test**: Complete several phase cycles including a rejection and revocation. Open the history panel, verify all events appear with correct timestamps and actors, filter to a single phase, and compare two runs of that phase via diff.

### Tests for User Story 7

- [ ] T083 [US7] Write failing unit tests for `speckit:history-load` handler and `appendHistory` in `extensions/speckit-pilot/tests/ipc/speckit.ipc.test.ts` — valid JSONL parses to `HistoryEntry[]`; malformed lines are skipped; empty file returns `[]`
- [ ] T084 [P] [US7] Write failing component tests for `HistoryPanel.tsx` in `extensions/speckit-pilot/tests/components/HistoryPanel.test.tsx` — entries render in reverse-chronological order; phase filter hides non-matching entries; CSV export button present

### Implementation for User Story 7

- [ ] T085 [US7] Add `speckit:history-load` handler to `speckit.ipc.ts` — read `history.jsonl`, split by newline, parse each line as JSON (skip malformed), validate with `HistoryEntrySchema`, return `{ entries: HistoryEntry[] }` — make T083 pass
- [ ] T086 [US7] Create `extensions/speckit-pilot/src/components/HistoryPanel.tsx` — reverse-chronological timeline with icon, timestamp, actor, action, phase, hash columns; filter bar (phase dropdown, actor input, date-range picker); Export to CSV button — make T084 pass
- [ ] T087 [US7] Add CSV export action to `HistoryPanel.tsx` — serialize `HistoryEntry[]` to CSV string (headers + rows), create a Blob URL, trigger download via anchor click
- [ ] T088 [US7] Add per-phase run history view to `PhaseDetail.tsx` — "Runs" tab shows list of `RunRecord`s for that phase; "Compare" selector lets user pick two runs and renders `ArtifactDiff` between their artifacts fetched via `speckit:artifact-read`
- [ ] T089 [US7] Wire `HistoryPanel` into `LifecycleSidebar.tsx` — add "History" navigation tab at the bottom of the sidebar; loads entries via `speckit:history-load` on open

**Checkpoint**: History panel shows complete audit trail; run comparison diff works; CSV export downloads correctly

---

## Phase 10: User Story 2b — Clarify Q&A Interactive View (FR-020)

**Goal**: The Clarify phase surfaces each clarifying question inline in the sidebar. The developer answers questions one by one; answers are written back into `spec.md`'s Clarifications section before the phase can be approved.

**Independent Test**: Run `/speckit-clarify` from the sidebar. Verify the Q&A view renders the questions produced by Claude Code, answering each one enables the next, and clicking "Save answers to spec.md" writes the answers to `spec.md` and transitions the Clarify phase to `awaiting_review`.

### Tests for User Story 2b

- [ ] T103 [US2] Write failing component tests for `ClarifyQA.tsx` in `extensions/speckit-pilot/tests/components/ClarifyQA.test.tsx` — question list renders, answered questions show ✓ glyph, unanswered questions block Approve, "Save answers" calls onSave

### Implementation for User Story 2b

- [ ] T104 [US2] Add `speckit:clarify-answers-save` IPC handler to `speckit.ipc.ts` — receives `{ featureDir, answers: { question: string, answer: string }[] }`, writes each Q&A pair as a bullet under `## Clarifications / ### Session <date>` in `spec.md`, appends `HistoryEntry { action: 'approved', note: 'clarifications saved' }`, returns `{ ok: true }`
- [ ] T105 [US2] Create `extensions/speckit-pilot/src/components/ClarifyQA.tsx` — renders ordered list of `{ question, answer, resolved }` items; inline answer input (radio options + free-text); progress bar; "Save & next" per question; "Save answers to spec.md" CTA disabled until all resolved; "Approve all (skip remaining)" records skipped count in history — make T103 pass
- [ ] T106 [US2] Integrate `ClarifyQA` into `PhaseDetail.tsx` for the Clarify phase — parse questions from the Clarify artifact (spec.md Clarifications section) on panel open; show `ClarifyQA` instead of generic `ApprovalPanel` when phase is `awaiting_review`

**Checkpoint**: Clarify Q&A works end-to-end — questions rendered → answers entered → written to spec.md → phase approvable

---

## Phase 11: User Story 2c — Analyze Findings Table (FR-021)

**Goal**: The Analyze phase surfaces a findings table categorized by severity (HIGH, MED, LOW). HIGH findings block approval; MED warns; LOW is informational. Each finding has Fix and Skip actions.

**Independent Test**: Run `/speckit-analyze` from the sidebar. Verify findings are parsed and rendered in a table, a HIGH finding prevents the Approve button from activating, clicking Fix sends the finding context back to Claude Code, and skipping a HIGH finding records the skip in history.

### Tests for User Story 2c

- [ ] T107 [US2] Write failing unit tests for findings parser in `extensions/speckit-pilot/tests/state/analyze-parser.test.ts` — valid findings table parses to `Finding[]`; HIGH/MED/LOW severity assigned correctly; missing severity defaults to LOW
- [ ] T108 [P] [US2] Write failing component tests for `AnalyzeFindings.tsx` in `extensions/speckit-pilot/tests/components/AnalyzeFindings.test.tsx` — HIGH findings show red badge; Approve button disabled when unresolved HIGH findings exist; Fix routes to run console; Skip records decision

### Implementation for User Story 2c

- [ ] T109 [US2] Create `extensions/speckit-pilot/src/state/analyze-parser.ts` — `parseFindings(artifactContent: string): Finding[]` where `Finding = { id, severity: 'HIGH'|'MED'|'LOW', description, source, decision: 'open'|'fixed'|'skipped' }`; parse markdown table rows from the Analyze output artifact — make T107 pass
- [ ] T110 [P] [US2] Create `extensions/speckit-pilot/src/components/AnalyzeFindings.tsx` — findings table with ID, severity badge, description, source, Fix/Skip action buttons; bulk actions (Fix HIGH+MED, Skip all LOW); Approve & unlock Implement CTA disabled while any HIGH finding is `open`; skipping a HIGH finding requires a confirmation note — make T108 pass
- [ ] T111 [US2] Enforce severity gate in `speckit:phase-approve` handler — before approving Analyze phase, call `analyze-parser.ts` on the analyze artifact; if any `Finding` with `severity === 'HIGH'` has `decision === 'open'`, return `{ error: 'UNRESOLVED_HIGH_FINDINGS' }` with the blocking finding IDs
- [ ] T112 [US2] Integrate `AnalyzeFindings` into `PhaseDetail.tsx` for the Analyze phase — replace generic approval panel with findings table when phase is `awaiting_review` or `approved`; Fix action injects a targeted follow-up prompt into the Claude Code terminal

**Checkpoint**: Analyze phase renders findings table; HIGH findings block approval; Fix/Skip actions work; gate enforced in IPC handler

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Settings page, new-feature dialog, native menu integration, `minimatch` dependency, documentation, lint and build validation.

- [ ] T090 [P] Create `extensions/speckit-pilot/src/components/SettingsPage.tsx` — sections: General (model, branch convention, sidebar-on-start, console position), Gates & auto-approval (per-phase table with gate/auto-approve/per-file columns, hard limits, disallowed paths), Per-phase prompts, Audit log (location, retention, reviewer identity), Telemetry
- [ ] T091 Wire `SettingsPage` into `LifecycleSidebar.tsx` — add "Settings" navigation button; replace panel content with `SettingsPage` component; settings changes call `api.settings.get/register` keys
- [ ] T092 Add `speckit:feature-create` handler to `speckit.ipc.ts` — `mkdir -p specs/<name>`, optionally run `.specify/extensions/git/scripts/bash/create-new-feature.sh` via `api.shell.exec`, return `{ featureDir, branchName }`
- [ ] T093 [P] Create `extensions/speckit-pilot/src/components/NewFeatureDialog.tsx` — feature name input (shows resolved `specs/00N-<name>/` path), initial prompt textarea, "Create git branch" checkbox (default on), "Run /speckit-specify immediately" checkbox, Cancel / Create feature CTAs
- [ ] T094 Wire `NewFeatureDialog` into `LifecycleSidebar.tsx` — show when feature list is empty or "+" button clicked; on create, call `speckit:feature-create`, then `speckit:initialize`, update store
- [ ] T095 [P] Register `api.settings.register` in `index.ts` for all `terminator.speckit-pilot.*` settings keys from plan.md settings registration table
- [ ] T096 [P] Update `docs/ARCHITECTURE.md` — add "SpecKit Pilot Extension" section: purpose, extension structure, key IPC channels, file-watcher logic, state persistence
- [ ] T097 [P] Update `README.md` features list — add SpecKit Pilot with short description and link to `specs/004-speckit-pilot-extension/`
- [ ] T098 [P] Update `specs/001-extension-first-terminal/contracts/ipc-channels.md` — add reference to `speckit:` namespace and link to `specs/004-speckit-pilot-extension/contracts/ipc-channels-speckit.md`
- [ ] T099 [P] Run `npm run lint` from repo root; fix all errors to zero (unused imports, type errors, missing return types)
- [ ] T100 [P] Run `npm run build:extensions` from repo root; fix all TypeScript compilation errors; confirm `extensions/speckit-pilot/src/index.js` is gitignored
- [ ] T101 Run `npm run test -- --project=speckit-pilot`; fix all Vitest test failures
- [ ] T102 Follow `quickstart.md` steps end-to-end in a running Terminator dev instance — open sidebar, create a feature, run Specify phase, approve, verify history.jsonl entry written

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
- **US1 Lifecycle View (Phase 3)**: Depends on Foundational
- **US2 Approval Gates (Phase 4)**: Depends on Foundational; integrates with US1 `PhaseDetail`
- **US3 Run Phase (Phase 5)**: Depends on Foundational; integrates with US1 `PhaseDetail`
- **US4 Artifact Editing (Phase 6)**: Depends on Foundational; integrates with US1 `PhaseDetail` and US2 approval flow
- **US5 Implement Gate (Phase 7)**: Depends on US3 run trigger, US4 diff component
- **US6 Stale Propagation (Phase 8)**: Depends on state machine from Foundational (computeStalePhases already implemented); integrates with US2 approval
- **US7 Audit History (Phase 9)**: Depends on Foundational history persistence only — largely independent
- **Polish (Phase 10)**: Depends on all user stories complete

### User Story Dependencies

- **US1 (P1)**: Can start immediately after Foundational — no other story dependencies
- **US2 (P1)**: Can start after Foundational — integrates with US1's `PhaseDetail` component
- **US3 (P2)**: Can start after Foundational — integrates with US1's `PhaseDetail`
- **US4 (P2)**: Can start after Foundational — reuses US2 approval flow
- **US5 (P2)**: Requires US3 run trigger (T049) and US4 `ArtifactDiff` component (T058)
- **US6 (P3)**: State machine work (T076–T078) parallelizable with US5; modal requires US1 `PhaseDetail`
- **US7 (P3)**: Fully independent of US3–US6; can run in parallel with any of them

### Within Each User Story

- Tests MUST be written and confirmed failing before implementation tasks begin
- Types/schemas before components
- IPC handlers before renderer integration
- Core component before integration into `PhaseDetail`

---

## Parallel Opportunities

```bash
# Phase 2 — Foundational (after T005, T006):
T007 types  +  T008 schemas  +  T012 hash tests  +  T013 hash impl  ← all different files

# Phase 3 — US1 (after Foundational):
T024 PhaseRow tests  +  T025 LifecycleSidebar tests  ← parallel test writing
T026 PhaseRow impl   +  T028 PhaseDetail stub         ← parallel component impl

# Phase 4 — US2 (after Foundational):
T037 ApprovalPanel tests  +  T039 RejectDialog  +  T040 RevokeDialog  ← parallel

# Phase 5 — US3 (after Foundational):
T044 timeout tests  +  T047 RunPromptDialog  +  T048 RunConsole  ← parallel component work

# Phase 6 — US4 (after Foundational):
T058 ArtifactDiff  +  T059 ArtifactEditor  ← parallel (different components)

# Phase 7 — US5 (after US3 + US4):
T071 ImplementDashboard  +  T072 ImplementFileGate  ← parallel components

# Phase 10 — Polish:
T096 ARCHITECTURE.md  +  T097 README.md  +  T098 ipc-channels.md
+  T099 lint  +  T100 build  ← all parallel
```

---

## Implementation Strategy

### MVP (User Stories 1 + 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (state machine, persistence, file watcher, IPC skeleton)
3. Complete Phase 3: US1 Lifecycle View
4. Complete Phase 4: US2 Approval Gates
5. **STOP and VALIDATE**: Lifecycle sidebar shows accurate state; approve/reject/revoke write history; downstream phases lock/unlock correctly
6. Demonstrate working gate flow end-to-end

### Incremental Delivery

1. Setup + Foundational → extension loads, IPC handlers respond
2. - US1 → sidebar shows live phase state (read-only MVP)
3. - US2 → full gate flow (approve/reject/revoke) — core value delivered
4. - US3 → run phases directly from sidebar
5. - US4 → edit artifacts inline with diff
6. - US5 → Implement per-file gate + safety net
7. - US6 → stale propagation management
8. - US7 → audit history panel

---

## Notes

- [P] tasks have different target files and no unresolved dependencies — safe to run in parallel
- [US*] labels map each task to its user story for traceability
- TDD is mandatory per constitution: test task → confirm red → implement → green
- Commit after each phase checkpoint or logical group
- `extensions/speckit-pilot/src/index.js` is a build artifact — must be in `.gitignore`, never committed
- All new `speckit:*` IPC channels must be listed in `contracts/ipc-channels-speckit.md` before implementation
- `window.electronAPI.terminal.input` usage in renderer is intentional — it is the published preload surface, not an internal import
