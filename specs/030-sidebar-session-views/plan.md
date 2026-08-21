# Implementation Plan: Sidebar Session Views

**Branch**: `030-sidebar-session-views` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/030-sidebar-session-views/spec.md`

## Summary

Replace the fixed Workspace → Project → Session sidebar tree with a flat session list rendered from a pure
view model — a grouping key, a sort key, and a filter chain applied to `(sessions, projects, workspaces,
view, now)`. Add per-session activity tracking so recency and a derived agent state are representable, a
staleness predicate with a configurable threshold, and multi-select bulk cleanup. Preserve all four
extension surfaces by making group headers scope-bearing and giving every row a scope affordance — and
complete the one surface that has never worked, by wiring extension-contributed sidebar items into the new
sidebar footer.

The design is deliberately layered so the risky part is the cheap part: everything that decides _what is
shown_ is a pure function in `view-model.ts` with no React and no store access, and everything that decides
_how it looks_ is a thin component over that. Phase 0 research corrected two claims in the source research
document that made the feature larger than it is — see [research.md](./research.md) R1 and R2.

## Technical Context

**Language/Version**: TypeScript 5.x, React 18.3.1, Node 20 (Electron 3x main process)

**Primary Dependencies**: `electron`, `react` 18.3.1, `zustand` 4.5.5 (state), `zod` 3.23.8 (schema),
`lucide-react` ^0.475.0 (icons, Principle XII), `@xterm/xterm` 6.0.0, `node-pty`. **No new production
dependency is added by this feature** — see research R10.

**Storage**: `staleAfterMs` → `GlobalSettingsSchema` (zod-validated, electron-store via IPC). View
definitions → one localStorage key `terminator.sidebar.views`, matching the three existing sidebar keys. New
session fields are renderer-only transient state with no persistence at all (research R3, R6).

**Testing**: `vitest` + `@testing-library/react` + jsdom for unit and component specs;
`@playwright/test` for the e2e boot gate. Coverage via `@vitest/coverage-v8` with the 80% gate enforced in
`vitest.config.ts`, plus `scripts/check-patch-coverage.cjs`.

**Target Platform**: Electron desktop app, macOS arm64 primary.

**Project Type**: Desktop application — Electron main + preload + React renderer, single repo, no backend.

**Performance Goals**: view switch / regroup renders within 100 ms for 100 sessions (SC-008); activity
stamping causes at most one store write per session per second (research R7); no visible stutter in terminal
output while the sidebar re-renders.

**Constraints**: Plain CSS with custom properties, no Tailwind. The `--tm-*` custom-property aliases in
`styles.css` are published extension API — additive changes only. Extension API changes are **additive
only**: one new method (`api.sidebar.togglePanel`) and one new internal channel
(`extension:sidebar-item-click`), taking `packages/extension-sdk` from 1.0.0 to **1.1.0**. No contribution
type is added, removed, or re-specified, and no existing extension must change. `Escape` must not be bound.
Renderer `keydown` only, never `globalShortcut` (research R9).

**Scale/Scope**: ~22 sessions across ~4 workspaces in the author's real usage; design target 100 sessions.
Roughly 6 new renderer files, 6 rewritten, 4 files of dead code deleted.

## Constitution Check

_GATE: evaluated before Phase 0 research, re-evaluated after Phase 1 design. Both passes below._

| Principle                   | Gate                                                                 | Pre-Phase-0                                                                                                                                                                             | Post-Phase-1                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity         | Behaviour claims cite the source, not the research doc               | **PASS** — every claim in research.md carries a `file:line`; two source-plan claims were disproved and corrected                                                                        | **PASS**                                                                                                                                        |
| II. Extension Isolation     | Core must not read extension internals; no extension may import core | **PASS** — `agentState` is derived from core's own bell/busy/exit signals, explicitly _not_ from `speckit-pilot`'s Claude hooks (research R4)                                           | **PASS** — surfaces are consumed through the registry only                                                                                      |
| IV. Dependency Stewardship  | No new dependency without justification                              | **PASS** — none added; `dnd-kit`/`react-dnd` considered and rejected (research R10)                                                                                                     | **PASS**                                                                                                                                        |
| V. Readability & Minimalism | No speculative code; abstraction must be earned                      | **PASS** — `useDragReorder` and `ContextMenu` each have 4 existing call sites; `AgentStateSource` has exactly one implementation and exists because README must document the limitation | **PASS** — session palette reuses the existing `⌘K` palette rather than adding a second (research R9)                                           |
| VI. TDD + 80% coverage      | Spec before code; ≥80% all four metrics                              | **PASS** — every phase below is spec-first                                                                                                                                              | **PASS** — `UnifiedSidebar.tsx` starts at 69.41% and is an explicit Phase 3 exit condition (research R11)                                       |
| VII. SOLID & YAGNI          | Simplest design that meets the spec                                  | **PASS**                                                                                                                                                                                | **PASS** — FR-028 retired as unsatisfiable rather than built (research R1); FR-037 becomes a regression test rather than new code (research R2) |
| VIII. Documentation         | Docs ship in the same PR                                             | **PASS** — Phase 5 carries README + ARCHITECTURE + ADR, and no phase is "done" without them                                                                                             | **PASS**                                                                                                                                        |
| IX. ADRs                    | Significant decisions recorded at the time                           | **PASS** — ADR planned for the flat-list/view-model decision and the extension-surface contract                                                                                         | **PASS**                                                                                                                                        |
| X. Code Cleanliness         | No dead code, lint 0 errors                                          | **PASS** — 4 dead-code items inventoried for deletion (research R12)                                                                                                                    | **PASS**                                                                                                                                        |
| XI. Purity & Immutability   | Side effects at the boundary                                         | **PASS** — the whole view model is pure; `now` and the clock are injected, never read inside                                                                                            | **PASS** — throttle state lives in the controller, not the store reducer (research R7)                                                          |
| XII. UI Icons               | lucide only, flat, `currentColor`, CSS-sized                         | **PASS** — no unicode status glyphs; pre-existing `⬡`/`⌥` in `App.tsx` flagged out-of-scope (research R8)                                                                               | **PASS**                                                                                                                                        |
| Workflow                    | Feature branch, ratified spec                                        | **PASS** — on `030-sidebar-session-views`, spec ratified                                                                                                                                | **PASS**                                                                                                                                        |

**Result: no violations. Complexity Tracking table is omitted — nothing to justify.**

### Spec amendments and their history

The spec has been amended twice. Both are recorded here rather than silently applied.

**Phase 0 research produced two amendments:**

- **FR-037 reclassified as a regression test.** Worktree removal on project delete is already implemented
  and correct in `workspace.ipc.ts:91-98` (research R2). This feature pins the behaviour with a spec and the
  FR-024 confirmation copy; it writes no new removal code. **This amendment stands.**
- **FR-028 retired as unsatisfiable.** **This amendment was wrong and has been reversed** — see below.

**The `/speckit-analyze` pass reversed the FR-028 retirement and added one requirement:**

- **FR-028 restored and widened.** `api.sidebar.registerItem` is a documented public API with a live caller
  (`extensions/git-integration/src/index.ts:146`). The registration reaches the main process and stops
  there because no host-renderer code consumes `extension:get-sidebar-items`. The surface is broken wiring,
  not an absent feature, so it is completed rather than deleted (research R1-CORRECTION). `ExtensionFooter`,
  `registerSidebarButton`, and `sidebarButtons` are **kept**.
- **FR-028a added.** `extension:toggle-panel` has listeners on both sides and no sender, so a sidebar item
  literally cannot perform its action today — which is why the one real contributor toasts a hint instead.
  `api.sidebar.togglePanel()` closes that gap. Wiring a button that cannot act would ship an inert control
  that reads as a working feature.
- **FR-030 clarified**: no contribution type changes, no published API is removed; one additive method takes
  the SDK from 1.0.0 to 1.1.0.
- **SC-004 restored to four surfaces.** The sidebar-item surface is newly reachable, not merely preserved.

**Six smaller amendments from the same pass**: FR-011 gains `oldest` (required by FR-012 but omitted);
FR-021 carves out the Stale view, where a hide-stale toggle contradicts itself; FR-022 specifies a
select-all control on the group header rather than a keyboard binding, because `⌘A` belongs to the terminal;
FR-003 notes that `awaiting-input` is the design-artifact name for waiting-on-user; and SC-002 and SC-005
gain verification tasks they previously lacked.

## Project Structure

### Documentation (this feature)

```text
specs/030-sidebar-session-views/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── view-model.md            # the pure layer's contract
│   ├── extension-surfaces.md    # the four surfaces and their hosts per grouping mode
│   └── session-state.md         # session view fields + agent-state derivation
├── checklists/requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── types/index.ts                    # CHANGED  TerminalSession gains 4 renderer-only view fields
│   ├── electron-api/manifest.ts          # CHANGED  declare extension:sidebar-item-click
│   └── schemas/
│       ├── settings.schema.ts            # CHANGED  GlobalSettings gains `sidebar.staleAfterMs`
│       └── session.schema.ts             # CHANGED  delete the dead TerminalSessionSchema export
├── main/
│   ├── ipc/workspace.ipc.ts              # UNCHANGED (worktree removal already correct — research R2)
│   ├── ipc/extension.ipc.ts              # CHANGED  extension:sidebar-item-click handler
│   └── extensions/api.ts                 # CHANGED  dispatchSidebarItemClick + api.sidebar.togglePanel
└── renderer/
    ├── sidebar/                          # NEW  the pure layer — no React, no store imports
    │   ├── view-model.ts                 # NEW  buildGroups / isStale / sort / filter
    │   ├── views.ts                      # NEW  built-in view definitions as data + persistence
    │   └── agent-state.ts                # NEW  AgentStateSource + BellAndBusySource
    ├── extensions/loader.ts              # CHANGED  fetch + register contributed sidebar items
    ├── hooks/
    │   ├── useDragReorder.ts             # NEW  extracted from 2 sidebar call sites
    │   └── useKeyboardShortcuts.ts       # CHANGED  ⌘] ⌘[ ⌘⇧A ⌘I
    ├── components/
    │   ├── ContextMenu.tsx               # NEW  extracted from 4 ctx-menu call sites
    │   ├── CommandPalette.tsx            # CHANGED  session section (no second palette)
    │   └── sidebar/
    │       ├── UnifiedSidebar.tsx        # REWRITTEN  body; resize + width persistence kept
    │       ├── SidebarHeader.tsx         # UNCHANGED  surface 1 stays exactly as-is
    │       ├── ViewBar.tsx               # NEW  view chips, group/sort menu, hide-stale toggle
    │       ├── FilterNotice.tsx          # NEW  "showing N of M · show all"
    │       ├── SessionGroup.tsx          # NEW  scope-bearing group header
    │       ├── SessionRow.tsx            # CHANGED  scope badge, recency, note, status vocabulary
    │       ├── ScopeMenu.tsx             # NEW  row-level scope affordance
    │       ├── BulkCloseDialog.tsx       # NEW  states exactly what leaves disk
    │       ├── WorkspaceCard.tsx         # DELETED  replaced by SessionGroup
    │       ├── ProjectRow.tsx            # DELETED  replaced by SessionGroup
    │       ├── ExtensionFooter.tsx/.css  # DELETED  unreachable (research R1)
    │       └── *.css                     # matching CSS moves with its component
    ├── terminal/session-controller.ts    # CHANGED  throttled activity stamping
    └── stores/session.store.ts           # CHANGED  pure setters for the new fields
```

**Structure Decision**: single Electron project, existing `src/main` · `src/renderer` · `src/shared` split.
The one new directory is `src/renderer/sidebar/` for the pure layer, kept out of `components/` precisely
because it must contain no React — that physical separation is what makes the 100%-tested pure layer
enforceable by inspection rather than by discipline. Tests sit beside their subjects as `*.spec.ts(x)`,
matching the existing convention.

## Phases

Each phase is independently shippable and ends with `npm run format` → `npm run lint` (0 errors) →
`npx vitest run --coverage` (all pass, ≥80%), run from the worktree directory. TDD throughout: the spec is
written and failing before the implementation.

### Phase 0 — Groundwork (no user-visible change)

1. Fix the three confirmed defects (spec FR-034 to FR-036, research "Confirmed defects"): per-session bell
   count, child-row busy id, and deletion of the dead git-status props and branch chip.
2. Delete the two genuinely dead items in research R12 (items 3 and 4) with their tests. Items 1 and 2 are
   wired up in Phase 3 instead of deleted (R1-CORRECTION).
3. Extract `useDragReorder`; migrate `WorkspaceCard` and `ProjectRow`. Leave `TabBar` alone, and leave
   `UnifiedSidebar`'s site alone too — Phase 3 rewrites that body and deletes the workspace reorder it
   serves, so migrating it first is throwaway work.
4. Extract `ContextMenu`; migrate all four `ctx-menu` sites.

_Verify_: suite green, coverage not reduced, zero visual change. Deleting `ExtensionFooter` is the only
behavioural delta and it is provably invisible (it returned `null` on every render).

### Phase 1 — Session model and activity tracking

Add `lastActivityAt`, `lastAttendedAt`, `agentState`, `note` to `TerminalSession` as renderer-only view
state; pure store setters; throttled stamping in `session-controller.ts` with an injected clock;
`AgentStateSource` + `BellAndBusySource` in `src/renderer/sidebar/agent-state.ts`.

_Verify_: unit specs for the state machine and the throttle with a faked clock; existing session-store specs
still green; no UI change.

### Phase 2 — The view model (pure, headless)

`view-model.ts` + `views.ts` and their specs. `buildGroups(sessions, projects, workspaces, view, now)`,
`isStale(session, now, staleAfterMs)`, built-in views as data, custom-view persistence.

_Verify_: the highest-value test surface in the feature — table-driven specs over every grouping × sort ×
filter combination plus the staleness boundaries (exactly at threshold, awaiting-input never stale, exited
always stale). This layer targets 100%, not 80%.

### Phase 3 — Sidebar shell

`ViewBar`, `FilterNotice`, `SessionGroup`, `ScopeMenu`, rewritten `UnifiedSidebar` body, extended
`SessionRow`, and `ExtensionFooter` hosted once in the sidebar footer with the main↔renderer wiring behind
it. `SidebarHeader` untouched. `WorkspaceCard` and `ProjectRow` deleted. Groups default expanded, with
collapse state persisted per grouping mode. `activeProjectId` set on every session selection so it is never
undefined under non-project grouping.

_Verify_: component specs with jsdom + `electronAPI` mock; **the extension-surface regression spec is the
acceptance gate** — all three surfaces render and fire in every grouping mode
(see [contracts/extension-surfaces.md](./contracts/extension-surfaces.md)). `UnifiedSidebar.tsx` must exit
this phase at ≥80% on all four metrics (it enters at 69.41%). Then launch the real app and confirm by eye:
header global-tab buttons, SpecKit and Code Reviews hover buttons, the Git project tab, `⌘⇧G` for the Git
Changes panel, and the "Git Changes" footer item both appearing and toggling that panel when clicked. The
task list is not evidence.

### Phase 4 — Staleness and cleanup

`staleAfterMs` in `GlobalSettingsSchema` + defaults + settings-panel row; Stale view; hide-stale toggle;
multi-select with shift-range and select-all-in-group; bulk close; `BulkCloseDialog` naming exactly what
leaves disk; worktree-backed projects routed through the existing `project:delete` IPC.

_Verify_: staleness boundary specs; a regression spec pinning `project:delete` → `removeWorktree`; a spec
asserting bulk close never touches an awaiting-input session.

### Phase 5 — Search, keyboard, docs

Search as a filter over name + note + project + branch, one behaviour; `⌘]` `⌘[` `⌘⇧A` `⌘I` in
`useKeyboardShortcuts.ts`; session section in the existing `⌘K` palette; scope actions registered as renderer
commands.

Docs in the same PR (Principle VIII): README sidebar section including the honest statement that
`awaiting-input` is bell-derived and under-reports; `docs/ARCHITECTURE.md` for the view-model layer and the
corrected component tree; `docs/EXTENSION-DEVELOPMENT.md` for `api.sidebar.togglePanel` and a `registerItem`
example that now actually renders; and **ADR `docs/adr/027-flat-session-list-view-model.md`** recording the
flat-list-with-view-model decision, the four-surface contract, and the amendment history — including the
reversed R1.

_Verify_: full done checklist, plus the e2e boot gate.

## Risks

| Risk                                                                                                                            | Mitigation                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An extension surface is silently lost                                                                                           | [contracts/extension-surfaces.md](./contracts/extension-surfaces.md) is a table of host × grouping mode, and the Phase 3 regression spec asserts every cell. Treat that spec as the merge gate.                                                                          |
| A surface is declared "absent" on an incomplete read, as happened in R1                                                         | The regression spec enumerates surfaces from the **main-process** `ExtensionAPI` and every `extensions/*/src` call site, not from the renderer registry alone. A registered contribution that renders nowhere fails the spec instead of being reclassified as dead code. |
| Wiring the sidebar item ships an inert button                                                                                   | FR-028a: `api.sidebar.togglePanel` lands in the same phase, and the Phase 3 manual pass requires clicking the footer item and seeing the Git panel toggle — not merely seeing the button.                                                                                |
| `activeProjectId` undefined under non-project grouping breaks the Git project tab and per-project auto-open (`App.tsx:303-311`) | Selection always sets both `activeProjectId` and the project's active session; explicit spec for group-by-status → select → project tab still resolves.                                                                                                                  |
| `agentState` is heuristic, so "Needs me" under-reports                                                                          | One `AgentStateSource` seam; README states the limitation; SC-003 is already scoped to detectable sessions.                                                                                                                                                              |
| `UnifiedSidebar.tsx` enters at 69.41% and blocks the patch-coverage gate                                                        | Measured up front (research R11); ≥80% is a Phase 3 exit condition, not a PR-time discovery.                                                                                                                                                                             |
| Losing the tree's positional encoding                                                                                           | Default view still groups by project; every row carries a project badge in every mode.                                                                                                                                                                                   |
| Activity-stamp write thrash on a chatty agent                                                                                   | Throttled in the controller with an injected clock, ≤1 write/session/second (research R7).                                                                                                                                                                               |
| Deleting `WorkspaceCard`/`ProjectRow` loses behaviour nobody remembered                                                         | Their specs are read and their assertions re-homed onto `SessionGroup` before deletion, not after.                                                                                                                                                                       |
