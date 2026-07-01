---
description: 'Task list for SpecKit Pilot Quill-style Workflow Board'
---

# Tasks: SpecKit Pilot Quill-style Workflow Board

**Input**: Design documents from `specs/016-speckit-pilot-board/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ipc-channels.md, contracts/ui-views.md, quickstart.md

**Tests**: MANDATORY. The project constitution (Principle VI) requires TDD — a failing test before each production file, ≥80% per-file coverage. Every production task below is preceded by its test task.

**Isolation**: ALL paths are under `extensions/speckit-pilot/`. No core app files (`src/main/preload.ts`, `src/renderer/electron.d.ts`, root `package.json`) may change. New deps go in the extension `package.json` only.

**Reuse anchors** (do NOT reimplement): `runner/agent-runner.ts`, `components/RunDashboard.tsx`, `PhaseRail.tsx`, `RunConsole.tsx`, `GatePanel.tsx`, `BatchCheckIn.tsx`, `SelfReviewGate.tsx`, `OpenPrGate.tsx`, `api/linear.ts`, `api/jira.ts`, `api/credentials.ts`, `speckit:dispatch`, `speckit:run-cancel`, `speckit:artifact-read`, the `diff` dep, existing Zod schemas in `schemas/speckit.schemas.ts`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1–US6 (maps to spec.md user stories)

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Add `@dnd-kit/core` and `@dnd-kit/sortable` (pinned versions) to `extensions/speckit-pilot/package.json` dependencies; run `npm install` from repo root; verify hoist and that root `package.json` is unchanged.
- [x] T002 [P] Add a PR-justification note for `@dnd-kit` (community health + official docs link) to the feature's `research.md` D1 section (already drafted — confirm and finalize).

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. Implements plan milestone **M1** (types + stage derivation + persistence).

- [x] T003 [P] Write failing tests for `deriveStage` covering every phase/run combination (backlog/no-run, spec/plan/implement/in-review phases, all-approved-awaiting-open-pr, done, failed/stopped) in `extensions/speckit-pilot/tests/derive-stage.spec.ts`.
- [x] T004 [P] Write failing tests for the v2→v3 migration and `CardBrief` synthesis (title from ticket/slug, defaults, `maxConcurrentRuns` default) in `extensions/speckit-pilot/tests/state-persistence.spec.ts` (extend existing suite).
- [x] T005 Extend types in `extensions/speckit-pilot/src/types/speckit.types.ts`: add `BoardStage`, `STAGE_ORDER`, `CardType`, `CardSource`, `ChecklistItem`, `KnowledgeRef`, `CardBrief`, `CardComment`, `ArtifactRevision`, `ArtifactRef`; bump `PilotState` to `version: 3` with `card` + `stage`; add `maxConcurrentRuns` to `PilotSettings` and `DEFAULT_SETTINGS` (default 3).
- [x] T006 Implement pure `deriveStage(phases, run)` in `extensions/speckit-pilot/src/state/derive-stage.ts` per data-model rules (make T003 pass).
- [x] T007 Extend `extensions/speckit-pilot/src/state/state-persistence.ts`: v2→v3 migration on read; `card.json` read/write helpers; `comments.jsonl` append/read helpers; initialize v3 fields in `createInitialState` (make T004 pass).
- [x] T008 [P] Add/extend Zod schemas in `extensions/speckit-pilot/src/schemas/speckit.schemas.ts` for `CardBrief`, `CardComment`, and new IPC request payloads; write failing schema tests in `extensions/speckit-pilot/tests/speckit.schemas.spec.ts`, then make them pass.

**Checkpoint**: Types, stage derivation, and persistence are ready.

---

## Phase 3: User Story 1 — See and manage all work on one board (Priority: P1) 🎯 MVP

**Goal**: The board is the home surface; every card appears in its derived column and updates live.

**Independent Test**: With several feature dirs in different stages, open the panel and confirm each is a card in the correct column, updating as phases advance.

- [x] T009 [P] [US1] Write failing test for the `speckit:card-list` handler (returns `CardSummary[]` with derived stage + phase summary; error contract) in `extensions/speckit-pilot/tests/index-ipc.spec.ts` (extend).
- [x] T010 [US1] Implement `speckit:card-list` in `extensions/speckit-pilot/src/index.ts` (scan feature dirs, load state, compute `deriveStage`, build `CardSummary`).
- [x] T011 [P] [US1] Write failing test for `CardTile` render states (type badge, title, scope line, compact PhaseRail, run-status chip) in `extensions/speckit-pilot/tests/CardTile.spec.tsx`.
- [x] T012 [US1] Implement `CardTile.tsx` in `extensions/speckit-pilot/src/renderer/components/` (reuse `PhaseRail` in a compact mode).
- [x] T013 [P] [US1] Write failing test for `BoardView` (buckets cards into six `STAGE_ORDER` columns; empty states; opens `CardDetail` on click) in `extensions/speckit-pilot/tests/BoardView.spec.tsx`.
- [x] T014 [US1] Implement `BoardView.tsx` with six columns + `@dnd-kit` context (drag scaffolding; move behavior wired in US2) in `extensions/speckit-pilot/src/renderer/components/`.
- [x] T015 [US1] Rework `App.tsx` so `BoardView` is the home surface; header holds New card / Import ticket / search / Settings placeholders; subscribe to `speckit:state-changed` to re-bucket the affected card live (SC-004).
- [x] T016 [P] [US1] Add board + card-tile styles (columns, tiles, status chips) to `extensions/speckit-pilot/src/renderer/components/speckit-pilot.css` using `--tm-*` tokens only.

**Checkpoint**: MVP — the board renders all work at a glance and updates live.

---

## Phase 4: User Story 2 — Create a card and offload it to an agent (Priority: P1)

**Goal**: Author a card natively (Backlog) and hand it off; dispatch starts a run in an isolated worktree.

**Independent Test**: Create a card with a brief, confirm it lands in Backlog, hand it off, confirm a worktree + run start and the card leaves Backlog.

- [x] T017 [P] [US2] Write failing tests for `speckit:card-create` (validates non-empty title → `VALIDATION_ERROR`; writes `card.json` + v3 state at `stage:'backlog'`, no run) and `speckit:card-update` in `extensions/speckit-pilot/tests/index-ipc.spec.ts` (extend).
- [x] T018 [US2] Implement `speckit:card-create` and `speckit:card-update` in `extensions/speckit-pilot/src/index.ts`.
- [x] T019 [P] [US2] Write failing test for `speckit:card-move` (backlog→next triggers dispatch; non-adjacent rejected; active→backlog cancels via `run-cancel`) in `extensions/speckit-pilot/tests/index-ipc.spec.ts` (extend; mock dispatch/run-cancel).
- [x] T020 [US2] Implement `speckit:card-move` in `extensions/speckit-pilot/src/index.ts`, reusing the existing `speckit:dispatch` path for handoff and `speckit:run-cancel` for park.
- [x] T021 [P] [US2] Write failing test for `CardBriefEditor` (title-required gate, type segmented control, checklist add/toggle/remove, attachments) in `extensions/speckit-pilot/tests/CardBriefEditor.spec.tsx`.
- [x] T022 [US2] Implement `CardBriefEditor.tsx` in `extensions/speckit-pilot/src/renderer/components/` (used for create via `card-create` and edit via `card-update`).
- [x] T023 [P] [US2] Write failing test for `CardDetail` shell + tab routing, with the **Phases** tab rendering `RunDashboard` for a running card and a "Hand off to agent" CTA for a Backlog card, in `extensions/speckit-pilot/tests/CardDetail.spec.tsx`.
- [x] T024 [US2] Implement `CardDetail.tsx` (drawer + Brief/Phases/Activity/Artifacts tab shell; Phases reuses `RunDashboard` unchanged) in `extensions/speckit-pilot/src/renderer/components/`.
- [x] T025 [US2] Wire `BoardView` drag + New-card action to `card-create`/`card-move` with handoff confirmation and backward-move confirmation; surface failures via toast.

**Checkpoint**: Cards can be authored and offloaded entirely from the board.

---

## Phase 5: User Story 5 — Control and review a card end-to-end (Priority: P1)

**Goal**: The card detail view provides steering (comments), gate actions, activity, and artifacts with revisions.

**Independent Test**: Open a running card, post a steering comment, act on a gate, and view an artifact with revision history.

- [x] T026 [P] [US5] Write failing tests for `speckit:card-comment` and `speckit:comment-list` (append to `comments.jsonl`; comment queued to feed next phase run) in `extensions/speckit-pilot/tests/index-ipc.spec.ts` (extend).
- [x] T027 [US5] Implement `speckit:card-comment` + `speckit:comment-list` in `extensions/speckit-pilot/src/index.ts`; on the next phase run, inject the pending comment as a feedback note via the existing agent-runner feedback-note path.
- [x] T028 [P] [US5] Write failing test for `speckit:artifact-list` (enumerates spec/plan/tasks/checklist/self-review/diff/pr with git revisions; missing artifacts flagged `exists:false`) in `extensions/speckit-pilot/tests/index-ipc.spec.ts` (extend; mock git log).
- [x] T029 [US5] Implement `speckit:artifact-list` in `extensions/speckit-pilot/src/index.ts` (git log per file via `api.shell.exec`).
- [x] T030 [P] [US5] Write failing test for `ActivityFeed` (merges comments + history chronologically; composer posts via `card-comment`) in `extensions/speckit-pilot/tests/ActivityFeed.spec.tsx`.
- [x] T031 [US5] Implement `ActivityFeed.tsx` (uses `comment-list` + `history-load`) in `extensions/speckit-pilot/src/renderer/components/`.
- [x] T032 [P] [US5] Write failing test for `ArtifactsPanel` (lists artifacts; renders markdown via `marked` and diff via `GatePanel`'s diff rendering; revision dropdown) in `extensions/speckit-pilot/tests/ArtifactsPanel.spec.tsx`.
- [x] T033 [US5] Implement `ArtifactsPanel.tsx` reusing `speckit:artifact-read` + the `diff` dep in `extensions/speckit-pilot/src/renderer/components/`.
- [x] T034 [US5] Wire the Activity and Artifacts tabs into `CardDetail`; add card-detail styles to `speckit-pilot.css` (`--tm-*` tokens).

**Checkpoint**: Full control-and-review loop lives in the card detail view.

---

## Phase 6: User Story 4 — Run several cards in parallel (Priority: P2)

**Goal**: Multiple cards run concurrently up to `maxConcurrentRuns`; excess waits and auto-starts. Implements plan milestone **M2**.

**Independent Test**: Hand off more cards than the cap; confirm concurrent runs up to the cap, waiting excess, and auto-start on slot free.

- [x] T035 [P] [US4] Write failing tests for concurrency in `extensions/speckit-pilot/tests/index-ipc.spec.ts` (extend): under-cap dispatch starts immediately; over-cap sets `queuePosition:'pending'`; terminal run auto-advances oldest pending; each run keeps its own worktree.
- [x] T036 [US4] Replace the single-active-run tracking in `extensions/speckit-pilot/src/index.ts` with a `Map<featureDir, RunnerHandle>` and enforce `maxConcurrentRuns`; update `speckit:dispatch` and the `speckit:run-cancel` queue-advance to respect the cap.
- [x] T037 [P] [US4] Write failing test for the `maxConcurrentRuns` control (min 1, default 3) in `extensions/speckit-pilot/tests/SettingsView.spec.tsx` (extend).
- [x] T038 [US4] Add the `maxConcurrentRuns` control to `SettingsView.tsx`.
- [x] T039 [US4] Ensure `BoardView`/`CardTile` render a `waiting` (pending) run-status chip distinctly from `running`.

**Checkpoint**: Parallel offload works end-to-end with a configurable cap.

---

## Phase 7: User Story 3 — Import work from an issue tracker as a card (Priority: P2)

**Goal**: Import an assigned Linear/Jira issue as a Backlog card, pre-filled and origin-marked.

**Independent Test**: With a tracker connected, import an assigned issue → a card appears in Backlog seeded from it; handing it off behaves like a native card.

- [x] T040 [P] [US3] Write failing test that `speckit:card-create` accepts a ticket-seeded brief (source `linear`/`jira`, `TicketRef` linkage) producing a Backlog card in `extensions/speckit-pilot/tests/index-ipc.spec.ts` (extend).
- [x] T041 [US3] Extend `speckit:card-create` (or add a thin `speckit:card-import` wrapper) to seed a card from a `Ticket` using existing `api/linear.ts` / `api/jira.ts` results in `extensions/speckit-pilot/src/index.ts`.
- [x] T042 [P] [US3] Write failing test for the Import modal (reuses `TicketsView` + `DispatchSheet`; selecting a ticket creates a Backlog card) in `extensions/speckit-pilot/tests/ImportTicketModal.spec.tsx`.
- [x] T043 [US3] Implement the Import-ticket header action + modal in `App.tsx`/a small `ImportTicketModal.tsx`, reusing `TicketsView` and `DispatchSheet`.

**Checkpoint**: Tracker issues flow onto the board as cards.

---

## Phase 8: User Story 6 — Search workspace knowledge (Priority: P3)

**Goal**: Keyword search across repo markdown + card briefs; attach a result to a card brief as agent context.

**Independent Test**: Search a known term → `file:line` results with snippets; attach one to a card brief.

- [x] T044 [P] [US6] Write failing tests for `knowledge-search` matching + empty-state (rg path and fs fallback) in `extensions/speckit-pilot/tests/knowledge-search.spec.ts`.
- [x] T045 [US6] Implement `extensions/speckit-pilot/src/utils/knowledge-search.ts` (rg via `api.shell.exec`, fs fallback; markdown + briefs/specs scope; returns `KnowledgeRef[]`).
- [x] T046 [P] [US6] Write failing test for the `speckit:knowledge-search` handler in `extensions/speckit-pilot/tests/index-ipc.spec.ts` (extend).
- [x] T047 [US6] Implement `speckit:knowledge-search` in `extensions/speckit-pilot/src/index.ts`.
- [x] T048 [P] [US6] Write failing test for `KnowledgeSearch` (input → results with `file:line` + snippet; explicit no-results; "Attach to card" adds a `KnowledgeRef`) in `extensions/speckit-pilot/tests/KnowledgeSearch.spec.tsx`.
- [x] T049 [US6] Implement `KnowledgeSearch.tsx` and wire it into the board header + attach-to-brief flow (updates `CardBrief.knowledgeRefs` via `card-update`).

**Checkpoint**: Knowledge search feeds card context.

---

## Phase 9: Polish & Cross-Cutting Concerns

Implements plan milestones **M5** (docs + ADRs) and **M6** (quality gate).

- [x] T050 [P] Update `README.md` SpecKit Pilot feature description to the board-based workflow.
- [x] T051 [P] Update `docs/ARCHITECTURE.md` (card model, board/stage derivation, parallel runs, knowledge search).
- [x] T052 [P] Update `specs/001-extension-first-terminal/contracts/ipc-channels.md` with the new `speckit:*` channels.
- [x] T053 [P] Add ADR-A (card model unifying feature/ticket/run) and ADR-B (parallel runs via concurrency cap) under `docs/adr/`.
- [x] T054 Remove retired top-level tabs/components absorbed into the board (`FeaturesView`, `ActiveRunsView`, `HistoryView` as top-level tabs) and any now-dead exports/imports; `grep` to confirm no references remain.
- [x] T055 Run `npm run build:extensions` (0 TS errors), `npm run format`, `npm run lint` (0 errors), `npx vitest run --coverage` (all thresholds ≥80%, every new file ≥80%).
- [ ] T056 Execute `specs/016-speckit-pilot-board/quickstart.md` manual scenarios 1–9 + isolation check; then run `/google-review` and address BLOCKERs.

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → **Phase 2 (Foundational, M1)** blocks everything.
- **Phase 3 (US1)** is the MVP and precedes UI-dependent stories (its `BoardView`/`CardDetail`/`CardTile` are extended by US2/US5).
- **Phase 4 (US2)** depends on US1 (board + card-list + CardDetail shell).
- **Phase 5 (US5)** depends on US2 (CardDetail shell).
- **Phase 6 (US4)** depends only on Foundational + existing dispatch; can proceed in parallel with US5 (touches `index.ts` concurrency — coordinate merge with US2/US3/US5 index.ts edits).
- **Phase 7 (US3)** depends on US2 (`card-create`).
- **Phase 8 (US6)** depends on Foundational + US2 (`card-update` for attach); largely independent otherwise.
- **Phase 9 (Polish)** depends on all desired stories.

### Within each story

- Test task (failing) before its production task (constitution VI).
- IPC handler before the component that calls it.

### Parallel opportunities

- `[P]` test tasks across different files run together.
- US4 (concurrency) and US6 (search) are mostly independent of US3/US5 UI work, but note all IPC handlers share `index.ts` — sequence `index.ts` edits or merge carefully to avoid conflicts.

---

## Implementation Strategy

- **MVP** = Phases 1–3 (Setup + Foundational + US1): a live board of all work. Stop and validate.
- **Core loop** = add US2 then US5 (author/offload, then control/review).
- **Scale & inflow** = add US4 (parallel) and US3 (import).
- **Enhancement** = add US6 (knowledge search).
- **Ship** = Phase 9 docs + quality gate + `/google-review`.

---

## Notes

- Every new production file must reach ≥80% coverage at merge (Constitution VI); a file at 0% is a defect.
- Extension IPC tests import `../../src/index.ts` (TypeScript), never the built `.js` bundle.
- Never edit `extensions/speckit-pilot/src/index.js` (build artifact); always `npm run build:extensions` after TS changes.
- Icons: `lucide-react` only, flat, `currentColor`, size via CSS (Constitution XII).
