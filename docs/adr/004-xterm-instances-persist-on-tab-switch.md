# ADR-004: xterm.js Terminal Instances Are Kept Alive on Tab Switch

**Date**: 2026-05-05  
**Status**: Accepted

## Decision

When a user navigates away from a project (switching to another project or workspace), the app does **not** destroy the xterm.js `Terminal` instance for each session tab. Instead, it detaches the instance's DOM element from the visible area. When the user returns, the app re-attaches the DOM element to the xterm.js instance. This restores the exact buffer state, scroll position, and running PTY connection.

## Motivation

1. **Core product requirement**: FR-012 and FR-013 require that terminal sessions persist. They also require that the terminal view returns to its last-seen state (including scroll position and buffer) when the user comes back. Destroying and recreating `Terminal` instances would lose all buffer content and PTY connection state.

2. **xterm.js architecture**: xterm.js `Terminal` objects keep their internal buffer in memory, independent of DOM attachment. The `terminal.open(element)` call attaches to a new DOM node without resetting the buffer. This is the supported pattern to hide and show terminals without losing state.

3. **PTY continuity**: The PTY process in the main process keeps running regardless of DOM attachment state. While the terminal is detached, IPC still writes PTY output to the `Terminal` buffer. When the user returns, the buffer contains all output generated during their absence.

## Alternatives Considered

- **Destroy and recreate Terminal on tab switch**: Rejected. It loses the buffer, the scroll position, and PTY output received while away. It violates FR-012 and FR-013.
- **Serialize buffer to string on detach, restore on attach**: Complex, lossy for ANSI sequences, and slower than keeping the instance alive. It has no compelling benefit, because memory is the constraint and SC-008 caps sessions at 20, which is manageable.
- **CSS `display: none` (hide DOM, keep attached)**: xterm.js needs a visible container for resize calculations. Hidden elements have zero dimensions, which breaks `xterm-addon-fit`. The detach/re-attach pattern is preferred over display:none.

## Consequences

- Each backgrounded session holds a `Terminal` instance in renderer memory (xterm.js internal buffer, ~scrollbackLimit × avg-line-size bytes). At 20 sessions × 10,000 lines × ~80 bytes, the upper bound is ~16MB, which is acceptable.
- The renderer's Zustand session store keeps a `Map<sessionId, Terminal>` to look up instances for attach/detach operations.
- When a session is closed (FR-014), the app cleans up both the `Terminal` instance and the PTY process immediately.
