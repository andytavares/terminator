# Implementation Plan: Declutter the Sidebar, and a Board for the Fleet

**Branch**: `034-declutter-sidebar` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/034-declutter-sidebar/spec.md`

## Summary

Take terminals out of the sidebar so it lists repos and branches only; give the per-terminal state that move destroys two better homes — the existing tab bar for the branch you are in, and a new state-columned board over the existing overview tiles for the whole fleet. Then cut the resting element count on what remains (13 → 3 on a repo header, ≤6 on a branch row), collapse four bands of chrome into two, and reduce repo colour from four background washes to one 2px rail.

The approach is renderer-only and additive-then-subtractive. A new pure module `buildBranchRows` is written beside the existing `buildGroups` rather than replacing it in place, so every step lands under a passing suite and `buildGroups` is deleted last, in one commit, once nothing imports it.

Two findings from Phase 0 shape the whole build:

1. **`mountPreview` moves the one live xterm element into the card's DOM node.** Re-parenting a card unmounts it and tears the preview out mid-transition. The board is therefore one CSS grid where a lane is a `grid-column`, never a per-lane container (R-003).
2. **`UnifiedSidebar.tsx` is at 79.2% function coverage today**, under the pre-commit patch gate. The first commit that stages it is refused before any of this feature's work is judged (R-012).

## Technical Context

**Language/Version**: TypeScript 5.5.4, React 18.3.1, Electron 42.4.1

**Primary Dependencies**: zustand 4.5.5 (stores), lucide-react 0.475.0 (icons, Constitution XII), `@xterm/xterm` 6.0.0, `@fontsource/ibm-plex-sans` 5.2.8. **No new dependency is added** — the mono/sans split (R-009) is a reassignment of two tokens that already exist.

**Storage**: No persisted change. `localStorage` gains one key, `terminator.board.lanes`. No IPC change, no migration.

**Testing**: vitest 4.1.9 with `@vitest/coverage-v8`, jsdom 29 for renderer specs, `@testing-library/react` 16.3.2; playwright 1.61.0 for e2e. Headless chromium via the same playwright install is the only way to verify `color-mix` and computed contrast — jsdom cannot.

**Target Platform**: Electron desktop (macOS primary), renderer process only.

**Project Type**: Desktop application, single project.

**Performance Goals**: Sidebar first paint must not wait on git (FR-032, SC-005 of 032). `buildBranchRows` stays O(sessions + projects) and has a performance spec alongside the existing `view-model-performance.spec.ts`. One 180ms transition, on the card that changed, and nothing else on the board animates.

**Constraints**: 80% coverage on all four metrics, enforced per-file at pre-commit and globally in CI. `npm run lint` at 0 errors. Sidebar operable between 200px and 480px. WCAG AA for all ten preset repo colours in both themes.

**Scale/Scope**: ~12 components touched, 5 deleted, 3 new pure modules, ~12 spec files rewritten or deleted. Target: 45 rows → 15 for 30 terminals; 165px → ≤99px of chrome.

## Constitution Check

_GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design. Both passes recorded._

| Principle                   | Gate                                                                  | Pre-design                                                                                                                                                 | Post-design                                                                    |
| --------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| I. Source Integrity         | Behaviour verified against the code and rendered output, not inferred | PASS — every Phase 0 finding cites a file and line that was read; contrast and font claims measured in a browser                                           | PASS                                                                           |
| II. Extension Isolation     | Core must not name any extension; contribution contracts unchanged    | PASS — FR-037; enforced by [contracts/extension-api-invariants.md](./contracts/extension-api-invariants.md) and the existing `extension-surfaces.spec.tsx` | PASS — render targets change, signatures do not; ADR-033 already did this once |
| IV. Dependency Stewardship  | Justify every addition                                                | PASS — **no new dependency**; the sans face is already a dependency                                                                                        | PASS                                                                           |
| V. Readability & Minimalism | Least code that satisfies the requirement; no speculative abstraction | PASS — the feature is net-subtractive; 5 components and ~10 dead rules deleted                                                                             | PASS — three new pure modules, each with one job, no abstraction over them     |
| VI. TDD + 80% coverage      | Red → Green → Refactor; no new file untested                          | PASS with a **pre-flight blocker**: `UnifiedSidebar.tsx` at 79.2% functions must be raised in the first commit that stages it                              | PASS — every new module has a named spec in [quickstart.md](./quickstart.md)   |
| VII. SOLID & YAGNI          | No interface the spec does not require                                | PASS — `AgentStateSource` is not extended; aggregation is a free function                                                                                  | PASS                                                                           |
| VIII. Documentation         | Docs ship in the same PR                                              | PASS — ARCHITECTURE §"Navigation Chrome", USER-GUIDE, README in scope                                                                                      | PASS                                                                           |
| IX. ADRs                    | Written at decision time                                              | PASS — three ADRs required, listed below                                                                                                                   | PASS                                                                           |
| X. Code Cleanliness         | No dead code, no unused exports, lint 0                               | PASS — deletion is a requirement (FR-025), not tidying; the dead-rule inventory is in [data-model.md §6](./data-model.md)                                  | PASS                                                                           |
| XI. Purity & Immutability   | Side effects at the boundary                                          | PASS — `src/renderer/sidebar/` imports nothing but types; `now` is a parameter                                                                             | PASS — the three new modules inherit the rule                                  |
| XII. UI Icons               | lucide only, flat, `currentColor`, opacity for state, never colour    | PASS — and it **constrains the design**: board lanes cannot use the reference product's coloured icons; states separate by shape and opacity (R-011)       | PASS                                                                           |
| Workflow                    | Feature branch, spec ratified first                                   | PASS — on `034-declutter-sidebar`, spec committed at `34e02d19`                                                                                            | PASS                                                                           |

**ADRs required** (Principle IX, written when the decision is taken, not retroactively):

1. **The sidebar stops at the branch** — why terminals leave the list, and what replaces the information.
2. **The board is one grid; a lane is a column** — the `mountPreview` constraint (R-003) and why per-lane containers were rejected.
3. **Colour reduced to one rail** — supersedes ADR-033 rather than editing it, per Principle IX's immutability rule. Records the light-theme AA fix.

**No Complexity Tracking entries.** No gate is violated and nothing needs justifying — the one blocker (coverage on `UnifiedSidebar.tsx`) is pre-existing debt to be paid, not a deviation to be excused.

## Project Structure

### Documentation (this feature)

```text
specs/034-declutter-sidebar/
├── spec.md
├── plan.md                       # this file
├── research.md                   # Phase 0 — R-001..R-012
├── data-model.md                 # Phase 1
├── quickstart.md                 # Phase 1
├── contracts/
│   ├── sidebar-pure-layer.md
│   └── extension-api-invariants.md
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks — NOT created here
```

### Source code

```text
src/renderer/
├── sidebar/                                  # pure layer — imports types only
│   ├── branch-state.ts                       # NEW  aggregateBranchState, countInState
│   ├── branch-rows.ts                        # NEW  buildBranchRows
│   ├── board-lanes.ts                        # NEW  buildLanes
│   ├── view-model.ts                         # CHG  export STATUS_ORDER; narrow GroupKey; delete buildGroups last
│   ├── views.ts                              # CHG  built-ins re-expressed at branch level
│   ├── session-status.ts                     # unchanged — the glyph map all three surfaces share
│   ├── agent-state.ts                        # unchanged
│   └── branch-display.ts, collapse-state.ts, relative-time.ts   # unchanged
│
├── components/sidebar/
│   ├── UnifiedSidebar.tsx                    # CHG  branch rows; coverage blocker (R-012)
│   ├── SessionGroup.tsx / .css               # CHG  → repo header + branch row
│   ├── AppBand.tsx / .css                    # CHG  icons only; absorbs the bell
│   ├── SidebarHeader.tsx / .css              # CHG  Filter + Display; delete dead rules
│   ├── FilterMenu.tsx / .css                 # NEW  views + hide-stale + count badge
│   ├── DisplayMenu.tsx / .css                # NEW  group + sort
│   ├── SidebarSearch.css                     # CHG  delete the undefined --font-sans
│   ├── SessionRow.tsx / .css                 # DEL
│   ├── WorkspaceRow.tsx / .css               # DEL
│   ├── ViewBar.tsx / .css                    # DEL
│   ├── FilterNotice.tsx / .css               # DEL
│   └── BulkCloseDialog.tsx / .css            # DEL
│
├── components/overview/
│   ├── BoardScreen.tsx / .css                # NEW  one grid, lane = grid-column
│   ├── OverviewScreen.tsx / .css             # CHG  hosts board | list, board default
│   └── SessionTile.tsx / .css                # CHG  → the card
│
└── components/terminal/
    └── TabBar.tsx / .css                     # CHG  state glyph; note → title; four-element cap

tests/unit/renderer/
├── sidebar/{branch-state,branch-rows,board-lanes}.spec.ts        # NEW
├── components/{BoardScreen,FilterMenu,DisplayMenu}.spec.tsx      # NEW
├── components/{SessionGroup,UnifiedSidebar,OverviewScreen,SessionTile,TabBar}.spec.tsx   # REWRITE
├── components/{SessionRow,WorkspaceRow,ViewBar}.spec.tsx         # DEL
└── sidebar-workspace-tint.spec.ts                                # RETARGET to rail + swatch

tests/e2e/sidebar-branch-first.spec.ts                            # REWRITE
```

**Structure Decision**: Single project, renderer-only. The existing `src/renderer/sidebar/` (pure) ↔ `src/renderer/components/sidebar/` (React) split from ADR-027 is kept and extended — all three new modules go in the pure half, and the components stay a thin rendering of what those functions return. No new top-level directory.

## Build order

Each step ends green. The order is chosen so the coverage blocker is paid first and the riskiest thing is proven early.

| #   | Step                                                                              | Why here                                                                                |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0   | Raise `UnifiedSidebar.tsx` function coverage ≥80%                                 | Nothing can be committed touching it until this is done (R-012)                         |
| 1   | `branch-state.ts` + spec                                                          | Pure, no dependents, and BS-1 (empty ⇒ idle) is the easiest thing to get wrong          |
| 2   | `branch-rows.ts` + spec, beside `buildGroups`                                     | The seam the rest rests on; nothing renders it yet                                      |
| 3   | `board-lanes.ts` + spec                                                           | Pure; unblocks the board without touching the sidebar                                   |
| 4   | `BoardScreen` as one grid + preview-survival test                                 | **Riskiest.** Prove `mountPreview` survives a lane change before building on it (R-003) |
| 5   | `TabBar` state glyph + four-element cap                                           | Must land before terminal rows are deleted, or US3 information is destroyed             |
| 6   | Sidebar switches to `buildBranchRows`; delete `SessionRow`, `WorkspaceRow`        | The structural cut, with its replacements already in place                              |
| 7   | `FilterMenu` + `DisplayMenu`; delete `ViewBar`, `FilterNotice`, `BulkCloseDialog` | Chrome collapse                                                                         |
| 8   | Row anatomy, `AppBand` icons, type-role swap, breakpoints re-derived              | Presentation, once structure is settled                                                 |
| 9   | Colour: one rail, retarget the tint spec, fix the light-theme AA failure          | Self-contained, lands last                                                              |
| 10  | Delete `buildGroups`, `Group`, `GroupScope`; dead CSS; unused props               | Only now does nothing import them                                                       |
| 11  | Docs + three ADRs                                                                 | Principle VIII — same PR                                                                |

## Risks

| Risk                                                                               | Mitigation                                                                                                                                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Live preview dies when a card changes lane**                                     | Step 4 proves it before anything depends on it; the DOM-identity check is in [quickstart.md](./quickstart.md). Single grid, lane = `grid-column`, card never re-parented |
| Pre-commit refuses the first sidebar commit                                        | Step 0 pays the 79.2% debt before any feature work                                                                                                                       |
| A missing import passes build + lint + the whole unit suite                        | E2E is the only real app-boot gate; run it per step, not at the end (`feedback_verify_imports_land`)                                                                     |
| Prettier reformats between edits and a scripted replace silently no-ops            | Verify each edit actually landed rather than assuming (`feedback_verify_imports_land`)                                                                                   |
| Deleting the washes silently deletes the AA guarantee                              | The tint spec is **retargeted**, never deleted (R-010)                                                                                                                   |
| jsdom cannot compute `color-mix`, so a CSS assertion passes while the app is wrong | Render in headless chromium and measure computed values (`feedback_verify_css_by_rendering`)                                                                             |
| Stale multi-select left wired but inert                                            | It is deleted with its tests and named in the PR (R-007, FR-025)                                                                                                         |
| A stored view override names a retired `groupBy`                                   | `loadViews()` degrades to the built-in default; invariant VW-1, with its own test                                                                                        |

## Out of scope

Carried from the spec: the diff viewer; lanes for pull-request or review state; dragging a card to change state; pinning, branch reordering, or user groups within a repo; changes to the terminal pane or the extension panels the sidebar hosts; renaming the stored entities.
