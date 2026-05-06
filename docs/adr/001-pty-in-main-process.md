# ADR-001: PTY Processes Run in the Electron Main Process

**Date**: 2026-05-05  
**Status**: Accepted

## Decision

All PTY processes (via `node-pty`) are spawned and managed exclusively in the Electron **main process**. The renderer process never has direct access to PTY instances. Communication between the renderer's xterm.js terminal and the main process PTY occurs through the IPC channels defined in `contracts/ipc-channels.md`.

## Motivation

1. **Security baseline**: Electron's security model requires `nodeIntegration: false` in renderer processes. Enabling it to allow PTY access would expose the full Node.js API surface to any XSS vulnerability in the renderer.

2. **Native module requirement**: `node-pty` is a native Node.js addon. Native modules require the Node.js runtime, which is only available in the main process when `contextIsolation: true` is enforced.

3. **Process lifecycle management**: The main process outlives any individual renderer window. Keeping PTY processes in main ensures they can continue running even if the renderer encounters a problem, and ensures cleanup responsibility is centralized.

## Alternatives Considered

- **`nodeIntegration: true` in renderer**: Rejected. Violates Electron security baseline (Constitution §VIII). Any content rendered in the window would have full Node.js access.
- **Separate PTY host process** (child_process): More isolated, but adds IPC complexity between main and the PTY host, with no security benefit over the main-process approach for Phase 1.

## Consequences

- All PTY I/O is asynchronous IPC. Input latency is negligible (sub-millisecond on localhost IPC).
- PTY cleanup on tab close or app exit is centralized in `src/main/terminal/pty-manager.ts`.
- Renderer tests that test terminal behavior must mock the IPC layer rather than calling PTY directly.
