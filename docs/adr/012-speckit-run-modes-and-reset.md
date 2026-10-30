# ADR-012: SpecKit Pilot run modes, worktree branch naming, and reset

**Status:** Accepted
**Date:** 2026-07-03

## Context

The 10-phase SpecKit pipeline (ADR-010) is overkill for small fixes. Cards need a
predictable branch name. A run that went wrong had no clean way to start over.
Three related decisions came out of this.

## Decisions

### 1. Run modes: `speckit` vs `quick`

`PilotState` gains `mode: 'speckit' | 'quick'` (defaults to `speckit`; migrated
states default to `speckit`). The user flags a card at hand-off/dispatch with a
**Quick fix** toggle. Quick mode runs only `QUICK_PHASES = [plan, implement,
self-review, open-pr]`. `primePhasesForRun` marks every other phase `skipped`.
Quick mode has no upstream `spec.md`/`tasks.md`, so it overrides the `plan`
and `implement` prompts to work from `ticket.md`/`plan.md` (`QUICK_PHASE_COMMANDS`).
The review bar is unchanged: quick runs still go through the full self-review gate
(`format + lint + coverage + /google-review`).

### 2. Worktree branch naming

`resolveBranchName` picks, in order: the tracker's suggested VCS branch
(`ticket.branchName`, provided per Linear issue); otherwise
`<git-username>/<ticket-key>-<kebab-title>`; otherwise `feature/<slug>` for native
cards with no ticket. `createWorktree` reuses an existing branch (attach without
`-b`) and does not fail, so recreating a removed worktree is safe. All work
happens in the card's worktree. Phase runners always resolve their cwd through
`ensureWorktreePath`. It creates a worktree if one is missing and does not
fall back to the main checkout.

### 3. Reset / start over

`speckit:card-reset` stops the runner, removes the worktree + deletes its branch
(and the mirrored workspace project), and wipes `.pilot/logs`, `history.jsonl`,
`self-review.json`, and `comments.jsonl`. It then rebuilds a fresh initial state.
It preserves the card brief, ticket, and `mode`, so the card can be re-dispatched
cleanly.

## Consequences

- Old `state.json` without `mode` reads as `speckit` (safe default).
- Reset destroys the worktree, branch, and history but never the card brief
  or ticket. An in-UI confirm gates it.
- Quick mode's `plan`/`implement` prompts intentionally diverge from the SpecKit
  prompts. Keep them in sync with `PHASE_COMMANDS` when phase semantics change.
