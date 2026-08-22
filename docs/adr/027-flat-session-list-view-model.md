# ADR-027: A Flat Session List Driven by a Pure View Model

**Status**: Accepted
**Date**: 2026-08-21
**Deciders**: Andrew Tavares

---

## Context

The sidebar was a fixed three-level tree: Workspace → Project → Session. With ~22 sessions across four workspaces, every session sat behind a collapsed header — `loadExpandedIds` defaulted to all-collapsed — and nothing in the data model could say which of them mattered.

Three specific gaps:

- **No recency.** `TerminalSession` had no activity timestamp of any kind. The only proxy was a transient `busy` boolean meaning "bytes moved in the last 1.5 seconds", so "which of these did I touch this morning" was unanswerable.
- **No ordering or filtering.** Workspaces, projects and sessions were all in insertion order with no sort and no filter. Search dimmed non-matching projects but hid non-matching sessions — two behaviours for one query.
- **Status was two disconnected systems.** A persisted `active | backgrounded | closed` enum that only tracked tab selection, and a transient `busy` / `bellCount` pair that was what the UI actually drew.

The tree also carried real information — which project a session belongs to — that a naive flat list would throw away, and it was the host for two extension surfaces.

## Decision

Replace the tree with a flat session list rendered from a **pure view model**.

A `SessionView` is a grouping key, a sort key, and a filter set. `buildGroups(sessions, projects, workspaces, view, now, staleAfterMs)` applies it in a fixed order — filter, group, sort within each group, sort the groups — and returns groups plus `shown` and `total`.

`src/renderer/sidebar/` holds that layer and **imports nothing but types**: no React, no store, no clock. `now` is always a parameter.

Supporting decisions:

- **D1 — `SidebarHeader` does not move.** It is workspace-independent; the view bar goes below it.
- **D2 — group headers are scope-bearing.** When the grouping key is a project or workspace, the header _is_ the tree row it replaced and hosts everything that row hosted. The default view groups by project, so nothing is lost by default.
- **D3 — non-scope groupings put scope on the row.** Under status, branch or no grouping there is no project header, so each row's project badge opens a `ScopeMenu` offering the same registry-sourced actions. Same data, second host.
- **D4 — session recency and state are renderer-only view state.** Sessions are not persisted, so `lastActivityAt`, `lastAttendedAt`, `agentState` and `note` need no schema, no IPC, and no migration.
- **D5 — staleness is a predicate, not a field.** `isStale(session, now, staleAfterMs)` recomputes as the clock moves. A session waiting on you is never stale, however long it waits.
- **D6 — `agentState` is honestly heuristic.** It is derived from PTY exit, the terminal bell, and byte flow, behind a single `AgentStateSource` seam.

## Consequences

**Good.** The decision about _what is shown_ is a pure function, tested exhaustively at 100% without a DOM, and the components are a thin rendering of its output — which is what makes the layout reversible. Every session is visible on first paint. Search is one behaviour. Three pre-existing status defects were fixed on the way past, and four duplicated drag implementations and four duplicated context menus collapsed into one each.

**Costs.** `awaiting-input` under-reports, and the README says so plainly rather than implying certainty. Two components (`WorkspaceCard`, `ProjectRow`) were deleted; their still-relevant assertions were re-homed before deletion, not after. Collapse state moved to a new key partitioned by grouping mode, because the two old keys carried opposite polarities and could not be merged safely; branch-group collapse is explicitly best-effort across a branch rename.

## The extension-surface contract

Flattening removed the host of two surfaces, so the contract is written down and asserted. `tests/unit/renderer/components/extension-surfaces.spec.tsx` checks every surface in all five grouping modes and is the merge gate for this feature.

| Surface        | Host after this change                                                                |
| -------------- | ------------------------------------------------------------------------------------- |
| Global tabs    | `SidebarHeader` — unchanged                                                           |
| Workspace tabs | `SessionGroup` header (hover) under scope groupings; `ScopeMenu` on the row otherwise |
| Sidebar items  | `ExtensionFooter`, once per window, independent of grouping                           |
| Project tabs   | `TabBar`, via `activeProjectId`                                                       |

**`activeProjectId` is never left undefined.** Selecting a session sets it alongside the session, under every grouping mode. It is load-bearing for per-project auto-open and the project tab bar.

## Alternatives considered

- **Keep the tree, add sorting and a recency column.** Rejected: it does not fix search, does not remove the collapsed-by-default problem, and leaves grouping hard-coded.
- **Delete the sidebar-item API instead of wiring it.** See the correction below. Rejected once its live caller was found: removing a documented, published SDK surface to delete a capability the app visibly wants is the wrong trade, and it would have forced a major SDK bump.
- **`dnd-kit` / `react-dnd` for reordering.** Rejected under the dependency principle: a new production dependency to replace ~20 lines of native HTML5 drag that already works.
- **A second command palette for sessions.** Rejected: `⌘K` was already bound and already merges renderer and extension commands. Sessions are a third source, not a new mechanism.

## A correction this feature had to make

Phase 0 research concluded that the sidebar-item surface was unreachable dead code and planned to delete it. That conclusion was reached by grepping the **renderer** only, and it was wrong.

`api.sidebar.registerItem` is a documented public API (`docs/EXTENSION-DEVELOPMENT.md`, `packages/extension-sdk/types/api.d.ts`) with a live caller: `extensions/git-integration/src/index.ts` registers a "Git Changes" item on every activation. The registration reached `globalRegistry.sidebarItems` and stopped there, because no host-renderer code ever read `extension:get-sidebar-items`. The renderer's own `sidebarButtons` array was a second, unconnected mechanism. **Broken wiring, not an absent feature.**

A second stranded channel compounded it: `extension:toggle-panel` had listeners on both sides and no sender, which is why the one real contributor showed a hint toast instead of acting.

Both are now complete, additively: `api.sidebar.togglePanel()` and an internal `extension:sidebar-item-click` channel, taking the SDK from 1.0.0 to 1.1.0. No contribution type changed and no extension had to.

The lesson is recorded in the regression spec itself: **extension surfaces are enumerated from the main-process API and from every `extensions/*/src` call site, never from the renderer registry alone.** A registered contribution that renders nowhere now fails a test instead of being reclassified as dead code.

## Related

- ADR-022 — webview-isolated extension renderer
- ADR-023 — channel manifest and declared remote access (the new channel is declared there)
- ADR-026 — double-Escape extension exit (why `Escape` stays unbound here)
- `specs/030-sidebar-session-views/` — spec, plan, research, contracts
