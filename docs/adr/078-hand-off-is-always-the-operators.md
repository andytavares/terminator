# ADR 078: Hand-off is always the operator's

**Status**: Accepted

**Date**: 2026-09-28

Supersedes the automatic hand-off in ADR 069 (the red team argues before
agreement) and ADR 074 (the Forge reads one readiness).

## Context

`terminator.foundry.autoHandOff` defaulted on. When a red-team round came back
clean, `handOff` in `src/index.ts` agreed the order as `rule:forge` and called
`runs.start`, so the Line started building before the operator had looked at
the plan. Order WO-0928-9bc was agreed at 20:03:22 and building at 20:03:23,
with no click from the operator.

The operator wants the final say on when work starts.

## Decision

- A clean round, a finished fix turn, and a released hold all end with a toast
  that says the order is ready to hand off. None of them agrees the order or
  starts a run.
- `foundry:run.start` is the only thing that starts a run, and the Forge's Hand
  off button is the only thing that calls it. `tests/hand-off.spec.ts` checks
  that `src/index.ts` calls `runs.start` once, from that channel.
- Removed: the setting, `foundry:auto-hand-off` and `foundry:auto-hand-off-set`,
  the switch on the Hand off step and in Settings, the strip's "Turn off
  automatic hand-off" action, and the `rule:forge` actor on
  `foundry:order.compile`. A caller that passes an actor is recorded as
  `operator`.
- Ledgers from before this change can still hold `order.agreed` by
  `rule:forge`. The Forge still says those orders were handed off
  automatically.

## Consequences

- The red-team loop still argues to a fixed point without the operator. It
  stops one step earlier: at "Ready to hand off".
- A stored `terminator.foundry.autoHandOff` value is ignored.
