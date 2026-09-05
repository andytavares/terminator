---
description: 'Task list for 036-extension-ux-remediation'
---

# Tasks: One UI Floor for Every Extension

**Input**: Design documents from `/specs/036-extension-ux-remediation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: REQUIRED, not optional. Constitution VI is non-negotiable and states that for bug
fixes "the Red → Green → Refactor cycle is mandatory without exception" — every finding here is
a defect. FR-042 additionally requires the Escape, modal and contrast behaviours be pinned by
tests that drive the running app, because the class of defect being fixed is invisible to unit
tests asserting on mocked collaborators.

**Organization**: Grouped by user story so each is independently implementable and shippable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: The user story this serves (US1–US8)

## Path Conventions

Desktop Electron app with a first-party extension host. Core at `src/`, shared packages at
`packages/`, extensions at `extensions/<name>/src/`, tests at `tests/unit/` and `tests/e2e/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Make a shared runtime package resolvable by the core app and all five extensions.

- [x] T001 Add `"packages/*"` to the `workspaces` array in `package.json` (currently `["extensions/*"]`, which is why a shared package cannot resolve today)
- [x] T002 Create the package scaffold at `packages/extension-ui/package.json` with `react` and `react-dom` as **peerDependencies** (never dependencies — each extension bundles its own copy), plus `main`, `types` and a build script
- [x] T003 [P] Add `packages/extension-ui/tsconfig.json` extending the repo's base config, and register it in the root `tsconfig.json` references
- [x] T004 [P] Add `packages/extension-ui/vite.config.ts` producing an ES build with `react`/`react-dom` externalised
- [x] T005 [P] Declare `@terminator/extension-ui` as a dependency in each of `extensions/{git-integration,notepad,remote-control,speckit-pilot,task-vault}/package.json` (Constitution II: each extension declares what it needs in its own manifest)
- [x] T006 Declare `@terminator/extension-ui` as a dependency of the core renderer in the root `package.json`
- [x] T007 [P] Add `packages/extension-ui/**` to the coverage `include` globs in `vitest.config.ts` so the 80% patch gate applies to the new package
- [x] T008 Run `npm install` and confirm workspace resolution, then `npm run build` to confirm the empty package builds and links

**Checkpoint**: A shared runtime package exists and every consumer can import it.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure pieces every story below depends on. Written as pure functions taking
inputs as parameters (Constitution XI) so they are exhaustively testable without a DOM.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [x] T009 [P] Write the failing unit spec for the layer scale in `tests/unit/packages/extension-ui/layers.spec.ts` covering the four-layer ordering and the nesting rule (a surface opened from another resolves above it)
- [x] T010 [P] Write the failing unit spec for modal depth in `tests/unit/packages/extension-ui/modal-depth.spec.ts` covering increment on open, decrement on close, floor at zero, and cleanup when a component throws during render
- [x] T011 [P] Write the failing unit spec for the Escape decision function in `tests/unit/shared/double-escape.spec.ts` covering all four suppression cases (terminal, text field, open modal, otherwise exit)
- [x] T012 [P] Implement the layer scale in `packages/extension-ui/src/layers.ts` per `contracts/layer-scale.md` — pure, no DOM access
- [x] T013 [P] Implement the per-document modal depth counter in `packages/extension-ui/src/useModalDepth.ts` per data-model §1
- [x] T014 Extend `src/shared/double-escape.ts` with a pure `shouldExitExtension(event, context)` decision function carrying the three guards; keep the existing detector API intact so nothing breaks yet
- [x] T015 Publish the layer scale as `--tm-layer-*` custom properties in `src/renderer/styles.css` alongside the existing `--tm-*` token block

**Checkpoint**: Foundation ready — user stories can begin.

---

## Phase 3: User Story 1 - Escape never destroys work (Priority: P1) 🎯 MVP

**Goal**: Typing in any extension field and pressing Escape twice never closes the extension or
discards the text, while the deliberate exit gesture keeps working.

**Independent Test**: Focus a text field inside any extension, type a value, press Escape twice
within 500 ms — the extension is still open and the text intact. Then confirm the exit gesture
still fires when nothing has claimed the key.

### Tests for User Story 1 ⚠️ Write first, confirm they FAIL

- [x] T016 [P] [US1] Write the failing end-to-end spec `tests/e2e/extension-escape.spec.ts` reproducing the current defect — type into SpecKit's search field, send two Escapes 100 ms apart into the extension's `webContents`, assert the extension is still showing and the field's value is unchanged
- [x] T017 [P] [US1] Extend `tests/e2e/extension-escape.spec.ts` with the four remaining cases from quickstart US1: terminal focus, single Escape closing a dialog, double Escape with a dialog open, and the preserved exit when nothing claims the key

### Implementation for User Story 1

- [x] T018 [US1] Replace the private 8-line detector in `src/main/preload-webview.ts` (lines ~30–38) with the shared decision function from `src/shared/double-escape.ts`, so the extension side gains the terminal, text-field and modal-depth guards
- [x] T019 [US1] Expose the extension view's modal depth to that detector via a document-scoped registry in `packages/extension-ui/src/useModalDepth.ts`, readable from the preload context without IPC (research R2)
- [x] T020 [US1] Refactor `src/renderer/hooks/useExtensionEscapeExit.ts` to call the same shared decision function instead of its own inline guard logic, so the two sides cannot diverge again (FR-009)
- [x] T021 [US1] Run `npm run build` then `npx playwright test tests/e2e/extension-escape.spec.ts` and confirm all five scenarios pass against the built app

**Checkpoint**: The data-loss defect is fixed and shippable on its own, before any redesign.

---

## Phase 4: User Story 2 - One dialog, inherited by the whole product (Priority: P1)

**Goal**: One implementation of dialog, confirmation, toast, empty state and icon button, used
by the core app and all five extensions, with correct behaviour inherited rather than rewritten.

**Independent Test**: Re-run the behaviour matrix across all 19 extension surfaces plus the
core's own dialogs — all five checks pass on every surface. Deleting any extension directory
still leaves the core building.

### Tests for User Story 2 ⚠️ Write first, confirm they FAIL

- [x] T022 [P] [US2] Write the failing end-to-end spec `tests/e2e/extension-dialogs.spec.ts` that opens every dismissible surface in the product and asserts all five behaviours on each (Escape closes, `role="dialog"`, `aria-modal`, focus trapped and restored, outside-click dismisses)
- [x] T023 [P] [US2] Write failing unit specs for the components in `tests/unit/packages/extension-ui/dialog.spec.tsx` covering focus restoration to the invoking element, the `dismissible: false` escape hatch, and no animation under `prefers-reduced-motion`
- [x] T024 [P] [US2] Write the failing spec `tests/unit/packages/extension-ui/empty-state.spec.tsx` asserting an empty state cannot be constructed without at least one action (FR-026)

### Implementation for User Story 2

- [x] T025 [P] [US2] Implement the focus trap utility in `packages/extension-ui/src/focus-trap.ts` — capture, cycle, restore; hand-rolled per research R4, no new dependency
- [x] T026 [US2] Implement `packages/extension-ui/src/Dialog.tsx` per `contracts/extension-ui-api.md`, consuming only `--tm-*` tokens and registering modal depth on mount
- [x] T027 [US2] Implement `packages/extension-ui/src/ConfirmDialog.tsx` by generalising the existing `src/renderer/components/ConfirmDialog.tsx` (61 lines — the reference implementation, per spec Assumptions)
- [x] T028 [P] [US2] Implement `packages/extension-ui/src/Toast.tsx` and `ToastRegion`, keeping the core's existing `info | success | warning | error` vocabulary (research R7)
- [x] T029 [P] [US2] Implement `packages/extension-ui/src/EmptyState.tsx` modelled on Notepad's `extensions/notepad/src/components/EmptyState.tsx`, with the actions prop typed as non-empty
- [x] T030 [P] [US2] Implement `packages/extension-ui/src/IconButton.tsx` with `label` as a required prop and CSS-controlled icon sizing (FR-005, Principle XII)
- [x] T031 [US2] Add the `ui` namespace to `src/main/extensions/api.ts` exposing `toast` and the readonly `layers` map, and surface it through `src/main/preload-webview.ts` (FR-001)
- [x] T032 [US2] Migrate the core's `src/renderer/components/ConfirmDialog.tsx` and `src/renderer/stores/toast.store.ts` onto the package, leaving no second implementation (FR-007a)
- [x] T033 [P] [US2] Migrate Notepad's 4 surfaces onto the primitives and delete `.notepad-overlay-backdrop` and the superseded rules from `extensions/notepad/src/components/notepad.css`
- [x] T034 [P] [US2] Migrate git-integration's 4 surfaces (`PrDialog`, `KeepBothModal`, `ReviewSubmitPanel`, `CommentComposer`) and delete `.pr-dialog`, `.keep-both-modal`, `.pr-review-submit-overlay`
- [x] T035 [P] [US2] Migrate speckit-pilot's 4 surfaces (`CardDetail`, `CardBriefEditor`, `BatchCheckIn`, `SettingsView`) and delete `.sk-modal`, `.sk-modal-overlay`, `.sk-drawer`
- [ ] T036 [P] [US2] Migrate task-vault's 7 surfaces (`TaskDetailPanel`, `FileToPicker`, `DateTimePicker`, `QuickCaptureOverlay`, `LinkPicker`, `KanbanLaneEditor`, `CalendarDrawer`) and delete `ExtensionToastContainer.tsx` and `.cal-drawer`
- [ ] T037 [US2] Audit MergeFlow and the PR review diff pane with a real merge conflict and a real open pull request before migrating them — both were reviewed from source only and have no visual baseline (plan, carried risk)
- [x] T038 [US2] Remove the five runtime imports of core renderer source: `extensions/notepad/src/components/NoteList.tsx:11`, `extensions/notepad/src/components/NotepadView.tsx:4`, `extensions/git-integration/src/components/GitSidebarPanel.tsx:4`, `extensions/task-vault/src/components/TaskVaultView.tsx:18`, `extensions/task-vault/src/components/ProjectsBrowser.tsx:19` (FR-008)
- [x] T039 [US2] Replace every numeric `z-index` in extension CSS with `var(--tm-layer-*)` per the migration map in `contracts/layer-scale.md` (14 distinct values)
- [x] T040 [US2] Add an ESLint rule failing a numeric `z-index` literal in `extensions/**/*.css` in `.eslintrc.json`
- [x] T041 [US2] Re-export the new component types from `packages/extension-sdk/types/index.d.ts` and bump the contract to v1.3.0, keeping every existing member unchanged (FR-006)
- [x] T042 [US2] Verify the isolation gate: `mv extensions/task-vault /tmp/ && npm run build` succeeds, then restore (SC-004)

**Checkpoint**: One implementation product-wide; the behaviour matrix is green; the illegal imports are gone.

---

## Phase 5: User Story 3 - Remote Control says whether it is on, where, and who (Priority: P2)

**Goal**: The view answers the three questions people open it for, conceals the credential, and
names every way it can fail.

**Independent Test**: Turn it on and confirm running state, address, concealed credential, and
connected devices are all readable without navigating elsewhere; occupy the port and confirm a
named failure with a way forward.

### Tests for User Story 3 ⚠️ Write first, confirm they FAIL

- [ ] T043 [P] [US3] Write failing unit specs for the state machine in `tests/unit/extensions/remote-control/status.spec.ts` covering off → starting → on → failed and the local-only sub-case (data-model §3)
- [ ] T044 [P] [US3] Write a failing spec asserting the credential is not present in the rendered output until an explicit reveal (FR-013)

### Implementation for User Story 3

- [ ] T045 [US3] Add `qrcode.react` pinned exact to `extensions/remote-control/package.json` only — never the root manifest (research R3, Constitution II/IV)
- [ ] T046 [US3] Implement the status state machine in `extensions/remote-control/src/state/status.ts` as a pure reducer
- [ ] T047 [US3] Emit connect/disconnect events from `extensions/remote-control/src/server/remote-server.ts` so the device list is pushed rather than polled (research R8)
- [ ] T048 [US3] Build the status band in `extensions/remote-control/src/components/StatusBand.tsx` — state dot, address with copy, stop control
- [ ] T049 [US3] Add the concealed credential with reveal and copy actions in `extensions/remote-control/src/components/Credential.tsx`
- [ ] T050 [US3] Render the scannable code with `QRCodeSVG` in `extensions/remote-control/src/components/ConnectCode.tsx`, taking `fgColor`/`bgColor` from theme tokens and encoding the credential so scanning never requires revealing it
- [ ] T051 [US3] Add the one-line consequence statement in plain language beside the credential (FR-014)
- [ ] T052 [US3] Build the connected-devices list with per-device disconnect in `extensions/remote-control/src/components/ConnectedDevices.tsx`
- [ ] T053 [US3] Implement the four named failure states with a resolving action each, replacing the current silent-failure behaviour (FR-017)
- [ ] T054 [US3] Demote configuration to a collapsed summary and reorder so the credential requirement precedes optional settings in `extensions/remote-control/src/components/RemoteControlSettings.tsx` (FR-018)

**Checkpoint**: Remote Control is a feature screen rather than a settings form.

---

## Phase 6: User Story 4 - A SpecKit card says where the work has got to (Priority: P2)

**Goal**: Cards name their phase and next step, carry only facts that vary, and every column is
reachable.

**Independent Test**: Open the board with cards at several phases — each names its phase and
next step, shows no raw markup, repeats no column name, and the last column is fully reachable.

### Tests for User Story 4 ⚠️ Write first, confirm they FAIL

- [ ] T055 [P] [US4] Write failing unit specs in `tests/unit/extensions/speckit-pilot/phase-progress.spec.ts` for `nextPhaseName` derivation and the all-complete case (data-model §4)
- [ ] T056 [P] [US4] Write a failing spec asserting no card renders the literal string `# Summary` or any leading markdown heading syntax

### Implementation for User Story 4

- [ ] T057 [US4] Extend the card phase model with phase **names** in `extensions/speckit-pilot/src/state/phases.ts` and derive `nextPhaseName` (FR-019)
- [ ] T058 [US4] Redesign `extensions/speckit-pilot/src/components/CardTile.tsx` — progress bar plus next-step label replacing the ten numbered circles; drop the invariant type chip and the column-duplicating status chip (FR-021)
- [ ] T059 [US4] Strip markdown heading syntax from card descriptions, rendering prose or the first prose line, in `extensions/speckit-pilot/src/components/CardTile.tsx` and the drawer's Scope field (FR-020)
- [ ] T060 [US4] Apply one card naming rule across all columns — brief title, folder name only as fallback — in `extensions/speckit-pilot/src/components/BoardView.tsx` (FR-023)
- [ ] T061 [US4] Add a horizontal scroller with a visible edge affordance and a minimum column width in `extensions/speckit-pilot/src/components/BoardView.tsx` (FR-022)
- [ ] T062 [US4] Collapse the supervision strip to zero height when nothing is running, or replace it with the action that starts something, in `extensions/speckit-pilot/src/components/SupervisionPanel.tsx` (FR-024)
- [ ] T063 [US4] Fold the toolbar's lone "New card" button into the app bar in `extensions/speckit-pilot/src/components/BoardView.tsx` to recover a full band of chrome
- [ ] T064 [US4] Rebuild `extensions/speckit-pilot/src/components/CardDetail.tsx` on the shared Dialog with a dirty-state guard that warns before discarding edits (FR-025)
- [ ] T065 [US4] Verify chrome above the first card is ≤ 100px at the default window size (SC-014)

**Checkpoint**: The board is readable without having memorised a phase numbering.

---

## Phase 7: User Story 5 - Task Vault invites one action (Priority: P3)

**Goal**: One empty state per region, a rail that adds information, and a Weekly Review whose
loudest button moves forward.

**Independent Test**: Open an empty day — exactly one empty state in the main column, the rail
showing something else. Walk all six review steps — the filled primary always advances.

### Tests for User Story 5 ⚠️ Write first, confirm they FAIL

- [ ] T066 [P] [US5] Write a failing spec in `tests/unit/extensions/task-vault/daily-log.spec.tsx` asserting exactly one empty state renders in the main column when a day has no entries
- [ ] T067 [P] [US5] Write a failing spec asserting the Weekly Review's primary action advances the step on all six steps (FR-030)

### Implementation for User Story 5

- [ ] T068 [US5] Replace the three stacked empty treatments in `extensions/task-vault/src/components/DailyLog.tsx` with one shared `EmptyState` carrying heading, explanation and two actions (FR-026)
- [ ] T069 [US5] Rebalance the day heading so the date carries at least the weight of the day name in `extensions/task-vault/src/components/DailyLog.tsx` (FR-028)
- [ ] T070 [US5] Replace the rail's duplicate day view with a week summary in `extensions/task-vault/src/components/TaskVaultView.tsx` (FR-027)
- [ ] T071 [US5] Name all six steps and state position once in `extensions/task-vault/src/components/WeeklyReview.tsx`, letting the named steps double as the progress indicator (FR-029)
- [ ] T072 [US5] Make the filled primary advance and demote skip to a subordinate link across the six step components in `extensions/task-vault/src/components/WeeklyReviewStep*.tsx` (FR-030)
- [ ] T073 [US5] Add per-day load indication and overdue colouring in `extensions/task-vault/src/components/CalendarDrawer.tsx` (FR-031)
- [ ] T074 [US5] Replace the icon-only toolbar controls with labelled `IconButton`s and rename "Context" to what it does in `extensions/task-vault/src/components/TaskVaultView.tsx` (FR-005)

**Checkpoint**: An empty day invites one action instead of reporting nothing four times.

---

## Phase 8: User Story 6 - Reviewing a pull request starts by reading it (Priority: P3)

**Goal**: One line of triage, risk stated once in words, and a row action that opens the diff.

**Independent Test**: Open a populated queue — the summary states a real count, each row states
risk once in words, the primary action opens the diff, and approval is reachable only from the
overflow menu.

### Tests for User Story 6 ⚠️ Write first, confirm they FAIL

- [ ] T075 [P] [US6] Write a failing spec in `tests/unit/extensions/git-integration/review-queue.spec.tsx` asserting no row exposes approval as its primary action and that approval styling is identical across risk levels (FR-034a)
- [ ] T076 [P] [US6] Write a failing spec asserting file status renders as a word, never a porcelain code (FR-036)

### Implementation for User Story 6

- [ ] T077 [US6] Replace the four stat tiles with a single summary line stating a true count and total reading time in `extensions/git-integration/src/components/pr-review/PrOverviewPanel.tsx` (FR-032)
- [ ] T078 [US6] Fetch the true count so the summary never reads `20+`, and remove the manual "Load more" pagination in `extensions/git-integration/src/components/pr-review/ReviewQueue.tsx`
- [ ] T079 [US6] State risk once in words per row and remove the unlabelled six-dot indicator, keeping the coloured edge, in `extensions/git-integration/src/components/pr-review/ReviewQueue.tsx` (FR-033)
- [ ] T080 [US6] Make the row's primary action open the diff, and move approval into the row's overflow menu with risk-independent styling (FR-034, FR-034a)
- [ ] T081 [US6] Remove the filter chips that duplicate the list's own section groupings in `extensions/git-integration/src/components/pr-review/PrReviewView.tsx` (FR-035)
- [ ] T082 [US6] Render file status as words in `extensions/git-integration/src/components/StagingArea.tsx` and `GitSidebarPanel.tsx` (FR-036)
- [ ] T083 [US6] Reduce the git panel's commit controls to one primary with alternates behind a caret, and state what would enable it when disabled, in `extensions/git-integration/src/components/GitSidebarPanel.tsx` (FR-037)
- [ ] T084 [US6] Add ahead/behind branch context to the panel header in `extensions/git-integration/src/components/GitSidebarPanel.tsx`
- [ ] T085 [US6] Verify chrome above the first queue row is ≤ 100px at the default window size (SC-014)

**Checkpoint**: Approving a pull request now starts by reading it.

---

## Phase 9: User Story 7 - One house style, enforced (Priority: P4)

**Goal**: One written rule set, and the parts a linter can enforce enforced.

**Independent Test**: Add a user-facing string containing a forbidden implementation term and
confirm the build rejects it, naming the file and string.

### Tests for User Story 7 ⚠️ Write first, confirm they FAIL

- [ ] T086 [P] [US7] Write a failing lint fixture spec in `tests/unit/lint/extension-vocabulary.spec.ts` asserting the rule rejects "ngrok auth token", "vault", "artifacts" and "stalls" in user-facing strings

### Implementation for User Story 7

- [ ] T087 [US7] Write the rule set at `docs/EXTENSION-STYLE.md` covering label case, button voice, empty-state shape and forbidden vocabulary (FR-038)
- [ ] T088 [US7] Extend the `no-restricted-syntax` override in `.eslintrc.json` to cover `extensions/*/src/**/*.tsx` with the same three selectors already used for "project" (research R6, FR-039)
- [ ] T089 [P] [US7] Convert caps section labels to sentence case across `extensions/git-integration`, `extensions/task-vault` and `extensions/remote-control`
- [ ] T090 [P] [US7] Normalise button labels to verb-first sentence case across all five extensions, including Notepad's lowercase "cancel" beside its capitalised "Save"
- [ ] T091 [US7] Replace implementation vocabulary in user-facing strings — "saved to vault", "Artifacts", "Stalls", "excess connections are rejected" — across all five extensions

**Checkpoint**: The style is written down, and the linter keeps it.

---

## Phase 10: User Story 8 - Both themes verified, not assumed (Priority: P4)

**Goal**: Every extension surface proven legible in both themes by a check that renders.

**Independent Test**: Run the theme harness — every surface meets WCAG AA in both themes,
measured from computed colours rather than parsed stylesheet text.

### Tests for User Story 8 ⚠️ Write first, confirm they FAIL

- [ ] T092 [US8] Build the rendering contrast harness at `tests/e2e/extension-themes.spec.ts` — mount each extension surface in both themes, read computed text and composited background colour, assert AA (research R5; parsing the stylesheet cannot resolve `color-mix` or layered alpha)

### Implementation for User Story 8

- [ ] T093 [P] [US8] Replace hardcoded hex and raw `rgba()` with tokens in `extensions/task-vault/src/components/task-vault.css` (132 hex, 144 rgba — the largest file)
- [ ] T094 [P] [US8] Replace hardcoded hex and raw `rgba()` with tokens in `extensions/notepad/src/components/notepad.css` (63 hex, 309 rgba — the highest rgba count)
- [ ] T095 [P] [US8] Replace hardcoded hex and raw `rgba()` with tokens in `extensions/git-integration/src/components/pr-review/pr-review.css` and `merge-flow/merge-flow.css`
- [ ] T096 [P] [US8] Replace hardcoded hex and raw `rgba()` with tokens in `extensions/speckit-pilot/src/components/speckit-pilot.css` (76 hex)
- [ ] T097 [US8] Fix every contrast failure the harness reports, and record any literal that legitimately has no token equivalent with a justification in review (FR-040, FR-041)

**Checkpoint**: Light mode is proven rather than assumed.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [ ] T098 [P] Write `docs/adr/038-dialogs-render-in-the-extension-view.md` recording the decision, the motivation, and why core-hosted was rejected — `WebContentsView` composites above the host DOM, so `useModalEffect` hides the extension, which would break the scrim FR-002 promises (Constitution IX)
- [ ] T099 [P] Write `docs/adr/039-one-ui-layer-published-outward.md` recording the single-implementation decision and the alternatives considered (Constitution IX)
- [ ] T100 [P] Update `docs/ARCHITECTURE.md` with the `packages/extension-ui` layer, the layer scale, and the per-document modal depth model
- [ ] T101 [P] Update `docs/EXTENSION-DEVELOPMENT.md` and `packages/extension-sdk/README.md` with the v1.3.0 surface and a migration note for third-party extensions
- [ ] T102 [P] Update `README.md` and `docs/user-guide/USER-GUIDE.md` for the four redesigned views
- [ ] T103 [P] Add the CHANGELOG entry under `### Fixed` describing the behaviour matrix, the Escape defect and the four redesigns
- [ ] T104 Convert `size={n}` icon props to CSS-controlled sizing in every component this feature rewrote, per the Complexity Tracking position (Principle XII)
- [ ] T105 Replace unicode characters used as visual elements with lucide icons in `extensions/git-integration/src/components/merge-flow/CompletionScreen.tsx`, `merge-flow/ConflictHub.tsx` and `pr-review/FullFileList.tsx` (Principle XII)
- [ ] T106 Record the remaining Principle XII debt in the untouched components as a follow-up issue rather than sweeping it silently into this PR
- [ ] T107 Delete every superseded implementation left dormant, verifying nothing references it (Constitution X)
- [ ] T108 Run the full `quickstart.md` validation end to end
- [ ] T109 Run the done gate from the worktree: `npm run format`, `npm run lint` (0 errors), `npm run test` — check the **exit code**, not the printed pass count — then `npx playwright test`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational. Blocks nothing; shippable alone
- **US2 (Phase 4)**: depends on Foundational. Independently testable, but US3–US6 are far cheaper after it
- **US3–US6 (Phases 5–8)**: depend on Foundational; each independent of the others
- **US7 (Phase 9)**: depends on Foundational; cheapest after US3–US6, which rewrite much of the text it would otherwise sweep twice
- **US8 (Phase 10)**: depends on Foundational; cheapest last, since earlier phases delete much of the CSS involved
- **Polish (Phase 11)**: depends on whichever stories shipped

### Within Each User Story

Tests are written and **must fail** before implementation (Constitution VI). Pure model changes
precede components; components precede migration; migration precedes deletion of the superseded
code.

### Parallel Opportunities

- T003–T005, T007 in Setup
- T009–T013 in Foundational (all different files)
- All four extension migrations T033–T036 — different directories, no shared files
- The four CSS token sweeps T093–T096
- All documentation tasks T098–T103
- With multiple people: US3, US4, US5 and US6 can run concurrently once Phase 4 lands

---

## Parallel Example: User Story 2

```bash
# Write the failing tests together:
Task: "e2e behaviour matrix in tests/e2e/extension-dialogs.spec.ts"
Task: "unit specs in tests/unit/packages/extension-ui/dialog.spec.tsx"
Task: "empty-state spec in tests/unit/packages/extension-ui/empty-state.spec.tsx"

# Then migrate the four extensions in parallel — separate directories:
Task: "Migrate Notepad's 4 surfaces"
Task: "Migrate git-integration's 4 surfaces"
Task: "Migrate speckit-pilot's 4 surfaces"
Task: "Migrate task-vault's 7 surfaces"
```

---

## Implementation Strategy

### MVP: User Story 1 only

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **stop and validate**.

US1 alone is a genuine release. It ends the only defect in the audit that destroys user data,
touches three files, and needs none of the redesigns. Ship it before anything else is built.

### Incremental delivery

1. Setup + Foundational → foundation ready
2. **US1** → the data loss stops → ship
3. **US2** → the behaviour matrix goes green product-wide, the illegal imports go, a large
   share of extension CSS is deleted → ship
4. **US3** → the biggest single-screen gain in the audit → ship
5. **US4**, then **US5**, then **US6** → one redesign at a time, each independently verifiable
6. **US7**, **US8** → the sweep, cheapest once the rewrites have landed

### A note on verification

Every story's tests must drive the built app where the behaviour is only observable after a
render. The defect class this feature fixes has already survived a full passing unit suite once
in this repository — a mocked store was asserted to have been called, while the list it should
have reordered never changed. Assert what renders.

---

## Notes

- `[P]` = different files, no dependency on incomplete work
- `[Story]` maps each task to a spec user story for traceability
- Verify tests fail before implementing (Constitution VI, non-negotiable)
- Rebuild (`npm run build`) before re-running any end-to-end scenario; a stale `out/` silently validates nothing
- Commit per logical unit, not per task and not in one lump
- Stop at any checkpoint to validate a story independently
