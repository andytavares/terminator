# ADR 010: SpecKit Pilot card model unifies feature dir, ticket, and run

**Status**: Accepted

**Date**: 2026-06-30

**Feature**: `specs/016-speckit-pilot-board`

## Context

SpecKit Pilot was reframed from a linear, single-run, tab-based UI into a Quill-style
kanban board (see `specs/016-speckit-pilot-board/`). The board needs a single unit of
work, a "card". A card can exist before any agent run (in Backlog), carry a
human-authored brief, and still drive the existing 10-phase Spec-Kit pipeline.

Previously three notions were separate: a **feature dir** (`specs/NNN-slug/` with
`.pilot/state.json`), a **ticket** (Linear/Jira reference), and a **run** (the active
agent execution). A backlog item had no representation at all. State only existed once
a run was dispatched.

## Decision

A **card is a feature dir.** We extend `PilotState` to **version 3** with a `card:
CardBrief` and a `stage: BoardStage`, and add two sibling files under `.pilot/`:
`card.json` (the authoritative brief for native/imported cards) and `comments.jsonl`
(steering comments + activity). A card can be created in Backlog with a brief and **no
run**. The run, ticket, and worktree remain optional fields, populated on hand-off.

A pure `deriveStage(phases, run)` **derives the board stage** from phase progress.
Backlog is the only stage that exists before a run. The board therefore stays
consistent with the authoritative phase state machine automatically. A v2→v3 migration
synthesizes a brief (from the ticket title or slug) and derives the stage on read.

## Consequences

- One source of truth per card, co-located and git-visible. No parallel board database
  needs to stay in sync.
- The card is an additive layer. The existing phase engine, gates, persistence, and
  artifact tooling are reused unchanged.
- Reads must migrate v1/v2 states. `deriveStage` must remain pure and total.

## Alternatives considered

- **A separate board index/database.** Rejected. A second source of truth invites
  drift and sync bugs for no benefit. The feature dir already holds everything.
- **Keep ticket/run/feature as distinct entities.** Rejected. That is the linear model
  being replaced. It cannot represent a backlog item and it fragments card data.
- **Store the stage authoritatively (not derived).** Rejected. A hand-maintained stage
  drifts from phase state. Deriving keeps the board correct with no extra writes.
