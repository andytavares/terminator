# ADR-001: PTY Processes Run in the Electron Main Process

**Date**: 2026-05-05  
**Status**: Accepted

## Decision

The Electron **main process** spawns and manages all PTY processes (via `node-pty`). The renderer process never has direct access to PTY instances. The renderer's xterm.js terminal and the main process PTY communicate through the IPC channels defined in `contracts/ipc-channels.md`.

## Motivation

1. **Security baseline**: Electron's security model requires `nodeIntegration: false` in renderer processes. If it were enabled for PTY access, any XSS vulnerability in the renderer would expose the full Node.js API surface.

2. **Native module requirement**: `node-pty` is a native Node.js addon. Native modules need the Node.js runtime. With `contextIsolation: true` enforced, only the main process has that runtime.

3. **Process lifecycle management**: The main process outlives any individual renderer window. PTY processes in main continue to run if the renderer has a problem. Cleanup responsibility stays in one place.

## Alternatives Considered

- **`nodeIntegration: true` in renderer**: Rejected. It violates the Electron security baseline (Constitution §VIII). Any content in the window would have full Node.js access.
- **Separate PTY host process** (child_process): More isolated, but it adds IPC complexity between main and the PTY host. It gives no security benefit over the main-process approach for Phase 1.

## Consequences

- All PTY I/O is asynchronous IPC. Input latency is negligible (sub-millisecond on localhost IPC).
- `src/main/terminal/pty-manager.ts` handles PTY cleanup on tab close or app exit.
- Renderer tests of terminal behavior must mock the IPC layer. They must not call the PTY directly.
