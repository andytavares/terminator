# Research: A3 Color Band Sidebar

**Feature**: `008-a3-color-band-sidebar`
**Date**: 2026-06-13

---

## Decision 1: Sidebar Resize Implementation

**Decision**: Use a `mousedown` + `mousemove` + `mouseup` listener set on `document` (not the handle element alone), driven by a `useRef` tracking pointer start position.

**Rationale**: The native CSS `resize` property only works on elements with `overflow: auto/scroll` and cannot be styled to match the design. Third-party drag-handle libraries add a dependency; the pattern is simple enough to implement directly (~30 lines). Capturing `mousemove` on `document` (not the handle) prevents the drag from breaking if the pointer moves faster than the component re-renders — the same approach used by VS Code's sidebar resize and already used in xterm's split-container. The sidebar width is stored in a `useRef` during drag and committed to `useState` + `localStorage` on `mouseup` to avoid excessive React renders during the drag.

**Alternatives considered**:

- `CSS resize property` — rejected: cannot match the design, style is browser-controlled.
- `react-resizable` / `react-split-pane` — rejected: unnecessary dependency for a single resize handle (Constitution IV).
- Zustand store for sidebar width — rejected: YAGNI. localStorage is sufficient for a single UI preference and avoids a re-render of the entire sidebar tree on every drag step (Constitution VII).

---

## Decision 2: `collapsedWorkspaceIds` Persistence

**Decision**: Store `collapsedWorkspaceIds: Set<string>` in `workspaceStore` (Zustand). Initialize from `localStorage` key `terminator.workspace.collapsed` on store creation. Write back to `localStorage` inside `toggleWorkspaceCollapse`.

**Rationale**: The existing workspace store uses IPC to the main process for Workspace/Project data; that IPC is unnecessary for a UI-only preference. The Zustand `persist` middleware could handle this, but no other store in the codebase uses `zustand/middleware` — introducing it just for one field would be inconsistent (Constitution V). Manual `localStorage` read on store creation + write on action is the simplest approach, matching the PRD's spec for `localStorage` persistence (`terminator.sidebar.width` pattern).

**Alternatives considered**:

- `zustand/middleware persist` — rejected: would require updating `workspaceStore` to a `persist`-wrapped creator, touching unrelated store slices. Inconsistent with codebase pattern.
- IPC to main process SQLite — rejected: overkill for a UI-only preference with no cross-window sync requirement.
- Component-local state (`useState`) — rejected: would be reset on `WorkspaceCard` unmount (e.g., during search filtering).

**Serialization**: `Set<string>` serialized as `JSON.stringify([...set])`, deserialized as `new Set(JSON.parse(...))`. Guarded with try/catch for corrupted localStorage.

---

## Decision 3: `--ws-color` CSS Variable Propagation

**Decision**: Each `WorkspaceCard` sets `style={{ '--ws-color': workspace.color } as React.CSSProperties}` on its root element. All child elements (band, project row active state, session row active state) inherit via `var(--ws-color)`. The pattern already exists in `ProjectsPanel.tsx` (line: `style={{ ['--ws-color' as string]: workspace.color }}`).

**Rationale**: No change needed; extend the existing mechanism to the new card hierarchy. Each card scopes its own color independently via CSS cascade. No JavaScript color manipulation needed.

**Alternatives considered**:

- Pass `color` as a prop to every child component — rejected: prop-drilling through 3 levels for something CSS handles natively.
- CSS-in-JS color generation — rejected: no CSS-in-JS library in the project; would add a dependency.

---

## Decision 4: Fuzzy Search (Phase 3)

**Decision**: Implement sidebar search with a simple substring match (case-insensitive `includes`) against project names and session tab titles. No external fuzzy library.

**Rationale**: The search scope is small (typically <50 items). A full fuzzy library (Fuse.js, etc.) is unnecessary and would add a dependency (Constitution IV). Case-insensitive `includes` matches the PRD description ("fuzzy filter") adequately for the scale. If richer fuzzy matching is needed in a later iteration, it can be swapped in behind the same search hook interface.

**Alternatives considered**:

- Fuse.js — rejected: unnecessary dependency for <50 items.
- `⌘K` global quickswitcher for all search — rejected: sidebar search is scoped and inline, complementing `⌘K` rather than replacing it (per spec FR-035).

---

## Decision 5: `ExtensionFooter` — Extension Button Source

**Decision**: `ExtensionFooter` reads `sidebarButtons` from `useExtensionRegistry`. It renders one button per `SidebarButtonRegistration`, calling `registration.action()` on click. No new extension API fields are needed; the existing `SidebarButtonRegistration` interface is sufficient.

**Rationale**: The existing `ProjectsPanel` already renders `sidebarButtons` from the registry in its footer. `ExtensionFooter` is a direct extraction of that logic into a standalone component moved inside `WorkspaceCard`. The extension itself (`registerSidebarButton`) does not change; only the renderer's placement of the button changes.

---

## Decision 6: Branch Badge Data Source

**Decision**: `ProjectRow` reads git branch/dirty state from the same source the existing `ProjectsPanel`/`BranchSwitcher` uses — the git extension's exported store or IPC call. The exact binding (prop passed from parent or direct store subscription in `ProjectRow`) will match the pattern in `ProjectItem.tsx` to avoid duplicating IPC calls.

**Rationale**: The git extension already publishes branch/dirty/conflict status to the renderer. `ProjectRow` subscribes to the same data, filtered by `project.id`. No new IPC channels needed (FR-049).

---

## Decision 7: Drag Reorder in New Layout

**Decision**: Reuse the existing `@dnd-kit/core` + `@dnd-kit/sortable` setup from `WorkspaceRail` and `ProjectsPanel`. `WorkspaceCard` list uses a `SortableContext` for workspace reorder; project rows inside each card use a nested `SortableContext` for project reorder; session rows use a third nested `SortableContext`.

**Rationale**: `@dnd-kit` already in the project (Constitution IV). The PRD requires drag reorder for workspaces, projects, and sessions. The library supports nested sortable contexts natively. Existing `reorderWorkspaces` and `reorderProjects` store actions are reused unchanged.

---

## Decision 8: ⌘B Sidebar Toggle Animation

**Decision**: Toggle a CSS class `unified-sidebar--hidden` that sets `width: 0; min-width: 0; overflow: hidden`. The `UnifiedSidebar` has a CSS `transition: width 0.2s ease` matching the existing `sidebar--collapsed` pattern in `Sidebar.css`. State (`sidebarVisible`) stays in `App.tsx` as it does today.

**Rationale**: Consistent with existing toggle behaviour in `App.tsx`. No library needed.
