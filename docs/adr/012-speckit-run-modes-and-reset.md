# ADR-012: SpecKit Pilot run modes, worktree branch naming, and reset

**Status:** Accepted
**Date:** 2026-07-03

## Context

The 10-phase SpecKit pipeline (ADR-010) is overkill for small fixes, cards need a
predictable branch name, and a run that goes wrong had no clean way to start over.
Three related decisions came out of this.

## Decisions

### 1. Run modes: `speckit` vs `quick`

`PilotState` gains `mode: 'speckit' | 'quick'` (defaults to `speckit`; migrated
states default to `speckit`). A card is flagged at hand-off/dispatch via a
**Quick fix** toggle. Quick mode runs only `QUICK_PHASES = [plan, implement,
self-review, open-pr]`; `primePhasesForRun` marks every other phase `skipped`.
Because there is no upstream `spec.md`/`tasks.md`, quick mode overrides the `plan`
and `implement` prompts to work from `ticket.md`/`plan.md` (`QUICK_PHASE_COMMANDS`).
The review bar is unchanged — quick runs still go through the full self-review gate
(`format + lint + coverage + /google-review`).

### 2. Worktree branch naming

`resolveBranchName` picks, in order: the tracker's suggested VCS branch
(`ticket.branchName`, provided per Linear issue); otherwise
`<git-username>/<ticket-key>-<kebab-title>`; otherwise `feature/<slug>` for native
cards with no ticket. `createWorktree` reuses an existing branch (attach without
`-b`) instead of failing, so recreating a removed worktree is safe. All work
happens in the card's worktree — phase runners always resolve their cwd through
`ensureWorktreePath`, which creates a worktree if one is missing rather than
falling back to the main checkout.

### 3. Reset / start over

`speckit:card-reset` stops the runner, removes the worktree + deletes its branch
(and the mirrored workspace project), wipes `.pilot/logs`, `history.jsonl`,
`self-review.json`, and `comments.jsonl`, then rebuilds a fresh initial state.
The card brief, ticket, and `mode` are preserved so the card can be re-dispatched
cleanly.

## Consequences

- Old `state.json` without `mode` reads as `speckit` (safe default).
- Reset is destructive to the worktree/branch/history but never to the card brief
  or ticket; it is gated behind an in-UI confirm.
- Quick mode's `plan`/`implement` prompts intentionally diverge from the SpecKit
  prompts; keep them in sync with `PHASE_COMMANDS` when phase semantics change.
