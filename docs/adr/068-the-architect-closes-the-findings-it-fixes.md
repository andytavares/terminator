# ADR 068: The architect closes the findings it fixes

**Status**: Accepted

**Date**: 2026-09-26

## Context

A red-team finding had three moves on the Forge's Red team step: Ask the
architect, Fixed, Accept.

- **Ask the architect** started a redraft, but only a structural finding
  (ADR 062's `settleFindings`) could close itself afterwards, by re-running the
  rule. A reviewer's finding is judgement: nothing re-derives it, and the
  proposal had no field to say it was cleared. The redraft landed and the
  finding sat there unchanged — reported as "Ask the architect seems to not do
  anything".
- **Fixed** marked the finding resolved with nothing changed in the order —
  reported as "Fixed provides no way to fix anything".
- A reviewer's finding was one inline paragraph beside three buttons —
  reported as "a wall of text that is impossible to read quickly".

## Decision

- A proposal may carry `resolveFindings: [{ id, how }]`. `readProposal` closes
  each open finding it names as `resolved`, with reason `architect: <how>`.
  `how` is required. An accepted or already-resolved finding is left alone.
  The converge brief says a finding fixed but not listed stays open.
- The operator's `finding.decision: 'resolved'` is removed from
  `foundry:order.turn`. **Fix it…** takes the operator's direction and sends
  it to the architect as a converge turn, which closes the finding through
  `resolveFindings` like any other ask.
- The Red team step lists cleared findings with their reason, so the effect of
  an ask is visible and checkable.
- A finding is shown as its first line (or first sentence) as the headline,
  with the rest folded under **Why** and rendered as markdown. The red-team
  role and the rung contract ask for exactly that shape: a one-sentence claim,
  then `- ` bullets of evidence.

## Consequences

- Closing a reviewer finding now rests on the architect's claim. The claim is
  recorded with the finding and shown to the operator, who can reopen the
  question by asking again; the compile gate still counts only open findings.
- Findings written before this change are single paragraphs; they are split at
  their first sentence rather than rewritten.
