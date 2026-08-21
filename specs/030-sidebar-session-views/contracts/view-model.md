# Contract: Sidebar View Model (pure layer)

**Module**: `src/renderer/sidebar/view-model.ts`, `src/renderer/sidebar/views.ts`

This layer is the whole reason the sidebar rewrite is reversible. It contains **no React import, no store
import, and no clock read**. Every function is pure: same inputs → same output, no mutation of any argument.
A lint-visible test of compliance: the module's import list mentions only types.

## Types

```ts
type GroupKey = 'project' | 'workspace' | 'status' | 'branch' | 'none'
type SortKey = 'recent' | 'oldest' | 'name' | 'status' | 'manual'
type AgentState = 'working' | 'awaiting-input' | 'idle' | 'exited'

interface SessionFilters {
  query?: string
  states?: AgentState[]
  projectIds?: string[]
  hideStale?: boolean
  staleOnly?: boolean
}

interface SessionView {
  id: string
  name: string
  groupBy: GroupKey
  sortBy: SortKey
  filters: SessionFilters
  builtIn?: boolean
}

interface Group {
  key: string // stable identity for React keys and collapse state
  label: string
  scope?:
    | { kind: 'project'; projectId: string; workspaceId: string }
    | { kind: 'workspace'; workspaceId: string }
  sessions: SessionListItem[]
  count: number
}

interface BuildResult {
  groups: Group[]
  shown: number // sessions after filtering
  total: number // sessions before filtering  → FilterNotice reads both
}
```

## Functions

### `isStale(session, now, staleAfterMs): boolean`

```
isStale =
     session.agentState === 'exited'
  || (session.agentState !== 'awaiting-input' && now - session.lastActivityAt > staleAfterMs)
```

| Case                                                 | Result                            | Requirement            |
| ---------------------------------------------------- | --------------------------------- | ---------------------- |
| `agentState === 'exited'`, active 1 s ago            | `true`                            | FR-017                 |
| `agentState === 'awaiting-input'`, idle 30 days      | `false`                           | FR-018, spec edge case |
| `now - lastActivityAt === staleAfterMs` exactly      | `false` — strictly greater        | spec edge case         |
| `now - lastActivityAt === staleAfterMs + 1`          | `true`                            | FR-017                 |
| `now` advances past the boundary with no other input | recomputes to `true` on next call | FR-019                 |

`now` is a parameter. The function never calls `Date.now()` — that is what makes FR-019 testable.

### `buildGroups(sessions, projects, workspaces, view, now, staleAfterMs): BuildResult`

Order of operations is fixed and observable:

1. **Filter** — `query` (case-insensitive substring over `tabTitle`, `note`, project name, project
   `gitBranch` — FR-031), then `states`, then `projectIds`, then `staleOnly` / `hideStale`.
   `total` is counted before this step, `shown` after (FR-016).
2. **Group** by `view.groupBy`. Empty groups are dropped (spec edge case). Every group whose key is a scope
   carries `scope`, which is what makes the header scope-bearing (FR-026).
3. **Sort within each group** by `view.sortBy`. `manual` preserves the store's existing session order;
   `recent` is `lastActivityAt` descending; `oldest` ascending; `name` is locale-compare on `tabTitle`;
   `status` orders `awaiting-input` → `working` → `idle` → `exited`.
4. **Sort the groups themselves** — project and workspace groups keep the workspace/project order the
   stores already define; status groups use the fixed status order above; branch and none sort by label.

Guarantees:

- Never mutates `sessions`, `projects`, `workspaces`, or `view`.
- Every input session appears in at most one group, and in exactly one unless filtered out.
- Called twice with the same arguments, returns deeply equal output.

### `Group.key` stability

`key` is stable within a grouping mode for the lifetime of the underlying entity:

- **project / workspace** groups key on the entity **id**, never the display name — renaming a project must
  not reset its collapse state.
- **status** groups key on the state literal.
- **branch** groups key on `branch:<name>` and are explicitly **not** stable across a branch rename;
  collapse state for branch groups is best-effort by design, and this is the reason
  `GroupCollapseState` is partitioned by grouping mode rather than held in one flat set.
- **none** produces a single group keyed `all`.

### Built-in views (`views.ts`, data not code — FR-012)

| id           | name       | groupBy   | sortBy   | filters                          |
| ------------ | ---------- | --------- | -------- | -------------------------------- |
| `everything` | Everything | `project` | `manual` | `{}`                             |
| `needs-me`   | Needs me   | `project` | `recent` | `{ states: ['awaiting-input'] }` |
| `active`     | Active     | `project` | `recent` | `{ states: ['working'] }`        |
| `stale`      | Stale      | `project` | `oldest` | `{ staleOnly: true }`            |

### Persistence (`views.ts`)

- `loadViews(): SessionView[]` — built-ins first, then custom views from localStorage key
  `terminator.sidebar.views`. Corrupt or unparseable JSON yields built-ins only, never a throw
  (matching the existing `loadExpandedIds` convention in `workspace.store.ts:38-47`).
- `saveViews(views: SessionView[]): void` — persists custom views only; write failures are swallowed
  (private browsing, storage full), same convention.
- Built-in views are never persisted and never deleted; per-view `hideStale` and grouping/sort overrides are
  persisted per view id (FR-014, FR-021).
- **`loadViews` never returns a filtered view as the active view** — the active view on launch is always
  `everything` (FR-015). Active-view id is deliberately not persisted.

## Test obligation

This layer is table-driven-tested over every `GroupKey` × `SortKey` × filter combination plus the staleness
boundary rows above, and targets **100%** coverage rather than the 80% gate. It is the cheapest place in the
feature to be certain, so it is the place to be certain.
