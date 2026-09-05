# Phase 1 Data Model: Declutter the Sidebar, and a Board for the Fleet

**Feature**: `034-declutter-sidebar` | **Date**: 2026-09-05

No persisted entity changes. `TerminalSession`, `Project` and `Workspace` in `src/shared/types/index.ts` are untouched, no IPC channel changes shape, and there is no migration. Everything below is renderer-side view state or a pure derivation.

---

## 1. Unchanged stored entities

Listed for reference only — the product says "repo" and "branch"; the code keeps `Workspace` and `Project` (ADR-032).

| Product name | Stored type       | Fields this feature reads                                                                                                   |
| ------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Repo         | `Workspace`       | `id`, `name`, `folderPath`, `color`, `tags`                                                                                 |
| Branch       | `Project`         | `id`, `workspaceId`, `name`, `gitBranch?`, `worktreePath?`, `isWorktree`                                                    |
| Terminal     | `TerminalSession` | `id`, `projectId`, `tabTitle`, `status`, `parentSessionId?`, `bellCount?`, `busy?`, `lastActivityAt`, `agentState`, `note?` |

`AgentState = 'working' | 'awaiting-input' | 'idle' | 'exited'` — unchanged, and now does double duty as a branch's aggregate and a board lane's identity.

---

## 2. New pure derivations

### `BranchState`

An alias, not a new type: `type BranchState = AgentState`. A branch's state is one of the same four values, so the sidebar gutter, the tab glyph and the board lane share one vocabulary (FR-018) and one set of glyph mappings in `session-status.ts`.

**Derivation** (`aggregateBranchState`, new in `src/renderer/sidebar/branch-state.ts`):

| Input                         | Result           |
| ----------------------------- | ---------------- |
| Any terminal `awaiting-input` | `awaiting-input` |
| Else any `working`            | `working`        |
| Else any `idle`               | `idle`           |
| Else all `exited`             | `exited`         |
| **No terminals at all**       | `idle`           |

Precedence is `STATUS_ORDER`, exported from `view-model.ts` rather than re-declared (R-002). The empty case is an explicit early return — the natural fold over an empty list would give `exited`, which FR-003 forbids.

### `BranchRow`

What one sidebar row is. Pure data, computed from `(sessions, projects, workspaces, view, now, staleAfterMs)` and nothing else.

| Field            | Type                  | Notes                                                                                                                                           |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`      | `string`              | Row identity and React key                                                                                                                      |
| `label`          | `string`              | From `branchLabel(project)` — the branch name, falling back to `name` only when the folder is not a git repo                                    |
| `isWorktree`     | `boolean`             | Drives the kind glyph, which marks the **plain checkout**, not the worktree                                                                     |
| `state`          | `BranchState`         | The gutter glyph                                                                                                                                |
| `stateCount`     | `number`              | How many terminals share `state`. Rendered only when > 1 — the count agrees with the glyph rather than totalling everything (FR-003 as amended) |
| `sessionCount`   | `number`              | Total terminals; feeds the repo header's count                                                                                                  |
| `lastActivityAt` | `number \| null`      | Newest across its terminals; `null` when it has none                                                                                            |
| `issueKey`       | `string \| undefined` | Plain text, no badge                                                                                                                            |
| `workspaceId`    | `string`              | Resolves the rail colour                                                                                                                        |

Deliberately **not** on `BranchRow`: added/removed line counts. They stay in `change-stats.store` behind a 15-second TTL, exactly as ADR-031 requires, because putting them here would make the derivation a function of when git last answered and destroy its determinism.

### `RepoGroup`

| Field            | Type          | Notes                                                                    |
| ---------------- | ------------- | ------------------------------------------------------------------------ |
| `workspaceId`    | `string`      | Identity                                                                 |
| `label`          | `string`      | Repo name, drawn in `--text-primary` — never in the repo colour (FR-043) |
| `color`          | `string`      | The 7px swatch and the 2px rail                                          |
| `folderPath`     | `string`      | Tooltip only; never drawn at rest (FR-030)                               |
| `branches`       | `BranchRow[]` | Sorted by the active view's `sortBy`                                     |
| `branchCount`    | `number`      | Must equal `branches.length` (FR-039)                                    |
| `hiddenNeedsYou` | `boolean`     | True when collapsed and any hidden branch is `awaiting-input` (FR-004)   |

### `BranchRowsResult`

```
{ groups: RepoGroup[], scratch: TerminalSession[], shown: number, total: number }
```

`shown` and `total` count **branches**, not terminals, so the Filter menu's badge matches the rows drawn (FR-039). `scratch` stays a list of terminals — a scratch terminal has no branch to be represented by, so it is the one place a terminal is still a row (FR-002).

---

## 3. Board view state

### `BoardLane`

| Field       | Type          | Notes                                                                             |
| ----------- | ------------- | --------------------------------------------------------------------------------- |
| `state`     | `AgentState`  | Lane identity and its glyph                                                       |
| `label`     | `string`      | "Needs you" / "Working" / "Idle" / "Exited"                                       |
| `cards`     | `BoardCard[]` |                                                                                   |
| `count`     | `number`      | Must equal `cards.length` (FR-039)                                                |
| `visible`   | `boolean`     | User-controlled (FR-016); `exited` additionally hides itself while empty (FR-010) |
| `isHistory` | `boolean`     | True for `exited` only — drives the reduced contrast                              |

Lane order is fixed: `awaiting-input`, `working`, `idle`, `exited`. It is `STATUS_ORDER` again, the same constant, so the board cannot disagree with the sidebar about severity.

**Structural constraint from R-003**: a lane is a `grid-column`, not a container. Cards live in one grid; lane membership is a computed CSS property. A card must never change DOM parent, or the live preview it holds is torn out mid-transition.

### `BoardCard`

| Field            | Type             | Notes                                                     |
| ---------------- | ---------------- | --------------------------------------------------------- |
| `sessionId`      | `string`         | Identity, React key, and the stable DOM node              |
| `title`          | `string`         | `tabTitle`, in sans                                       |
| `sourceLabel`    | `string`         | `"<repo> / <branch>"`, in mono; `"no branch"` for scratch |
| `state`          | `AgentState`     | Which column it claims                                    |
| `bellCount`      | `number`         | Rendered only when > 0                                    |
| `lastActivityAt` | `number`         | Relative age                                              |
| `workspaceColor` | `string \| null` | The rail; `null` for scratch, which draws none (FR-045)   |

Every optional field is **omitted rather than drawn empty** (FR-013).

### Lane visibility persistence

`localStorage` key `terminator.board.lanes`, a JSON array of hidden `AgentState` values. Corrupt storage degrades to "all visible" rather than throwing — the same convention as `views.ts` `loadViews()` and `workspace.store`'s `loadExpandedIds`.

Deliberately not persisted: the board/list layout choice resets to board on launch, matching the existing decision that the active view is not restored (`views.ts`, FR-015) for the same reason — restoring a narrowed surface reads as data loss.

---

## 4. View model changes

`SessionView` keeps its shape. Two unions shrink:

| Type       | Before                                                       | After                   | Why                                                                                                              |
| ---------- | ------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GroupKey` | `'project' \| 'workspace' \| 'status' \| 'branch' \| 'none'` | `'workspace' \| 'none'` | `project` and `branch` collapse into the row itself; `status` is redundant once every row shows a glyph (FR-038) |
| `SortKey`  | `'recent' \| 'oldest' \| 'name' \| 'status' \| 'manual'`     | unchanged, re-scoped    | Each now orders **branches**; `status` sorts by aggregate                                                        |

`SessionFilters` is unchanged in shape. Its semantics lift one level: a branch matches when **any of its terminals** matches (R-006).

`loadViews()` must degrade a stored override naming a retired `groupBy` to the view's built-in default. It already degrades corrupt storage to the built-ins; this is the same guard reached by a new path, and needs its own test.

---

## 5. State transitions

The only transition this feature introduces is a card's lane, and it is **observed, not assigned** — there is no drag-to-change-state (Out of Scope).

```
terminal's agentState changes
  → BoardCard.state changes
  → the card's grid-column changes        (no re-parent, no remount)
  → 180ms transition on transform + opacity, on that card only
  → both lane counts update
  → the owning branch's aggregate recomputes
  → the sidebar gutter glyph and the tab glyph update
```

Every surface reads the same `AgentState`, so FR-018 holds by construction rather than by synchronisation. `prefers-reduced-motion` cuts straight to the new position.

---

## 6. What is deleted

| Thing                                                                                        | Reason                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionRow.tsx` / `.css`                                                                    | FR-001 — terminals are not sidebar rows                                                                                                                         |
| `WorkspaceRow.tsx` / `.css`                                                                  | FR-005 — creating a branch moves to the repo header's hover                                                                                                     |
| `ViewBar.tsx` / `.css`                                                                       | FR-034 — folded into Filter and Display                                                                                                                         |
| `FilterNotice.tsx` / `.css`                                                                  | FR-035 — folded into the Filter badge                                                                                                                           |
| `BulkCloseDialog.tsx` / `.css`                                                               | R-007 — nothing left to multi-select                                                                                                                            |
| `Group.sessions`, `GroupScope`, `buildGroups`                                                | superseded by `buildBranchRows`; deleted last, once nothing imports it                                                                                          |
| `--font-sans` reference in `SidebarSearch.css:32`                                            | R-009 — the token is never defined                                                                                                                              |
| Dead rules in `SidebarHeader.css`                                                            | `__search`, `__search-icon`, `__search-placeholder`, `__actions`, `__tabs`, `__fixed-actions`, `__tab*` — no matching element since the tabs moved to `AppBand` |
| `.unified-sidebar__add-project`, `.ws-card--dnd-over`                                        | unreferenced; the latter never had a rule at all                                                                                                                |
| Unused `UnifiedSidebarProps`: `notificationPanelOpen`, `scratchActive`, `hasScratchSessions` | declared and passed, never destructured                                                                                                                         |

Deletion is a requirement, not tidying: Principle X makes dead code a defect, and FR-025 requires anything unreachable to go with its tests and be named in the PR.
