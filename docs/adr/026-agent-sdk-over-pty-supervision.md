# ADR 026: Drive supervised sessions with the Agent SDK, not by parsing a terminal

**Status**: Accepted
**Date**: 2026-07-26
**Context**: Feature `021-agent-supervision-console`

## Context

The console must know, for every supervised session, whether the agent is working, blocked on a permission request, stuck, finished, or failed — and it must know within two seconds without the operator opening the session (SC-001).

Terminator is a terminal emulator. The obvious path was to keep using `node-pty` and derive state by reading what the agent prints.

## Decision

Supervised sessions are driven programmatically through `@anthropic-ai/claude-agent-sdk`. Runtime state is derived from three sources, in priority order: the SDK's own callbacks and result messages, the agent's durable transcript, and lifecycle hooks. Rendered terminal output is never parsed for state.

Ordinary, unsupervised terminal sessions are untouched and continue to use `node-pty`.

## Rationale

**`canUseTool` is the only way to observe a blocked agent.** The `Notification` hook does not fire for permission prompts. Without the SDK callback there is no event to observe, and `needs_input` — the state SC-001 is written about — would be unobservable. This single fact decides the question.

**Terminal output is not a contract.** The agent runtime ships continuously and its rendered output changes freely between releases. Omnara archived a 2.6k-star project because wrapping the CLI "became unfeasible to maintain with Claude Code's constant updates". Building the console's core capability on that surface would mean re-deriving it after every release.

**The SDK gives the accounting for free.** `SDKResultMessage` carries `session_id`, `num_turns`, `total_cost_usd` and `usage`; scraping equivalents from a rendered pane would be guesswork.

## Alternatives considered

**Parse PTY output.** Rejected above, and forbidden by the specification (FR-005).

**Hooks only, no SDK.** Rejected: hooks cannot express a permission decision, so the blocked state stays invisible.

**Poll the transcript alone.** Rejected as a primary source — it lags, and it cannot answer a permission request. It is retained as the always-on secondary source precisely because it survives the driver dying (FR-006).

## Consequences

The SDK became a new core dependency, which forced a repository-wide Zod 4 migration (ADR 030). Its `0.x` version line is pinned exactly.

All runtime-specific knowledge is confined to one module — see ADR 027, which exists because of this decision.

Ordinary terminal sessions keep their existing behaviour, so this adds a session type rather than replacing one.
