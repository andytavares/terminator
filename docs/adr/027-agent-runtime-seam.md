# ADR 027: One seam for agent-runtime knowledge, with a single implementation

**Status**: Accepted
**Date**: 2026-07-26
**Context**: Feature `021-agent-supervision-console`

## Context

Following ADR 026, the core application knows several runtime-specific things: how to start a session, how permission decisions are exchanged, where the durable transcript lives and roughly what its lines look like, and which lifecycle hooks exist.

The runtime is released continuously and independently of this application, and SC-007 requires that upgrading it cause no regression in reported state — with any change needed to absorb an upgrade confined to one place.

Constitution VII treats abstraction over a single concrete case as a defect. Supporting a second agent runtime is an explicit non-goal (FR-004 forbids making this pluggable). So this decision needs justifying, not assuming.

## Decision

All agent-runtime knowledge lives in `src/main/supervision/agent-runtime/`. It emits a runtime-neutral `SessionEvent` union that references no runtime type. The state machine, stall detector, review queue, and every surface consume only that union.

The boundary has exactly one implementation. It is not a registry, not a provider interface, and not exposed on the Extension API.

Two mechanical guards enforce it:

- an ESLint `no-restricted-imports` rule permitting `@anthropic-ai/claude-agent-sdk` only under `agent-runtime/`;
- `tests/unit/main/supervision/events/session-event.spec.ts`, which asserts the neutral union's module imports nothing at all.

## Rationale

**The justification is a present requirement, not an anticipated one.** SC-007 exists today. The runtime is `0.x` and ships continuously; the transcript's per-line schema is not a published contract at all. Without the seam, one shape change edits the state machine, the detector, the review queue, and every surface simultaneously — which is exactly the failure SC-007 is written to prevent, and the documented cause of the Omnara archival cited in ADR 026.

**A seam is not a layer.** There is no second implementation to keep in step, no registry to resolve, and no interface published to anyone. The cost is one translation module; the benefit is a bounded blast radius on every upgrade.

**Enforcement, not convention.** A convention that is not enforced decays. Both guards fail loudly, and both were verified to fail before the rule existed rather than assumed to work.

## Alternatives considered

**Let runtime types flow through the codebase.** Less code today. Rejected: it makes SC-007 unachievable and converts every runtime release into a repository-wide diff.

**Make the boundary pluggable for future runtimes.** Rejected, and forbidden by FR-004. That would be the speculative abstraction Constitution VII prohibits — the seam is justified by upgrade containment, not by a second runtime that is out of scope.

## Consequences

`driver.ts` is the only file under `src/` importing the SDK. The runtime-neutral `SessionEvent` union carries `callId` and `isShell` on tool events specifically so the stall detector can exclude an in-flight shell command (FR-015) without knowing anything about the runtime.

The upgrade-regression check in `quickstart.md` is the test of this decision: pin an older runtime, upgrade, and confirm the resulting diff touches only `agent-runtime/` and its tests.
