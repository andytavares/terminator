# ADR 126: A session breaks out into a child window

**Status**: Accepted

**Date**: 2026-10-23

Extends ADR 004 (xterm instances persist on tab switch).

## Context

Every terminal session is a tab in the one Terminator window. To watch two sessions on different screens, or to keep the terminal of an agent visible while you work in another branch, the only tool is a split pane inside the same window. A session must move into its own window, by shortcut or by dragging its tab out, and come back to the branch it left. Its process, scrollback and agent state must survive both moves.

## Decision

A breakout window is a same-process child of the main window, opened with `window.open`. It holds the existing xterm element of the session, moved from the page of the main window into the page of the child. Main only allows, sizes and tracks the window (`src/main/breakout-windows.ts`). The session never leaves the stores of the main renderer. The frame name carries the session id (`src/shared/breakout.ts`), and the renderer moves the element (`src/renderer/terminal/breakout.ts`).

This is the only option where "process, scrollback and agent state carry over unchanged" is true by construction, and not by a replay that can drift. It extends ADR 004 (one xterm per session, moved between containers) to containers in another window.

## Options considered

- **Separate renderer with serialized scrollback.** Rejected. The app must serialize and replay the scrollback. Output routing becomes per-session. The busy, idle, bell and choice-prompt state is computed from the xterm in the main renderer, so it would need a second sync path.
- **Second full app window.** Rejected. It has all the cost of the option above, plus a second sidebar, store and set of extension frames. Returning a session means merging two app states.
- **macOS native tabs.** Rejected. They group whole windows, not one session out of a branch, and give no control over where a session returns.

## Consequences

- One window holds one session. A breakout window has no tabs or splits.
- A slow main renderer stalls breakout windows, as it already stalls the main window.
- Reloading the main renderer closes every breakout window. The sessions dock back.
- Closing a breakout window docks its session at its original branch and tab position. It never kills the process.
- `Cmd+W` in a breakout window closes that session, not the active tab of the main window.
- `Shift+Cmd+O` toggles. It moves the focused session out. In a breakout window, it moves the session back.

## Amendment, 2026-10-24: a tab drag follows the pointer, not HTML drag and drop

The first version dragged tabs with HTML drag and drop. At `dragend`, it asked main where the cursor was. On macOS, an unaccepted drop slides back to its start before `dragend` fires. The cursor that the app reads at that point is wherever the hand has moved since. A tab released outside the window counted as dropped inside, and nothing opened.

A tab drag now captures the pointer (`src/renderer/terminal/tab-drag.ts`). The release reports at once, with its own screen position, even outside the window. Every Terminator window belongs to this renderer. So a rectangle test here decides whether that point is over a window, and the main-process check is gone. Escape cancels a drag. The same drag reorders tabs and docks the tab of a breakout window over the main window.

Moving a terminal between windows also exposed an xterm 6.0.0 bug. A frame requested in a window that then closes never runs, and a pending frame blocks every later refresh, so the terminal stopped drawing. `patches/@xterm+xterm+6.0.0.patch` (patch-package) requests the frame again in the new window. Check the patch on every xterm upgrade. The bug is still in 6.1.0-beta.315.
