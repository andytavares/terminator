# Phase 0 Research: SpecKit Pilot Quill-style Workflow Board

All Technical Context items resolved; no NEEDS CLARIFICATION remain. Decisions below
are grounded in the existing codebase and official documentation per Constitution I.

## D1 — Drag-and-drop library for the board

- **Decision**: Add `@dnd-kit/core` + `@dnd-kit/sortable` to `extensions/speckit-pilot/package.json` (pinned), used for the kanban columns and card movement.
- **Rationale**: Actively maintained, multi-maintainer, widely adopted, accessible (keyboard + pointer sensors), zero external runtime deps, works with React 18. Satisfies Constitution IV (dependency stewardship) and XII (icons unaffected). Hand-rolling HTML5 DnD would be more code and less accessible (violates minimalism + a11y).
- **Alternatives considered**: `react-beautiful-dnd` (effectively unmaintained/archived — rejected); native HTML5 DnD (poor a11y, fiddly cross-browser — rejected); no-DnD click-to-move (worse UX, still need move affordance — rejected as primary but retained as keyboard fallback via dnd-kit sensors).
- **Isolation**: Declared in the extension manifest only; npm workspaces hoist it; Vite resolves it. Deletion test unaffected.

## D2 — Card identity: unify feature dir + ticket + run

- **Decision**: A card **is** a feature dir (`specs/NNN-slug/`). Extend `PilotState` to v3 with a `card: CardBrief` and a persisted `stage`. Native cards are created as a feature dir with a `card.json` brief and `state.json` at `stage: 'backlog'` with no `run`/`worktreePath`.
- **Rationale**: The feature dir already carries `.pilot/state.json`, history, and artifacts — it is the natural card record. Reusing it avoids a parallel store (minimalism) and keeps all card data co-located and git-visible. Recorded as ADR-A.
- **Alternatives considered**: A separate board database/JSON index (adds a second source of truth, sync burden — rejected); keeping tickets/runs as distinct entities (the linear UX we are replacing — rejected).

## D3 — Stage derivation vs. stored stage

- **Decision**: `stage` for active cards is **derived** from phase progress via a pure `deriveStage(phases, run)`; Backlog is the only stage stored authoritatively (a card with no run). Mapping: Backlog = no run; Spec = constitution/specify/clarify; Plan = plan/checklist; Implement = tasks/analyze/implement; In Review = self-review/open-pr; Done = PR opened or run completed. The active/awaiting phase determines the stage; a failed/stopped run keeps the card in its last active column with a failed status chip.
- **Rationale**: Deriving keeps the board consistent with the authoritative phase machine automatically (SC-004) and prevents drift. Storing `stage` too lets Backlog exist before any run and lets the UI render instantly without recomputing. Purity satisfies Constitution XI and is trivially testable.
- **Alternatives considered**: Fully stored stage updated by handlers (drift risk, more mutation — rejected); fully derived with no stored stage (cannot represent Backlog/parked pre-run — rejected).

## D4 — Manual moves and guard rails

- **Decision**: Allow drag only between **adjacent** stages where meaningful: Backlog→(next) triggers dispatch; any active→Backlog parks/cancels the run **after explicit confirmation**. Non-adjacent drags and forward skips are disabled; the in-card phase rail remains the authoritative controller (FR-005).
- **Rationale**: Prevents skipping phases/gates (safety, FR-023) while keeping the familiar kanban affordance for the two moves that have real meaning (start, park). Matches the spec's edge-case handling.
- **Alternatives considered**: Free-form drag across any column (would bypass gates — rejected); no drag at all (loses the requested kanban feel — rejected).

## D5 — Concurrency model

- **Decision**: Replace the single-active-run queue with a `Map<featureDir, RunnerHandle>` of live runners and a `maxConcurrentRuns` setting (default 3). Dispatches beyond the cap set `queuePosition: 'pending'`; on any terminal run state a pending card auto-starts, oldest-queued first. Each run keeps its own git worktree (already true today).
- **Rationale**: Directly delivers the "offload many" value (US4/FR-012/FR-013). The runner already returns per-run handles and each run already has its own worktree, so this is bookkeeping, not a runner rewrite (minimalism). Recorded as ADR-B.
- **Alternatives considered**: Unlimited concurrency (resource exhaustion, thrash — rejected); keep single-active (fails the core user need — rejected).

## D6 — Comment steering

- **Decision**: `comments.jsonl` append-only log per card (mirrors `history.jsonl`). A user comment is recorded and injected into the **next** phase run as a feedback note, reusing the agent-runner's existing feedback-note prompt path (the same mechanism `speckit:phase-request-changes` already uses).
- **Rationale**: Reuses a proven mechanism (minimalism), keeps comment→agent influence deterministic and auditable, and keeps the activity feed a simple merge of `comments.jsonl` + `history.jsonl` (FR-017/FR-018).
- **Alternatives considered**: Live-injecting into a running subprocess (fragile, non-deterministic — rejected); comments as inert notes with no agent effect (fails FR-017 — rejected).

## D7 — Artifacts view + revisions

- **Decision**: `artifact-list` enumerates a card's known artifacts (spec.md, plan.md, tasks.md, checklists, self-review.json, code diff, PR reference) with per-file git revision history (`git log --oneline -- <path>` in the worktree). The viewer reuses `speckit:artifact-read` and the `diff`-based rendering already in `GatePanel`.
- **Rationale**: Reuses existing read + diff machinery (minimalism); git already stores revisions, so no new versioning store is needed (FR-019).
- **Alternatives considered**: A bespoke revision store (duplicates git — rejected).

## D8 — Workspace knowledge search (keyword, v1)

- **Decision**: `knowledge-search` performs keyword search over repository markdown (`*.md`, `docs/`, `specs/`) plus card briefs/specs, via `rg` through `api.shell.exec` when available, falling back to a Node `fs` recursive scan. Returns `{ file, line, snippet }[]` with an explicit empty state. Results are attachable to a card brief and appended as context on dispatch/feedback (FR-020/FR-021).
- **Rationale**: Keyword search satisfies the scoped v1 requirement with minimal surface; `rg` is fast and commonly present, and the fs fallback guarantees it works without it. Vector/semantic search, URL ingestion, and tracker/PR indexing are explicitly out of scope (YAGNI, Constitution VII).
- **Alternatives considered**: Embeddings/vector index (large lift, out of scope — deferred); indexing external URLs and GitHub (out of scope — deferred).

## D9 — Testing approach

- **Decision**: Pure logic (`deriveStage`, concurrency queue math, search matching) unit-tested directly; IPC handlers tested by extending `index-ipc.spec.ts` with mocked runner/git/fs/tracker; renderer components tested with jsdom + the existing `electronAPI` mock pattern. Extension IPC tests import `../../src/index.ts` (TypeScript), not the built bundle.
- **Rationale**: Matches the extension's established test patterns and the constitution's per-file ≥80% coverage gate.

## Post-design constitution re-check

No new violations introduced by these decisions. PASS.
