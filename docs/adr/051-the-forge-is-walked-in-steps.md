# ADR 051: The Forge is walked in steps

**Status**: Accepted

**Date**: 2026-09-13

**Replaces**: the rail-and-document layout of the Forge (a UI arrangement, never
its own ADR; last described in the user guide before this change)

## Context

An open order in the Forge was a document with a rail beside it. The rail was
260px wide (300px above 1400px) and held the six convergence checks with their
remedies, the hand-off button, up to nine shape-of-work cards, the tracker
state mapping and write-back toggles, and the "not measurable here" note. The
document held intent, acceptance, coverage, assumptions, red team findings and
the message box to the architect.

The operator's report: the rail's cards are so condensed they cannot be read,
and the Forge should walk them through the process rather than show a tile
view. Every decision the rail carried was squeezed into a fifth of the width
while the document beside it had more room than its text could use. Earlier
fixes bounded the rail's height and clamped the recipe descriptions to one
line — which made the cards shorter and harder to read, not easier.

## Decision

**An open order is a sequence of steps, one full-width screen each, with Back
and Next at the foot.**

- The steps are **Intent → Plan → Red team → Shape → Tracker → Hand off**.
  Shape appears only while the order is a draft and the repository supports a
  shape; Tracker only for an order seeded from an issue.
- Each failing check sits on the step whose controls clear it
  (`src/forge/steps.ts`): falsifiable, coverage, risk and budgets on Plan; red
  team on Red team. That step shows the check with its remedy above its
  content, and the step list replaces the step's number with a cross. Hand off
  lists all six.
- An order opens where the next thing to do is: Intent when nothing is
  planned, otherwise the first step still blocking, otherwise Hand off. Once
  the operator picks a step, it stays put.
- Steps are not locked. Any step can be opened from the list at any time,
  because agreeing an order is iterative — a redraft can move every step.
- Unchanged: the refused-turn band and the Needs you band stay above every
  step; Draft the plan / Redraft and Attach stay in the order header; Discard
  and Delete stay at the foot of the frame.

## Alternatives considered

- **Widen the rail.** Tried before as two and three rail columns at 1200px and
  1700px; it took half a wide window from the document and did nothing below
  1200px, where the reports came from.
- **A strictly linear wizard (Next only unlocks when the step passes).** Most
  steps are cleared by the architect, not by the operator, and a redraft can
  reopen an earlier step. Locking would stop the operator reading ahead to the
  shape of work or the tracker while the plan is still being drafted.
- **Tabs with no order.** Loses what the steps say: there is a sequence, and
  hand-off is the end of it.

## Consequences

- Nothing on the Forge is narrower than the step body (at most 760px of
  readable measure), so every description is shown whole; the one-line clamp
  on recipe descriptions is gone.
- The operator sees one step at a time. What another step is holding up is on
  the step list (cross) and what a turn redrew there is marked with a dot.
- Structural tests assert the wizard box (`fdry-wizard-head`, `fdry-step`,
  `fdry-wizard-foot`) instead of the rail and document columns.
