# Quickstart & Validation Guide: SpecKit Pilot Revamp

**Date**: 2026-06-27
**Spec**: [spec.md](./spec.md) | **Data model**: [data-model.md](./data-model.md) | **Contracts**: [contracts/](./contracts/)

This guide covers how to validate each major scenario from the spec. It is not implementation code — it describes what to set up, what to run, and what observable outcome confirms the feature works.

---

## Prerequisites

1. `npm install` at repo root — installs all workspace deps including extension.
2. `npm run build:extensions` — compiles all extension TypeScript and renderer bundles.
3. `npm start` or `npm run dev` — launches Terminator in dev mode.
4. A repo with `.specify/` initialized (run `/speckit-specify` once to confirm).
5. Linear or Jira API credentials configured in SpecKit Pilot settings (for tracker scenarios).
6. `gh` CLI authenticated (`gh auth status` succeeds).
7. `claude` CLI available on PATH (`claude --version` succeeds).

---

## Scenario 1 — Ticket inbox loads

**Setup**: Linear API key configured in settings.

**Steps**:

1. Open any repo workspace in Terminator.
2. Click the SpecKit project tab.
3. Select "Tickets" in the sub-navigation.

**Expected**:

- Ticket list renders with LINEAR/JIRA source badges, keys, titles, and tags.
- Filter pills (Assigned to me / Linear / Jira / Not yet dispatched) are clickable and filter the list.
- Previously dispatched tickets show a run-status badge instead of the dispatch action.

**Edge case — no credentials**:

- Tickets sub-view shows an "Integration not configured" empty state with a link to Settings.

---

## Scenario 2 — Dispatch a ticket

**Setup**: A Linear ticket assigned to the test user. `.specify/` initialized in the repo.

**Steps**:

1. Select an undispatched ticket in the inbox.
2. In the dispatch sheet, choose autonomy level "Standard" and click "Start run".

**Expected**:

- `specs/NNN-<slug>/` directory created with `ticket.md` seed.
- `.pilot/state.json` created with `ticket`, `run.status: 'running'`, `queuePosition: 'active'`.
- A git worktree appears at `.wt/<slug>`.
- Active runs count in sidebar increments to 1.
- Run dashboard opens showing the 10-phase rail with Constitution phase active (blue).
- Console begins streaming `claude --headless` output.

---

## Scenario 3 — Phase gate: Approve

**Setup**: Constitution phase complete; Specify phase in `awaiting_review`.

**Steps**:

1. Open the active run.
2. Observe the gate panel showing `spec.md` artifact preview.
3. Click "Approve → Clarify".

**Expected**:

- Phase rail updates: Specify node turns green (done), Clarify becomes active (blue).
- `history.jsonl` gains an `approved` entry for Specify.
- Console shows runner launching Clarify phase.

---

## Scenario 4 — Request changes

**Setup**: A phase in `awaiting_review`.

**Steps**:

1. Type a note in the feedback textarea.
2. Click "Reject & re-run".

**Expected**:

- Phase status returns to `running`.
- Console shows runner re-launching with the note injected.
- After completion, phase returns to `awaiting_review` with updated artifact.
- `history.jsonl` gains `request_changes` entry with the note text.

---

## Scenario 5 — Run queue (one active run at a time)

**Setup**: One run already active.

**Steps**:

1. Select a second ticket and click "Start run".

**Expected**:

- `dispatch` returns `{ queued: true }`.
- Active runs sub-view shows two entries: one "running", one "pending".
- No second worktree is created yet.
- When the first run reaches a terminal state, the second run starts automatically and Active runs updates.

---

## Scenario 6 — Batch check-in during Implement

**Setup**: A ticket whose `tasks.md` has ≥ 2 top-level sections. Implement phase running.

**Steps**:

1. Let Implement run through the first section's tasks.

**Expected**:

- After the first section completes, Implement pauses and shows the check-in banner.
- Kanban board shows first section's tasks in Done; second section in Todo.
- "Partial diff" button shows a diff of changes so far.
- "Continue to Batch 2" resumes runner for the next section.
- "Pause" halts the run; "Split" splits remaining batches to a follow-up ticket entry.

---

## Scenario 7 — Self-Review gate

**Setup**: Implement phase approved.

**Steps**:

1. Approve Implement.
2. Wait for Self-Review phase to run.

**Expected**:

- Phase rail shows Self-Review as active, then awaiting_review.
- Gate panel shows 5 quality rows: Format / Lint / Tests / Coverage / /google-review.
- Each row shows actual metric values (e.g. "88% · gate ≥80% ✓").
- "Approve → Open PR" button is active only when developer explicitly clicks it; there is no auto-approval path.

---

## Scenario 8 — Open PR

**Setup**: Self-Review gate approved.

**Steps**:

1. Approve Self-Review.
2. Review PR preview panel; click "Approve".

**Expected**:

- `gh pr create` runs in the worktree.
- PR URL is displayed in the Open PR card.
- `PilotState.prUrl` is set.
- If Linear/Jira is configured, a comment with the PR URL is posted to the originating ticket.
- Ticket status changes to "In Review" in the tracker (if `writeStatusBackOnPrOpen: true`).
- "Open in Code Reviews" button routes to the existing Code Reviews tab with the PR loaded.
- The worktree at `.wt/<slug>` is cleaned up.

---

## Scenario 9 — App restart mid-run

**Setup**: An active run in any non-terminal phase.

**Steps**:

1. Close Terminator while a run is active.
2. Reopen Terminator.

**Expected**:

- SpecKit tab opens with the run restored to its last known state (from `state.json`).
- Phase rail shows the correct phase status.
- The console is empty (new session) but the phase status is accurate.
- The developer can resume from the gate (approve/reject) or cancel the run.

---

## Scenario 10 — Old UI fully removed

**Steps**:

1. Build the extension: `npm run build:extensions`.
2. Open SpecKit tab in any workspace.

**Expected**:

- The old `SpecKitPilotView` left-panel / right-panel layout is absent.
- The new sub-navigation (Tickets / Features / Active runs / History) is present.
- No old component is reachable by clicking any UI element.
- No TypeScript errors from removed components.

---

## Test coverage gate

Before any PR, run:

```bash
npx vitest run --coverage
```

All thresholds must be ≥ 80%. New files in `extensions/speckit-pilot/src/` without companion specs are a hard blocker.
