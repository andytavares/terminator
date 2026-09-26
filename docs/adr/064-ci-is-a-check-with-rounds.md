# ADR 064: CI is a check with rounds

**Status**: Accepted

**Date**: 2026-09-26

## Context

Foundry opened a draft pull request and then asked "mark it ready?" without
ever reading the draft's CI. `integrate.ts` called `gh pr create`, `gh pr ready`
and `gh pr edit`, and nothing else. A red CI reached the operator as a review
request, and fixing it was a person's job. ADR-063 made a failed check inside
the Line send the work back; CI is the same kind of check, one step later.

## Decision

- A recipe that ships code declares `ci: { rounds: 1..3 }`. The built-ins
  declare two. `spike`, `research` and `design-doc` declare none, so nothing is
  watched on their drafts.
- After the drafts open, `watchChecks` polls
  `gh pr checks <url> --json name,bucket,link,workflow` every 15 seconds until
  nothing is `pending`. Any `fail` or `cancel` is red. Only `pass` and
  `skipping` is green. No checks at all (gh exits 1 with "no checks reported")
  or still pending after 30 minutes is **not measured**, and the ready gate
  says so. It is never read as green.
- A red CI with rounds left takes the failed logs (`gh run view <run>
--log-failed`, the last 200 lines) as `ci` feedback, reworks the recipe's
  build step through the ready-for-review node (whose `reworks` then counts
  the rounds), runs the Line again, and pushes the lanes to update the drafts.
  Ledger: `ci.round`, then `ci.green`, `ci.not_measured` or `ci.exhausted`.
- With the rounds spent, `ci.red` is raised instead of the ready gate, with the
  failing checks and the log tail. It offers "Another round" or "Hold",
  defaults to hold, and is live at every autonomy level.
- The state is kept in the order's `ci.json`, which `run.observe` and
  `order.list` carry to the Floor, the factory site and the hall.

## Alternatives

- **CI as a recipe step.** Rejected: the drafts open after the graph, so the
  step would run before there is a pull request.
- **`gh pr checks --watch`.** Rejected: it blocks one `gh` process for the whole
  wait and reports nothing along the way. Polling `--json` gives the surfaces
  each check as it lands.
- **Unbounded rounds.** Rejected: a CI the builder cannot fix would loop with
  nobody watching, as ADR-062 found for the Forge.

## Consequences

- P0 and P1 orders decide before anything is pushed, so their drafts are not
  watched by this path.
- A workflow that skips draft pull requests reports no checks, and the order
  says "not measured" rather than green.
