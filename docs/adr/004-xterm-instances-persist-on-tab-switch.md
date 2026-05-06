# ADR-004: xterm.js Terminal Instances Are Kept Alive on Tab Switch

**Date**: 2026-05-05  
**Status**: Accepted

## Decision

When a user navigates away from a project (switching to another project or workspace), the xterm.js `Terminal` instance for each session tab is **not destroyed**. Instead, its DOM element is detached from the visible area. When the user returns, the DOM element is re-attached to the xterm.js instance, restoring the exact buffer state, scroll position, and running PTY connection.

## Motivation

1. **Core product requirement**: FR-012 and FR-013 require that terminal sessions persist and that the terminal view is restored to its last-seen state (including scroll position and buffer) when the user returns. Destroying and recreating `Terminal` instances would lose all buffer content and PTY connection state.

2. **xterm.js architecture**: xterm.js `Terminal` objects maintain their internal buffer in memory independently of their DOM attachment. The `terminal.open(element)` call attaches to a new DOM node without resetting the buffer. This is the supported pattern for hiding/showing terminals without losing state.

3. **PTY continuity**: The PTY process in the main process continues running regardless of DOM attachment state. Output received from the PTY while the terminal is detached is still written to the `Terminal` buffer via IPC — so when the user returns, the buffer contains all output generated during their absence.

## Alternatives Considered

- **Destroy and recreate Terminal on tab switch**: Rejected. Loses buffer, scroll position, and PTY output received while away. Violates FR-012 and FR-013.
- **Serialize buffer to string on detach, restore on attach**: Complex, lossy for ANSI sequences, and slower than simply keeping the instance alive. No compelling benefit given that memory is the constraint, and SC-008 caps sessions at 20 — manageable.
- **CSS `display: none` (hide DOM, keep attached)**: xterm.js requires a visible container for resize calculations. Hidden elements have zero dimensions, breaking `xterm-addon-fit`. The detach/re-attach pattern is preferred over display:none.

## Consequences

- Each backgrounded session holds a `Terminal` instance in renderer memory (xterm.js internal buffer, ~scrollbackLimit × avg-line-size bytes). At 20 sessions × 10,000 lines × ~80 bytes ≈ ~16MB upper bound — acceptable.
- The renderer's Zustand session store maintains a `Map<sessionId, Terminal>` to look up instances for attach/detach operations.
- When a session is closed (FR-014), both the `Terminal` instance and PTY process are cleaned up immediately.
