# ADR 011: SpecKit Pilot runs cards in parallel via a concurrency cap

**Status**: Accepted

**Date**: 2026-06-30

**Feature**: `specs/016-speckit-pilot-board`

## Context

The board's core value is offloading many feature cards to agents at once. The prior
SpecKit Pilot enforced **one active run per workspace** via a queue — a hand-off would
wait until the single active run finished. That defeats the "offload many" workflow the
board exists to enable.

Each run already executes in its own git worktree, and the agent runner already returns
a per-run `RunnerHandle`, so the machinery for isolated parallel execution largely
exists; only the single-active gate stood in the way.

## Decision

Replace the single-active gate with a **configurable concurrency cap**,
`maxConcurrentRuns` (default 3), surfaced as an extension setting and in the Settings
view. Hand-off (`speckit:card-move` Backlog→Spec, and `speckit:dispatch`) counts the
cards currently occupying a run slot (active + running, scanned from state) and:

- starts immediately if under the cap, creating the worktree and constitution runner;
- otherwise sets `queuePosition: 'pending'` and waits.

When a slot frees — a run is cancelled, parked to Backlog, or its PR is opened — an
`advanceQueue` pass starts the oldest pending card(s) up to the cap. Live runner handles
are tracked in a `Map<featureDir, RunnerHandle>` for cancellation.

## Consequences

- Multiple cards progress concurrently, each isolated in its own worktree; excess
  hand-offs queue visibly (a "Waiting" chip) and start automatically.
- Slot counting is state-scan based (stateless), avoiding cross-run in-memory drift.
- `advanceQueue` must run on every terminal transition (cancel, park, PR-open) to keep
  the pipeline flowing.

## Alternatives considered

- **Keep one active run.** Rejected — it is the exact limitation the board removes.
- **Unbounded concurrency.** Rejected — spawning unlimited `claude` subprocesses and
  worktrees exhausts machine resources and thrashes; a cap bounds the blast radius.
- **In-memory active-set counter.** Rejected in favor of scanning persisted state, which
  survives reloads and cannot desync from the on-disk truth.
