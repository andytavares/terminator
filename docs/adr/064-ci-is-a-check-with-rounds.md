# ADR 064: CI is a check with rounds

**Status**: Accepted

**Date**: 2026-09-26

## Context

Foundry opened a draft pull request and then asked "mark it ready?" without
reading the CI of the draft. `integrate.ts` called `gh pr create`, `gh pr ready`
and `gh pr edit`, and nothing else. A red CI reached the operator as a review
request, and a person had to fix it. ADR-063 made a failed check inside the
Line send the work back. CI is the same kind of check, one step later.

## Decision

- A recipe that ships code declares `ci: { rounds: 1..3 }`. The built-ins
  declare two. `spike`, `research` and `design-doc` declare none, so nothing is
  watched on their drafts.
- After the drafts open, `watchChecks` polls
  `gh pr checks <url> --json name,bucket,link,workflow` every 15 seconds until
  nothing is `pending`. Any `fail` or `cancel` is red. Only `pass` and
  `skipping` is green. Two cases are **not measured**: no checks at all (gh
  exits 1 with "no checks reported"), and checks still pending after 30 minutes.
  The ready gate says so. It never reads them as green.
- A red CI with rounds left starts a round:

  1. The failed logs (`gh run view <run> --log-failed`, the last 200 lines)
     become `ci` feedback.
  2. The recipe's build step is reworked through the ready-for-review node. Its
     `reworks` then counts the rounds.
  3. The Line runs again.
  4. The lanes are pushed to update the drafts.

  Ledger: `ci.round`, then `ci.green`, `ci.not_measured` or `ci.exhausted`.

- When the rounds are spent, `ci.red` is raised instead of the ready gate. It
  shows the failing checks and the log tail. It offers "Another round" or
  "Hold", defaults to hold, and is live at every autonomy level.
- The order's `ci.json` keeps the state. `run.observe` and `order.list` carry
  it to the Floor, the factory site and the hall.

## Alternatives

- **CI as a recipe step.** Rejected. The drafts open after the graph, so the
  step would run before there is a pull request.
- **`gh pr checks --watch`.** Rejected. It blocks one `gh` process for the whole
  wait and reports nothing along the way. Polling `--json` gives the surfaces
  each check as it lands.
- **Unbounded rounds.** Rejected. A CI that the builder cannot fix would loop
  with nobody watching, as ADR-062 found for the Forge.

## Consequences

- P0 and P1 orders decide before anything is pushed, so this path does not
  watch their drafts.
- A workflow that skips draft pull requests reports no checks. The order says
  "not measured", not green.
