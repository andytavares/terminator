# Data Model: Sidebar Session Views

Nothing here is persisted server-side or in a database. The entities below live in three places only:
the renderer zustand stores (transient), `GlobalSettings` via electron-store (one number), and one
localStorage key (view definitions). See [research.md](./research.md) R3 and R6 for why.

## Existing entities — changes

### `TerminalSession` (`src/shared/types/index.ts:44-58`)

| Field                                                                                                          | Type         | New?    | Persisted? | Notes                                                                    |
| -------------------------------------------------------------------------------------------------------------- | ------------ | ------- | ---------- | ------------------------------------------------------------------------ |
| `id`, `projectId`, `tabTitle`, `status`, `type`, `scrollbackLimit`, `createdAt`, `closedAt`, `parentSessionId` | —            | no      | —          | unchanged                                                                |
| `bellCount`                                                                                                    | `number?`    | no      | no         | renderer-only; feeds `agentState`                                        |
| `busy`                                                                                                         | `boolean?`   | no      | no         | renderer-only; feeds `agentState`                                        |
| `lastActivityAt`                                                                                               | `number`     | **yes** | no         | epoch ms; stamped on PTY output, throttled to ≤1/s/session               |
| `lastAttendedAt`                                                                                               | `number?`    | **yes** | no         | epoch ms; stamped when the session becomes visible                       |
| `agentState`                                                                                                   | `AgentState` | **yes** | no         | derived — see [contracts/session-state.md](./contracts/session-state.md) |
| `note`                                                                                                         | `string?`    | **yes** | no         | one line, newlines stripped, ≤120 chars                                  |

**Validation**: `lastActivityAt` is always defined after construction — `?? Date.parse(createdAt)` (FR-007).
`agentState` is always one of the four values; there is no "unknown". `note` is trimmed; an empty result is
stored as `undefined`, not `''`, so "has a note" is a single truthiness check.

**Relationships**: unchanged — a session belongs to exactly one `Project` via `projectId`, and may have a
`parentSessionId` pointing at a split parent in the same project.

**State transitions** (`agentState`, derived on read, never stored as a transition):

```
        bell rings                    output flows
idle ──────────────► awaiting-input ──────────────► working
  ▲                        │                            │
  │  bell acknowledged     │                            │ 1.5 s silence
  └────────────────────────┴────────────────────────────┘
                    any state ──► exited   (PTY exit; terminal)
```

`exited` is terminal. `awaiting-input` outranks `working` in the derivation precedence, so a session that
rings the bell while still producing output reads as needing you — the safer reading of an ambiguous signal.

### `Project` (`src/shared/types/index.ts:14-25`) — unchanged

Read by the view model for group labels (`name`), branch grouping and search (`gitBranch`), and the bulk
worktree-removal path (`isWorktree`, `worktreePath`). No field is added.

### `Workspace` (`src/shared/types/index.ts:4-12`) — unchanged

Read for workspace grouping, the colour band, and tags. No field is added.

### `GlobalSettings` (`src/shared/schemas/settings.schema.ts`)

Gains one group; see [contracts/session-state.md](./contracts/session-state.md#settings).
`WorkspaceSettings` is deliberately **not** extended.

## New entities

### `SessionView`

A named, persisted combination of grouping key, sort key, and filters. Four built-ins ship as data; users
create more. Full shape, invariants, and persistence rules in
[contracts/view-model.md](./contracts/view-model.md).

| Field     | Type             | Validation                                                                                                      |
| --------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`      | `string`         | unique; built-in ids are reserved (`everything`, `needs-me`, `active`, `stale`)                                 |
| `name`    | `string`         | 1-40 chars, trimmed, non-empty                                                                                  |
| `groupBy` | `GroupKey`       | one of `project` `workspace` `status` `branch` `none`                                                           |
| `sortBy`  | `SortKey`        | one of `recent` `oldest` `name` `status` `manual`                                                               |
| `filters` | `SessionFilters` | all members optional; `staleOnly` and `hideStale` are mutually exclusive                                        |
| `builtIn` | `boolean?`       | built-ins cannot be deleted or renamed; their grouping/sort/hide-stale overrides are persisted separately by id |

**Persistence**: custom views only, localStorage key `terminator.sidebar.views`. Corrupt JSON degrades to
built-ins without throwing. The **active** view id is deliberately not persisted — launch is always
`everything` (FR-015).

### `GroupCollapseState` (persisted)

Which groups are collapsed. localStorage key `terminator.sidebar.collapsed`, shape
`Record<GroupKey, string[]>` — a **collapsed** set keyed by grouping mode.

| Rule                                                           | Reason                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Polarity is collapsed-not-expanded                             | FR-008's "default to expanded" is then the empty set, so no migration and no first-run write                |
| Keyed by grouping mode                                         | collapsing a project group must not leak into status grouping, where the same key could mean something else |
| Unknown group keys ignored on read; stale keys pruned on write | groups come and go as sessions and branches do                                                              |
| Corrupt JSON degrades to `{}` without throwing                 | matches `loadExpandedIds` at `workspace.store.ts:38-47`                                                     |

**Supersedes** `terminator.workspace.expanded` and `terminator.project.collapsed`. Those two carry _opposite_
polarities — one is an expanded set, the other a collapsed set — which is exactly why they are replaced
wholesale rather than merged. Their store members (`expandedWorkspaceIds`, `collapsedProjectIds`) and setters
are deleted with them; note `useKeyboardShortcuts.ts:34` calls `setExpandedWorkspaceIds` in `cycleWorkspace`
and must be updated in the same change or the build breaks.

### `Group` (runtime only, never persisted)

Produced by `buildGroups`. Carries `key`, `label`, `count`, `sessions`, and — when its grouping key is a
scope — a `scope` discriminated union identifying the project or workspace. That `scope` field is the entire
mechanism behind the scope-bearing header (FR-026): a header hosts extension actions precisely when `scope`
is present, and rows carry the scope affordance precisely when it is absent (FR-027).

## What is deliberately absent

- **No new persisted session record.** Adding one would be session persistence across restart, which the
  spec puts out of scope.
- **No `staleAt` stored field.** Staleness is a pure function of `(session, now, staleAfterMs)` so it
  recomputes as the clock moves without any write (FR-019).
- **No per-workspace staleness override**, no tags on projects or sessions, no session-level branch field —
  none is required by an FR (Principle VII).
- **No new entity for extension-contributed sidebar items.** They are read from the main process at init and
  held in the existing `sidebarButtons` registry array; nothing about them is persisted by core.
