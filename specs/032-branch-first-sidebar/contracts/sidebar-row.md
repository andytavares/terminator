# Contract: Sidebar Row Presentation

**Feature**: `032-branch-first-sidebar`

The UI contract for the two row types the sidebar draws. These are the surfaces SC-001 through SC-004 are measured against.

## Session row — `SessionRow.tsx`

### Visual channels

| Channel                  | Carries                     | Constraint                                                                                                          |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Row surface (background) | **Selection**               | Never carries state (FR-001)                                                                                        |
| Leading glyph            | **State**                   | Never carries selection (FR-001). Flat lucide, `currentColor`, no colour class, no inline colour (constitution XII) |
| Left edge bar            | **Awaiting-input emphasis** | Row-level element, so colour is permitted here                                                                      |
| Trailing text            | Relative activity time      | Existing behaviour                                                                                                  |

### Glyph selection

Delegated wholly to `statusPresentationFor(session)` in `src/renderer/sidebar/session-status.ts` — see [data-model.md](../data-model.md#sessionstatus-new-derived--not-stored). The component contains no state-to-icon branching of its own.

Precedence, highest first: busy spinner → bell badge → state glyph. Unchanged from today.

### Accessible name

Every row exposes state as text, not only as a shape:

```
aria-label = "{tabTitle}, {statusLabel}, active {relativeTime}"
```

The glyph itself is `aria-hidden`. This is what makes SC-007 testable and what carries FR-002 to a screen reader, where shape means nothing.

## Branch row — `SessionGroup.tsx` header, scope kind `project`

### Composition, in order

```
[chevron] [branch glyph] {display name} [worktree tag] [issue badge] [stats] [count] [+]
```

| Element      | Source                | Rule                                                                                                     |
| ------------ | --------------------- | -------------------------------------------------------------------------------------------------------- |
| Branch glyph | `isWorktree`          | `GitFork` when true, `GitBranch` when false (FR-007)                                                     |
| Display name | `displayName(branch)` | Pure; see data-model.md. Truncates head-first so the disambiguating tail survives; full value in `title` |
| Worktree tag | `isWorktree`          | Text "worktree"; `title` carries `worktreePath` (FR-007)                                                 |
| Stats        | `change-stats` store  | `+{added} −{removed}`; **absent** when unavailable, loading or errored (FR-009)                          |
| Count        | existing              | Unchanged                                                                                                |

### Repo group header

Gains `folderPath` as secondary text after the repo name (FR-008). Path is tilde-abbreviated for display; full value in `title`.

### Width degradation

Fixed order, per [research.md](../research.md#r3--sidebar-width-and-how-the-row-degrades). Name and state glyph never drop; the row never wraps to a second line.

| Below | Drops                           |
| ----- | ------------------------------- |
| 300px | change statistics               |
| 260px | worktree tag text (glyph stays) |
| 230px | relative activity time          |

## Vocabulary rule

Every user-visible string that named a "project" names a **branch** (FR-010), and every string that names a branch outside its own repo group is qualified by the repo (FR-011 – FR-014).

### Required call sites

| Surface                               | Before                    | After                                                                                                                                 |
| ------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Command palette, new-terminal command | `New terminal in main`    | `New terminal — {repo} · {branch}`                                                                                                    |
| Command palette, session entry        | `tests · main`            | `tests — {repo} · {branch}`                                                                                                           |
| Session tab bar                       | _(unscoped)_              | Names the branch whose terminals are shown                                                                                            |
| Link-issue dialog                     | `Attaching to main`       | `Attaching to {repo} · {branch}`                                                                                                      |
| Move-session dialog                   | "Move to project"         | "Move to branch", options qualified by repo                                                                                           |
| Remove confirmation                   | `Remove project "X"?`     | `Remove branch "X"?` — **wording only**; the disclosure defect (audit PRJ-1) is a separate feature and must not be quietly fixed here |
| Group header add action               | `+ New project in {repo}` | `+ New branch in {repo}`                                                                                                              |
| Create dialog                         | "Create Project"          | "Create Branch"                                                                                                                       |

### Enforcement

A lint rule fails the build on the case-insensitive word "project" appearing in a user-facing string literal under `src/renderer/components/`, with an allowlist for identifiers, import paths and type names (research R4). Constitution X already makes a lint error a merge blocker, so this needs no separate gate.

## Non-regression

| Must not change                                 | Why                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `buildGroups` inputs, outputs or performance    | Constitution XI; `view-model-performance.spec.ts` runs unmodified |
| Grouping, sort, filter and saved-view behaviour | FR-020                                                            |
| Extension contribution points                   | FR-020                                                            |
| Selection, collapse and drag-reorder behaviour  | Out of scope                                                      |
| The count `buildGroups` reports                 | Audit NAV-6 is a standalone repair, deliberately not bundled      |

## Test obligations

| File                      | Must cover                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-status.ts`       | All four states map to distinct icons and labels; the mapping is total; no selection input                                                         |
| `SessionRow.spec.tsx`     | State glyph independent of `isActive`; spinner and bell precedence; `aria-label` contains the status label; no colour class on the icon element    |
| `SessionGroup.spec.tsx`   | `GitFork` vs `GitBranch` by `isWorktree`; `displayName` in all three branches; stats absent when the store has none; repo path on the group header |
| `UnifiedSidebar.spec.tsx` | No two palette commands identical across six repos named `main` (SC-002); every listed surface says "branch" (SC-004)                              |
