# ADR 011: SpecKit Pilot runs cards in parallel via a concurrency cap

**Status**: Accepted

**Date**: 2026-06-30

**Feature**: `specs/016-speckit-pilot-board`

## Context

The board's core value is to offload many feature cards to agents at once. The prior
SpecKit Pilot enforced **one active run per workspace** via a queue. A hand-off waited
until the single active run finished. That defeats the "offload many" workflow the
board exists to enable.

Each run already executes in its own git worktree, and the agent runner already returns
a per-run `RunnerHandle`. Most of the machinery for isolated parallel execution
exists. Only the single-active gate stood in the way.

## Decision

Replace the single-active gate with a **configurable concurrency cap**,
`maxConcurrentRuns` (default 3). It appears as an extension setting and in the Settings
view. Hand-off (`speckit:card-move` Backlog→Spec, and `speckit:dispatch`) counts the
cards that currently occupy a run slot (active + running, scanned from state). Then:

- If the count is under the cap, the run starts immediately and creates the worktree and constitution runner.
- Otherwise the card sets `queuePosition: 'pending'` and waits.

When a slot frees (a run is cancelled, parked to Backlog, or its PR is opened), an
`advanceQueue` pass starts the oldest pending card(s) up to the cap. A
`Map<featureDir, RunnerHandle>` tracks live runner handles for cancellation.

## Consequences

- Multiple cards progress concurrently, each isolated in its own worktree. Excess
  hand-offs queue visibly (a "Waiting" chip) and start automatically.
- Slot counting scans state (stateless), which avoids cross-run in-memory drift.
- `advanceQueue` must run on every terminal transition (cancel, park, PR-open) to keep
  the pipeline flowing.

## Alternatives considered

- **Keep one active run.** Rejected. It is the exact limitation the board removes.
- **Unbounded concurrency.** Rejected. Unlimited `claude` subprocesses and worktrees
  exhaust machine resources and thrash. A cap bounds the blast radius.
- **In-memory active-set counter.** Rejected in favor of scanning persisted state. That
  state survives reloads and cannot desync from the on-disk truth.
