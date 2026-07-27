# ADR 028: The console owns the work-item publication directory and its schema

**Status**: Accepted
**Date**: 2026-07-26
**Context**: Feature `021-agent-supervision-console`

## Context

Work items originate outside the console: a producer runs the specification pipeline and knows the phase, the artefacts, the gates and the lanes. The console renders that and supervises the sessions it implies.

The source PRD proposed writing `workitem.json` into the producer's own feature directory and having the console watch it there, with the console writing `lanes[].session_id` back.

The operator's constraint on this feature was unambiguous: plugins must never mix with the core application. That rules out both halves of the PRD's proposal — the console reading inside a producer's directory, and the console writing into producer-owned state.

## Decision

The console defines and owns a publication directory under the application's user-data path, and defines the schema of the contract files written into it. Producers write their own files into their own subdirectory of it.

- Inbound: the console reads only from its own directory, and treats every file as read-only input.
- Outbound: every action directed at a producer goes through a command the producer registered on the published Extension API.
- Lane-to-session bindings live in console-owned storage, keyed by work item and lane position.

## Rationale

**It makes the boundary structural rather than behavioural.** The console holds no knowledge of any producer's file layout, so there is nothing to accidentally couple to. A rule enforced by not knowing something cannot decay.

**`session_id` had to move.** Keeping it in the contract, as the PRD had it, would force the console to write into producer state for the most routine operation there is — starting a session. Moving it to console-owned storage is the single most important difference between this contract and the draft, and it is what lets the boundary test in `quickstart.md` § P6 assert that the producer's file is byte-for-byte unchanged after a session is bound.

**It removed a risk rather than adding one.** The PRD flagged that spec-kit's artefact paths were unverified and warned against hard-coding a directory convention. Because the producer reports artefact paths inside the contract, the console never infers a layout, and that risk no longer exists.

**Producer-agnostic by construction.** The board is derived entirely from the contract, so a hand-written JSON file behaves identically to any extension. That is a testable property, not an aspiration.

## Alternatives considered

**Watch the producer's own directory** (the PRD's proposal). Rejected: the console would need per-producer layout knowledge, and it is the coupling the operator ruled out.

**Extension API only, no file.** Rejected: the producer would stop working standalone in a bare terminal, which was the PRD's stated reason for choosing a file.

**Registration — the producer nominates a path.** Rejected: flexible, but the console still ends up reading inside extension directories.

## Consequences

The publication schema is a published contract carrying `contract_version`. Unknown major versions are rejected outright rather than partially parsed; additive optional fields do not bump the major, so a newer producer degrades gracefully against an older console.

Failures are strictly per item. A malformed or half-written file marks that one item unreadable with a stated reason and touches nothing else.

Two producers publishing the same id are both flagged as conflicted, naming both. The console never resolves a conflict by choosing.

The watcher deliberately ignores its own event payload — `fs.watch` is unreliable about which file changed — and debounces into a full re-scan.
