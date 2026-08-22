---
description: 'Task list for feature implementation'
---

# Tasks: Sidebar Session Views

**Input**: Design documents from `/specs/030-sidebar-session-views/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks are included and are **not optional**. Constitution Principle VI (NON-NEGOTIABLE) requires Red → Green → Refactor: the failing spec is written before the code that satisfies it, and the 80% coverage gate on statements/branches/functions/lines is a hard blocker.

**Organization**: Tasks are grouped by user story. **Read the honesty note below before planning around "independent" stories.**

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US6 from [spec.md](./spec.md))
- Every task names its exact file path

## Path Conventions

Single Electron project: `src/main/`, `src/renderer/`, `src/shared/` at repository root.

**Specs do NOT live beside their subjects** — verified against `vitest.config.ts`, whose include globs are `tests/unit/**/*.spec.tsx` (jsdom), `tests/unit/**/*.spec.ts` (node), `tests/integration/**`, and a few `src/**/__tests__/**` exceptions. A spec written next to its source would not run at all. The homes are:

| Subject                                                   | Spec location                                             |
| --------------------------------------------------------- | --------------------------------------------------------- |
| Renderer components                                       | `tests/unit/renderer/components/`                         |
| Renderer stores / hooks / terminal / extensions / sidebar | `tests/unit/renderer/<area>/`                             |
| Main-process extension API                                | `tests/unit/extensions/api.spec.ts`                       |
| IPC handlers                                              | `tests/integration/ipc/` (workspace) or `tests/unit/ipc/` |
| Shared schemas                                            | `tests/unit/schemas/`                                     |

`tests/unit/renderer/sidebar/` is new and must be created. All commands run from the worktree directory.

## Honesty note on story independence

This feature is layered, not sliced. The template's promise that every story is independently deliverable does not hold here, and pretending otherwise would produce a plan that breaks halfway through:

- **US1 cannot ship without the whole foundation** — the session model, activity tracking, and the pure view model all sit underneath it. Phase 2 is correspondingly large.
- **US3 (stale cleanup) depends on US4 (views UI)** — the Stale view is selected through the view bar. US4 is therefore sequenced before US3 despite both being P2.
- **US5 (filter notice) depends on US4** — nothing is filtered until views exist. It is sequenced immediately after US4, before US3, because the first filtered view a user sees must already explain itself.
- **US2 (extension surfaces) is independent of US4** — its regression spec drives components with an explicit view prop rather than through the view bar.

Phase order below is US1 → US2 → US4 → US5 → US3 → US6, which stays inside the spec's priority bands (P1, P1, P2, P2, P2, P3) while respecting real dependencies.

---

## Phase 1: Setup

**Purpose**: Establish the baseline that later coverage claims are measured against.

- [x] T001 Confirm the worktree is on branch `030-sidebar-session-views` and run `npm ci && npm run build:extensions` from the worktree root (`extensions/*/src/index.js` is a gitignored build artifact — the app will not run without this)
- [x] T002 Record the pre-change baseline by running `npx vitest run --coverage` from the worktree root and pasting the summary into the PR draft; it must reproduce 354 files / 6121 tests passing and 94.67% / 87.75% / 91.17% / 95.89% before any edit (see [research.md](./research.md) R11)

**Checkpoint**: Baseline captured. Any later number below it is a regression, not noise.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Defect fixes, dead-code removal, extracted primitives, the session model, and the pure view model. Every user story depends on this phase.

**⚠️ CRITICAL**: No user story work begins until this phase is complete and green.

### 2a — Confirmed defects (spec FR-034 to FR-036)

Fix these first so they are not inherited by the new rows and misread as regressions this feature introduced. Each is a bug fix, so Principle VI's no-exception rule applies: reproduce with a failing spec before fixing.

- [x] T003 [P] Add a failing spec in `tests/unit/renderer/components/ProjectRow.spec.tsx` proving a bell on one session currently shows a count on every sibling row in the same project
- [x] T004 [P] Add a failing spec in `tests/unit/renderer/components/ProjectRow.spec.tsx` proving a busy child row currently reflects its parent's busy state
- [x] T005 Fix `src/renderer/components/sidebar/ProjectRow.tsx:236,262` to pass `getBellCountForSession(session.id)` / `getBellCountForSession(child.id)` instead of `getBellCountForProject(project.id)` (the store method already exists at `session.store.ts:371`), making T003 pass
- [x] T006 Fix `src/renderer/components/sidebar/ProjectRow.tsx:261` to pass `isBusy={isSessionBusy(child.id)}` instead of the parent's id, making T004 pass
- [x] T007 Delete the unreachable `gitDirty`, `gitConflict`, and `onBranchBadgeClick` props and the `project-row__branch-chip` block they gate from `src/renderer/components/sidebar/ProjectRow.tsx` (no caller passes them, and the chip additionally renders only when `!branchSwitcher`, which `WorkspaceCard.tsx:184` always supplies), plus the matching rules in `src/renderer/components/sidebar/ProjectRow.css` and any spec that asserted them

### 2b — Dead code removal (Constitution X, [research.md](./research.md) R3, R12)

Only items 3 and 4 of the R12 inventory are deleted. Items 1 and 2 — `registerSidebarButton` / `sidebarButtons` / `SidebarButtonRegistration` and `ExtensionFooter` — are **kept and wired up** in Phase 4 instead; see [research.md](./research.md) R1-CORRECTION.

- [x] T008 [P] Add specs in `tests/unit/renderer/extensions/registry.spec.ts` covering `registerSidebarButton` add, dedupe-on-id, and disposal — the function exists (`registry.ts:224-228`) and is currently uncovered (lines 225-227 are the only uncovered lines in that file), because nothing has ever called it. Do **not** add it to `ExtensionRendererAPI` (invariant I7)
- [x] T009 [P] Remove the `ExtensionFooter` import and its per-workspace call site at `src/renderer/components/sidebar/WorkspaceCard.tsx:191` only. Keep `ExtensionFooter.tsx` and `ExtensionFooter.css`, plus `tests/unit/renderer/components/ExtensionFooter.spec.tsx` — Phase 4 re-hosts the component once in the sidebar footer (FR-028)
- [x] T010 [P] Delete the dead `TerminalSessionSchema` export from `src/shared/schemas/session.schema.ts:6-15` and any spec referencing it (verify with `grep -rn "TerminalSessionSchema" src extensions` returning nothing first)

### 2c — Extracted primitives ([research.md](./research.md) R10)

- [x] T011 [P] Write `tests/unit/renderer/hooks/useDragReorder.spec.tsx` covering drag start, hover index, drop reorder, drag leave, and drag end for a generic item list
- [x] T012 Implement `src/renderer/hooks/useDragReorder.ts` satisfying T011
- [x] T013 Migrate `src/renderer/components/sidebar/WorkspaceCard.tsx:68-93` and `ProjectRow.tsx:203-230` to `useDragReorder`. Leave `UnifiedSidebar.tsx:141-163` alone — T036 rewrites that body and T039 deletes the workspace reorder it serves, so migrating it first is throwaway work. Leave `src/renderer/components/terminal/TabBar.tsx:84-109` alone too (out of blast radius)
- [x] T014 [P] Write `tests/unit/renderer/components/ContextMenu.spec.tsx` covering positioning, click-outside dismissal, item click, and the existing `window` `CustomEvent('close-context-menus')` coordination
- [x] T015 Implement `src/renderer/components/ContextMenu.tsx` + `ContextMenu.css` satisfying T014, preserving the `ctx-menu` / `ctx-menu__item` / `ctx-menu__item--danger` / `ctx-menu__separator` class contract
- [x] T016 Migrate all four menu sites to `ContextMenu` — `src/renderer/components/sidebar/ScratchSection.tsx:37,138`, `ProjectRow.tsx:92,324`, `WorkspaceCard.tsx:97,255`, `SessionRow.tsx:65,161`

### 2d — Session model and activity tracking (plan Phase 1, [contracts/session-state.md](./contracts/session-state.md))

- [x] T017 [P] Write `tests/unit/renderer/sidebar/agent-state.spec.ts` as a table test over the four-row derivation precedence in [contracts/session-state.md](./contracts/session-state.md), including a session that is both belled and busy resolving to `awaiting-input`
- [x] T018 Add `lastActivityAt: number`, `lastAttendedAt?: number`, `agentState: AgentState`, and `note?: string` to `TerminalSession` in `src/shared/types/index.ts:44-58`, each commented as renderer-side view state in the same style as the existing `bellCount` / `busy`, and export the `AgentState` union
- [x] T019 Implement `src/renderer/sidebar/agent-state.ts` — the `AgentStateSource` interface and the single `BellAndBusySource` implementation — satisfying T017
- [x] T020 [P] Write failing specs in `tests/unit/renderer/stores/session.store.spec.ts` for `stampActivity(sessionId, now)` as a pure patch, `lastActivityAt` backfill to `Date.parse(createdAt)` at construction, `note` normalisation (newlines stripped, ≤120 chars, empty stored as `undefined`), and `lastAttendedAt` stamping inside `setActiveSessionForProject`
- [x] T021 Implement those setters in `src/renderer/stores/session.store.ts`, keeping every one a pure patch with no timing logic (Principle XI)
- [x] T022 [P] Write `tests/unit/renderer/terminal/session-controller.spec.ts` proving that with an injected fake clock, 100 `onBusy` callbacks inside one second produce exactly one `stampActivity` write, and the next call after the clock advances past one second produces a second
- [x] T023 Implement the throttle in `src/renderer/terminal/session-controller.ts:28-34` — a module-level `Map<sessionId, number>` plus an injectable `now()` defaulting to `Date.now` — satisfying T022

### 2e — The pure view model (plan Phase 2, [contracts/view-model.md](./contracts/view-model.md))

- [x] T024 [P] Write `tests/unit/renderer/sidebar/view-model.spec.ts` covering `isStale` for all five rows of the boundary table in [contracts/view-model.md](./contracts/view-model.md) — exactly at threshold is NOT stale, one ms past IS, `awaiting-input` never, `exited` always, and recomputation as `now` advances
- [x] T025 [P] Extend `tests/unit/renderer/sidebar/view-model.spec.ts` with a table test over every `GroupKey` × `SortKey` × filter combination, plus: empty groups dropped, no session in two groups, deep-equality on repeat calls, and no mutation of any input
- [x] T026 Implement `isStale` and `buildGroups` in `src/renderer/sidebar/view-model.ts` with the fixed filter → group → sort-within → sort-groups order and the `BuildResult { groups, shown, total }` shape, importing only types — no React, no store, no `Date.now()`
- [x] T027 [P] Write `tests/unit/renderer/sidebar/views.spec.ts` covering the four built-in view definitions, `loadViews` degrading to built-ins on corrupt JSON without throwing, `saveViews` swallowing write failures, and `loadViews` never returning a filtered view as active
- [x] T028 Implement `src/renderer/sidebar/views.ts` — built-in views as data, plus `loadViews` / `saveViews` over the `terminator.sidebar.views` localStorage key, following the `workspace.store.ts:38-47` try/catch convention
- [x] T029 Run `npx vitest run --coverage src/renderer/sidebar/` and confirm the pure layer is at **100%**, not 80% — it is the cheapest place in this feature to be certain

**Checkpoint**: Suite green, coverage not below the T002 baseline, zero visual change in the running app. The only behavioural delta is the `ExtensionFooter` deletion, which is provably invisible because it returned `null` on every render.

---

## Phase 3: User Story 1 — See every session at a glance (Priority: P1) 🎯 MVP

**Goal**: One flat list showing every session with status and recency, grouped by project by default, nothing hidden behind a collapsed header.

**Independent Test**: Create multiple workspaces, projects, and sessions; open the app; confirm all sessions are visible on first paint with a status indicator and relative last-activity time, grouped under their project.

### Tests for User Story 1

- [x] T030 [P] [US1] Write `tests/unit/renderer/components/SessionGroup.spec.tsx` asserting the scope-bearing header renders chevron, project icon, name, `BranchSwitcher` slot, busy aggregate, `+ new terminal`, and context menu when `scope.kind === 'project'`, and label + count only when `scope` is absent
- [x] T031 [P] [US1] Write `tests/unit/renderer/components/SessionRow.spec.tsx` additions for the project badge, relative last-activity text, the three-opacity status dot, and the `awaiting-input` edge bar plus text pill
- [x] T032 [P] [US1] Write `tests/unit/renderer/components/UnifiedSidebar.spec.tsx` asserting all sessions render on first paint with nothing expanded, groups default to expanded, and selecting any session sets `activeProjectId` to that session's `projectId`
- [x] T033 [P] [US1] Read `tests/unit/renderer/components/WorkspaceCard.spec.tsx` and `ProjectRow.spec.tsx` and re-home every still-relevant assertion onto the specs above **before** their subjects are deleted — behaviour nobody remembered is lost at deletion time, not discovered later

### Implementation for User Story 1

- [x] T034 [US1] Implement `src/renderer/components/sidebar/SessionGroup.tsx` + `SessionGroup.css` — the scope-bearing group header per invariant I2 in [contracts/extension-surfaces.md](./contracts/extension-surfaces.md), hosting expand/collapse, project icon (`FolderGit2` / `GitBranch`), name, `BranchSwitcher`, busy aggregate, `+ new terminal`, and the project/workspace context menu
- [x] T035 [US1] Extend `src/renderer/components/sidebar/SessionRow.tsx` + `SessionRow.css` with the project badge, relative last-activity, and the status vocabulary from [research.md](./research.md) R8 — one lucide dot at three opacities, a 3px accent left-edge bar plus a text pill for `awaiting-input`, no unicode glyphs, no hue-only distinction
- [x] T036 [US1] Rewrite the body of `src/renderer/components/sidebar/UnifiedSidebar.tsx` to render `buildGroups` output, keeping the existing resize behaviour and `terminator.sidebar.width` persistence untouched and leaving `SidebarHeader` exactly as-is (invariant I1)
- [x] T037 [US1] Set `activeProjectId = session.projectId` alongside `setActiveSessionForProject` on every session selection so it is never undefined under any grouping (invariant I4 — load-bearing for the auto-open effect at `App.tsx:303-318`)
- [x] T037a [P] [US1] Write `tests/unit/renderer/sidebar/collapse-state.spec.ts` per the `GroupCollapseState` entity in [data-model.md](./data-model.md) — empty set means expanded (so FR-008 needs no first-run write), per-grouping-mode isolation, unknown keys ignored on read, stale keys pruned on write, corrupt JSON degrading to `{}` without throwing
- [x] T038 [US1] Implement `src/renderer/sidebar/collapse-state.ts` over the `terminator.sidebar.collapsed` key, then delete the two superseded keys and their store members from `src/renderer/stores/workspace.store.ts:38-47,229-275` — `expandedWorkspaceIds`, `collapsedProjectIds`, `toggleWorkspaceCollapse`, `setExpandedWorkspaceIds`, `toggleProjectCollapse`, `ensureProjectExpanded`. **`useKeyboardShortcuts.ts:34` calls `setExpandedWorkspaceIds` inside `cycleWorkspace`** and must be updated in this same task or the build breaks
- [x] T039 [US1] Delete `src/renderer/components/sidebar/WorkspaceCard.tsx`, `WorkspaceCard.css`, `ProjectRow.tsx`, `ProjectRow.css`, and their specs under `tests/unit/renderer/components/`, and remove their imports from `UnifiedSidebar.tsx` (only after T033)
- [x] T040 [US1] Run `npx vitest run --coverage tests/unit/renderer/components/UnifiedSidebar.spec.tsx` and confirm `UnifiedSidebar.tsx` is at **≥80% on all four metrics** — it entered this feature at 69.41% / 69.23% / 75% / 71.25%, below the patch-coverage gate ([research.md](./research.md) R11). This is a phase exit condition, not a PR-time discovery.

**Checkpoint**: The sidebar is a flat list. Run the app and look at it — the task list is not evidence that a UI works.

---

## Phase 4: User Story 2 — Every extension action stays reachable (Priority: P1)

**Goal**: All four extension surfaces reachable in every grouping mode — including the sidebar-item surface, which is contributed to today but has never rendered. **This phase is the merge gate for the whole feature.**

**Independent Test**: With SpecKit Pilot and Git Integration installed, switch grouping through all five modes and confirm each contributed action is present and fires — including clicking "Git Changes" in the sidebar footer and seeing the panel toggle.

### Tests for User Story 2

- [x] T041 [US2] Write `tests/unit/renderer/components/extension-surfaces.spec.tsx` implementing every obligation in [contracts/extension-surfaces.md](./contracts/extension-surfaces.md): register a fake extension contributing a `workspaceTab`, a `projectTab`, and a sidebar item, then for **each** of the five grouping modes assert global tab buttons render and fire, the workspace tab is reachable and fires with the correct `workspaceId`, the sidebar item renders exactly once in the footer and its click reaches the handler, selection leaves `activeProjectId` correct, and the project tab resolves
- [x] T042 [P] [US2] Add to the same spec the once-only assertions: `⌘⇧G` toggles the git-integration sidebar panel; `ExtensionContributes` and `ExtensionRendererAPI` member lists match inline literals so an accidental change fails loudly; and `api.sidebar.togglePanel` is present (invariant I5)
- [x] T043 [P] [US2] Write `tests/unit/renderer/components/ScopeMenu.spec.tsx` asserting the row-level menu offers the same workspace- and project-scoped actions as a scope-bearing header, and fires with the row's own project and workspace ids

### Implementation for User Story 2

- [x] T044 [US2] Render the hover-revealed `workspaceTabs` buttons on the `SessionGroup` header in `src/renderer/components/sidebar/SessionGroup.tsx`, on the workspace's first group under project grouping and on the header itself under workspace grouping, preserving the `.ws-card__header:hover` reveal semantics in `SessionGroup.css`
- [x] T045 [US2] Implement `src/renderer/components/sidebar/ScopeMenu.tsx` + `ScopeMenu.css` on top of the extracted `ContextMenu`, exposing the same registry-sourced workspace and project actions for use under non-scope groupings (invariant I3)
- [x] T046 [US2] Wire the scope affordance into `SessionRow.tsx` — the project badge opens `ScopeMenu` — and into the row context menu
- [x] T047 [US2] Register the scope actions as renderer `commands` in the extension registry so they appear in the existing `⌘K` palette, satisfying the third reachability path in FR-027 without adding a second palette
- [x] T043a [P] [US2] Write `tests/unit/extensions/api.spec.ts` additions for `dispatchSidebarItemClick(itemId)` — invokes the matching registered item's `onClick`, no-ops on an unknown id — mirroring the existing `dispatchContextMenuClick` tests
- [x] T043b [P] [US2] Write `tests/unit/extensions/api.spec.ts` additions for `api.sidebar.togglePanel()` — sends `extension:toggle-panel` with the calling extension's panel id to every window. The channel is declared (`manifest.ts:371`) and both renderer sides already listen (`App.tsx:341-343`, `preload-webview.ts:152-153`); **nothing has ever sent on it**, which is why the one real sidebar item toasts a hint instead of acting (FR-028a)
- [x] T043c [P] [US2] Write `tests/unit/renderer/extensions/loader.spec.ts` additions asserting `initExtensions` fetches `extension.getSidebarItems()` and registers one `sidebarButton` per item whose `action` invokes `extension:sidebar-item-click` with that item's id
- [x] T044a [US2] Implement `dispatchSidebarItemClick` in `src/main/extensions/api.ts` next to `dispatchContextMenuClick:476-484`; add the `extension:sidebar-item-click` handler to `src/main/ipc/extension.ipc.ts` and declare the channel in `src/shared/electron-api/manifest.ts` beside `extension:get-sidebar-items:282`
- [x] T044b [US2] Implement `api.sidebar.togglePanel()` in `src/main/extensions/api.ts:608-613` and add it to the `ExtensionAPI` interface at `:213-217`; mirror the declaration into `packages/extension-sdk/types/api.d.ts:145` and bump `packages/extension-sdk/package.json` from 1.0.0 to **1.1.0** — additive, so no extension must change (FR-030)
- [x] T044c [US2] Change `extensions/git-integration/src/index.ts:145-158` so the sidebar item's `onClick` calls `api.sidebar.togglePanel()` instead of showing the "Toggle git sidebar via View menu or shortcut" toast, then run `npm run build:extensions`
- [x] T044d [US2] Fetch `extension.getSidebarItems()` in `src/renderer/extensions/loader.ts` during `initExtensions` and register each through `registry.registerSidebarButton` with an `action` that invokes the click channel — **without** adding `registerSidebarButton` to `ExtensionRendererAPI` (invariant I7)
- [x] T044e [US2] Render `ExtensionFooter` once at the bottom of `src/renderer/components/sidebar/UnifiedSidebar.tsx`, outside the group list so it survives every regrouping, and update `tests/unit/renderer/components/ExtensionFooter.spec.tsx` for the new host
- [x] T048 [US2] Confirm `git diff src/shared/types/index.ts src/renderer/extensions/registry.ts` shows no change to `ExtensionContributes` or `ExtensionRendererAPI`, and state in the PR body that the only API changes are additive — `api.sidebar.togglePanel` plus the `extension:sidebar-item-click` channel, SDK 1.0.0 → 1.1.0 — with that diff as evidence (FR-030)

**Checkpoint**: T041 green in all five grouping modes. If it is red the feature does not merge regardless of what else is green.

---

## Phase 5: User Story 4 — Switch and save views (Priority: P2)

**Goal**: Named views selectable in one click, grouping and sort changeable, custom views saved and surviving restart. Sequenced before US3 and US5 because both are selected and triggered through this UI.

**Independent Test**: Switch between built-in views, change grouping and sort, save a custom view, restart, and confirm it is still there and produces the same result.

### Tests for User Story 4

- [x] T049 [P] [US4] Write `tests/unit/renderer/components/ViewBar.spec.tsx` covering view chip selection, the group-by and sort menus, per-view persistence of grouping/sort overrides, and custom-view save and delete
- [x] T050 [P] [US4] Write a spec asserting the sidebar restores to the unfiltered `everything` view on mount even when the last-used view was filtered (FR-015) — a user opening a laptop to 6 of 22 sessions reads it as data loss

### Implementation for User Story 4

- [x] T051 [US4] Implement `src/renderer/components/sidebar/ViewBar.tsx` + `ViewBar.css` — saved-view chips, group-by/sort menu, and the hide-stale toggle — inserted **below** `SidebarHeader`, which stays untouched (invariant I1)
- [x] T052 [US4] Wire `ViewBar` into `src/renderer/components/sidebar/UnifiedSidebar.tsx` as the source of the `view` argument passed to `buildGroups`, with the active view held in component state and never persisted
- [x] T053 [US4] Implement custom-view creation, rename, and delete against `saveViews` in `src/renderer/sidebar/views.ts`, enforcing the reserved built-in ids and the 1-40 character name rule from [data-model.md](./data-model.md)

**Checkpoint**: Views switch, persist, and never restore filtered.

---

## Phase 6: User Story 5 — Never be silently shown a subset (Priority: P2)

**Goal**: Any active filter is explained on screen with shown/total counts and a one-click escape.

**Independent Test**: Apply any filter, confirm the notice shows correct counts, click "show all", confirm the full list returns.

### Tests for User Story 5

- [x] T054 [P] [US5] Write `tests/unit/renderer/components/FilterNotice.spec.tsx` asserting the notice renders with correct shown/total counts when filtered, does not render when unfiltered, cannot be dismissed, and that "show all" clears every filter

### Implementation for User Story 5

- [x] T055 [US5] Implement `src/renderer/components/sidebar/FilterNotice.tsx` + `FilterNotice.css` reading `shown` and `total` straight off the `BuildResult` (they exist on it precisely for this — see [contracts/view-model.md](./contracts/view-model.md))
- [x] T056 [US5] Render it in `src/renderer/components/sidebar/UnifiedSidebar.tsx` whenever `shown < total`, and wire "show all" to reset the active view to `everything` with filters cleared

**Checkpoint**: No filter can hide a session without saying so.

---

## Phase 7: User Story 3 — Find and clean up abandoned sessions (Priority: P2)

**Goal**: A Stale view, a configurable threshold, multi-select, and bulk close including worktree removal.

**Independent Test**: Create sessions with varying activity times and states, open the Stale view, confirm the correct set, multi-select, bulk close, and confirm sessions and worktrees are gone.

### Tests for User Story 3

- [x] T057 [P] [US3] Write specs in `tests/unit/schemas/settings.schema.spec.ts` for the new `sidebar.staleAfterMs` field — default 7_200_000, rejects below 60_000 and above 2_592_000_000 (the spec's "zero or very large" edge case must be a validation failure, not a nonsense view)
- [x] T058 [P] [US3] Write a spec asserting a threshold change in settings is reflected in the Stale view without a restart (FR-019 / spec acceptance scenario 6)
- [x] T059 [P] [US3] Write `tests/unit/renderer/components/BulkCloseDialog.spec.tsx` asserting the confirmation names the exact worktree paths leaving disk before confirmation, and that an `awaiting-input` session in the selection is excluded from the action (SC-006)
- [x] T060 [P] [US3] ~~Write~~ **Verified already present** — `tests/integration/ipc/workspace.ipc.spec.ts:197-260` already pins the **existing** `project:delete` → `removeWorktree` behaviour at `workspace.ipc.ts:91-98` — this is FR-037, which is already implemented ([research.md](./research.md) R2), so this task writes a test and no production code
- [x] T061 [P] [US3] Write specs for multi-select interaction in `tests/unit/renderer/components/UnifiedSidebar.spec.tsx` — shift-click range within a group and select-all-within-group

### Implementation for User Story 3

- [x] T062 [US3] Add the `sidebar: { staleAfterMs }` group to `GlobalSettingsSchema` and `DEFAULT_GLOBAL_SETTINGS` in `src/shared/schemas/settings.schema.ts` per [contracts/session-state.md](./contracts/session-state.md), leaving `WorkspaceSettingsSchema` deliberately unextended (Principle VII)
- [x] T063 [US3] Add the staleness threshold row to `src/renderer/components/settings/GlobalSettings.tsx`
- [x] T064 [US3] Thread `staleAfterMs` from `useSettingsStore` into the `buildGroups` call in `UnifiedSidebar.tsx` so it is read at render time and the view updates as the clock and the setting move
- [x] T065 [US3] Implement multi-select state in `src/renderer/components/sidebar/UnifiedSidebar.tsx` — shift-click range and select-all-within-group, active in the Stale view only (extending it to other views is out of scope per spec Assumptions)
- [x] T066 [US3] Implement `src/renderer/components/sidebar/BulkCloseDialog.tsx` + `BulkCloseDialog.css`, listing exactly what closes and exactly which worktree paths are removed from disk, and excluding `awaiting-input` sessions from the action
- [x] T067 [US3] Wire bulk close to the existing session-close path, and for worktree-backed projects to the existing `project.delete` IPC — **no new IPC channel and no change to `src/main/git/git-service.ts`** ([research.md](./research.md) R2)

**Checkpoint**: Cleanup works end to end. Verify with `git worktree list` that a removed worktree is actually gone.

---

## Phase 8: User Story 6 — Search and keyboard navigation (Priority: P3)

**Goal**: One consistent search behaviour and keyboard access to sessions.

**Independent Test**: Type a query and confirm only matching sessions remain; exercise each shortcut and confirm the jump.

### Tests for User Story 6

- [ ] T068 [P] [US6] Write specs asserting search is a filter with one behaviour — matching sessions remain, non-matching are removed, never dimmed — matching name, note, project name, and branch (replacing the split dim/hide behaviour that `ProjectRow.tsx:75-80` and `SessionRow.tsx:44` had)
- [ ] T069 [P] [US6] Write specs asserting an empty-result query renders an explanatory empty state offering to clear the query, and that zero sessions overall renders a create-a-session empty state with no filter notice
- [ ] T070 [P] [US6] Write specs in `tests/unit/renderer/hooks/useKeyboardShortcuts.spec.tsx` for `⌘]` / `⌘[` MRU cycling across project boundaries, `⌘⇧A` jumping to the next `awaiting-input` session, and `⌘I` opening the note editor — and asserting `Escape` remains unbound
- [ ] T071 [P] [US6] Write specs in `tests/unit/renderer/components/CommandPalette.spec.tsx` for the session section listing sessions alongside existing commands

### Implementation for User Story 6

- [ ] T072 [US6] Route search through the view model's `query` filter in `UnifiedSidebar.tsx` and delete the old dim/hide paths, keeping `SidebarSearch.tsx` as the input
- [ ] T073 [US6] Implement the two empty states in `UnifiedSidebar.tsx` using lucide icons only (Principle XII — do not copy the `⬡` / `⌥` pattern at `App.tsx:583,600`, which is a pre-existing violation this feature does not own)
- [ ] T074 [US6] Add `⌘]`, `⌘[`, `⌘⇧A`, and `⌘I` to `src/renderer/hooks/useKeyboardShortcuts.ts`, verified against the taken-bindings list in [research.md](./research.md) R9, as renderer `keydown` handlers only — never `globalShortcut`, which takes an OS-exclusive claim. `⌘]` / `⌘[` order by `lastAttendedAt` descending — **this is FR-006's only consumer; if this task is cut, cut FR-006 with it** rather than leaving a field that is written and never read
- [ ] T075 [US6] Add the session section to the existing `src/renderer/components/CommandPalette.tsx` rather than building a second palette (`⌘K` is already bound to it — [research.md](./research.md) R9)
- [ ] T076 [US6] Implement inline note editing on `SessionRow.tsx` writing through the store setter from T021

**Checkpoint**: All six stories functional.

---

## Phase 9: Polish, Documentation & Verification

**Purpose**: Constitution Principle VIII is binding — documentation ships in this PR, not after it.

- [ ] T076a [P] Update `README.md:12` — the extension contribution list already claims "sidebar items", which becomes true for the first time; verify the wording matches what now renders
- [ ] T076b [P] Update `docs/EXTENSION-DEVELOPMENT.md` — document `api.sidebar.togglePanel` under `api.sidebar`, and note on the `registerItem` example at lines 187-203 that items render in the sidebar footer (they previously rendered nowhere)
- [ ] T077 [P] Update `README.md` with the sidebar views section, including the plain statement that `awaiting-input` is derived from the terminal bell and therefore under-reports, and why core cannot use Claude Code hooks (Principle II)
- [ ] T078 [P] Update `docs/ARCHITECTURE.md` (not repo root — the file lives under `docs/`) with the `src/renderer/sidebar/` view-model layer and why it contains no React, and correct the component tree at line 478: `ExtensionFooter` moves to the sidebar footer, and the `WorkspaceCard` → `ProjectRow` branch becomes `SessionGroup`
- [ ] T079 [P] Write `docs/adr/027-flat-session-list-view-model.md` recording the flat-list-with-view-model decision, the four-surface contract, alternatives considered, and the amendment history — the two corrections to the source research document **and** the subsequent reversal of R1. Use `027`; `026` is already used by two existing ADRs
- [ ] T080 Write the PR body naming every deleted item explicitly — `TerminalSessionSchema`, the dead `ProjectRow` git props, `WorkspaceCard`, `ProjectRow` — so removal reads as intent rather than collateral; and stating the two additive API changes with the SDK bump, that FR-037 was reclassified as a regression test, and that the Phase 0 decision to delete the sidebar-item surface was reversed once its live caller was found
- [ ] T081 Verify SC-008 by measuring a view switch and a regroup with 100 sessions and confirming it completes within 100 ms with no visible stutter in terminal output
- [ ] T082 Verify SC-011 by taking a greyscale screenshot of the sidebar and confirming `awaiting-input` is still distinguishable — the edge bar and pill must carry it, not hue
- [ ] T082a Verify SC-005: with 10 stale sessions listed, clear them all and count interactions — at most 3 (open Stale view, shift-click range, confirm), under 30 seconds
- [ ] T082b Verify SC-002: with 20+ sessions, locate a named session twice — once by search, once by view switch — timing both at under 10 seconds with nothing expanded
- [ ] T083 Run the full done checklist from the worktree root: `npm run format` → `npm run lint` (0 errors) → `npx vitest run --coverage` (all pass, ≥80% on all four metrics, nothing below the T002 baseline)
- [ ] T084 Run `npm run test:e2e` — the only real check that the app still boots; `npm run typecheck` and unit tests will not catch a boot failure
- [ ] T085 Run the full manual pass in [quickstart.md](./quickstart.md) Gate 5 — all 20 checks against the running app via `npm run dev`, with particular attention to items 5-10 (extension surfaces, including the footer item **actually toggling** the Git panel) and 13 (worktree removal naming the exact path)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Phase 2
- **US2 (Phase 4)**: depends on US1 (`SessionGroup`, `SessionRow`, and the rewritten `UnifiedSidebar` must exist to host the surfaces and the footer)
- **US4 (Phase 5)**: depends on US1
- **US5 (Phase 6)**: depends on US4 — nothing is filtered until views exist
- **US3 (Phase 7)**: depends on US4 (the Stale view is selected through the view bar) and on US5 (a filtered view must explain itself)
- **US6 (Phase 8)**: depends on US1; the palette task additionally depends on US2's command registration (T047)
- **Polish (Phase 9)**: depends on all stories

### Within Phase 2

2a and 2b can run in parallel. 2c depends on 2a and 2b landing in the same files. 2d is independent of 2a-2c and can run in parallel. 2e depends on 2d for the `AgentState` type only.

### Within Each Story

Failing spec → implementation → green, without exception (Principle VI). Component specs before components; the store setter before the UI that calls it.

### Parallel Opportunities

- T003 and T004 together; T008, T009, T010 together
- T011 and T014 together (different files)
- 2d (T017, T020, T022) in parallel with 2c
- T024, T025, T027 together
- T030, T031, T032, T033, T037a together
- T043a, T043b, T043c together (main API, SDK, loader — three different files)
- T057, T058, T059, T060, T061 together
- T068, T069, T070, T071 together
- T077, T078, T079 together

## Parallel Example: Phase 2 foundational specs

```bash
# Four independent failing specs, four different files:
Task: "Write tests/unit/renderer/sidebar/agent-state.spec.ts"          # T017
Task: "Write tests/unit/renderer/stores/session.store.spec.ts additions" # T020
Task: "Write tests/unit/renderer/terminal/session-controller.spec.ts"    # T022
Task: "Write tests/unit/renderer/hooks/useDragReorder.spec.tsx"          # T011
```

## Implementation Strategy

### MVP (US1)

Phase 1 → Phase 2 → Phase 3, then **stop and look at the running app**. That is a working flat sidebar with recency and status. It is not shippable on its own — Phase 4 is the merge gate, because an MVP that silently drops the SpecKit and Code Reviews buttons is a regression wearing a feature's clothes.

### Incremental delivery

Phase 2 (invisible, all green) → US1 (flat list) → **US2 (merge gate, and the first time a contributed sidebar item has ever appeared)** → US4 (views) → US5 (filter notice) → US3 (cleanup) → US6 (search and keyboard) → Phase 9 (docs and verification).

### Every phase ends the same way

`npm run format` → `npm run lint` (0 errors) → `npx vitest run --coverage`, from the worktree directory. Phases 3 and 7 additionally require launching the real app and confirming by eye. A green task list is not evidence that a UI works.

## Notes

- `[P]` means different files with no dependency on incomplete work
- Commit per logical unit, matching the repo's existing convention
- `UnifiedSidebar.tsx` starts below the coverage gate at 69.41% — T040 is the checkpoint that stops this surfacing at PR time
- `registry.ts` lines 225-227 (`registerSidebarButton`) are its only uncovered lines today, precisely because nothing called it; T008 covers them and T044d finally calls it
- The pure layer (`src/renderer/sidebar/`) targets 100%, not 80%
- FR-037 is a test-only task (Phase 0 research). FR-028 is built rather than retired — the Phase 0 decision to delete that surface was reversed once its live caller was found. Both are recorded in [plan.md](./plan.md) under "Spec amendments and their history"
