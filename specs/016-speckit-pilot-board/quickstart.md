# Quickstart & Validation: SpecKit Pilot Quill-style Workflow Board

Runnable validation that the board feature works end-to-end. Details live in
[data-model.md](./data-model.md) and [contracts/](./contracts/).

## Prerequisites

- Repo checked out on branch `016-speckit-pilot-board`.
- Node deps installed: `npm install` (hoists the new `@dnd-kit/*` extension deps).
- Build extensions: `npm run build:extensions`.

## Automated checks (run before manual validation)

```bash
# From repo root
npm run format
npm run lint                         # 0 errors
npx vitest run --coverage            # all thresholds ≥ 80%, all suites green
npm run build:extensions             # 0 TypeScript errors
```

Unit-level expectations:

- `deriveStage` returns the correct `BoardStage` for every phase/run combination (incl. backlog, done, failed).
- v2→v3 migration round-trips and synthesizes a valid `CardBrief`.
- Concurrency: with `maxConcurrentRuns=2`, a 3rd dispatch is `pending` and auto-starts when a slot frees.
- `knowledge-search` returns `file:line` matches and an empty array for no matches.

## Manual end-to-end (launch the app)

Launch via the project's run flow (`/run`) and open the SpecKit Pilot panel.

1. **Board is home (US1 / SC-001)**: The panel opens to a six-column board (Backlog → Spec → Plan → Implement → In Review → Done). Existing feature dirs appear as cards in their derived columns.
2. **Native card + handoff (US2 / SC-002)**: Click **New card**, author a brief (title required, pick a type, write scope, add a checklist item), save → card appears in **Backlog**. Hand it off (drag to Spec or use "Hand off to agent") → confirm a worktree is created and a run starts; the card leaves Backlog.
3. **Parallel runs (US4 / SC-003)**: With `maxConcurrentRuns=3`, hand off two more cards while the first runs → all show running, each in its own worktree. Hand off a 4th → it shows **waiting**; stop/finish one → the 4th auto-starts.
4. **Live stage updates (SC-004)**: Let a running card advance a phase (or approve its gate) → its card moves to the next column within a few seconds without refreshing.
5. **Card control loop (US5 / SC-005)**: Open a running card → **Phases** tab drives the run with gates (approve / request changes). **Activity** tab shows comments + audit; post a comment → confirm it is recorded and is applied as a feedback note on the next phase run. **Artifacts** tab lists spec/plan/tasks/diff/self-review with a revision dropdown; open one and read it.
6. **Ticket import (US3)**: Header **Import ticket** → pick a Linear/Jira assigned issue → a card appears in Backlog pre-filled from the issue (with its origin marked). Hand it off and confirm it behaves like a native card.
7. **Knowledge search (US6 / SC-006)**: Use the header search box with a known term → results show `file:line` + snippet; attach one to a card brief and confirm it appears in the brief's attached context.
8. **Safety (SC-007)**: Confirm the final **In Review** phases (self-review, open-pr) still require explicit approval and are never auto-approved, regardless of autonomy level.
9. **Backward move guard**: Drag an active card to Backlog → a confirmation appears before the run is parked/cancelled; non-adjacent drags are rejected with a toast.

## Isolation check (Constitution II)

```bash
# The extension must be self-contained: new deps only in the extension manifest
grep -q "@dnd-kit" extensions/speckit-pilot/package.json && echo "dnd-kit in extension pkg: OK"
! grep -q "@dnd-kit" package.json && echo "dnd-kit NOT in root pkg: OK"
```

Confirm no changes to `src/main/preload.ts`, `src/renderer/electron.d.ts`, or root
`package.json`.

## Done criteria

- All automated checks pass; manual scenarios 1–9 succeed; isolation check passes.
