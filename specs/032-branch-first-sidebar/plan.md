# Implementation Plan: Branch-First Sidebar

**Branch**: `032-branch-first-sidebar` | **Date**: 2026-08-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/032-branch-first-sidebar/spec.md`

## Summary

Make the sidebar row carry what the rest of the app already knows. Three changes, in dependency order:

1. **Separate state from selection.** Selection moves to the row surface; state becomes a distinct lucide glyph with four resting forms. The agent state the view model already computes becomes visible for the first time.
2. **Make the branch the identity.** A branch row displays its branch name by default, carries a worktree marker when it has a working copy on disk, and shows change statistics when git can supply them. Repo headers carry their folder path.
3. **Say "branch" everywhere, and qualify by repo.** Every user-visible string, command label and dialog that said "project" says "branch" and names the repo that owns it.

Plus one independent slice: consolidate the sidebar's app-level surfaces — four unlabelled global-tab icons at the top and the contributed-item footer at the bottom — into a single labelled band, and give scratch sessions a real group.

The technical shape is a pure-core change plus one new async data source. `buildGroups` gains no responsibilities: change statistics arrive through a separate store keyed by branch id and are read at render, so the pure layer stays a function of `(sessions, branches, repos, view, now, staleAfterMs)` and first paint never waits on git.

## Technical Context

**Language/Version**: TypeScript 5.x, React 18, Node 20 (Electron main)

**Primary Dependencies**: Electron, Zustand (renderer stores), lucide-react ^0.475.0, xterm.js, Vitest + Testing Library, Playwright (e2e)

**Storage**: Existing workspace store (`src/main/storage/workspace-store.ts`) — **no schema change**; `localStorage` for sidebar view/collapse state

**Testing**: Vitest unit + jsdom component tests; Playwright e2e for app-boot and sidebar interaction

**Target Platform**: Electron desktop app, macOS arm64 primary

**Project Type**: Desktop application — Electron main + preload + React renderer, with a sandboxed extension host

**Performance Goals**: Sidebar first paint unblocked by git; change statistics resolve within 2s of a branch becoming visible and never re-fetch more than once per 15s per branch; `buildGroups` stays within the existing `view-model-performance.spec.ts` budget at 200 sessions

**Constraints**: Coverage ≥ 80% per new file (constitution VI); `npm run lint` 0 errors; icons lucide-only with no colour on the icon element (constitution XII); no stored-data change that an older build cannot read (FR-021); extension contribution points unchanged (FR-020)

**Scale/Scope**: ~6 repos × ~3 branches × ~5 sessions in real use; the sidebar must stay legible at 200 sessions. Roughly 8 renderer components touched, 1 new main-process git function, 1 new renderer store, 1 IPC channel.

**Prerequisite**: PR #155 (`032-sidebar-workspace-grouping`) must merge first; this branch is cut from `main` and will need a rebase onto it. `SessionGroup`'s `nested`/`workspaceName` props and the workspace-grouped default come from that PR.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

| Principle                   | Gate                                                      | Verdict                                                                                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity         | Icon and git behaviour decisions cite vendor docs         | **PASS** — lucide component names verified against the installed package; `git diff --numstat` behaviour from git docs. Recorded in research.md.                                                                                               |
| II. Extension Isolation     | Core must not reach into extensions; extensions unchanged | **PASS** — FR-020 forbids requiring extension changes. The app band consumes the _existing_ `globalTab` manifest contribution and the existing `registerItem` API; neither contract changes. Core adds no knowledge of any specific extension. |
| IV. Dependency Stewardship  | No new dependencies                                       | **PASS** — lucide-react and the git CLI are already present. Nothing added.                                                                                                                                                                    |
| V. Readability & Minimalism | No speculative abstraction                                | **PASS** — one new store, one new git function, no new abstraction layer. Status glyph selection is a lookup table, not a strategy pattern.                                                                                                    |
| VI. TDD & 80% coverage      | Failing test before code, per-file ≥ 80%                  | **PASS** with obligation — every new file (`change-stats.store.ts`, `session-status.ts`, `AppBand.tsx`) ships with its spec. Vocabulary changes are covered by assertions on rendered strings.                                                 |
| VII. SOLID & YAGNI          | Simplest design that meets the spec                       | **PASS** — see Complexity Tracking for the one recorded deviation.                                                                                                                                                                             |
| VIII. Documentation         | Docs in the same PR                                       | **PASS** with obligation — `docs/ARCHITECTURE.md` sidebar section, `README.md` session-views bullet, and `docs/user-guide/USER-GUIDE.md` all say "project" today and must change with the code.                                                |
| IX. ADRs                    | Significant decisions recorded at the time                | **PASS** with obligation — three ADRs required, listed under Phase 1.                                                                                                                                                                          |
| X. Code Cleanliness         | No dead code, lint clean                                  | **PASS** with obligation — the audit already found `expandedWorkspaceIds` dead. It is _not_ in this feature's scope (WS-2 is a standalone repair) and must not be silently swept in.                                                           |
| XI. Purity & Immutability   | Domain logic pure                                         | **PASS** — `buildGroups` gains nothing. `statusGlyphFor(session)` is pure. Git I/O is confined to the main process behind IPC.                                                                                                                 |
| XII. UI Icons               | lucide only, flat, `currentColor`, no colour on the icon  | **CONFLICT — resolved.** See below.                                                                                                                                                                                                            |

### Resolved conflict: XII vs FR-002

FR-002 requires four session states distinguishable "by shape, not by hue alone". Constitution XII forbids colour on icon elements entirely and permits only opacity for state.

These are compatible, and the resolution is what the spec actually asked for:

- **Shape carries state.** Four distinct lucide components, one per state. The icon element itself stays `currentColor` with no colour class and no inline colour — XII holds without exception.
- **Colour, where it appears at all, lives on the row, not the icon** — the awaiting-input edge bar (FR-004) is a row-level element, exactly as it is today.

This is stricter than the mockups, which tinted the glyphs. The constitution wins. Recorded in research.md as the icon decision, and it makes SC-001 (four states nameable from a greyscale screenshot) a stronger test rather than a weaker one.

## Project Structure

### Documentation (this feature)

```text
specs/032-branch-first-sidebar/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── change-stats-ipc.md
│   ├── sidebar-row.md
│   └── app-band.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── types/index.ts                     # + ChangeStats; Project keeps its name (see Complexity Tracking)
│   └── schemas/git.schema.ts              # + changeStatsSchema
├── main/
│   ├── git/git-service.ts                 # + getChangeStats()
│   └── ipc/git.ipc.ts                     # + git:change-stats handler
├── preload/index.ts                       # + electronAPI.git.changeStats
└── renderer/
    ├── sidebar/
    │   ├── session-status.ts              # NEW — pure state → glyph/label mapping
    │   └── view-model.ts                  # unchanged behaviour; count fix is out of scope here
    ├── stores/
    │   └── change-stats.store.ts          # NEW — cached, TTL'd per-branch stats
    └── components/sidebar/
        ├── SessionRow.tsx / .css          # state glyph, selection on the surface
        ├── SessionGroup.tsx / .css        # branch name, worktree marker, stats, repo path
        ├── SidebarHeader.tsx / .css       # app band; bell and + move to the search row
        ├── AppBand.tsx / .css             # NEW — labelled global tabs + contributed items
        ├── ExtensionFooter.tsx            # DELETED — merged into AppBand
        ├── ScratchSection.tsx             # DELETED — becomes a group in the list
        ├── MoveSessionDialog.tsx          # copy: "branch", qualified by repo
        └── CreateProjectDialog.tsx        # copy + title; file rename deferred

tests/
├── unit/renderer/sidebar/session-status.spec.ts        # NEW
├── unit/renderer/stores/change-stats.store.spec.ts     # NEW
├── unit/renderer/components/AppBand.spec.tsx           # NEW
├── unit/renderer/components/SessionRow.spec.tsx        # extended
├── unit/renderer/components/SessionGroup.spec.tsx      # extended
├── unit/main/git-service.spec.ts                       # extended — getChangeStats
└── e2e/sidebar-branch-first.spec.ts                    # NEW

docs/
├── ARCHITECTURE.md                        # sidebar section + the new store
├── user-guide/USER-GUIDE.md               # vocabulary
└── adr/
    ├── 0NN-branch-vocabulary-ui-only.md   # NEW
    ├── 0NN-change-stats-out-of-band.md    # NEW
    └── 0NN-one-app-band.md                # NEW
```

**Structure Decision**: The existing Electron three-process layout is kept unchanged. All new renderer logic lands in the two directories that already own it — `src/renderer/sidebar/` for pure logic and `src/renderer/components/sidebar/` for components — and the one new main-process capability follows the established `git-service → git.ipc → preload → store` path used by every other git feature. No new top-level directory is introduced.

## Phase 0 — Research

Unknowns carried out of Technical Context, resolved in [research.md](./research.md):

1. Which lucide components express the four states, given XII forbids colour on the icon.
2. How change statistics are fetched, cached and invalidated without blocking paint or hammering git.
3. What the sidebar's default and minimum widths become, and the order in which row metadata degrades.
4. Whether the rename touches stored data, and how a UI-only rename avoids rotting.
5. How the app band absorbs two different extension contribution points without changing either contract.

## Phase 1 — Design & Contracts

**Artifacts**: [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

Three ADRs are required by constitution IX and must be written as the decisions are taken, not after:

- **Branch vocabulary is UI-only** — why the stored `Project` entity keeps its name, what the split costs, and the lint rule that stops the two drifting.
- **Change statistics travel out of band** — why they are a separate store rather than a field on the branch record, and why the pure view model never sees them.
- **One app band** — why two contribution points render into one surface, and why that does not violate extension isolation.

## Post-Design Constitution Re-Check

_Re-run after Phase 1. Design artifacts: research.md, data-model.md, contracts/ (3), quickstart.md._

| Principle                   | Verdict after design     | Evidence                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity         | **PASS**                 | Icon availability verified against the installed package, not assumed (research R1). `git diff --numstat` semantics, including binary `-` rows and unborn `HEAD`, specified from git's documented behaviour (contracts/change-stats-ipc.md).                                                                                    |
| II. Extension Isolation     | **PASS**                 | `AppBand` iterates registry data and names no extension in code, stated as a rule in contracts/app-band.md. Both contribution contracts are unchanged; the reference table of currently-registered extensions is documentation, not code. Deleting every extension directory still builds.                                      |
| IV. Dependency Stewardship  | **PASS**                 | Nothing added.                                                                                                                                                                                                                                                                                                                  |
| V. Readability & Minimalism | **PASS**                 | Design settled on one pure module, one store, one git function, one component. Status selection is a total lookup table (data-model.md), not a pattern.                                                                                                                                                                         |
| VI. TDD & 80% coverage      | **PASS with obligation** | Every new file has an explicit test obligation table in its contract. Boundary cases are named, not implied — TTL at exactly `fetchedAt + TTL` and one ms past, binary rows, unborn HEAD, unresolved icon names.                                                                                                                |
| VII. SOLID & YAGNI          | **PASS**                 | Two candidate abstractions were rejected in research on YAGNI grounds: a per-branch filesystem watcher (R2) and a user-facing density setting (R3). Both are recorded with the condition that would justify revisiting them.                                                                                                    |
| VIII. Documentation         | **PASS with obligation** | `docs/ARCHITECTURE.md`, `README.md` and `docs/user-guide/USER-GUIDE.md` are named in the source tree as required edits. The vocabulary lint rule covers renderer strings but **not** docs, so the doc edits are a human obligation, not an enforced one. Called out here so it is not assumed covered.                          |
| IX. ADRs                    | **PASS with obligation** | Three ADRs specified, each corresponding to a decision actually taken in Phase 0: research R4 → vocabulary, R2 → out-of-band stats, R5 → one band. Each must be written when the code lands, not retrofitted.                                                                                                                   |
| X. Code Cleanliness         | **PASS**                 | Two deletions are explicit (`ExtensionFooter`, `ScratchSection`) with their specs reassigned rather than orphaned. The pre-existing dead `expandedWorkspaceIds` is explicitly **not** swept in — it belongs to a separate repair, and bundling it would make this PR's diff lie about its scope.                                |
| XI. Purity & Immutability   | **PASS**                 | The design's central constraint. `buildGroups` is untouched, proven by requiring `view-model.spec.ts` and `view-model-performance.spec.ts` to pass **unmodified** (quickstart gate). `statusPresentationFor` is pure and total. The store takes `now` as a parameter and holds no clock. All git I/O stays in the main process. |
| XII. UI Icons               | **PASS**                 | The conflict identified pre-design is resolved in favour of the constitution, not the mockups: shape carries state, the icon element keeps `currentColor` with no colour class, and colour lives only on the row's edge bar. Asserted in the SessionRow test obligations.                                                       |

**No new violations introduced by the design.** The Complexity Tracking table below is unchanged from the pre-design check — both entries were identified up front and neither grew.

## Complexity Tracking

| Violation                                                                        | Why Needed                                                                                                                                                                                       | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The user-visible noun ("branch") differs from the stored entity name (`Project`) | FR-021 forbids a stored-data change an older build cannot read, and a rename of the persisted entity is a migration with no user-visible benefit beyond the label the UI already controls        | Renaming the entity end-to-end was rejected: it touches the store schema, every IPC channel name, the Extension API surface (`project.*`), and every installed extension — which FR-020 explicitly forbids requiring. The cost is a permanent translation seam; it is contained by a lint rule that forbids the string "project" in user-facing renderer strings, specified in contracts/sidebar-row.md. |
| A second source of truth for change statistics, separate from the branch record  | The stats are derived, expensive, and stale the moment they are read; storing them on the branch would make the pure view model depend on I/O timing and break its determinism (constitution XI) | Putting `added`/`removed` on the `Project` record was rejected: `buildGroups` would become a function of when git last answered, which makes it untestable at the boundaries and violates the "no I/O in domain logic" rule the sidebar's pure core was built on.                                                                                                                                        |
