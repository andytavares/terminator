# TAV-16 — A run that finished but did not ship reads "Between steps"

**Open decisions:** 1 (the control), 2 (the graph's `ship` node). Each has a recommended default below. Neither needs an answer from the asker.

## What actually happened

Reproduced from the order in the screenshots, `~/repos/orders/WO-0913-0bd`:

- `run-graph.json`: `build:lane-1`, `check`, `ship` are all `passed`.
- `order.json`: `status: "running"`, never `shipped`.
- `ledger.jsonl`, last two entries: `run.complete` ("0 verdicts"), then `run.failed` "Opening the pull request for terminator failed: " (empty stderr).
- `git ls-remote` shows `foundry/wo-0913-0bd` pushed; `gh pr list --head foundry/wo-0913-0bd --state all` returns nothing.

So the push succeeded and `gh pr create` exited non-zero with no stderr. The error went to the ledger only. `standingOf` (`extensions/foundry/src/order/standing.ts:260`) never reads the ledger for a running order. It finds 3/3 passed and nothing running, and falls through to `working` / turn `foundry` / "Between steps. Nothing is running right now." Both halves are false: it is the operator's move, and nothing will ever run again.

This has the same shape as ADR 046 (a refused intake turn is a state, not a ledger line), one phase later.

## Files

- `extensions/foundry/src/order/standing.ts`: add an input for the run's terminal failure and a standing for it, ranked with the other `turn: 'you'` kinds. Add the kind everywhere `StandingKind` is keyed (see the `Record` keyed by a union rule in `extensions/foundry/CLAUDE.md`).
- `extensions/foundry/src/ipc/run-channels.ts` (records `run.failed` at :412 and :569) and `src/ipc/forge-channels.ts:603`: supply the new source as `intakeRefusedFor` does. Read only `run.failed` / `ship.refused` entries newer than the latest `run.started`.
- `extensions/foundry/src/index.ts:1440-1495`: the tail. Both `ship.refused` and a thrown `shipOrder` must reach the standing.
- `extensions/foundry/src/line/integrate.ts:324-358`: `openDraft` discards stdout when stderr is empty. `gh` writes some failures to stdout. The reason must carry whichever is non-empty, and the exit code when both are empty.
- `extensions/foundry/src/components/Floor.tsx` (~561-730): show the reason and the control for the new kind.
- ADR in `docs/adr/`, README/ARCHITECTURE per Constitution VIII.

## Decision 1: what the operator can do

- **Recommended: "Try opening the pull request again."** Re-run only the tail (`shipOrder`) against the existing pushed branch. It is idempotent if the PR now exists: check `gh pr list --head` first.
- Alternative: link to the branch and tell them to open the PR themselves. Cheaper, but the order stays `running` for ever. That puts the same dead end on the order list.

## Decision 2: the `ship` node

It reads `passed` even though the pull request never opened. Recommended: mark it `failed` when the tail throws. Then the existing `failed` standing and `resume` with `retry: ['ship']` become the path, and no new kind is needed. That folds Decision 1 into existing machinery. Before you choose it, check that `retryNode` on `ship` re-enters the tail.

## Out of scope (seen in the screenshots, separate tickets)

- "To review" lists `foundry/wo-0913-0bd` twice (one row per session, `review-queue.ts` keys by `sessionId`).
- The activity feed repeats "is ready to review" once per agent turn (`supervision.ts:268`).
- Why `gh pr create` failed with no output. Not measured: it needs the stdout fix above, then a rerun.

## Acceptance criteria

- With the WO-0913-0bd fixture (all nodes passed, last ledger entry `run.failed`), the standing is `turn: 'you'` and its detail contains the failure reason. It is not "Between steps".
- A `ship.refused` after `run.complete` produces the same standing, carrying `whyNotShipped`'s text.
- A `run.failed` older than the latest `run.started` does not change the standing.
- `openDraft` with exit 1, empty stderr and non-empty stdout throws a message containing the stdout.
- The Floor shows exactly one reachable control for the state, and using it on the fixture either opens the PR or records a new, non-empty reason.
- An e2e opens that order and asserts the headline and control by role (not by class).

## Proof

`npm run format && npm run lint && npm run typecheck:extensions && npx vitest run --coverage`, plus the Foundry e2e for the Floor. Then one live run per memory "Run it for real once".

size: L
