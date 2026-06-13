# Implementation Plan: A3 Color Band Sidebar

**Branch**: `ux-terminal-navigation-redesign` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/008-a3-color-band-sidebar/spec.md`

---

## Summary

Replace the existing two-column navigation chrome (72px `WorkspaceRail` + 248px `ProjectsPanel`) with a single resizable `UnifiedSidebar` (default 260px) that renders each workspace as a color-coded card containing inline project rows and session rows. Extension surfaces (git branch badges, Speckit phase badges, Task Vault counts, global tab icons) are moved from the WorkspaceRail and ProjectsPanel to their natural anchoring points within the new card-based layout. The store, IPC, and Extension API are unchanged; this is a renderer-only restructuring across four phases.

---

## Technical Context

**Language/Version**: TypeScript 5.x / TSX, Node 20 LTS (Electron renderer process)
**Primary Dependencies**: React 18, Zustand 4, `@dnd-kit/core` + `@dnd-kit/sortable` (existing), Vitest + @testing-library/react (tests)
**Storage**: UI collapse/width state → `localStorage` (renderer-only preference, not IPC). Workspace/project/session data → main process SQLite via existing IPC (unchanged).
**Testing**: Vitest 2 + @testing-library/react + jsdom. Component specs live in `tests/unit/renderer/components/`. All new TSX files need a companion spec in that directory.
**Target Platform**: Electron desktop app (macOS primary, Electron 30+)
**Project Type**: Desktop application — renderer-side UI restructuring only
**Performance Goals**: Sidebar collapse/expand must complete in ≤150ms CSS transition; resize drag must be jank-free at 60fps.
**Constraints**: No extension source changes required through Phase 2. No IPC channel changes. No data model changes. Dead code (WorkspaceRail, ProjectsPanel, ScratchPanel) removed only in Phase 4 to keep diffs reviewable.
**Scale/Scope**: 7 new component files + CSS pairs. 1 store field addition. 1 App.tsx swap. ~5 CSS token changes.

---

## Constitution Check

_GATE: Must pass before implementation. Re-check before PR._

| Principle                        | Status  | Notes                                                                                                                   |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity              | ✅      | Using existing React, Zustand, dnd-kit patterns already in codebase                                                     |
| II. Extension Isolation          | ✅      | No extension source files change. Renderer maps existing `sidebarButtons` data to `ExtensionFooter`                     |
| IV. Dependency Stewardship       | ✅      | No new dependencies. `@dnd-kit` already present for drag reorder                                                        |
| V. Code Readability & Minimalism | ✅      | New components mirror HTML mockup structure; no speculative abstractions                                                |
| VI. TDD (NON-NEGOTIABLE)         | ⚠️ GATE | Every new `.tsx` file MUST have a corresponding spec in `tests/unit/renderer/components/` at ≥80% coverage before merge |
| VII. SOLID & YAGNI               | ✅      | Components scoped to their responsibility; no future-proofing beyond spec                                               |
| VIII. Documentation              | ⚠️ GATE | `docs/ARCHITECTURE.md` and `README.md` must be updated alongside Phase 4                                                |
| IX. ADR                          | ✅      | ADR-004 captures the A3 design choice rationale (already in PRD §2)                                                     |
| X. Code Cleanliness              | ⚠️ GATE | `npm run lint` must pass 0 errors before any phase is closed                                                            |
| XI. Functional Purity            | ✅      | Store actions remain pure functions; localStorage writes isolated to store boundary                                     |

**Hard blockers before merge:**

1. `npx vitest run --coverage` ≥ 80% on all new files
2. `npm run lint` 0 errors
3. `docs/ARCHITECTURE.md` updated with new sidebar architecture
4. Old components (`WorkspaceRail`, `ProjectsPanel`, `ScratchPanel`) deleted in Phase 4

---

## Project Structure

### Documentation (this feature)

```text
specs/008-a3-color-band-sidebar/
├── plan.md              # This file
├── research.md          # Phase 0 — technical decisions
├── data-model.md        # Phase 1 — store changes
├── contracts/
│   └── ui-components.md # Phase 1 — component API contracts
├── quickstart.md        # Phase 1 — dev workflow
└── tasks.md             # Phase 2 — /speckit-tasks output (NOT created here)
```

### Source Code Changes

```text
src/renderer/
├── App.tsx                                     MODIFY: swap WorkspaceRail+ProjectsPanel → UnifiedSidebar
├── styles.css                                  MODIFY: replace --rail-w/--panel-w with --sidebar-w tokens
├── stores/
│   └── workspace.store.ts                      MODIFY: add collapsedWorkspaceIds + toggleWorkspaceCollapse
└── components/
    └── sidebar/
        ├── UnifiedSidebar.tsx                  NEW
        ├── UnifiedSidebar.css                  NEW
        ├── WorkspaceCard.tsx                   NEW
        ├── WorkspaceCard.css                   NEW
        ├── ProjectRow.tsx                      NEW
        ├── ProjectRow.css                      NEW
        ├── SessionRow.tsx                      NEW
        ├── SessionRow.css                      NEW
        ├── SidebarHeader.tsx                   NEW
        ├── SidebarHeader.css                   NEW
        ├── SidebarSearch.tsx                   NEW (Phase 3)
        ├── SidebarSearch.css                   NEW (Phase 3)
        ├── ExtensionFooter.tsx                 NEW (Phase 2)
        ├── ExtensionFooter.css                 NEW (Phase 2)
        ├── ScratchSection.tsx                  NEW (replaces ScratchPanel)
        ├── ScratchSection.css                  NEW
        │
        │   [DELETED in Phase 4:]
        ├── WorkspaceRail.tsx  ← DELETE
        ├── WorkspaceRail.css  ← DELETE
        ├── ProjectsPanel.tsx  ← DELETE
        ├── ProjectsPanel.css  ← DELETE
        ├── ScratchPanel.tsx   ← DELETE
        └── ScratchPanel.css   ← DELETE

tests/unit/renderer/components/
    ├── UnifiedSidebar.spec.tsx                 NEW
    ├── WorkspaceCard.spec.tsx                  NEW
    ├── ProjectRow.spec.tsx                     NEW
    ├── SessionRow.spec.tsx                     NEW
    ├── SidebarHeader.spec.tsx                  NEW
    ├── SidebarSearch.spec.tsx                  NEW (Phase 3)
    ├── ExtensionFooter.spec.tsx                NEW (Phase 2)
    └── ScratchSection.spec.tsx                 NEW
```

**Structure Decision**: Single-project renderer-side restructuring. All new files are co-located with their existing sibling components in `src/renderer/components/sidebar/`. Tests follow the established pattern in `tests/unit/renderer/components/`.

---

## Complexity Tracking

No constitution violations. No complexity deviations from the spec are anticipated.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| —         | —          | —                                    |
