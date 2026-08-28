---
description: 'Task list for the branch-first sidebar'
---

# Tasks: Branch-First Sidebar

**Input**: Design documents from `/specs/032-branch-first-sidebar/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ — all present

**Tests**: **Required, not optional.** Constitution VI is non-negotiable: no production code is written before a failing test exists that demands it, and every new file ships at ≥ 80% coverage. Each contract in `contracts/` carries a test-obligation table; those obligations are the test tasks below.

**Organization**: Tasks are grouped by user story so each can be implemented, tested and shipped independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: Which user story this serves (US1–US4)
- Every task names its exact file path

## Path Conventions

Electron desktop app, per plan.md: `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`, tests under `tests/unit/`, `tests/integration/`, `tests/e2e/`, ADRs in `docs/adr/`.

---

## Phase 1: Setup

**Purpose**: Land on the right base and record what "no regression" means before touching anything.

- [ ] T001 Rebase this branch onto `032-sidebar-workspace-grouping` (PR #155), resolving conflicts in `src/renderer/components/sidebar/UnifiedSidebar.tsx` and `src/renderer/components/sidebar/SessionGroup.tsx` — the `nested` and `workspaceName` props this feature builds on come from that PR
- [ ] T002 [P] Record the pre-change baseline (total passing tests, and per-file coverage for `src/renderer/components/sidebar/` and `src/renderer/sidebar/`) in `specs/032-branch-first-sidebar/baseline.md` by running `npx vitest run --coverage`
- [ ] T003 [P] Confirm `npm run lint` reports 0 errors and `npx playwright test` passes on the rebased base, so any later failure is attributable to this feature

**Checkpoint**: Rebased, green, and the baseline is written down.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The sidebar has to be wide enough to hold the enriched row before either P1 story can land. Nothing else is genuinely shared — the two P1 stories are otherwise independent.

**⚠️ CRITICAL**: T004–T006 block US1 and US2.

- [ ] T004 Raise `DEFAULT_WIDTH` from 260 to 300 in `src/renderer/components/sidebar/UnifiedSidebar.tsx`, leaving `MIN_WIDTH`, `MAX_WIDTH` and `readStoredWidth()` untouched so an existing stored width still wins (research R3)
- [ ] T005 [P] Add the width-degradation rules to `src/renderer/components/sidebar/SessionRow.css` and `src/renderer/components/sidebar/SessionGroup.css` in the fixed drop order — statistics below 300px, worktree tag text below 260px, activity time below 230px — with name and state glyph never dropping and the row never wrapping (research R3, contracts/sidebar-row.md)
- [ ] T006 [P] Extend `tests/unit/renderer/components/UnifiedSidebar.spec.tsx` with failing tests asserting the new 300px default and that a stored width still overrides it

**Checkpoint**: Foundation ready — US1 and US2 can proceed in parallel.

---

## Phase 3: User Story 1 — Read a session's real state without touching it (Priority: P1) 🎯 MVP

**Goal**: Selection and state become two independent visual channels, and the four agent states the app already computes become visible at rest.

**Independent Test**: Put four sessions in different states, screenshot the sidebar in greyscale, and have someone who has not used the app name all four correctly (SC-001).

### Tests for User Story 1 ⚠️ Write first, confirm they fail

- [ ] T007 [P] [US1] Write failing tests for the pure status mapping in `tests/unit/renderer/sidebar/session-status.spec.ts` — all four `AgentState` values map to distinct icons and labels, the mapping is total, and the function takes no selection input (data-model.md § SessionStatus)
- [ ] T008 [P] [US1] Add a failing test to `tests/unit/renderer/components/SessionRow.spec.tsx` asserting the state glyph is unchanged when `isActive` toggles from false to true (FR-001)
- [ ] T009 [P] [US1] Add a failing test to `tests/unit/renderer/components/SessionRow.spec.tsx` for render precedence: busy spinner beats bell badge beats state glyph
- [ ] T010 [P] [US1] Add a failing test to `tests/unit/renderer/components/SessionRow.spec.tsx` asserting `aria-label` contains the status label and the icon carries `aria-hidden` (SC-007, contracts/sidebar-row.md)
- [ ] T011 [P] [US1] Add a failing test to `tests/unit/renderer/components/SessionRow.spec.tsx` asserting the icon element carries no colour class and no inline `color` style (constitution XII)

### Implementation for User Story 1

- [ ] T012 [US1] Create `src/renderer/sidebar/session-status.ts` exporting a pure, total `statusPresentationFor(session)` returning `{ icon, label, emphasises }`, using `Play` / `Circle` / `Pause` / `CircleX` (research R1) — no clock, no store, no I/O
- [ ] T013 [US1] Rewrite `renderStatus()` in `src/renderer/components/sidebar/SessionRow.tsx` to consume `statusPresentationFor`, removing the `isActive`-driven dot entirely and keeping the existing spinner and bell precedence
- [ ] T014 [US1] Move selection to the row surface in `src/renderer/components/sidebar/SessionRow.css` (`.session-row--active` background) and keep the `--needs-you` edge bar as the awaiting-input emphasis (FR-004)

**Checkpoint**: US1 is independently shippable — the sidebar now answers "what is happening" without US2, US3 or US4.

---

## Phase 4: User Story 2 — Know which branch you are about to type into (Priority: P1)

**Goal**: A branch row shows its branch name, whether it has a worktree on disk, and how much has changed — without ever blocking first paint on git.

**Independent Test**: With a plain checkout and a worktree in the same repo, state which is which from the sidebar alone, before selecting either (SC-003).

### Tests for User Story 2 ⚠️ Write first, confirm they fail

- [ ] T015 [P] [US2] Write failing tests for `getChangeStats` in `tests/unit/git/git-service.spec.ts` — numstat summing, binary rows reporting `-` counting toward `files` but contributing 0, unborn `HEAD` resolving to zeroes, and rejection on non-repo and timeout (contracts/change-stats-ipc.md)
- [ ] T016 [P] [US2] Write failing tests in `tests/unit/renderer/stores/change-stats.store.spec.ts` — cache hit inside the TTL, refetch at exactly `fetchedAt + TTL` and one ms past, concurrent `ensure` calls collapsing to one request, error state throttling retries, and `invalidate` forcing a refetch
- [ ] T017 [P] [US2] Extend `tests/unit/ipc/git.ipc.spec.ts` with failing tests for `git:change-stats` success passthrough and `{ error }` shaping
- [ ] T018 [P] [US2] Write failing tests for `displayName` in `tests/unit/renderer/sidebar/branch-display.spec.ts` covering all three cases — absent `gitBranch`, `name === gitBranch`, and a distinct label (data-model.md § Branch)
- [ ] T019 [P] [US2] Extend `tests/unit/renderer/components/SessionGroup.spec.tsx` with failing tests for `GitFork` vs `GitBranch` by `isWorktree`, the worktree tag carrying `worktreePath` in its `title`, statistics rendering as absent when the store has none, and the repo folder path on the group header

### Implementation for User Story 2

- [ ] T020 [P] [US2] Add `changeStatsSchema` and its inferred `ChangeStats` type to `src/shared/schemas/git.schema.ts`
- [ ] T021 [US2] Implement `getChangeStats(cwd)` in `src/main/git/git-service.ts` running `git diff --numstat HEAD` through the module's existing `execFile` wrapper, `GIT_TIMEOUT` and `GIT_ENV`
- [ ] T022 [US2] Register the `git:change-stats` invoke handler in `src/main/ipc/git.ipc.ts`, resolving `{ error }` rather than rejecting across the boundary
- [ ] T023 [US2] Expose `electronAPI.git.changeStats(cwd)` in `src/preload/index.ts`
- [ ] T024 [US2] Create `src/renderer/stores/change-stats.store.ts` with `statsFor` / `ensure` / `invalidate`, a 15s TTL, injected `now`, and in-flight collapsing — `ensure` returns void and is never awaited by render (contracts/change-stats-ipc.md)
- [ ] T025 [P] [US2] Create `src/renderer/sidebar/branch-display.ts` exporting the pure `displayName(branch)` — **note: an addition to the file list in plan.md**, made so the display rule is unit-testable in isolation rather than buried in the component
- [ ] T026 [US2] Render the branch glyph, `displayName` and worktree tag on the project-scope header in `src/renderer/components/sidebar/SessionGroup.tsx`, truncating the name head-first so the disambiguating tail survives
- [ ] T027 [US2] Render change statistics on the branch row and the repo folder path on the repo group header in `src/renderer/components/sidebar/SessionGroup.tsx`, calling `ensure` at render and rendering nothing when the entry is absent, loading or errored
- [ ] T028 [US2] Style the glyph, tag, statistics and repo path in `src/renderer/components/sidebar/SessionGroup.css`, keeping icons flat and `currentColor`
- [ ] T029 [US2] Invalidate a branch's cached statistics when a session in it stamps activity, in `src/renderer/stores/session.store.ts`
- [ ] T030 [US2] Invalidate on completed git operations and on window focus in `src/renderer/components/sidebar/UnifiedSidebar.tsx`
- [ ] T031 [US2] Write `docs/adr/031-change-stats-out-of-band.md` recording why statistics live in their own store rather than on the branch record, and the purity constraint that forced it (constitution IX, research R2)

**Checkpoint**: Both P1 stories are done. The sidebar now answers "what is happening" and "where am I". This is the point at which the feature is worth shipping even if US3 and US4 never land.

---

## Phase 5: User Story 3 — One name for one thing, everywhere (Priority: P2)

**Goal**: No surface can name a branch ambiguously, and the word "project" is gone from the product.

**Independent Test**: With six repos each on `main`, open the palette and confirm no two entries read identically (SC-002); confirm no user-facing string says "project" (SC-004).

### Tests for User Story 3 ⚠️ Write first, confirm they fail

- [ ] T032 [P] [US3] Add a failing test to `tests/unit/renderer/components/UnifiedSidebar.spec.tsx` asserting that six repos whose branch is `main` produce six textually distinct new-terminal commands (SC-002, FR-011)
- [ ] T033 [P] [US3] Add a failing test to `tests/unit/renderer/components/CommandPalette.spec.tsx` asserting session entries name both repo and branch (FR-012)
- [ ] T034 [P] [US3] Add failing tests to `tests/unit/renderer/components/LinkIssueDialog.spec.tsx` and `tests/unit/renderer/components/MoveSessionDialog.spec.tsx` asserting "branch" wording and repo qualification (FR-014)
- [ ] T035 [P] [US3] Add a failing test to `tests/unit/renderer/components/TabBar.spec.tsx` asserting the session tab bar states which branch's terminals it is showing (FR-013)

### Implementation for User Story 3

- [ ] T036 [US3] Add the vocabulary lint rule to `.eslintrc.json` — fail on the case-insensitive word "project" in user-facing string literals and JSX text under `src/renderer/components/`, allowlisting identifiers, import paths and type names (research R4)
- [ ] T037 [US3] Qualify the registered `core.scope.new-terminal.*` command labels with their repo in `src/renderer/components/sidebar/UnifiedSidebar.tsx`
- [ ] T038 [US3] Name repo and branch on session entries in `src/renderer/components/CommandPalette.tsx`
- [ ] T039 [US3] Add the branch scope label to `src/renderer/components/terminal/TabBar.tsx`
- [ ] T040 [P] [US3] Update copy in `src/renderer/components/integrations/LinkIssueDialog.tsx`, `src/renderer/components/sidebar/MoveSessionDialog.tsx` and `src/renderer/components/sidebar/CreateProjectDialog.tsx` to say "branch" and name the repo
- [ ] T041 [P] [US3] Update the remaining user-facing strings — the group-header add action and rename/remove menu items in `src/renderer/components/sidebar/SessionGroup.tsx`, `src/renderer/components/sidebar/ScopeMenu.tsx`, and the removal confirmation title in `src/renderer/components/sidebar/UnifiedSidebar.tsx` — **wording only; do not add the missing worktree disclosure, which belongs to audit finding PRJ-1 and its own feature**
- [ ] T042 [US3] Write `docs/adr/032-branch-vocabulary-ui-only.md` recording why the stored `Project` entity keeps its name, what the translation seam costs, and how the lint rule contains it (constitution IX, research R4)

**Checkpoint**: The product says "branch" and every name identifies exactly one thing.

---

## Phase 6: User Story 4 — App-level surfaces have one home (Priority: P3)

**Goal**: One labelled band replaces four unlabelled icons at the top and one button at the bottom; scratch becomes a group.

**Independent Test**: Ask someone who has not used the app to name every icon in the sidebar header, before and after.

### Tests for User Story 4 ⚠️ Write first, confirm they fail

- [ ] T043 [P] [US4] Write failing tests in `tests/unit/renderer/components/AppBand.spec.tsx` — every registration renders a visible label and an `aria-label`, an unresolved icon name falls back to `Square` without throwing, entries fire `onSelect` with the right id, focus order follows DOM order, and a contributed sidebar item and a global tab both appear in the same band (contracts/app-band.md)
- [ ] T044 [P] [US4] Add failing tests to `tests/unit/renderer/components/SidebarHeader.spec.tsx` asserting the bell and add-repo controls sit on the search row and no unlabelled icon row remains (FR-017)
- [ ] T045 [P] [US4] Add failing tests to `tests/unit/renderer/components/UnifiedSidebar.spec.tsx` asserting scratch renders as a group with a count, no `ExtensionFooter` is in the tree, and each contributed item still appears exactly once (FR-018, existing FR-028 assertions must keep passing)

### Implementation for User Story 4

- [ ] T046 [US4] Create `src/renderer/components/sidebar/AppBand.tsx` rendering global tabs and contributed sidebar items in one band, iterating registry data only and naming no extension in code (constitution II, contracts/app-band.md)
- [ ] T047 [US4] Add the icon-name to lucide-component resolution with a `Square` fallback inside `src/renderer/components/sidebar/AppBand.tsx`, so an extension typo cannot break the sidebar
- [ ] T048 [P] [US4] Style the band in `src/renderer/components/sidebar/AppBand.css` — icon above visible label, ruled off from the session list, visible keyboard focus ring
- [ ] T049 [US4] Restructure `src/renderer/components/sidebar/SidebarHeader.tsx` to render `AppBand` above the search row and move the bell and add-repo controls onto the search row
- [ ] T050 [US4] Delete `src/renderer/components/sidebar/ExtensionFooter.tsx` and `ExtensionFooter.css`, remove its usage from `UnifiedSidebar.tsx`, and move the assertions from `tests/unit/renderer/components/ExtensionFooter.spec.tsx` into `AppBand.spec.tsx` before deleting that spec (constitution X — no orphaned files, no lost coverage)
- [ ] T051 [US4] Render scratch sessions as a group with a count and a "New scratch terminal" action in `src/renderer/components/sidebar/UnifiedSidebar.tsx` — **do not change the count `buildGroups` reports; audit finding NAV-6 is out of scope** (contracts/app-band.md)
- [ ] T052 [US4] Delete `src/renderer/components/sidebar/ScratchSection.tsx` and `ScratchSection.css` and fold `tests/unit/renderer/components/ScratchSection.spec.tsx` into the sidebar spec
- [ ] T053 [US4] Write `docs/adr/033-one-app-band.md` recording why two contribution points render into one surface and why that does not violate extension isolation (constitution IX, research R5)

**Checkpoint**: All four stories functional and independently verifiable.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T054 [P] Write `tests/e2e/sidebar-branch-first.spec.ts` covering: four states visible at rest, worktree distinguishable from checkout, the palette with two same-named branches, and the band surviving an extension registering after mount
- [ ] T055 [P] Update the sidebar section of `docs/ARCHITECTURE.md` — the component hierarchy gains `AppBand` and loses `ExtensionFooter`/`ScratchSection`; document `change-stats.store` and why it sits outside the pure view-model layer (constitution VIII)
- [ ] T056 [P] Update the session-views bullet in `README.md` to the branch vocabulary and the enriched row
- [ ] T057 [P] Update `docs/user-guide/USER-GUIDE.md` for the branch vocabulary and the app band
- [ ] T058 Verify `tests/unit/renderer/sidebar/view-model.spec.ts` and `view-model-performance.spec.ts` are byte-identical to the base commit via `git diff` — an edit to either means the pure core was changed and the design was not followed
- [ ] T059 Run `npm run format`, then `npm run lint` and confirm 0 errors, including the new vocabulary rule
- [ ] T060 Run `npx vitest run --coverage` and confirm all pass with every new file at ≥ 80% statements, branches, functions and lines: `session-status.ts`, `branch-display.ts`, `change-stats.store.ts`, `AppBand.tsx`
- [ ] T061 Run `npx playwright test` and confirm the full e2e suite passes
- [ ] T062 Walk every scenario in `specs/032-branch-first-sidebar/quickstart.md` by hand, including the greyscale check for SC-001 and the `git diff --numstat` spawn count for the TTL

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 blocks everything — the rebase must land first
- **Foundational (Phase 2)**: depends on Setup; blocks US1 and US2
- **US1 (Phase 3)** and **US2 (Phase 4)**: both depend on Foundational, and are independent of each other
- **US3 (Phase 5)**: independent of US1 and US2 in principle, but T037 and T041 touch `UnifiedSidebar.tsx` and `SessionGroup.tsx`, which US2 also edits — sequence US3 after US2 to avoid conflicts, or accept the merge cost
- **US4 (Phase 6)**: independent of all three; touches `SidebarHeader.tsx` and `UnifiedSidebar.tsx`
- **Polish (Phase 7)**: depends on every story you intend to ship

### Within Each User Story

Tests are written and confirmed failing before the implementation task that satisfies them. Pure modules land before the components that consume them. Main-process work lands before the store that calls it.

### Parallel Opportunities

- T002, T003 in Setup
- T005, T006 in Foundational
- All of T007–T011 (US1 tests) — five different assertions, two files
- All of T015–T019 (US2 tests) — five different files
- T020 and T025 (schema and pure display helper) — no shared file
- All of T032–T035 (US3 tests) — four different files
- All of T043–T045 (US4 tests) — three different files
- T040 and T041 (US3 copy) — disjoint file sets
- T054–T057 in Polish — e2e and three doc files

### Conflict Warnings

These files are touched by more than one story. Do not run them in parallel across stories:

| File                                                     | Touched by                         |
| -------------------------------------------------------- | ---------------------------------- |
| `src/renderer/components/sidebar/UnifiedSidebar.tsx`     | T004, T030, T037, T041, T050, T051 |
| `src/renderer/components/sidebar/SessionGroup.tsx`       | T026, T027, T041                   |
| `tests/unit/renderer/components/UnifiedSidebar.spec.tsx` | T006, T032, T045                   |

---

## Parallel Example: User Story 1

```bash
# All five US1 test tasks can be written at once — they touch two files
# and assert independent behaviours:
Task: "T007 pure status mapping tests in tests/unit/renderer/sidebar/session-status.spec.ts"
Task: "T008 glyph unchanged by selection in SessionRow.spec.tsx"
Task: "T009 spinner/bell/state precedence in SessionRow.spec.tsx"
Task: "T010 aria-label carries the status label in SessionRow.spec.tsx"
Task: "T011 no colour on the icon element in SessionRow.spec.tsx"

# Then implementation, in order — T012 before T013 before T014.
```

---

## Implementation Strategy

### MVP scope

**Phases 1–3 (T001–T014).** US1 alone is a shippable increment: it fixes the defect the audit ranked highest among the design problems (SESS-1) and needs nothing from the other three stories. Fourteen tasks, one new pure module, one component and one stylesheet.

### Recommended delivery

1. **Setup + Foundational** → rebased, baseline recorded, sidebar wide enough
2. **US1** → state is visible → **stop and validate against SC-001 in greyscale**
3. **US2** → branch identity and worktrees → validate SC-003 and SC-005
4. — natural release point; both P1 stories deliver the audit's core finding —
5. **US3** → vocabulary → validate SC-002 and SC-004
6. **US4** → app band → validate SC-007

### A warning about US1

This story makes the existing "waiting on you" inference visible for the first time. That signal is inferred from the terminal bell and the README already admits it under-reports. Expect US1 to surface wrong states, and **do not fix the inference here** — that is a separate concern, and the point of making it visible is to find out how bad it is.

---

## Notes

- `[P]` means different files and no dependency on incomplete work.
- Every test task must be confirmed failing before its implementation task starts (constitution VI).
- Commit per task or per logical group; the repo's pre-commit hook runs format, lint and related tests.
- Three deliberate exclusions, each with an owning finding, so a reviewer can tell absence from oversight: the worktree disclosure on removal (PRJ-1), the count-versus-rows defect (NAV-6), and the dead `expandedWorkspaceIds` state (WS-2).
- T025 adds `src/renderer/sidebar/branch-display.ts`, which is not in plan.md's file list. Recorded here rather than added silently.
