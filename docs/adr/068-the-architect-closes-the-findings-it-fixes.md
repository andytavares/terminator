# ADR 068: The architect closes the findings it fixes

**Status**: Accepted

**Date**: 2026-09-26

## Context

A red-team finding had three moves on the Red team step of the Forge: Ask the
architect, Fixed, Accept.

- **Ask the architect** started a redraft. But only a structural finding
  (`settleFindings` of ADR 062) could close itself afterwards, by re-running the
  rule. The finding of a reviewer is judgement. Nothing re-derives it, and the
  proposal had no field to say that it was cleared. The redraft landed and the
  finding sat there unchanged. A report said "Ask the architect seems to not do
  anything".
- **Fixed** marked the finding resolved with nothing changed in the order. A
  report said "Fixed provides no way to fix anything".
- The finding of a reviewer was one inline paragraph beside three buttons. A
  report said "a wall of text that is impossible to read quickly".

## Decision

- A proposal may carry `resolveFindings: [{ id, how }]`. `readProposal` closes
  each open finding that the list names as `resolved`, with reason
  `architect: <how>`. `how` is required. An accepted or already-resolved
  finding is left alone. The converge brief says that a finding that is fixed
  but not listed stays open.
- The `finding.decision: 'resolved'` of the operator is removed from
  `foundry:order.turn`. **Fix it…** takes the direction of the operator and
  sends it to the architect as a converge turn. The architect closes the finding
  through `resolveFindings` like any other ask.
- The Red team step lists cleared findings with their reason, so the effect of
  an ask is visible and checkable.
- A finding is shown as its first line (or first sentence) as the headline.
  The rest is folded under **Why** and rendered as markdown. The red-team role
  and the rung contract ask for exactly that shape: a one-sentence claim, then
  `- ` bullets of evidence.

## Consequences

- Closing the finding of a reviewer now rests on the claim of the architect.
  The claim is recorded with the finding and shown to the operator. The operator
  can reopen the question by asking again. The compile gate still counts only
  open findings.
- Findings written before this change are single paragraphs. They are split at
  their first sentence, not rewritten.
