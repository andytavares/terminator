# UI Component Contracts: A3 Color Band Sidebar

**Feature**: `008-a3-color-band-sidebar`
**Date**: 2026-06-13

These contracts define the public props interface for each new component. They govern the boundary between parent and child and are what tests will verify.

---

## `UnifiedSidebar`

```tsx
interface UnifiedSidebarProps {
  /** All registered global tabs (from useExtensionRegistry) */
  globalTabs: GlobalTabRegistration[]
  activeGlobalTabId: string | null
  onSelectGlobalTab: (id: string) => void

  /** Notification count for the bell indicator */
  unreadNotifications: number
  notificationPanelOpen: boolean
  onBellClick: () => void

  /** Scratch terminal section */
  scratchActive: boolean
  hasScratchSessions: boolean
  onNewScratch: () => void
  activeScratchSessionId: string | null
  onSelectScratchSession: (sessionId: string) => void

  /** Sidebar visibility: controlled from App.tsx */
  visible: boolean
}
```

**Behaviour**:

- Reads `workspaces`, `activeWorkspaceId`, `projectsByWorkspaceId` from `useWorkspaceStore`.
- Reads `collapsedWorkspaceIds`, `toggleWorkspaceCollapse` from `useWorkspaceStore`.
- Manages sidebar width with a `mousedown` resize handle; persists to `localStorage`.
- Applies `unified-sidebar--hidden` class when `visible === false`.

---

## `WorkspaceCard`

```tsx
interface WorkspaceCardProps {
  workspace: Workspace
  projects: Project[]
  isCollapsed: boolean
  onToggleCollapse: () => void
  activeProjectId: string | null
  onSelectProject: (projectId: string) => void
}
```

**Behaviour**:

- Sets `style={{ '--ws-color': workspace.color }}` on its root element.
- Renders a 3px color band (`--ws-band-w`) on the left edge using `--ws-color`.
- Renders `ProjectRow` children when not collapsed.
- Renders `ExtensionFooter` at the bottom of the project list.
- Renders a "New project" add row after the project list.
- Supports drag reorder via `@dnd-kit/sortable` at the `WorkspaceCard` list level in `UnifiedSidebar`.

---

## `ProjectRow`

```tsx
interface ProjectRowProps {
  project: Project
  isActive: boolean
  isExpanded: boolean
  workspaceColor: string
  onSelect: () => void
  onAddSession: () => void
}
```

**Behaviour**:

- When `isActive`, applies `border-left: 2px solid var(--ws-color)` and `rgba(var(--ws-color), 0.14)` background.
- Renders sessions as `SessionRow` children when `isExpanded`.
- Renders a branch badge chip when `project.gitBranch` is defined (color: green = clean, amber = dirty, red = conflict — driven by git extension store subscription).
- Renders Speckit phase badges when speckit extension has active feature data for this project.
- Supports drag reorder within its `WorkspaceCard` via `@dnd-kit/sortable`.
- Right-click context menu: Rename / Remove (same as current `ProjectItem`).

---

## `SessionRow`

```tsx
interface SessionRowProps {
  session: TerminalSession
  isActive: boolean
  isBusy: boolean
  bellCount: number
  workspaceColor: string
  onSelect: () => void
  onRename: (newTitle: string) => void
}
```

**Behaviour**:

- Prefix: `$` for `session.type === 'human'`, `⟡` for `'agent'`.
- Status indicator (right-aligned):
  - `isActive && !isBusy`: filled dot in `workspaceColor`
  - `isBusy`: animated spinner ring
  - `bellCount > 0`: red bell badge with count
  - otherwise: dim dot
- Double-click activates inline rename (same pattern as existing `ProjectItem` rename).
- Supports drag reorder within its `ProjectRow` via `@dnd-kit/sortable`.
- Right-click context menu: Rename / Move to project / Close.

---

## `SidebarHeader`

```tsx
interface SidebarHeaderProps {
  globalTabs: GlobalTabRegistration[]
  activeGlobalTabId: string | null
  onSelectGlobalTab: (id: string) => void
  onSearchFocus: () => void
  onAddWorkspace: () => void
}
```

**Behaviour**:

- Renders search bar that calls `onSearchFocus` when clicked or when `⌘F` fires (with sidebar focus).
- Renders icon buttons for each non-hidden `GlobalTabRegistration` (moved from WorkspaceRail).
- Renders a `+` button to create a new workspace.

---

## `SidebarSearch` _(Phase 3)_

```tsx
interface SidebarSearchProps {
  query: string
  onChange: (q: string) => void
  onClear: () => void
}
```

**Behaviour**:

- Controlled input. Parent (`UnifiedSidebar`) holds the query string.
- `Escape` key calls `onClear`.
- Query is used by `UnifiedSidebar` to filter/dim projects and hide sessions.

---

## `ExtensionFooter` _(Phase 2)_

```tsx
interface ExtensionFooterProps {
  buttons: SidebarButtonRegistration[]
}
```

**Behaviour**:

- Renders when `buttons.length > 0`.
- Each button calls `button.action()` on click.
- Styled as a bordered footer row within the workspace card.

---

## `ScratchSection`

```tsx
interface ScratchSectionProps {
  sessions: TerminalSession[]
  activeSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onNewScratch: () => void
}
```

**Behaviour**:

- Pinned at the bottom of `UnifiedSidebar`, below the workspace card list.
- Renders one `SessionRow`-like row per scratch session.
- "New scratch terminal" add row triggers `onNewScratch`.
- Active scratch session shown with a dim indicator (no workspace color).

---

## No New IPC Channels

This redesign introduces zero new IPC channels. All data consumed by the new components is already available via:

- `useWorkspaceStore` (workspaces, projects)
- `useSessionStore` (sessions, busy/bell state)
- `useExtensionRegistry` (global tabs, sidebar buttons, sidebar panels)
- Git extension store (branch/dirty/conflict — subscribed to by `ProjectRow` via existing hook)
- Speckit extension store (phase badges — subscribed to by `ProjectRow`)
- Task Vault store (workspace task count — subscribed to by `WorkspaceCard`)
