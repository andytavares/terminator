---
description: 'Task list for MergeFlow — Merge Conflict Resolver'
---

# Tasks: MergeFlow — Merge Conflict Resolver

**Input**: Design documents from `specs/006-mergeflow-conflict-resolver/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Per the project constitution (Principle VI: TDD is NON-NEGOTIABLE), tests MUST be written before implementation. Write failing tests first — Red → Green → Refactor.

**Organization**: Tasks grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: User story this task belongs to (US1–US8 maps to spec.md)
- TDD: test tasks must be completed (RED) before their paired implementation task (GREEN)

---

## Phase 1: Setup

**Purpose**: Create the new directory structure and wire the store field that all subsequent tasks depend on.

- [x] T001 Create `extensions/git-integration/src/components/merge-flow/` directory and empty `merge-flow.css` scaffold
- [x] T002 Add `view: 'default' | 'merge-flow'` field and `setView()` action to `extensions/git-integration/src/stores/git.store.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Data schemas, git conflict reader, IPC handlers, renderer API bridge, and Zustand store. All user story UI work blocks on this phase.

**⚠️ CRITICAL**: No user story phase can begin until T012 is complete.

### Schemas

- [x] T003 Write failing tests for all Zod schemas in `extensions/git-integration/tests/unit/merge-flow-schema.spec.ts` (GitAuthor, ConflictBlock, ConflictFile, ConflictResolution, ResolutionDecision, ConflictSession, AISuggestion — parse valid + reject invalid)
- [x] T004 Implement `extensions/git-integration/src/schemas/merge-flow.schema.ts` (all 7 Zod schemas, export inferred TypeScript types) — GREEN for T003

### Conflict Reader (main process)

- [x] T005 [P] Write failing tests for conflict detection and block parsing in `extensions/git-integration/tests/unit/conflict-reader.spec.ts` (mock execFile: list conflicted files, read :1:/:2:/:3: stages, extract context lines, detect REBASE_HEAD, parse author info from git log)
- [x] T006 Implement `extensions/git-integration/src/git/conflict-reader.ts` (git diff --diff-filter=U, git show :N:file, context extraction, rebase detection, author parsing, extract conflict description text from `git log --format=%s -1 HEAD -- <file>` and `git log --format=%s -1 MERGE_HEAD -- <file>` commit subject lines, return ConflictFile[] ordered by conflict count) — GREEN for T005

### IPC Handlers

- [x] T007 [P] Write failing tests for all 9 IPC channels in `extensions/git-integration/tests/unit/merge-flow-ipc.spec.ts` (valid payloads → correct delegation; invalid payloads → VALIDATION_ERROR; runtime errors → { error: string }; git:merge-ai-suggest → NOT_IMPLEMENTED; all 9 channels: git:conflicts-list, git:conflict-blocks, git:resolve-conflict, git:undo-resolve, git:merge-commit, git:merge-ai-suggest, git:session-restore, git:session-persist, git:session-clear)
- [x] T008 Implement `extensions/git-integration/src/ipc/merge-flow.ipc.ts` (registerMergeFlowHandlers: all 9 channels — git:conflicts-list, git:conflict-blocks, git:resolve-conflict, git:undo-resolve, git:merge-commit, git:merge-ai-suggest stub, git:session-restore, git:session-persist, git:session-clear) — GREEN for T007
- [x] T009 Modify `extensions/git-integration/src/ipc/git.ipc.ts` to import and call `registerMergeFlowHandlers(register)` after existing handler registrations

### Renderer API Bridge

- [x] T010 [P] Implement `extensions/git-integration/src/api/merge-flow.ts` (mergeFlowAPI object: thin wrappers over extensionBridge.invoke for all 9 channels)

### Zustand Store

- [x] T011 [P] Write failing tests for the MergeFlow store in `extensions/git-integration/tests/unit/merge-flow.store.spec.ts` (startSession, clearSession, setActiveFile, setActiveBlock, goToNextBlock, goToPrevBlock, confirmDecision, undoLastDecision on empty stack = null, undoLastDecision across files, isComplete derived value, canUndo derived value, openKeepBoth/closeKeepBoth, openAiPanel/closeAiPanel)
- [x] T012 Implement `extensions/git-integration/src/stores/merge-flow.store.ts` (full store interface from contracts/extension-api.md: session lifecycle, navigation, undo stack, modal state, derived selectors) — GREEN for T011

**Checkpoint**: Foundation complete — all user story phases can now begin

---

## Phase 3: User Story 1 — Conflict Hub (Priority: P1) 🎯 MVP

**Goal**: Developer opens MergeFlow after a failed `git merge` and sees all conflicted files ordered by complexity, with progress bar, author info, and a disabled commit button.

**Independent Test**: Launch MergeFlow against a repo with staged conflicts; verify the hub renders all files sorted by conflict count, shows correct author info, and the "Commit merge" button is disabled.

### Tests for US1 (write first — must FAIL before implementation)

- [x] T013 Write failing tests for MergeFlowView session init in `extensions/git-integration/tests/unit/MergeFlowView.spec.tsx` (restoreSession called on mount → renders hub when session exists; listConflicts called when no prior session; routes to resolver when activeFile set; routes to completion when isComplete)
- [x] T014 [P] Write failing tests for ConflictHub in `extensions/git-integration/tests/unit/ConflictHub.spec.tsx` (renders all files sorted by conflictCount desc; shows conflict count badge, both author names, complexity dot; progress bar shows 0/N; "Commit merge" button disabled when totalResolved < totalConflicts; resolved files appear in Resolved section; recommendation callout shows first file)

### Implementation for US1

- [x] T015 Modify `extensions/git-integration/src/components/GitSidebarPanel.tsx` — add "Resolve conflicts →" button that calls `gitStore.setView('merge-flow')` when `status.hasConflicts === true`
- [x] T016 Modify `extensions/git-integration/src/components/GitFullView.tsx` — add `view === 'merge-flow'` branch rendering `<MergeFlowView repoRoot={repoRoot} />`
- [x] T017 Implement `extensions/git-integration/src/components/merge-flow/MergeFlowView.tsx` (on mount: call restoreSession → startSession if found, else listConflicts → startSession; route to ConflictHub / ConflictResolver / CompletionScreen based on store state; surface errors via useToastStore) — GREEN for T013
- [x] T018 Implement `extensions/git-integration/src/components/merge-flow/ConflictHub.tsx` (summary bar with totalFiles/totalConflicts/estimatedMinutes; file list sorted by conflictCount desc; per-file: path, type badge, conflict count, author names, complexity dot; progress bar; recommendation callout for first file; "Commit merge" button disabled until isComplete; resolved section at bottom) — GREEN for T014

**Checkpoint**: User Story 1 fully functional — conflict hub renders, entry point works, progress bar live

---

## Phase 4: User Story 2 — Conflict Resolver (Priority: P1)

**Goal**: Developer clicks a file and resolves conflicts one at a time with a two-panel diff view, live result preview, and "Confirm & next" flow.

**Independent Test**: Open a single conflicted file with 2 conflicts; walk through "Keep mine" then "Keep theirs"; verify result preview updates on hover, confirmation advances to the next conflict, and the file is marked resolved after the last one.

### Tests for US2 (write first — must FAIL before implementation)

- [x] T019 Write failing tests for ConflictHeader in `extensions/git-integration/tests/unit/ConflictHeader.spec.tsx` (renders one dot per block: green/blue/gray; undo button disabled when canUndo === false, enabled otherwise; back link present; conflict description text rendered)
- [x] T020 [P] Write failing tests for ConflictPanel in `extensions/git-integration/tests/unit/ConflictPanel.spec.tsx` (renders author name, branch badge, commit hash, timestamp for both sides; context lines have dimmed CSS class; added lines have highlight CSS class; no text containing "<<<<<<<", "=======", or ">>>>>>>" appears in output)
- [x] T021 [P] Write failing tests for ResultPreviewStrip in `extensions/git-integration/tests/unit/ResultPreviewStrip.spec.tsx` (shows placeholder text when no preview; updates content when previewText prop changes; expands/highlights when confirmed=true)
- [x] T022 [P] Write failing tests for ActionBar in `extensions/git-integration/tests/unit/ActionBar.spec.tsx` (5 buttons rendered with keyboard labels M/T/B/E/Cmd+Shift+A; AI button displays visible `[Cmd+Shift+A]` keyboard hint text; onHoverMine/onHoverTheirs fire on mouseenter; onClick fires with correct strategy; hover calls onPreview with correct text; no button is pre-selected on mount)
- [x] T023 [P] Write failing tests for ConflictResolver in `extensions/git-integration/tests/unit/ConflictResolver.spec.tsx` (shows sub-components; no selection → Confirm button absent; after selection → Confirm button present; Confirm calls resolveConflict + confirmDecision + persistSession + advances; last conflict confirmed → navigates; Enter with no selection → no-op with prompt; Esc closes open modal)

### Implementation for US2

- [x] T024 Implement `extensions/git-integration/src/components/merge-flow/ConflictHeader.tsx` (progress dots, breadcrumb with file path, "← All files" back button, undo button wired to store canUndo, conflict description text from block metadata) — GREEN for T019
- [x] T025 [P] Implement `extensions/git-integration/src/components/merge-flow/ConflictPanel.tsx` (two-column layout; left="Your change", right="Their change"; author name, branch badge, commit hash, timestamp per column; line-by-line rendering: context=dimmed, added=highlighted green/blue; no conflict markers) — GREEN for T020
- [x] T026 [P] Implement `extensions/git-integration/src/components/merge-flow/ResultPreviewStrip.tsx` (placeholder state; updates live on previewText prop; expands with confirmed content) — GREEN for T021
- [x] T027 Implement `extensions/git-integration/src/components/merge-flow/ActionBar.tsx` (Keep mine [M], Keep theirs [T], Keep both [B], Edit manually [E], Ask AI to suggest [Cmd+Shift+A]; onHover → onPreview callback; onClick → onSelect callback; no autocomplete) — GREEN for T022
- [x] T028 Implement `extensions/git-integration/src/components/merge-flow/ConflictResolver.tsx` (compose Header + Panel + Strip + ActionBar; previewSelection on hover; activeSelection on click; "Confirm & next →" appears after selection; on confirm: resolveConflict → confirmDecision → persistSession → advance; Esc closes modals; no-op Enter guard) — GREEN for T023

**Checkpoint**: User Story 2 fully functional — single-conflict resolution flow works end-to-end

---

## Phase 5: User Story 8 — Completion + Commit (Priority: P1)

**Goal**: After the last conflict is confirmed, developer sees a summary screen with stats and commits the merge in one click.

**Independent Test**: Resolve all conflicts in a test repo; verify completion screen loads with correct stats, commit message is editable, and clicking "Commit merge →" produces a successful git commit with all resolved files staged.

### Tests for US8 (write first — must FAIL before implementation)

- [x] T029 Write failing tests for CompletionScreen in `extensions/git-integration/tests/unit/CompletionScreen.spec.tsx` (renders success headline; shows totalConflicts, time taken, per-file strategy breakdown; commit message input is editable and pre-filled; "Commit merge →" calls mergeCommit → on success: clearSession called + success toast shown + session NOT cleared on failure; "Review changes" opens diff view; error toast displayed with failure reason when commit fails; completion screen stays mounted on failure)

### Implementation for US8

- [x] T030 Implement `extensions/git-integration/src/components/merge-flow/CompletionScreen.tsx` (success icon + headline; time elapsed from session.startedAt; totalConflicts count; per-strategy summary counts; per-file breakdown table; editable commit message input pre-filled from MERGE_MSG when available; "Review changes" → FileDiffView; "Commit merge →" → mergeCommit → success: clearSession + toast; failure: error toast + stay on screen) — GREEN for T029

**Checkpoint**: Full P1 MVP complete — hub → resolver → commit flow works end-to-end

---

## Phase 6: User Story 3 — Keyboard-First Navigation (Priority: P2)

**Goal**: Developer resolves all conflicts without touching the mouse using M/T/B/E/Enter/←/→/Cmd+Z/Cmd+Shift+A/Esc.

**Independent Test**: Resolve a 5-conflict file entirely via keyboard; verify each shortcut triggers the correct action and Cmd+Z restores the previous state.

### Tests for US3 (write first — must FAIL before implementation)

- [x] T031 Add keyboard shortcut tests to `extensions/git-integration/tests/unit/ConflictResolver.spec.tsx` (keydown M → selects mine + preview updates; keydown T → selects theirs; keydown B → opens KeepBothModal; keydown E → opens ManualEditor; keydown Enter with active selection → confirms + advances; keydown ArrowLeft → goToPrevBlock; keydown ArrowRight → goToNextBlock; keydown Cmd+Z → undoLastDecision; keydown Cmd+Shift+A → opens AI panel; keydown Esc → closes open panel; shortcuts disabled when modal is open)

### Implementation for US3

- [x] T032 Add `useEffect` keyboard event listener to `extensions/git-integration/src/components/merge-flow/ConflictResolver.tsx` (register keydown handler for all 10 shortcuts; guard shortcuts when modal/panel open; clean up listener on unmount) — GREEN for T031
- [x] T033 Update `extensions/git-integration/src/components/merge-flow/ActionBar.tsx` to display `[Cmd+Shift+A]` label on the AI suggestion button (keyboard hint visible in UI; covered by T022 test which already asserts this label)

**Checkpoint**: User Story 3 complete — full keyboard resolution flow verified

---

## Phase 7: User Story 4 — Undo (Priority: P2)

**Goal**: Developer can undo any decision from anywhere in the session, including decisions made in a previously visited file.

**Independent Test**: Resolve 3 conflicts, navigate to a second file, then undo; verify the last decision (from the first file) is reversed and the correct conflict is shown in its unresolved state.

### Tests for US4 (write first — must FAIL before implementation)

- [x] T034 Add cross-file undo tests to `extensions/git-integration/tests/unit/merge-flow.store.spec.ts` (confirm decisions in file A, navigate to file B, undoLastDecision → resolvedCount for file A decremented; undo on empty stack returns null; undo reverses only the most recent decision regardless of current activeFile)
- [x] T035 Add undo button wiring tests to `extensions/git-integration/tests/unit/ConflictHeader.spec.tsx` (undo button click calls store undoLastDecision and mergeFlowAPI.undoResolve with correct blockId and originalConflictText; button disabled when canUndo === false)

### Implementation for US4

- [x] T036 Wire undo button in `extensions/git-integration/src/components/merge-flow/ConflictHeader.tsx` (onClick: call store.undoLastDecision() → if decision returned, call mergeFlowAPI.undoResolve(repoRoot, decision.blockId, originalConflictText) → navigate to the undone block's file/index) — GREEN for T034, T035

**Checkpoint**: User Story 4 complete — cross-session undo works end-to-end

---

## Phase 8: User Story 5 — Keep Both Modal (Priority: P2)

**Goal**: Developer keeps both versions of a conflict and chooses their order via a draggable modal with a live merged preview.

**Independent Test**: Trigger "Keep both" on a conflict; verify the modal shows both blocks, toggling order updates the preview, a duplicate identifier warning appears when applicable, and confirming produces the correctly ordered merged output.

### Tests for US5 (write first — must FAIL before implementation)

- [x] T037 Write failing tests for KeepBothModal in `extensions/git-integration/tests/unit/KeepBothModal.spec.tsx` (renders both code blocks with author headers; "Mine first" toggle sets order to ours-first; "Theirs first" toggle updates merged preview to theirs-above-mine; duplicate function/class name in combined output triggers warning; "Cancel" closes modal without setting selection; "Use this order →" calls onConfirm with correct resolvedText; "Let AI merge these" shows NOT_IMPLEMENTED toast)

### Implementation for US5

- [x] T038 Implement `extensions/git-integration/src/components/merge-flow/KeepBothModal.tsx` (modal overlay; two draggable code block cards with drag-handle grips; Mine first/Theirs first toggle; live merged preview; duplicate-identifier regex warning; Cancel / Let AI merge these (NOT_IMPLEMENTED toast) / Use this order → buttons; onConfirm callback with resolvedText) — GREEN for T037
- [x] T039 Wire KeepBothModal into `extensions/git-integration/src/components/merge-flow/ConflictResolver.tsx` (render when isKeepBothOpen; pass activeBlock ours/theirs text; on confirm: set activeSelection with resolvedText + strategy 'both-\*'; close modal)

**Checkpoint**: User Story 5 complete — Keep Both modal works with order selection and live preview

---

## Phase 9: User Story 7 — Manual Edit (Priority: P2)

**Goal**: Developer directly edits the conflict output in a minimal single-editor mode pre-populated with the heuristically better version.

**Independent Test**: Open a conflict, click "Edit manually," modify the pre-populated code, and confirm; verify the custom output is stored as the resolution.

### Tests for US7 (write first — must FAIL before implementation)

- [x] T040 Write failing tests for ManualEditor in `extensions/git-integration/tests/unit/ManualEditor.spec.tsx` (pre-populates with longer block when blocks differ in length; pre-populates with theirs when blocks are equal length; no conflict markers in pre-populated content; user edit changes onSave callback value; "Save & next →" calls onSave with current textarea content; unchanged content from pre-fill still calls onSave correctly)

### Implementation for US7

- [x] T041 Implement `extensions/git-integration/src/components/merge-flow/ManualEditor.tsx` (single textarea pre-populated via heuristic: longer block wins, theirs on tie; conflict markers stripped from pre-populated content; highlight.js applied for syntax highlighting; no autocomplete or linting; "Save & next →" button calls onSave with current value) — GREEN for T040
- [x] T042 Wire ManualEditor into `extensions/git-integration/src/components/merge-flow/ConflictResolver.tsx` (replace ConflictPanel with ManualEditor when edit-manually mode active; on save: set activeSelection with manual content + strategy 'manual'; return to normal view on cancel)

**Checkpoint**: User Story 7 complete — manual edit mode works with correct pre-population heuristic

---

## Phase 10: User Story 6 — AI Suggestion Panel (Priority: P3)

**Goal**: Developer requests an AI resolution suggestion via Cmd+Shift+A; panel shows reasoning, code, and confidence; AI runs locally with no data leaving the machine (stub in this scope).

**Independent Test**: Trigger AI suggestion on a conflict; verify the panel opens, the NOT_IMPLEMENTED placeholder is shown, and dismiss closes the panel without changing conflict state.

### Tests for US6 (write first — must FAIL before implementation)

- [x] T043 Write failing tests for AiSuggestionPanel in `extensions/git-integration/tests/unit/AiSuggestionPanel.spec.tsx` (when NOT_IMPLEMENTED: renders "AI suggestions coming soon" placeholder and dismiss button; "Dismiss" calls onDismiss and does not call onAccept; when AISuggestion provided: renders reasoning, code block, confidence score with label; "Accept suggestion" calls onAccept with suggestedText; "Edit suggestion before accepting" calls onEdit with suggestedText; background diff opacity reduced while panel mounted)

### Implementation for US6

- [x] T044 Implement `extensions/git-integration/src/components/merge-flow/AiSuggestionPanel.tsx` (right-side panel; loading state while IPC in-flight; NOT_IMPLEMENTED: "AI suggestions coming soon" + dismiss; AISuggestion present: reasoning section, syntax-highlighted code block, confidence score + risk label, Accept / Edit suggestion before accepting / Dismiss buttons) — GREEN for T043
- [x] T045 Wire AiSuggestionPanel into `extensions/git-integration/src/components/merge-flow/ConflictResolver.tsx` (open on Cmd+Shift+A: call mergeFlowAPI.requestAiSuggestion → store openAiPanel(suggestion); render panel with 60% opacity dim on diff behind; on accept: set activeSelection with AI text + strategy 'ai'; on edit: open ManualEditor pre-populated with AI text; on dismiss: closeAiPanel)

**Checkpoint**: User Story 6 complete — AI panel stub works; ready for Phase 3 AI implementation later

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, full CSS pass, and quality gate enforcement.

- [x] T046 [P] Update `specs/002-git-github-integration/contracts/ipc-channels-git.md` — append reference to `specs/006-mergeflow-conflict-resolver/contracts/ipc-channels.md` for the 8 new MergeFlow IPC channels
- [x] T047 [P] Update `docs/ARCHITECTURE.md` — add MergeFlow as a subsystem of the git-integration extension; document session lifecycle (open → resolve → commit → clear)
- [x] T048 [P] Update `README.md` — add MergeFlow to features list; add keyboard shortcut table (M, T, B, E, Enter, ←/→, Cmd+Z, Cmd+Shift+A, Esc)
- [x] T049 Complete `extensions/git-integration/src/components/merge-flow/merge-flow.css` — full scoped styles: file list rows, complexity dots (red/yellow/green), progress bar, two-column diff panels (context opacity 50%, yours=green, theirs=blue), progress dots (gray/blue/green), action bar button layout, modal overlay, AI panel slide-in, completion screen layout
- [x] T050 Run `npm run format` from repo root — fix any formatting issues (0 errors required)
- [x] T051 Run `npm run lint` from repo root — fix any lint errors (0 errors required per constitution)
- [x] T052 Run `npx vitest run --coverage` from repo root — verify all thresholds ≥ 80% (statements, branches, functions, lines); fix any failures before marking done
- [x] T053 Run `npm run build:extensions` — verify extension compiles cleanly with no TypeScript errors

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **BLOCKS all user story phases**
- **Phase 3 (US1)**: Depends on Phase 2 completion
- **Phase 4 (US2)**: Depends on Phase 3 (resolver needs hub's routing in place)
- **Phase 5 (US8)**: Depends on Phase 4 (completion screen follows resolver flow)
- **Phase 6 (US3)**: Depends on Phase 4 (adds keyboard listeners to ConflictResolver)
- **Phase 7 (US4)**: Depends on Phase 4 (adds undo wiring to ConflictHeader)
- **Phase 8 (US5)**: Depends on Phase 4 (KeepBothModal wired into ConflictResolver)
- **Phase 9 (US7)**: Depends on Phase 4 (ManualEditor wired into ConflictResolver)
- **Phase 10 (US6)**: Depends on Phase 4 (AiSuggestionPanel wired into ConflictResolver)
- **Phase 11 (Polish)**: Depends on all desired stories complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — no dependency on other stories
- **US2 (P1)**: Depends on US1 (needs hub routing and entry point)
- **US8 (P1)**: Depends on US2 (completion screen is end of resolver flow)
- **US3 (P2)**: Depends on US2 (adds to ConflictResolver, no new files)
- **US4 (P2)**: Depends on US2 (adds undo wiring to ConflictHeader)
- **US5 (P2)**: Depends on US2 (KeepBothModal mounted inside ConflictResolver)
- **US7 (P2)**: Depends on US2 (ManualEditor replaces ConflictPanel inside ConflictResolver)
- **US6 (P3)**: Depends on US2 (AiSuggestionPanel mounted inside ConflictResolver)
- **US5, US6, US7 can be worked in parallel** after US2 is complete (each adds a different component to ConflictResolver with no shared file conflicts)

### Within Each Phase

1. Write test file → confirm it FAILS
2. Implement production code → confirm tests PASS
3. Run lint + format check
4. Move to next task

---

## Parallel Opportunities

### Phase 2 (Foundational) — parallel within phase

```
T003 (schema tests)        → T004 (schema impl)
T005 (reader tests)   [P]  → T006 (reader impl)
T007 (IPC tests)      [P]  → T008 (IPC impl)
T011 (store tests)    [P]  → T012 (store impl)
T010 (API bridge)     [P]  (no test needed — thin wrapper)
```

### Phase 4 (US2) — parallel within tests then parallel within impl

```
T019 (Header tests)          T020 (Panel tests)   [P]
T021 (Strip tests)   [P]     T022 (ActionBar tests) [P]
T023 (Resolver tests) [P]

→ then parallel impl:
T024 (Header impl)    T025 (Panel impl) [P]  T026 (Strip impl) [P]
T027 (ActionBar impl)
→ T028 (Resolver impl — composes above, must be last in phase)
```

### Phases 8, 9, 10 — parallel after Phase 4

```
Phase 8 (US5 — KeepBothModal)    ← different files
Phase 9 (US7 — ManualEditor)     ← different files
Phase 10 (US6 — AiSuggestionPanel) ← different files
```

Each of T037–T042 and T043–T044 can proceed simultaneously with different developers.

---

## Implementation Strategy

### MVP First (P1 stories only — Phases 1–5)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks everything)
3. Complete Phase 3: US1 — Conflict Hub
4. Complete Phase 4: US2 — Conflict Resolver
5. Complete Phase 5: US8 — Completion + Commit
6. **STOP AND VALIDATE**: Full hub → resolve → commit flow works end-to-end
7. Run quality gate (T050–T053)

### Full Delivery (add P2 + P3)

After MVP is validated:

- Phase 6 (US3 keyboard), Phase 7 (US4 undo) — extend ConflictResolver in sequence
- Phase 8, 9, 10 (US5/US7/US6) — can be done in parallel (different files)
- Phase 11 (Polish) — documentation + quality gate

---

## Notes

- [P] tasks = different files with no shared dependencies — safe to parallelize
- [Story] label maps each task to a specific user story for traceability
- TDD is non-negotiable per constitution Principle VI — each test task must produce a RED state before its paired impl task
- Run `npx vitest run --coverage` after each phase to catch regressions early
- Session persistence (electron-store reads/writes in IPC handlers) is covered by T007/T008 — no separate task needed
- The `git:merge-ai-suggest` IPC handler intentionally returns `{ error: 'NOT_IMPLEMENTED' }` — this is correct behaviour for this scope, not a bug
- Binary file handling is covered by the conflict-reader (T005/T006): binary files are detected via `isBinary: true` on `ConflictFile` and excluded from block parsing; ConflictHub renders them with placeholder + external tool link (no separate task — part of T018)
