# ADR 126: A session breaks out into a child window

**Status**: Accepted

**Date**: 2026-10-23

Extends ADR 004 (xterm instances persist on tab switch).

## Context

Every terminal session is a tab in the one Terminator window. To watch two sessions on different screens, or keep an agent's terminal visible while working in another branch, the only tool is a split pane inside the same window. A session should move into its own window, by shortcut or by dragging its tab out, and come back to the branch it left. Its process, scrollback and agent state must survive both moves.

## Decision

A breakout window is a same-process child of the main window, opened with `window.open`. It holds the session's existing xterm element, moved from the main window's page into the child's. Main only allows, sizes and tracks the window (`src/main/breakout-windows.ts`); the session never leaves the main renderer's stores. The frame name carries the session id (`src/shared/breakout.ts`), and the renderer moves the element (`src/renderer/terminal/breakout.ts`).

This is the only option where "process, scrollback and agent state carry over unchanged" is true by construction rather than by a replay that can drift. It extends ADR 004 (one xterm per session, moved between containers) to containers in another window.

## Options considered

- **Separate renderer with serialized scrollback.** Rejected: scrollback must be serialized and replayed, output routing becomes per-session, and busy, idle, bell and choice-prompt state, computed from the xterm in the main renderer, would need a second sync path.
- **Second full app window.** Rejected: all the cost of the option above, plus a second sidebar, store and set of extension frames, and returning a session means merging two app states.
- **macOS native tabs.** Rejected: they group whole windows, not one session out of a branch, and give no control over where a session returns.

## Consequences

- One window holds one session. No tabs or splits inside a breakout window.
- A slow main renderer stalls breakout windows, as it already stalls the main window.
- Reloading the main renderer closes every breakout window; the sessions dock back.
- Closing a breakout window docks its session at its original branch and tab position. It never kills the process.
- `Cmd+W` in a breakout window closes that session, not the main window's active tab.
- `Shift+Cmd+O` toggles: it moves the focused session out, and in a breakout window moves it back.
