# ADR 135: A failed agent start carries its reason

**Status**: Accepted

**Date**: 2026-10-29

**Relates to**: [ADR 134](134-feature-usage-is-counted-in-the-core.md)

## Context

An ACP agent that cannot start answers with a `RequestError` whose message is "Internal error" and whose `data.details` holds the real reason (for example "Mode dontAsk is not available in this session"). The core logged `String(error)`, which keeps only "Internal error", and discarded the adapter's stderr (`stdio: ['pipe', 'pipe', 'ignore']`). `api.agents.start` returned `null`, so an extension could not tell the operator why. Foundry showed "plan refused" for a start failure.

## Decision

- **Keep the evidence.** `agent-connection.ts` pipes the adapter's stderr into a string trimmed from the front to the last 16 KB, and exposes it as `stderrTail()` on the link.
- **Log it.** `agent did not start` now logs the error, the reason and the stderr tail.
- **One reason string.** `error.data.details` when it is a string, else the error message.
- **Tell the caller, additively.** `StartAgentInput.onStartFailed?(reason)` (SDK 6.2.0) receives the reason before `start` resolves `null`. `start` still resolves `null`, so no existing caller breaks. The IPC path is unchanged: functions do not cross IPC.

## Alternatives considered

- **Throw from `start`.** Gives the reason, but breaks every caller that checks for `null`.
- **Return `{ error }` from `start`.** Changes the return type for all callers.

## Consequences

- An extension that passes `onStartFailed` can show the agent's own reason.
- The stderr tail is only in the log, not in the callback; it can hold paths and tokens an agent prints.
- Renderer callers through IPC get no reason.
