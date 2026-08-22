# Contract: Session View State and Agent-State Derivation

**Modules**: `src/shared/types/index.ts`, `src/renderer/sidebar/agent-state.ts`,
`src/renderer/terminal/session-controller.ts`, `src/renderer/stores/session.store.ts`

## New fields on `TerminalSession`

All four are **renderer-side view state**, following the existing `bellCount` / `busy` convention. Sessions
are not persisted (the main process owns PTYs, not session records), so there is no schema change, no IPC
change, and no migration. See [research.md](../research.md) R3.

```ts
/** Epoch ms of the last PTY output. Renderer-side view state; never serialised. */
lastActivityAt: number
/** Epoch ms of when this session last became the visible one. Renderer-side view state. */
lastAttendedAt?: number
/** Derived from bell/busy/exit — see the table below. Renderer-side view state. */
agentState: AgentState
/** Optional one-line user note. Free text, never structured. Renderer-side view state. */
note?: string
```

- Epoch ms rather than the ISO strings used by `createdAt` / `closedAt`, because these two are compared
  against `Date.now()` on every row render and every staleness evaluation and are never serialised
  (research R5).
- Backfill at construction: `lastActivityAt ??= Date.parse(session.createdAt)` (FR-007).
- `note` is capped at one line: newlines are stripped on write, length capped at 120 characters.

## `AgentState` derivation

`agent-state.ts` exposes one interface with one implementation. The interface exists because the README must
document a limitation and a future source must be swappable without touching the UI — not to support a
second implementation this feature does not build.

```ts
interface AgentStateSource {
  derive(session: TerminalSession): AgentState
}
```

`BellAndBusySource.derive`, in precedence order:

| Order | Condition                      | Result           | Signal quality                                                |
| ----- | ------------------------------ | ---------------- | ------------------------------------------------------------- |
| 1     | `session.status === 'closed'`  | `exited`         | real — `handleProcessExit`, `session.store.ts:398-412`        |
| 2     | `(session.bellCount ?? 0) > 0` | `awaiting-input` | **heuristic** — the terminal bell is the only signal core has |
| 3     | `session.busy === true`        | `working`        | real — byte flow, `IDLE_DEBOUNCE_MS = 1500`                   |
| 4     | otherwise                      | `idle`           | real — the complement                                         |

**Documented limitation (README, Phase 5):** `awaiting-input` is inferred from the terminal bell, so an agent
that waits without ringing it is reported as `idle`. Core cannot use Claude Code hooks — they belong to the
`speckit-pilot` extension and Constitution Principle II forbids core consuming an extension's internals — and
a shell-launched `claude` emits none. Spec SC-003 is scoped to detectable sessions for this reason.

## Activity stamping

`onBusy` fires on **every** PTY output chunk (`TerminalSession.tsx:144-157`). The existing
`setSessionBusy` guard returns unchanged state when already busy (`session.store.ts:380-384`), which is what
keeps a chatty agent from thrashing the store today. An unthrottled `lastActivityAt` write would defeat it.

Contract:

- `session-controller.ts` owns a module-level `Map<sessionId, number>` of last-stamped times and calls the
  store's `stampActivity(sessionId, now)` **at most once per second per session**.
- The controller takes `now()` as an injectable dependency (default `Date.now`) so the throttle is testable
  with a fake clock and no timers.
- `stampActivity` in the store is a plain pure patch with no timing logic of its own (Principle XI).
- `setActiveSessionForProject` additionally stamps `lastAttendedAt`.

**Test obligation**: with a fake clock, 100 `onBusy` calls inside one second produce exactly one store write;
the 101st call after the clock advances past one second produces a second.

## Settings

`GlobalSettingsSchema` gains:

```ts
sidebar: z.object({
  staleAfterMs: z.number().int().min(60_000).max(2_592_000_000).default(7_200_000),
}).default({ staleAfterMs: 7_200_000 })
```

Default 2 hours (FR-020); bounded 1 minute to 30 days so the spec's "zero or very large" edge case is a
validation failure rather than a nonsense view. `DEFAULT_GLOBAL_SETTINGS` gains the matching literal, and
`SettingsPanel` gains one row. `WorkspaceSettingsSchema` is **not** extended — staleness is a global
preference, and adding a per-workspace override nobody asked for would violate Principle VII.
