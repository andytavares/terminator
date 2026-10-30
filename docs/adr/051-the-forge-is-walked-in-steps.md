# ADR 051: The Forge is walked in steps

**Status**: Accepted

**Date**: 2026-09-13

**Replaces**: the rail-and-document layout of the Forge (a UI arrangement, never
its own ADR; last described in the user guide before this change)

## Context

An open order in the Forge was a document with a rail beside it. The rail was 260px wide (300px above 1400px). It held these items:

- the six convergence checks with their remedies
- the hand-off button
- up to nine shape-of-work cards
- the tracker state mapping and write-back toggles
- the "not measurable here" note

The document held intent, acceptance, coverage, assumptions, red team findings and the message box to the architect.

The operator reported that the rail's cards are so condensed that they cannot be read. The operator also said the Forge should walk them through the process and not show a tile view. The rail squeezed every decision it carried into a fifth of the width, while the document beside it had more room than its text could use. Earlier fixes bounded the rail's height and clamped the recipe descriptions to one line. That made the cards shorter and harder to read, not easier.

## Decision

**An open order is a sequence of steps. Each step is one full-width screen, with Back and Next at the foot.**

- The steps are **Intent → Plan → Red team → Shape → Tracker → Hand off**. Shape appears only while the order is a draft and the repository supports a shape. Tracker appears only for an order seeded from an issue.
- Each failing check sits on the step whose controls clear it (`src/forge/steps.ts`). Falsifiable, coverage, risk and budgets sit on Plan. Red team sits on Red team. That step shows the check with its remedy above its content, and the step list replaces the step's number with a cross. Hand off lists all six.
- An order opens at the step where the next thing to do is. That is Intent when nothing is planned, otherwise the first step that still blocks, otherwise Hand off. Once the operator picks a step, the Forge keeps that step.
- Steps are not locked. The operator can open any step from the list at any time, because agreeing an order is iterative and a redraft can move every step.
- Unchanged: the refused-turn band and the Needs you band stay above every step. Draft the plan / Redraft and Attach stay in the order header. Discard and Delete stay at the foot of the frame.

## Alternatives considered

- **Widen the rail.** We tried this before, as two and three rail columns at 1200px and 1700px. It took half of a wide window from the document, and it did nothing below 1200px, which is where the reports came from.
- **A strictly linear wizard (Next unlocks only when the step passes).** The architect clears most steps, not the operator, and a redraft can reopen an earlier step. Locking would stop the operator from reading ahead to the shape of work or the tracker while the Forge is still drafting the plan.
- **Tabs with no order.** Tabs lose what the steps say: there is a sequence, and hand-off is the end of it.

## Consequences

- Nothing on the Forge is narrower than the step body (at most 760px of readable measure), so the Forge shows every description whole. The one-line clamp on recipe descriptions is gone.
- The operator sees one step at a time. The step list shows what another step is holding up (cross) and marks what a turn redrew there (dot).
- Structural tests assert the wizard box (`fdry-wizard-head`, `fdry-step`, `fdry-wizard-foot`) instead of the rail and document columns.
