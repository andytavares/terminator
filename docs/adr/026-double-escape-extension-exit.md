# ADR-026: Double-Escape Exits an Extension to the Terminal

**Status**: Accepted
**Date**: 2026-08-15
**Deciders**: Andrew Tavares

---

## Context

Terminator is a terminal first; extensions are surfaces layered over it. There was no keyboard way out of one. Every extension surface — global tab, workspace tab, project tab, sidebar panel — could only be dismissed by clicking the rail icon that opened it, clicking a project, or clicking the Terminal tab. A keyboard-first app made the user reach for the mouse to get back to their shell.

`Esc` is the obvious key, and it is already taken. All five bundled extensions bind it for their own dismissals — closing a `SmartTaskInput` dropdown (`extensions/task-vault/src/components/SmartTaskInput.tsx`), cancelling an inline rename (`extensions/notepad/src/components/NoteList.tsx`), dismissing the MergeFlow conflict resolver (`extensions/git-integration/src/components/merge-flow/ConflictResolver.tsx`), and roughly a dozen more sites. None of them call `preventDefault()`, so there is no signal on the event saying whether the extension consumed it.

Two mechanics constrain any solution:

- Extension UIs are isolated `WebContentsView` instances (ADR-022). Keystrokes inside one never reach the host renderer's `window` listener, so a renderer-side handler alone cannot see them.
- `Esc` inside a terminal belongs to the shell. Anything that intercepts it globally breaks vim.

---

## Decision

**Two `Esc` presses within 500 ms exit the extension and return focus to the terminal session the user was last in.**

The listeners are passive and bubble-phase — they never call `preventDefault()` or `stopPropagation()`. The first press reaches the extension exactly as before; the second is the exit. No extension code changes, and no extension loses its own `Esc`.

The gesture is detected at two sources that converge on one action:

1. **Inside an extension view** — `src/main/preload-webview.ts` (core-owned, not extension code) detects the pair and sends `extension:request-exit`. `routeExtensionExitRequest` (`src/main/extensions/extension-exit.ts`) attributes the sender webContents to a surface, focuses the main renderer, and relays `extension:exit-to-terminal`.
2. **In the host chrome while an extension surface is showing** — `useExtensionEscapeExit` detects the pair directly.

Both call `registry.exitExtensionToTerminal()`. A sidebar panel sits beside the terminal rather than replacing it, so exiting one just closes that panel; every other surface clears all three tab slots at once, which reveals `TerminalPane`. The project's `activeSessionId` is untouched while an extension is showing, so it is still the session the user left — no separate "last terminal" history is needed.

Scope boundaries: core surfaces (`core.*` ids, i.e. Overview) are never exited; the host-side listener stands down inside a terminal, a text field, or an open modal; auxiliary `windowViews` pop-outs are excluded (separate OS windows with their own chrome and no terminal to return to).

---

## Considered Alternatives

### Single `Esc`, always exits (rejected)

One press, no state, trivially explainable. But `Esc` to close a Task Vault dropdown would also throw the user out to the terminal. Every extension's own `Esc` becomes a double action. Rejected on use, not on implementation cost.

### Single `Esc`, exit unless `preventDefault()` (rejected)

The correct contract in the abstract: core exits only when nothing else consumed the key. It requires every extension `Esc` handler to opt out explicitly, which means editing ~15 sites across all five bundled extensions and adding a rule to the Extension API that third-party extensions must obey or be silently broken by. A contract whose failure mode is "your extension exits when the user only wanted to close a dropdown" fails open in the worst direction, and it cannot be enforced at build time.

### Capture-phase interception in the preload (rejected)

Swallowing `Esc` before the page sees it makes the behavior deterministic, but it breaks every extension's internal dismissal outright — a strictly worse version of the first alternative.

### A dedicated non-`Esc` accelerator (rejected)

`Cmd+Shift+Esc`-style bindings collide with the OS and with the reserved-shortcut set, and they are undiscoverable. `Esc` is what a user actually presses when they want out.

---

## Consequences

**Positive:**

- Every extension becomes keyboard-exitable with no per-extension code, and third-party extensions inherit it for free.
- Extensions keep their own `Esc` behavior unchanged; nothing regresses.
- The main-process router attributes the sender rather than trusting a payload, so a stray `extension:request-exit` from an unknown webContents is ignored.

**Negative:**

- It is a timing heuristic. Pressing `Esc` twice quickly for two legitimate extension dismissals (close a dropdown, then close the dialog behind it) exits instead of performing the second dismissal. 500 ms is the tolerance chosen for that trade.
- Undiscoverable without documentation — it is in the user guide's shortcut table, but there is no in-app hint.
- The detector is implemented twice: `src/shared/double-escape.ts` for everything that can import, and inlined in `preload-webview.ts`. That preload must not share modules with `preload.ts` or Rollup emits a chunk Electron's sandboxed `require` cannot resolve (same constraint that already duplicates `RESERVED_SHORTCUTS`).
