# Quickstart: A3 Color Band Sidebar

**Feature**: `008-a3-color-band-sidebar`
**Branch**: `ux-terminal-navigation-redesign`

---

## Development Workflow

### 1. Build and run

```bash
# Start dev server (builds extensions + launches Electron)
npm run dev
```

The sidebar changes are renderer-only. Hot-module reload applies. Extension rebuilds are not needed unless you modify extension source.

### 2. Run tests

```bash
# Run all unit tests with coverage
npx vitest run --coverage

# Run only sidebar-related specs in watch mode
npx vitest --watch tests/unit/renderer/components/UnifiedSidebar.spec.tsx
npx vitest --watch tests/unit/renderer/components/WorkspaceCard.spec.tsx
```

Coverage must be ≥80% on statements, branches, functions, and lines for every new file before a phase is considered done.

### 3. Lint

```bash
npm run lint
```

Must pass with 0 errors. Run after every phase.

### 4. Type check

```bash
npm run typecheck
```

Run before raising a PR. No new TypeScript errors are acceptable.

---

## Phase-by-Phase Build Order

### Phase 1 — Structure (no extensions involved)

Work order within Phase 1 (each item unblocked by the previous):

1. **Add CSS tokens** to `styles.css`: add `--sidebar-w`, `--ws-card-radius`, `--ws-band-w`, `--session-row-h`, `--project-row-h`, `--ws-card-gap`. Do NOT yet remove `--rail-w` / `--panel-w` (those go in Phase 4).
2. **Add `collapsedWorkspaceIds` to `workspaceStore`** — initialize from localStorage, add `toggleWorkspaceCollapse` action.
3. **Create `ScratchSection`** — simplest new component; establishes the pattern.
4. **Create `SessionRow`** — bottom of the data hierarchy; no child components.
5. **Create `ProjectRow`** — wraps `SessionRow`; no extension dependencies yet.
6. **Create `WorkspaceCard`** — wraps `ProjectRow`; no extension footer yet.
7. **Create `SidebarHeader`** — standalone header, no search yet (Phase 3).
8. **Create `UnifiedSidebar`** — assembles all of the above; includes resize handle + ⌘B toggle.
9. **Swap in `App.tsx`** — replace `<WorkspaceRail>` + `<ProjectsPanel>` with `<UnifiedSidebar>`.
10. **Verify acceptance**: navigate workspace → project → session with no regressions. All keyboard shortcuts work.

### Phase 2 — Extension Surfaces

1. Move global tab icons from `WorkspaceRail` to `SidebarHeader` (update `GlobalTabRegistration.hidden` handling).
2. Create `ExtensionFooter`; wire `sidebarButtons` from registry.
3. Add branch badge to `ProjectRow` — subscribe to git extension store.
4. Add Speckit phase badges to `ProjectRow`.
5. Add Task Vault count chip to `WorkspaceCard` header.
6. Verify: all extensions render correctly in new layout without changing extension source.

### Phase 3 — Polish

1. `SidebarSearch` component + fuzzy filter in `UnifiedSidebar`.
2. Animated collapse/expand on `WorkspaceCard` (CSS height transition).
3. Snap-to-default on double-click of resize handle.
4. Hover tooltips for truncated names (CSS `title` attribute first; custom tooltip if needed).
5. `⌘B` sidebar toggle animation (already wired in Phase 1, add animation here).

### Phase 4 — Cleanup

1. Delete `WorkspaceRail.tsx`, `WorkspaceRail.css`.
2. Delete `ProjectsPanel.tsx`, `ProjectsPanel.css`.
3. Delete `ScratchPanel.tsx`, `ScratchPanel.css`.
4. Remove `--rail-w` and `--panel-w` from `styles.css`.
5. Remove all CSS rules in any file that reference `--rail-w` or `--panel-w`.
6. Update `docs/ARCHITECTURE.md` with the new sidebar architecture.
7. Update `README.md` — replace screenshots and navigation description.
8. Run full test suite: `npx vitest run --coverage` — all thresholds ≥80%.
9. Run `npm run lint` — 0 errors.

---

## Testing Approach for New Components

All component specs live in `tests/unit/renderer/components/`. Each spec:

1. Mocks `window.electronAPI` (the global IPC bridge) as needed.
2. Mocks store state using `vi.spyOn(useWorkspaceStore, 'getState')` or by calling store actions directly on a fresh store instance.
3. Uses `@testing-library/react` `render` + `screen` + `fireEvent`.
4. Does NOT test CSS values — tests verify rendered structure, ARIA roles, and user interactions.

### Mock pattern for workspace store

```typescript
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'

vi.mock('../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))

const mockStore = {
  workspaces: [
    {
      id: 'ws1',
      name: 'Backend',
      color: '#5c6bc0',
      tags: [],
      folderPath: '',
      createdAt: '',
      updatedAt: '',
    },
  ],
  activeWorkspaceId: 'ws1',
  activeProjectId: null,
  projectsByWorkspaceId: new Map(),
  collapsedWorkspaceIds: new Set<string>(),
  toggleWorkspaceCollapse: vi.fn(),
  setActiveWorkspace: vi.fn(),
  setActiveProject: vi.fn(),
}

beforeEach(() => {
  vi.mocked(useWorkspaceStore).mockReturnValue(mockStore)
})
```

### Mock pattern for electronAPI

```typescript
beforeAll(() => {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      workspace: { list: vi.fn().mockResolvedValue({ workspaces: [] }) },
      project: { list: vi.fn().mockResolvedValue({ projects: [] }) },
    },
    writable: true,
  })
})
```

---

## Design Reference

The visual reference for all new components is:

- `ux-mockups/index.html` — base layout (local copy of the desktop design)
- `terminator-a3-design.html` — core design tokens and component anatomy
- `terminator-a3-extensions.html` — extension integration surfaces (branch badge, phase badges, task count chip, extension footer)

Key design tokens (defined in `styles.css` after Phase 1):

| Token              | Value      | Usage                                       |
| ------------------ | ---------- | ------------------------------------------- |
| `--sidebar-w`      | 260px      | Default sidebar width                       |
| `--ws-card-radius` | 8px        | WorkspaceCard border-radius                 |
| `--ws-band-w`      | 3px        | Color band width                            |
| `--session-row-h`  | 28px       | SessionRow height                           |
| `--project-row-h`  | 30px       | ProjectRow height                           |
| `--ws-card-gap`    | 6px        | Gap between workspace cards                 |
| `--ws-color`       | (per card) | Workspace brand color, set via inline style |
