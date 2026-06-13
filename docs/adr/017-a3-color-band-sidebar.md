# ADR-017: A3 Color Band Sidebar Navigation

**Date**: 2026-06-13
**Status**: Accepted

## Context

The original sidebar navigation used two separate panels: a `WorkspaceRail` (72px icon strip) and a `ProjectsPanel` (248px list). This two-column layout consumed 320px of horizontal space, required separate scroll contexts, and made it difficult to show session-level status and branch information inline.

Five alternative layouts were evaluated (A1–A5):

| Layout | Description          | Key trade-off                                        |
| ------ | -------------------- | ---------------------------------------------------- |
| A1     | Keep dual-panel      | Familiar but wide; no inline session status          |
| A2     | Accordion tabs       | Single column but loses workspace color identity     |
| **A3** | **Color-band cards** | **Single column with color-coded workspace cards**   |
| A4     | Floating panel       | Persistent but covers terminal content               |
| A5     | Tree view            | Compact but visually flat; poor at 3-level hierarchy |

## Decision

Adopt **A3 (Color Band Sidebar)**: a single resizable `UnifiedSidebar` where each workspace appears as a color-coded card with a 3px left band matching the workspace color. Projects expand inline, sessions expand below projects.

Key design choices:

- **`--ws-color` CSS custom property** propagation: set on the workspace card root, consumed by all descendants for tinted borders, active state highlights, and status dots. No prop drilling.
- **Native HTML5 drag-and-drop** for workspace, project, and session reorder (existing pattern in the codebase; no new dependencies).
- **`localStorage` persistence** for sidebar width (`terminator.sidebar.width`) and collapsed workspace IDs (`terminator.workspace.collapsed`).
- **`setCollapsedWorkspaceIds`** store action for batch collapse updates (used by `⌘1–9` shortcut to expand one workspace and collapse all others).
- **Resizable handle** uses a `widthRef` (not state) during drag to avoid re-renders; commits to state only on `mouseup`.

## Consequences

- Horizontal space reduced from 320px (72 + 248) to a single 260px-default sidebar.
- Sessions and branch chips now visible inline without switching sidebar panels.
- `WorkspaceRail.tsx`, `ProjectsPanel.tsx`, `ScratchPanel.tsx` deleted as dead code.
- `--rail-w` and `--panel-w` CSS tokens removed.
- `Sidebar.tsx`, `WorkspaceItem.tsx`, `ProjectItem.tsx` deleted (were previously dead code).
- The `hidden` flag on `GlobalTabRegistration` is now used by `SidebarHeader` (was previously used by `WorkspaceRail`).
