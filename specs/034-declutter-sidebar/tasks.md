---
description: 'Task list for 034-declutter-sidebar'
---

# Tasks: Declutter the Sidebar, and a Board for the Fleet

**Input**: Design documents from `/specs/034-declutter-sidebar/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: **Mandatory, not optional.** The tasks template treats tests as opt-in, but `CLAUDE.md` makes `.specify/memory/constitution.md` binding and Principle VI is NON-NEGOTIABLE: Red → Green → Refactor strictly, no production code before a failing test that demands it, 80% on all four metrics, and "no new file ships untested". Every phase below writes its failing specs first.

**Organization**: Grouped by user story. Note the ordering caveat under Implementation Strategy — the three P1 stories are mutually dependent and US1 must not ship first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US6, mapping to the user stories in [spec.md](./spec.md)
- Every task names the exact file it touches

## Path Conventions

Single project, renderer-only. Sources under `src/renderer/`, specs under `tests/unit/renderer/`, end-to-end under `tests/e2e/`. Run everything from the worktree root.

---

## Phase 1: Setup & Unblocking

**Purpose**: Pay the pre-existing debt that blocks the first commit, and fix the spec defects found in design review before they are built.

- [x] T001 Raise `src/renderer/components/sidebar/UnifiedSidebar.tsx` function coverage from 79.2% to ≥80% by extending `tests/unit/renderer/components/UnifiedSidebar.spec.tsx`; verify with `npx vitest run --coverage tests/unit/renderer/components/UnifiedSidebar.spec.tsx` — **`scripts/check-patch-coverage.cjs` refuses any commit staging this file until this passes** (research.md R-012)
- [x] T002 [P] Amend FR-040 in `specs/034-declutter-sidebar/spec.md` so the repo rail is the only _colour_ edge and state emphasis lives in the status gutter, resolving the FR-003/FR-040 contradiction (research.md R-011)
- [x] T003 [P] Amend FR-003, FR-009, FR-011 and FR-023 in `specs/034-declutter-sidebar/spec.md`: the count agrees with the glyph rather than totalling terminals; an empty _lane_ is silent but an empty _board_ gets one line and one action; the lane transition is 180ms with `prefers-reduced-motion` cutting to position; the terminal note is a tooltip and is never drawn
- [x] T004 [P] Add two requirements to `specs/034-declutter-sidebar/spec.md`: mono for machine facts and sans for human language (research.md R-009), and board lanes distinguished without colour per Constitution XII (research.md R-011)
- [x] T005 [P] Extend FR-047 in `specs/034-declutter-sidebar/spec.md` to the ordinary case — which terminal focuses when a branch has several (research.md R-004)

**Checkpoint**: `UnifiedSidebar.tsx` is committable and the spec no longer contains a requirement that cannot be built.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The state vocabulary every surface shares. FR-018 requires the sidebar gutter, the tab glyph and the board lane to agree; they agree by construction because they read one constant and one function.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [x] T006 Export `STATUS_ORDER` from `src/renderer/sidebar/view-model.ts` (currently module-private) so nothing re-declares the severity order — do **not** narrow `GroupKey` yet, that breaks the build until `views.ts` moves in T044
- [x] T007 [P] Write failing spec `tests/unit/renderer/sidebar/branch-state.spec.ts` covering invariants BS-1 to BS-5 from `contracts/sidebar-pure-layer.md`, especially BS-1: an empty terminal list aggregates to `idle`, never `exited`
- [x] T008 [P] Write failing spec `tests/unit/renderer/sidebar/purity.spec.ts` asserting no module under `src/renderer/sidebar/` imports React, a store, or reads the clock (ADR-027, Constitution XI)
- [x] T009 Implement `aggregateBranchState` and `countInState` in `src/renderer/sidebar/branch-state.ts`, importing `STATUS_ORDER` from `view-model.ts` (T006, T007)
- [x] T010 [P] Add the shared state-opacity scale to `src/renderer/styles.css` — `awaiting-input` 1.0, `working` 0.85, `idle` 0.34, `exited` 0.24 — as tokens, since three surfaces consume them and Constitution XII forbids differentiating icon state by colour

**Checkpoint**: One state vocabulary exists and is tested. The three story phases can now proceed.

---

## Phase 3: User Story 2 — Track every terminal's state on one board (Priority: P1)

**Goal**: Every terminal in the app, across every repo, arranged in lanes by state, with its card moving lane on its own when the state changes.

**Independent Test**: Open eight terminals across three branches in all four states. Without clicking anything, name all eight from the board. Make one agent ask a question and confirm its card moves to the waiting lane unaided.

**Why first**: US1 deletes the surface that answers "which terminal is in what state". Building the replacement before the removal is what makes the removal safe.

### Tests for User Story 2 (write first, confirm they fail)

- [x] T011 [P] [US2] Write failing spec `tests/unit/renderer/sidebar/board-lanes.spec.ts` covering invariants BL-1 to BL-7 from `contracts/sidebar-pure-layer.md`
- [x] T012 [P] [US2] Write failing spec `tests/unit/renderer/components/BoardScreen.spec.tsx` for lane headers (glyph, label, count), FR-039 count-equals-cards, and FR-009 empty lane drawing nothing in its body
- [x] T013 [P] [US2] Write failing spec `tests/unit/renderer/components/board-lane-visibility.spec.ts` for the `terminator.board.lanes` localStorage key, including degrading corrupt storage to all-visible rather than throwing

### Implementation for User Story 2

- [x] T014 [US2] Implement `buildLanes` in `src/renderer/sidebar/board-lanes.ts` returning lanes in `STATUS_ORDER`, with `exited` marked `isHistory` and invisible while empty (T011)
- [x] T015 [US2] Create `src/renderer/components/overview/BoardScreen.tsx` rendering **one CSS grid containing every card**, with a card's lane expressed as `grid-column` — cards must never be re-parented (research.md R-003)
- [x] T016 [US2] Create `src/renderer/components/overview/BoardScreen.css` — grid template, lane headers in row 1, exited lane at 42% opacity, `min-height` so an empty lane keeps its header without a placeholder
- [x] T017 [US2] **Write the preview-survival test** in `tests/unit/renderer/components/BoardScreen.spec.tsx`: assert a card's DOM node identity is unchanged across a state change, because `mountPreview` moves the one live xterm element into that node and re-parenting tears it out (`src/renderer/components/terminal/TerminalSession.tsx:471`)
- [x] T018 [US2] Rework `src/renderer/components/overview/SessionTile.tsx` into the card: title in sans, `"<repo> / <branch>"` in mono, bell only when non-zero, and every optional line **omitted rather than drawn empty** (FR-013)
- [x] T019 [US2] Rework `src/renderer/components/overview/SessionTile.css` — 2px repo rail replacing the colour dot, preserved live-preview container (FR-020, FR-040)
- [x] T020 [US2] Add the 180ms `transform`/`opacity` transition to the card that changed lane in `src/renderer/components/overview/BoardScreen.css`, with `@media (prefers-reduced-motion: reduce)` cutting straight to position (FR-011)
- [x] T021 [US2] Implement lane visibility (show/hide per lane) with `terminator.board.lanes` persistence in `src/renderer/components/overview/BoardScreen.tsx` (FR-016, T013)
- [x] T022 [US2] Implement the empty-board state — one line and one action, distinct from an empty lane — in `src/renderer/components/overview/BoardScreen.tsx` (FR-009 as amended, T003)
- [x] T023 [US2] Make `src/renderer/components/overview/OverviewScreen.tsx` host board and list layouts on one surface with board as the default (FR-015)
- [x] T024 [US2] Rewrite `tests/unit/renderer/components/OverviewScreen.spec.tsx` for the two layouts and the default
- [x] T025 [US2] Rewrite `tests/unit/renderer/components/SessionTile.spec.tsx` for the card anatomy
- [x] T026 [US2] Add `tests/e2e/board.spec.ts` driving four terminals into four states and asserting lane placement, then a state change moving a card

**Checkpoint**: The board answers "which terminal is in what state" for the whole fleet, and the live preview survives a lane change.

---

## Phase 4: User Story 3 — Nothing is lost, only moved (Priority: P1)

**Goal**: Per-terminal state, bells, notes and commands are all reachable from the tab bar of the branch that owns them.

**Independent Test**: Open a branch with four terminals in four states, one with a note and one with unread bells. Name each state, read the note, and see the bell count from the tab bar alone.

**Why before US1**: `TabBar` already carries bell, rename, close and move (research.md R-005). Only the glyph is missing, and it must be there before terminal rows are deleted.

### Tests for User Story 3 (write first, confirm they fail)

- [x] T027 [P] [US3] Extend `tests/unit/renderer/components/TabBar.spec.tsx` with failing cases: each tab renders its own state glyph distinguishable by shape; the bell count renders only when non-zero; the note is exposed as `title` and appears in no text node; no tab renders more than four elements

### Implementation for User Story 3

- [x] T028 [US3] Add the four-state glyph to each tab in `src/renderer/components/terminal/TabBar.tsx` via the existing `statusPresentationFor` from `src/renderer/sidebar/session-status.ts` (FR-021)
- [x] T029 [US3] Move the terminal note to the tab's `title` attribute in `src/renderer/components/terminal/TabBar.tsx` — never drawn (FR-023 as amended)
- [x] T030 [US3] Enforce the four-element cap in `src/renderer/components/terminal/TabBar.tsx`: glyph, title, one trailing slot (bell when it has a count), and close on the active tab only (research.md R-005)
- [x] T031 [US3] Update `src/renderer/components/terminal/TabBar.css` for the glyph slot and the cap, keeping `min-width: 100px` for the sessions variant
- [x] T032 [US3] Make tab-bar overflow visible in `src/renderer/components/terminal/TabBar.tsx` and `.css` — a pre-existing defect (`docs/ux-improvement-prd.md` §3.4) that adding a glyph makes worse
- [x] T033 [US3] Verify rename, close and move-to-branch still work from the tab context menu in `tests/unit/renderer/components/TabBar.spec.tsx` (FR-024)

**Checkpoint**: Everything the terminal rows carried has a home. US1 is now safe to build.

---

## Phase 5: User Story 1 — See the whole fleet without scrolling past it (Priority: P1)

**Goal**: The sidebar lists repos and branches only. One row per branch, carrying its aggregate state.

**Independent Test**: Three repos, four branches each, two or three terminals per branch. The sidebar shows exactly three repo headers and twelve branch rows, no terminal appears in it, and the whole list fits without scrolling at the default window height.

### Tests for User Story 1 (write first, confirm they fail)

- [x] T034 [P] [US1] Write failing spec `tests/unit/renderer/sidebar/branch-rows.spec.ts` covering invariants BR-1 to BR-9, especially BR-1: a branch with no terminals is still a row, unconditionally
- [x] T035 [P] [US1] Write failing spec `tests/unit/renderer/sidebar/branch-rows-performance.spec.ts` mirroring `view-model-performance.spec.ts`, asserting `buildBranchRows` stays O(sessions + projects)
- [x] T036 [P] [US1] Extend `tests/unit/renderer/sidebar/views.spec.ts` with failing cases for the re-expressed built-ins and invariant VW-1: a stored override naming a retired `groupBy` degrades to the built-in default
- [x] T037 [P] [US1] Rewrite `tests/unit/renderer/components/SessionGroup.spec.tsx` as failing specs for a repo header and a branch row
- [x] T038 [P] [US1] Write failing spec `tests/unit/renderer/components/branch-selection.spec.tsx` for FR-047: a branch with several terminals focuses the one awaiting input, else the last active on that branch, else the most recently active; a branch with none offers to start one

### Implementation for User Story 1

- [x] T039 [US1] Implement `buildBranchRows` in `src/renderer/sidebar/branch-rows.ts` beside `buildGroups`, not replacing it (research.md R-001, T034)
- [x] T040 [US1] Re-express the four built-ins in `src/renderer/sidebar/views.ts` at branch level — a branch matches when any of its terminals matches — moving `needs-me`, `active` and `stale` to `groupBy: 'workspace'` (research.md R-006)
- [x] T041 [US1] Add the retired-`groupBy` degradation to `loadViews()` in `src/renderer/sidebar/views.ts` (T036)
- [x] T042 [US1] Rework `src/renderer/components/sidebar/SessionGroup.tsx` into the repo header: name, count, swatch, and hover-only chevron / new-branch / registered repo actions
- [x] T043 [US1] Add the branch row with its 16px status gutter to `src/renderer/components/sidebar/SessionGroup.tsx`, reading `aggregateBranchState` (FR-003)
- [ ] T044 [US1] Narrow `GroupKey` to `'workspace' | 'none'` in `src/renderer/sidebar/view-model.ts` and remove the retired grouping options (FR-038) — safe only after T040
- [x] T045 [US1] Update `src/renderer/components/sidebar/SessionGroup.css` for the repo header, the branch row and the gutter
- [x] T046 [US1] Switch `src/renderer/components/sidebar/UnifiedSidebar.tsx` from `buildGroups` to `buildBranchRows` and stop rendering terminal rows (FR-001)
- [x] T047 [US1] Implement branch-selection resolution in `src/renderer/components/sidebar/UnifiedSidebar.tsx` using the store's existing `getActiveSessionForProject` (research.md R-004, T038)
- [x] T048 [US1] Render the collapsed-repo waiting signal from `hiddenNeedsYou` in `src/renderer/components/sidebar/SessionGroup.tsx` (FR-004)
- [x] T049 [US1] Render the scratch section from `BranchRowsResult.scratch` in `src/renderer/components/sidebar/UnifiedSidebar.tsx` — the one place a terminal is still a row (FR-002)
- [x] T050 [US1] Delete `src/renderer/components/sidebar/SessionRow.tsx`, `SessionRow.css` and `tests/unit/renderer/components/SessionRow.spec.tsx` (FR-001)
- [x] T051 [US1] Delete `src/renderer/components/sidebar/WorkspaceRow.tsx`, `WorkspaceRow.css` and `tests/unit/renderer/components/WorkspaceRow.spec.tsx`, moving branch creation to the repo header's hover `+` (FR-005)
- [x] T052 [US1] Delete `src/renderer/components/sidebar/BulkCloseDialog.tsx`, `BulkCloseDialog.css`, its spec, and the multi-select state in `UnifiedSidebar.tsx` — nothing left to select (research.md R-007, FR-025); **name the deletion in the PR body**
- [x] T053 [US1] Rewrite `tests/unit/renderer/components/UnifiedSidebar.spec.tsx` for the branch list
- [x] T054 [US1] Rewrite `tests/e2e/sidebar-branch-first.spec.ts` for repos and branches with no terminal rows

**Checkpoint**: 45 rows become 15 for the same 30 terminals, and nothing that mattered was destroyed.

---

## Phase 6: User Story 4 — A branch row states its case in five facts (Priority: P2)

**Goal**: Six elements at rest on a branch row, three on a repo header. Everything else on hover, click, or the context menu.

**Independent Test**: Count the distinct visual elements on any one branch row in a screenshot of a populated sidebar; then hover it and confirm the demoted items appear without the resting facts moving.

### Tests for User Story 4 (write first, confirm they fail)

- [ ] T055 [P] [US4] Write failing spec `tests/unit/renderer/components/row-anatomy.spec.tsx` asserting no branch row renders more than six elements at rest and no repo header more than three (FR-026, FR-027)
- [ ] T056 [P] [US4] Write failing spec in `tests/unit/renderer/components/row-anatomy.spec.tsx` asserting hover controls occupy reserved space so no resting element changes position (FR-031)

### Implementation for User Story 4

- [ ] T057 [US4] Swap the type roles in `src/renderer/components/sidebar/SessionGroup.css`: branch name to `var(--font-mono)`, repo name to `var(--font-ui)` (research.md R-009)
- [ ] T058 [US4] Mark only the plain checkout with the kind glyph and delete the "worktree" tag chip from `src/renderer/components/sidebar/SessionGroup.tsx` and `.css` (FR-028)
- [ ] T059 [US4] Render a linked issue key as plain mono text in `src/renderer/components/integrations/IssueBadge.tsx` — no border, no background, no state dot (FR-029)
- [ ] T060 [US4] Move the repo folder path to a `title` on the repo header in `src/renderer/components/sidebar/SessionGroup.tsx`; never drawn at rest (FR-030)
- [ ] T061 [US4] Delete the repo-name qualifier and the busy dot from `src/renderer/components/sidebar/SessionGroup.tsx` — both duplicate something already on screen
- [ ] T062 [US4] Render the state-aware count (terminals in the row's state, only when >1) in `src/renderer/components/sidebar/SessionGroup.tsx` (FR-003 as amended)
- [ ] T063 [US4] Reserve hover-control space in `src/renderer/components/sidebar/SessionGroup.css` so revealing them shifts nothing (FR-031, T056)
- [ ] T064 [US4] Re-derive the `@container sidebar` breakpoints in `src/renderer/components/sidebar/SessionGroup.css` for the new anatomy, guaranteeing a row never drops its branch name or state glyph (FR-049, research.md R-008)
- [ ] T065 [US4] Confirm change statistics still render from `change-stats.store` without delaying first paint, in `tests/unit/renderer/components/SessionGroup.spec.tsx` (FR-032, ADR-031)

**Checkpoint**: Every row is countable and nothing moves under the cursor.

---

## Phase 7: User Story 5 — One row of controls, not four bands (Priority: P2)

**Goal**: At most two bands of chrome above the first row of work; every view, grouping, sort and staleness control behind two menus.

**Independent Test**: Measure the vertical distance from the sidebar's top to the first row of work, before and after.

### Tests for User Story 5 (write first, confirm they fail)

- [ ] T066 [P] [US5] Write failing spec `tests/unit/renderer/components/FilterMenu.spec.tsx` for the saved views, the stale toggle, the active-filter count badge, and clearing the filter (FR-035)
- [ ] T067 [P] [US5] Write failing spec `tests/unit/renderer/components/DisplayMenu.spec.tsx` for grouping and sort
- [ ] T068 [P] [US5] Write failing spec `tests/unit/renderer/components/sidebar-chrome.spec.tsx` asserting at most two bands sit above the first row of work (FR-033)

### Implementation for User Story 5

- [ ] T069 [US5] Create `src/renderer/components/sidebar/FilterMenu.tsx` and `FilterMenu.css` holding the saved views, the hide-stale toggle, and a count badge when anything is hidden (FR-034, FR-035)
- [ ] T070 [US5] Create `src/renderer/components/sidebar/DisplayMenu.tsx` and `DisplayMenu.css` holding grouping and sort (FR-034)
- [ ] T071 [US5] Rework the search row in `src/renderer/components/sidebar/SidebarHeader.tsx` and `.css` to hold search, Filter, Display and new-repo
- [ ] T072 [US5] Render `src/renderer/components/sidebar/AppBand.tsx` as a single compact icon row without text labels, keeping `aria-label` and `title` on every entry (FR-036, invariant EA-4)
- [ ] T073 [US5] Move the notification bell and its badge from the search row into `src/renderer/components/sidebar/AppBand.tsx` — it is app-level like the rest of the band
- [ ] T074 [US5] Update `src/renderer/components/sidebar/AppBand.css` for the compact row
- [ ] T075 [US5] Update the single permitted assertion in `tests/unit/renderer/components/extension-surfaces.spec.tsx` — the 8px label becomes an accessible name; **any other required change means a contract moved** (`contracts/extension-api-invariants.md`)
- [ ] T076 [US5] Delete `src/renderer/components/sidebar/ViewBar.tsx`, `ViewBar.css` and `tests/unit/renderer/components/ViewBar.spec.tsx` (FR-034)
- [ ] T077 [US5] Delete `src/renderer/components/sidebar/FilterNotice.tsx`, `FilterNotice.css` and its spec (FR-035)
- [ ] T078 [US5] Add `scripts/measure-sidebar-chrome.cjs` rendering the sidebar in headless chromium and asserting the top-to-first-row distance is ≤99px, against the 165px baseline (SC-002)
- [ ] T079 [US5] Verify keyboard reachability and accessible names across the app band and the control row in `tests/unit/renderer/components/sidebar-chrome.spec.tsx` (FR-046)

**Checkpoint**: The first row of work is near the top and every control is still reachable.

---

## Phase 8: User Story 6 — Colour identifies a repo; it does not paint the column (Priority: P3)

**Goal**: One 2px rail per repo. Every surface in the column neutral.

**Independent Test**: Render five repos of different colours and confirm each row's repo is identifiable while every background is a neutral surface.

### Tests for User Story 6 (write first, confirm they fail)

- [x] T080 [P] [US6] Retarget `tests/unit/renderer/sidebar-workspace-tint.spec.ts` from the four washes to the rail and the swatch, rendering in headless chromium because jsdom cannot compute `color-mix` (research.md R-010)
- [x] T081 [P] [US6] Add failing assertions to `tests/unit/renderer/sidebar-workspace-tint.spec.ts`: every row background at rest computes to `rgba(0, 0, 0, 0)`, and hover and selection resolve to identical neutral tokens for all ten preset colours (FR-041, FR-042)

### Implementation for User Story 6

- [x] T082 [US6] Remove the 10%, 5%, 14% and 22% washes from `src/renderer/components/sidebar/SessionGroup.css`, leaving one 2px repo rail (FR-025 of the colour section, FR-040)
- [x] T083 [US6] Make hover and selection neutral `--bg-elevated` / `--bg-card-hover` in `src/renderer/components/sidebar/SessionGroup.css`, identical for every repo (FR-042)
- [x] T084 [US6] Draw the repo name in `--text-primary` with a 7px colour swatch in `src/renderer/components/sidebar/SessionGroup.tsx` and `.css`, fixing the light-theme contrast failure measured at 1.08 : 1 (FR-043, research.md R-010)
- [x] T085 [US6] Ensure a row or card with no repo draws no rail and is otherwise laid out identically, in `src/renderer/components/sidebar/SessionGroup.css` and `src/renderer/components/overview/SessionTile.css` (FR-045)
- [ ] T086 [US6] Verify all ten preset colours meet AA in both themes by rendering, and record the measured ratios in `tests/unit/renderer/sidebar-workspace-tint.spec.ts` (FR-044, SC-015)

**Checkpoint**: Colour means "which repo" and nothing else, and a pre-existing AA failure is fixed.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Remove what is now unreachable, and ship the documentation the constitution requires in this PR.

- [ ] T087 Delete `buildGroups`, `Group`, `GroupScope` and `BuildResult` from `src/renderer/sidebar/view-model.ts` now that nothing imports them, and delete the corresponding cases in `tests/unit/renderer/sidebar/view-model.spec.ts` and `view-model-performance.spec.ts` (Principle X)
- [ ] T088 [P] Delete the dead rules in `src/renderer/components/sidebar/SidebarHeader.css` — `__search`, `__search-icon`, `__search-placeholder`, `__actions`, `__tabs`, `__fixed-actions`, `__tab*` — which have had no matching element since the tabs moved to `AppBand`
- [ ] T089 [P] Delete `.unified-sidebar__add-project` from `src/renderer/components/sidebar/UnifiedSidebar.css` and the `ws-card--dnd-over` class reference in `UnifiedSidebar.tsx`, which never had a CSS rule at all
- [ ] T090 [P] Delete the unused `notificationPanelOpen`, `scratchActive` and `hasScratchSessions` props from `UnifiedSidebarProps` in `src/renderer/components/sidebar/UnifiedSidebar.tsx` and their pass-through in `src/renderer/App.tsx`
- [ ] T091 [P] Delete `font-family: var(--font-sans)` from `src/renderer/components/sidebar/SidebarSearch.css:32` — the token is never defined anywhere in `src/` (research.md R-009)
- [ ] T092 [P] Write `docs/adr/035-the-sidebar-stops-at-the-branch.md` — the decision, the motivation, and the alternatives with their tradeoffs (Principle IX)
- [ ] T093 [P] Write `docs/adr/036-the-board-is-one-grid-a-lane-is-a-column.md` recording the `mountPreview` constraint and why per-lane containers were rejected (research.md R-003)
- [ ] T094 [P] Write `docs/adr/037-repo-colour-reduced-to-one-rail.md` superseding ADR-033 rather than editing it, and recording the light-theme AA fix (Principle IX immutability)
- [ ] T095 Rewrite the "Navigation Chrome — UnifiedSidebar" section of `docs/ARCHITECTURE.md` for the branch-first list, the two-band chrome, the single-grid board, and the colour reduction (Principle VIII)
- [ ] T096 [P] Update `docs/user-guide/USER-GUIDE.md` for the branch list, the board, and the tab-bar state glyphs
- [ ] T097 [P] Update `README.md` where it describes the sidebar
- [ ] T098 Run the Principle II isolation check: grep `src/` for any import, type, string or conditional naming a specific extension; confirm core still builds with any extension directory deleted (`contracts/extension-api-invariants.md`)
- [ ] T099 Run the full gate in order from the worktree: `npm run format`, then `npm run lint` at 0 errors, then `npx vitest run --coverage` with all four metrics ≥80%, then `npx playwright test`
- [ ] T100 Walk every scenario in `specs/034-declutter-sidebar/quickstart.md` against the running app, including the preview-survival check and the chrome measurement
- [ ] T101 Write the PR body from the deletion list in `specs/034-declutter-sidebar/data-model.md` §6, naming every removal — bulk close and stale multi-select above all — as FR-025 requires

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: no dependencies. T001 blocks every later commit that stages `UnifiedSidebar.tsx`.
- **Phase 2 (Foundational)**: depends on Phase 1. **Blocks all six stories.**
- **Phase 3 (US2, board)**: depends on Phase 2.
- **Phase 4 (US3, tab bar)**: depends on Phase 2. Independent of US2 — can run alongside it.
- **Phase 5 (US1, sidebar)**: depends on Phase 2, and **must not merge before US2 and US3 are done** — see the caveat below.
- **Phase 6 (US4, anatomy)**: depends on US1, whose rows it refines.
- **Phase 7 (US5, chrome)**: depends on Phase 2 only. Can run alongside US1.
- **Phase 8 (US6, colour)**: depends on US1 and US4 for the elements it repaints.
- **Phase 9 (Polish)**: depends on all preceding phases. T087 is only safe once nothing imports `buildGroups`.

### The P1 ordering caveat

The template's usual "MVP is User Story 1" does **not** hold here. US1 removes the surface that answers "which terminal is in what state"; US2 and US3 are what replace it. Shipping US1 alone would trade one complaint for a worse one, and the spec says so in its Context. Implementation order is therefore **US2 and US3 first, then US1** — which is why the phases are numbered that way.

### Within each story

Failing specs first, then the pure module, then the component, then the CSS, then the deletions. Constitution VI is strict: no production code before a test that demands it.

### Parallel opportunities

- **Phase 1**: T002–T005 are all spec edits to different sections and can run together, alongside T001.
- **Phase 2**: T007 and T008 in parallel; T010 in parallel with both.
- **US2**: T011, T012, T013 in parallel. Then T018/T019 (the card) run alongside T015/T016 (the grid).
- **US3**: independent of US2 throughout — a second person can take Phase 4 while Phase 3 is in flight.
- **US1**: T034–T038 all in parallel.
- **US5**: T066, T067, T068 in parallel; the whole phase runs alongside US1.
- **Phase 9**: T088–T094 and T096–T097 are all different files.

### Parallel example: User Story 1's tests

```bash
# Four failing specs, four different files, no shared state:
npx vitest run tests/unit/renderer/sidebar/branch-rows.spec.ts
npx vitest run tests/unit/renderer/sidebar/branch-rows-performance.spec.ts
npx vitest run tests/unit/renderer/sidebar/views.spec.ts
npx vitest run tests/unit/renderer/components/branch-selection.spec.tsx
```

---

## Implementation Strategy

### The real MVP

Phase 1 + Phase 2 + **US2 + US3 + US1 together**. That is the smallest set that leaves the app better rather than worse, because the three are mutually dependent by construction. Stop there and validate before touching anything cosmetic.

### Incremental delivery after that

1. **US4** — the rows get countable. Visible improvement, no structural risk.
2. **US5** — the chrome collapses. The most visible reclaim of space, independent of everything below it.
3. **US6** — colour reduces to a rail, and a pre-existing light-mode AA failure gets fixed.
4. **Phase 9** — delete what is now unreachable, write the ADRs, ship the docs.

### Where this most likely breaks

**T017.** `mountPreview` moves the single live xterm element into the card's DOM node. If a card is ever re-parented, that element is torn out and the preview blanks in the middle of the transition FR-011 asks for. Prove the node identity survives before building anything else on the board.

---

## Notes

- `[P]` means different files and no dependency on an incomplete task.
- Commit per logical unit, matching the repo's existing `type(scope): subject` convention.
- Verify each edit actually landed — prettier reformats between edits and a scripted replace can silently no-op, and a missing import passes build, lint and the whole unit suite while only e2e catches the dead app.
- Verify CSS by rendering in headless chromium, never by reading the stylesheet; jsdom cannot compute `color-mix`.
- `npm run typecheck` is a no-op in this repo. For a real type check run `tsc -p` per project and diff against `main`.
- After changing any TypeScript under `extensions/*/src/`, run `npm run build:extensions`; the compiled output is a build artifact and must never be committed.
