# Implementation Plan: SpecKit Pilot Quill-style Workflow Board

**Branch**: `016-speckit-pilot-board` | **Date**: 2026-06-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/016-speckit-pilot-board/spec.md`

**Blueprint**: Engineering blueprint approved by the user at
`~/.claude/plans/i-want-the-speckit-pilot-groovy-peacock.md` (this plan is fully
consistent with it).

## Summary

Reframe the `speckit-pilot` extension's UX from a linear, single-run, tab-based tool
into a **Quill-style kanban board** as the home surface. Work becomes **cards** on a
six-column board (Backlog → Spec → Plan → Implement → In Review → Done). A card
unifies today's "feature dir + ticket + run", can exist in Backlog before any run,
and carries a brief (title, type, scope, checklist, attachments). Cards are authored
natively or imported from Linear/Jira. Handing a card off dispatches it (reusing the
existing worktree + agent-runner path); the existing 10-phase rail and approval gates
live inside each card's detail view. The one-active-run queue is replaced by a
`maxConcurrentRuns` cap so several cards run in parallel, each in its own worktree.
Each card gains an activity/comments feed (comments steer the next phase), an
artifacts view with per-file revision history, and a keyword workspace-knowledge
search. All work is contained within the isolated extension; no core files change.

## Technical Context

**Language/Version**: TypeScript 5.x — Electron main process + React 18 renderer (existing).

**Primary Dependencies**:

- Existing (extension `package.json`): `@linear/sdk`, `diff`, `marked`, `minimatch`, React 18, Vite.
- New (extension `package.json` **only**): `@dnd-kit/core` + `@dnd-kit/sortable` (accessible drag-and-drop for the board).
- No new root dependencies; no new main-app dependencies.

**Storage** (per feature dir `specs/NNN-slug/.pilot/`, files, atomic writes):

- `state.json` — `PilotState` **v3** (adds `card` brief + `stage`).
- `card.json` — card brief for native/imported cards (authored before any run).
- `history.jsonl` — existing append-only audit log (reused for activity feed).
- `comments.jsonl` — NEW append-only comment log (mirrors history.jsonl pattern).
- `self-review.json` — existing self-review result.

**Testing**: Vitest (existing); jsdom + `electronAPI` mock for renderer components. Coverage ≥ 80% per file (statements/branches/functions/lines).

**Target Platform**: Electron desktop (macOS, Linux, Windows).

**Project Type**: Isolated Electron extension (`extensions/speckit-pilot/`) — main-process IPC handlers + React renderer.

**Performance Goals**: Board renders all cards in < 1s for ~100 cards; a card's column reflects a phase change within a few seconds (push-event driven, no manual refresh — SC-004); knowledge search returns in < 2s over repo markdown.

**Constraints**: Extension isolation (Constitution II) — all new deps and code in the extension tree only; never touch `src/main/preload.ts`, `src/renderer/electron.d.ts`, or root `package.json`. Final review + open-PR phases never auto-approved (FR-023).

**Scale/Scope**: Up to ~100 cards per workspace; default `maxConcurrentRuns` = 3 (configurable).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                | Status | Notes                                                                                                                                                                                          |
| ---------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity                      | ✓      | `@dnd-kit` selected from official docs (dndkit.com); Linear/Jira behavior already grounded.                                                                                                    |
| II. Extension Isolation (NON-NEGOTIABLE) | ✓      | All new deps in `extensions/speckit-pilot/package.json`; all code under the extension tree; IPC registered by the extension's own `index.ts`. Deletion test still passes.                      |
| III. Readability & Minimalism            | ✓      | Reuse existing state machine, persistence, gates, runner, RunDashboard, PhaseRail, artifact-read/diff. New code only for the board, card brief, activity, artifacts panel, and keyword search. |
| IV. Dependency Stewardship               | ✓      | `@dnd-kit` is battle-tested, multi-maintainer, actively maintained; pinned versions; justification recorded in research.md.                                                                    |
| V. Readability & Minimalism              | ✓      | (see III)                                                                                                                                                                                      |
| VI. TDD (NON-NEGOTIABLE)                 | ✓      | Failing test first for every new file; ≥80% per-file coverage at merge. Test plan per milestone below.                                                                                         |
| VII. SOLID & YAGNI                       | ✓      | Keyword search only (no vector/URL/GH indexing); no per-batch-PR; parallelism capped, no speculative abstraction.                                                                              |
| VIII. Documentation First-Class          | ✓      | README, ARCHITECTURE.md, and ipc-channels.md updated in the same change (M5).                                                                                                                  |
| IX. ADRs                                 | ✓      | Two ADRs: (a) card model unifying feature/ticket/run; (b) parallel runs via concurrency cap replacing single-active queue.                                                                     |
| X. Code Cleanliness (NON-NEGOTIABLE)     | ✓      | Retired tabs/paths removed cleanly; `npm run build:extensions`; 0 lint errors; no dead exports.                                                                                                |
| XI. Functional Purity                    | ✓      | `deriveStage` and stage/queue logic are pure; side effects (spawn, fs, git) isolated to IPC handlers/runner.                                                                                   |
| XII. UI Icons (NON-NEGOTIABLE)           | ✓      | lucide-react only, flat, `currentColor`, size via CSS.                                                                                                                                         |

**Result: PASS.** No violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/016-speckit-pilot-board/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions (dnd-kit, stage derivation, concurrency, comment-steering, search)
├── data-model.md        # Phase 1 — PilotState v3, CardBrief, BoardStage, entities, transitions
├── quickstart.md        # Phase 1 — end-to-end validation scenarios
├── contracts/
│   ├── ipc-channels.md  # Phase 1 — new/changed speckit-pilot IPC channels + payloads
│   └── ui-views.md      # Phase 1 — board + card-detail view contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 — /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
extensions/speckit-pilot/
├── package.json                         # add @dnd-kit/core, @dnd-kit/sortable (pinned)
├── src/
│   ├── index.ts                         # extend: card IPC handlers + concurrency (runner map, cap)
│   ├── types/
│   │   └── speckit.types.ts             # extend: PilotState v3, CardBrief, BoardStage, CardType, ChecklistItem, CardComment
│   ├── state/
│   │   ├── derive-stage.ts              # NEW — pure deriveStage(phases, run) → BoardStage
│   │   ├── state-persistence.ts         # extend: v2→v3 migration; card.json + comments.jsonl helpers
│   │   └── phase-state-machine.ts       # unchanged (10-phase machine reused)
│   ├── runner/agent-runner.ts           # unchanged (per-run RunnerHandle reused)
│   ├── api/{linear,jira,credentials}.ts # unchanged (reused for import)
│   ├── utils/
│   │   ├── retry.ts                     # unchanged
│   │   └── knowledge-search.ts          # NEW — keyword search (rg via api.shell.exec, fs fallback)
│   └── renderer/
│       ├── App.tsx                      # rework: BoardView is home; Settings in header; import as modal
│       └── components/
│           ├── BoardView.tsx            # NEW — six columns, dnd, New card / Import ticket, search box
│           ├── CardTile.tsx             # NEW — card face (type badge, title, scope, compact PhaseRail, status)
│           ├── CardDetail.tsx           # NEW — drawer with tabs: Brief | Phases | Activity | Artifacts
│           ├── CardBriefEditor.tsx      # NEW — author/edit brief (type/scope/checklist/attachments)
│           ├── ActivityFeed.tsx         # NEW — merged comments + audit events + composer
│           ├── ArtifactsPanel.tsx       # NEW — artifact list + viewer + revision history
│           ├── KnowledgeSearch.tsx      # NEW — search input + results (file:line snippets)
│           ├── RunDashboard.tsx         # reused unchanged inside CardDetail "Phases" tab
│           ├── PhaseRail.tsx            # reused (+ compact mode for CardTile)
│           ├── RunConsole.tsx           # reused
│           ├── GatePanel.tsx            # reused (diff rendering reused by ArtifactsPanel)
│           ├── SelfReviewGate.tsx       # reused
│           ├── OpenPrGate.tsx           # reused
│           ├── BatchCheckIn.tsx         # reused
│           ├── TicketsView.tsx          # reused inside Import modal
│           ├── DispatchSheet.tsx        # reused inside Import/handoff flow
│           ├── SettingsView.tsx         # extend: maxConcurrentRuns setting
│           └── speckit-pilot.css        # extend: board + card-detail styles (--tm-* tokens only)
│   # Retired: FeaturesView / ActiveRunsView / HistoryView top-level tabs absorbed into the board
└── tests/                               # companion specs for every new/changed file
```

**Structure Decision**: Single isolated extension. All feature code lives under
`extensions/speckit-pilot/`. The renderer gains a board surface and card-detail
drawer; the main process gains card + search IPC handlers and a concurrency change.
No files outside the extension are modified.

## Implementation Milestones (TDD; ≥80% per-file coverage)

- **M1 — Types + stage derivation**: extend `speckit.types.ts` (v3 `PilotState`, `CardBrief`, `BoardStage`, `CardType`, `ChecklistItem`, `CardComment`); add pure `derive-stage.ts`; v2→v3 migration + card/comment helpers in `state-persistence.ts`. _Tests_: `deriveStage` for every phase/run combination; migration round-trip; helper read/write.
- **M2 — Concurrency**: replace single-active queue in `index.ts` with a `Map<featureDir, RunnerHandle>` + `maxConcurrentRuns` cap; over-cap → `pending`; auto-advance on slot free. _Tests_: N-under-cap start immediately; over-cap queues; slot frees → next auto-starts; each keeps its own worktree.
- **M3 — Card + search IPC**: `card-list/create/update/move`, `card-comment/comment-list`, `artifact-list`, `knowledge-search`. Move triggers dispatch (Backlog→next) or park/cancel (→Backlog) with confirmation semantics enforced in the renderer. _Tests_: extend `index-ipc.spec.ts`; mock runner/git/fs/linear/jira; `knowledge-search.spec.ts`.
- **M4 — Renderer**: `BoardView`, `CardTile`, `CardDetail` (+ Brief/Phases/Activity/Artifacts tabs), `CardBriefEditor`, `ActivityFeed`, `ArtifactsPanel`, `KnowledgeSearch`; rework `App.tsx`; extend `SettingsView`; add `@dnd-kit`. _Tests_: `.spec.tsx` per component (jsdom + `electronAPI` mock) covering key states.
- **M5 — Docs + ADRs**: update `README.md`, `docs/ARCHITECTURE.md`, `specs/001-extension-first-terminal/contracts/ipc-channels.md`; add two ADRs under `docs/adr/`.
- **M6 — Quality gate**: `npm run format && npm run lint && npx vitest run --coverage && npm run build:extensions`; then `/google-review`, address BLOCKERs.

## Complexity Tracking

No constitution violations. Table intentionally empty.
