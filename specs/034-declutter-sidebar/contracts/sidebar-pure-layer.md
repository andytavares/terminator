# Contract: the sidebar's pure layer

**Feature**: `034-declutter-sidebar`

`src/renderer/sidebar/` is the seam this whole feature rests on. Every module in it **imports nothing but types** — no React, no store, no `Date.now()`. `now` is always a parameter. That physical separation is what makes "what is shown" a pure function of its inputs, exhaustively testable without a DOM (ADR-027).

Any new module here inherits that rule. A single React or store import in this directory is a contract violation, and there is a test that fails on one.

---

## New: `branch-state.ts`

```ts
import type { AgentState, TerminalSession } from '../../shared/types/index'

/**
 * The one state a branch row shows, folded from its terminals.
 *
 * Precedence is STATUS_ORDER, imported from view-model.ts rather than
 * re-declared, so the sidebar gutter, the tab glyph and the board lanes
 * can never disagree about severity.
 *
 * A branch with no terminals is `idle`, not `exited` — a branch you have
 * not opened yet is not a finished one. The natural fold over an empty
 * list would give the last entry in STATUS_ORDER, so this case is an
 * explicit early return.
 */
export function aggregateBranchState(sessions: TerminalSession[]): AgentState

/** How many of `sessions` are in `state`. Drives the count that agrees with the glyph. */
export function countInState(sessions: TerminalSession[], state: AgentState): number
```

**Invariants**

| #    | Invariant                                                                         |
| ---- | --------------------------------------------------------------------------------- |
| BS-1 | `aggregateBranchState([]) === 'idle'`                                             |
| BS-2 | Any `awaiting-input` present ⇒ result is `awaiting-input`, whatever else is there |
| BS-3 | Result is always a member of the terminals' states, except for the empty case     |
| BS-4 | Pure: same input, same output, no clock read                                      |
| BS-5 | `countInState(s, aggregateBranchState(s)) >= 1` for non-empty `s`                 |

---

## New: `branch-rows.ts`

```ts
export interface BranchRow {
  projectId: string
  label: string
  isWorktree: boolean
  state: AgentState
  stateCount: number
  sessionCount: number
  lastActivityAt: number | null
  issueKey?: string
  workspaceId: string
}

export interface RepoGroup {
  workspaceId: string
  label: string
  color: string
  folderPath: string
  branches: BranchRow[]
  branchCount: number
  hiddenNeedsYou: boolean
}

export interface BranchRowsResult {
  groups: RepoGroup[]
  scratch: TerminalSession[]
  /** Branches after filtering. */
  shown: number
  /** Branches before filtering. */
  total: number
}

export function buildBranchRows(
  sessions: TerminalSession[],
  projects: Project[],
  workspaces: Workspace[],
  view: SessionView,
  now: number,
  staleAfterMs: number
): BranchRowsResult
```

Same six parameters as `buildGroups`, in the same order, so the call site changes by one identifier.

**Invariants**

| #    | Invariant                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BR-1 | Every project appears as exactly one `BranchRow`, whether or not it has terminals (FR-001). Unlike `buildGroups`, this is **unconditional** — a narrowing filter may hide a branch, but never because it has no sessions |
| BR-2 | `group.branchCount === group.branches.length` — the count and the rows are the same number (FR-039)                                                                                                                      |
| BR-3 | `shown` and `total` count **branches**, not terminals                                                                                                                                                                    |
| BR-4 | A branch matches a filter when **any of its terminals** matches (R-006). A branch with no terminals matches only an unfiltered view                                                                                      |
| BR-5 | `hiddenNeedsYou` is true only when the repo is collapsed **and** some branch in it is `awaiting-input` (FR-004)                                                                                                          |
| BR-6 | Scratch terminals never appear as a `BranchRow`; they come back in `scratch` (FR-002)                                                                                                                                    |
| BR-7 | Deterministic order: filter → group → sort branches within a repo → sort repos                                                                                                                                           |
| BR-8 | No change statistics. They stay in `change-stats.store` behind its TTL (ADR-031) — including them would make this a function of when git last answered                                                                   |
| BR-9 | Pure: no React, no store, no clock                                                                                                                                                                                       |

---

## Changed: `view-model.ts`

```ts
// widened export — was module-private
export const STATUS_ORDER: AgentState[]

// narrowed unions
export type GroupKey = 'workspace' | 'none' // was + 'project' | 'status' | 'branch'
```

`buildGroups`, `Group`, `GroupScope` and `BuildResult` stay **exactly as they are** until nothing imports them, then are deleted in one commit. They are not modified in place — see R-001.

---

## Changed: `views.ts`

`BUILT_IN_VIEWS` keeps four entries with the same ids and names. `needs-me` moves from `groupBy: 'status'` to `groupBy: 'workspace'`; `active` and `stale` move from `'project'` to `'workspace'`.

**Invariant VW-1**: `loadViews()` degrades a stored override naming a retired `groupBy` to that view's built-in default, rather than throwing or passing an invalid key through. The existing corrupt-storage guard covers the shape; this needs its own case and its own test.

---

## New: `board-lanes.ts`

```ts
export interface BoardCard {
  sessionId: string
  title: string
  sourceLabel: string
  state: AgentState
  bellCount: number
  lastActivityAt: number
  workspaceColor: string | null
}

export interface BoardLane {
  state: AgentState
  label: string
  cards: BoardCard[]
  count: number
  visible: boolean
  isHistory: boolean
}

export function buildLanes(
  sessions: TerminalSession[],
  projects: Project[],
  workspaces: Workspace[],
  hiddenLanes: AgentState[]
): BoardLane[]
```

**Invariants**

| #    | Invariant                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| BL-1 | Lanes are returned in `STATUS_ORDER` — the same constant the sidebar uses                                                            |
| BL-2 | `lane.count === lane.cards.length` (FR-039)                                                                                          |
| BL-3 | Every open terminal appears in exactly one lane; a closed one appears in `exited`                                                    |
| BL-4 | The `exited` lane has `visible: false` when it holds no cards (FR-010)                                                               |
| BL-5 | A user-hidden lane still returns its cards; only `visible` changes, so hiding is presentational and reversible without recomputation |
| BL-6 | `workspaceColor` is `null` for a scratch terminal, which draws no rail (FR-045)                                                      |
| BL-7 | Pure                                                                                                                                 |

**Structural constraint (not expressible in the signature, load-bearing anyway)**

`buildLanes` returns lanes, but the renderer **must not** render each lane as its own container. `mountPreview` moves the one live xterm element into the card's DOM node (`TerminalSession.tsx:471`); re-parenting a card unmounts it and tears the preview out mid-transition. Cards live in one grid and a lane is a `grid-column`. See R-003 — this is the single most likely way this feature breaks something that works today.
