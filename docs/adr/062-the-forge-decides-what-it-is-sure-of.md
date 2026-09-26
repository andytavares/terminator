# ADR 062: The Forge decides what it is sure of

**Status**: Accepted

**Date**: 2026-09-26

## Context

The Forge stopped the operator for three things: every open question (up to
three per draft), every open red-team finding, and every failed check, which
waited for a click on "Ask for the gap to be closed". The architect could not
even see which findings were open — its brief carried only their count — so
each one was the operator's by construction. The operator asked for stops only
on show-stoppers, with the architect taking any option it is at least 90% sure
of (spec 062).

## Decision

- An open question carries `confidence`. At `CONFIDENCE_BAR` (0.9) or above,
  `decideConfidentQuestions` answers it with the recommended option and adds an
  assumption the operator can strike. This runs on read-back, so it holds even
  when the architect asks anyway.
- The brief lists open findings. A proposal may carry `dismissFindings`;
  `dismissConfidentFindings` accepts only low and medium ones at the bar, with
  the architect's reason. `redTeam` itself stays unreachable from a proposal.
- `followUpFor` hands failing checks other than `questions` back to the
  architect, at most `MAX_AUTO_TURNS` (2) times per operator turn. The previous
  architect process is ended first (`endAndWait`), so two processes never share
  one conversation.

## Alternatives

- **Prompt-only guidance.** Cheaper, but the brief already said "ask only
  where the repository cannot answer", and questions still arrived. The
  confidence gate is enforced on read-back instead.
- **Let high-severity findings be dismissed too.** Rejected: those are the
  show-stoppers — release machinery, no runnable check, a P0 decided by opinion.
- **Unbounded follow-ups.** Rejected: a plan the architect cannot fix would
  loop and spend tokens with nobody watching.

## Consequences

- A decision the operator would have made differently shows up as a struck
  assumption on the next turn, not as a question beforehand.
- A self-reported confidence is only as good as the model's calibration. The
  assumption is always there to strike.
