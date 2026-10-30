# ADR 086: Six shapes, a commit after every agent, and a document hand-back

**Status**: Accepted

**Date**: 2026-10-05

Amends ADR 050 (effort belongs to the shape), ADR 059 and ADR 064 (which named
the document and demonstration shapes) and ADR 069 (design-doc and the red team
before agreement). Those stay as history.

## Context

Ten shapes shipped, and four of them were another shape with a word changed.
`design-doc` and `research` differed only in id, description and effort. `poc`
was `direct` without the inspector. `spike` was `research` that never opened a
pull request. `quick` was `direct` with the test command of the project in
place of the verifier. Choosing between them asked the operator a question that
the repository could answer.

Research orders also could not finish. WO-0913-0bd ran research (author,
verify, integrate, ship):

- Nothing in Foundry ever runs `git commit`.
- The document of the author was edited and never committed.
- The push carried the base commit.
- `gh pr create` failed with "No commits between".
- The ledger ended on `run.failed`.

The author could write documentation only inside the checkout. So an answer
that the order wanted somewhere else had nowhere to go.

## Decision

**Six shapes.** `direct`, `standard`, `bugfix`, `refactor`, `speckit` and
`research`. `design-doc`, `poc`, `spike` and `quick` are deleted.

`direct` is one shape for one lane:

1. build (by lane)
2. lint, when the repository has a lint command
3. either the test command as a `check` step when the repository has one
   (`toolchain.test is set`, one rework round back to the build) or a fresh
   `verify` agent when it has not
4. inspect, when a risk trigger fired
5. document, unless the change is graded P3
6. integrate
7. ship

Effort is medium. The proposal is `direct` for one lane at P2 or P3, flagged or
not. It is `standard` for more than one lane or above P2.

The recipe language gains `risk.grade is P3` and `risk.grade is not P3`. They
work in `evaluateWhen` and in the sentence that records a skipped step. A step
that depends on a skipped step is satisfied. So `integrate` waits on `check`,
`verify`, `inspect` and `document`, and whichever of them did not apply is
simply absent.

**The line commits what agents write.** After an agent whose role may write the
checkout passes, the executor commits the worktree of its lane with
`<step id>: <unit titles>` (`commitNode`, over `commitWorktree`). A builder or
author that passed and left nothing to commit fails with "made no change to the
checkout". It follows the existing failure and rework path. A scribe with
nothing to document passes. So does an author whose document is outside the
checkout.

**The author hands back a document.** A new collectable,
`document: { path, url?, location: checkout | outputs | published }`, is
written to the rung file of the author. The executor collects it onto the order
like the other artefacts and records it as `document.handed_back`. The author
may now also write under the `outputs/` directory of the order, whose path is in
its brief. For a role whose `writes` is documentation only, the tool policy
allows that directory and the rung file by name. When the order names a target
outside the checkout, or in another repository, the author writes to `outputs/`
and says so.

```mermaid
flowchart LR
  A[Author hands back a document] --> L{location}
  L -->|checkout| C[Committed, ships as a pull request]
  L -->|outputs or published| R[run.document_ready: no pull request]
  A -->|nothing handed back| F[run.failed: the author handed back no document]
```

A run that ends on `outputs` or `published` records `run.document_ready`
instead of opening a pull request, and does not open an early draft.
`standingOf` reads the line as done, foundry's turn, "Finished · document
ready", never "Finished, but not shipped". A research order that ends without a
hand-back is `run.failed` with "the author handed back no document".

**A documentation-only change runs a short final check.** This applies when
every changed path is documentation (`*.md`, `docs/`, `specs/`, `README*`,
`CHANGELOG*`). The ladder keeps Format and Lint and marks the other command
steps not run, with reason "documentation only". An unknown change set, or one
code file among the documents, runs everything.

## Consequences

- Choosing a shape is a smaller question. Nothing is lost. The four deleted
  shapes are `direct` or `research` with a step removed. A repository without a
  test command is no longer a reason to refuse a shape.
- `direct` at P3 skips the scribe. `direct` runs at medium effort where it used
  to run at high. A risky change that is proposed `direct` still gets the
  inspector, and `standard` is one grade away.
- Every agent that writes now leaves a commit, so a branch has history to push.
  A builder that rewords nothing and changes nothing now stops the line instead
  of passing silently.
- An order whose document is outside the checkout stays `running` in the order
  record. Its standing, not its status, says that it is finished.
- The check of the ladder for documentation reuses the definition of a
  documentation path that the scribe uses, so the two cannot disagree about
  what documentation is.
