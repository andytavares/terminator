# ADR 135: A failed agent start carries its reason

**Status**: Accepted

**Date**: 2026-10-29

**Relates to**: [ADR 134](134-feature-usage-is-counted-in-the-core.md)

## Context

An ACP agent that cannot start answers with a `RequestError`. Its message is "Internal error", and `data.details` holds the real reason (for example "Mode dontAsk is not available in this session"). The core logged `String(error)`, which keeps only "Internal error". It discarded the stderr of the adapter (`stdio: ['pipe', 'pipe', 'ignore']`). `api.agents.start` returned `null`, so an extension could not tell the operator why. Foundry showed "plan refused" for a start failure.

## Decision

- **Keep the evidence.** `agent-connection.ts` pipes the stderr of the adapter into a string, trimmed from the front to the last 16 KB. It exposes the string as `stderrTail()` on the link.
- **Log it.** `agent did not start` now logs the error, the reason and the stderr tail.
- **One reason string.** The reason is `error.data.details` when it is a string, else the error message.
- **Tell the caller, additively.** `StartAgentInput.onStartFailed?(reason)` (SDK 6.2.0) receives the reason before `start` resolves `null`. `start` still resolves `null`, so no existing caller breaks. The IPC path is unchanged, because functions do not cross IPC.

## Alternatives considered

- **Throw from `start`.** This gives the reason, but breaks every caller that checks for `null`.
- **Return `{ error }` from `start`.** This changes the return type for all callers.

## Consequences

- An extension that passes `onStartFailed` can show the own reason of the agent.
- The stderr tail is only in the log, not in the callback. It can hold paths and tokens that an agent prints.
- Renderer callers through IPC get no reason.
