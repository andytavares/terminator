# ADR-017: Embedded HTTP Server for Remote Browser Access

**Date**: 2026-06-11  
**Status**: Accepted

## Decision

Embed a Fastify HTTP + WebSocket server in the Electron **main process** to provide browser-based remote access to Terminator's terminal sessions, workspaces, and projects. The server binds to `127.0.0.1` only and is exposed to the public internet via an on-demand ngrok tunnel when the user enables the feature.

## Motivation

1. **PTY is already in main process** (ADR-001): All PTY lifecycle management lives in `PtyManager` in the main process. The HTTP server calls `ptyManager.spawn()`, `.write()`, `.kill()`, and `.resize()` directly — no second IPC hop is needed or possible (there is no supported way to invoke `ipcMain.handle` from main itself).

2. **On-demand activation**: The feature is off by default. The server only starts when the user explicitly enables it. This contains the security surface to an opt-in configuration.

3. **Localhost-only binding**: The server is never directly internet-accessible. The only external entry point is the ngrok tunnel (or LAN access for same-network use). This matches the threat model documented in the Electron security guide.

4. **Single process simplicity**: Running the HTTP server in the existing main process avoids the IPC complexity of a separate Node.js sidecar process, while still achieving full isolation from the renderer (the browser SPA is a separate Vite bundle with no access to Electron APIs).

## Alternatives Considered

- **Separate Node.js sidecar process** (child_process): Stronger isolation, but requires a full IPC bridge between the sidecar and the main process to access `PtyManager` and `workspaceStore`. The added complexity brings no security benefit given that the server already binds to localhost only.

- **Electron `remote` module**: Deprecated and removed in Electron 14+. Not viable.

- **Express instead of Fastify**: Express has been in maintenance mode since 2015 (single maintainer). Fastify is multi-maintainer, TypeScript-first, and provides a built-in `inject()` test API that enables full route testing without a live port — critical for meeting the 80% coverage gate (Constitution §VI).

## Security Constraints

- Server MUST bind to `127.0.0.1`, never `0.0.0.0`.
- Every protected request MUST be validated against a bcrypt-hashed password.
- `Host` header checked on every request to prevent DNS rebinding attacks.
- WebSocket upgrades require a short-lived (30s), single-use ticket to avoid the password appearing in server logs.
- ngrok is spawned as a child process and killed when the feature is disabled — the public URL exists only while the feature is active.

## Consequences

- The Electron app gains three new npm dependencies: `fastify`, `@fastify/websocket`, `@fastify/static`.
- A second Vite renderer entry (`src/renderer-remote/`) is added for the browser SPA. This bundle uses `@xterm/xterm@6` (new package namespace) independently of the Electron renderer's `xterm@5`.
- The `before-quit` handler must be updated to stop the remote server before `ptyManager.killAll()`.
- All new files in `src/main/remote/` must reach ≥80% test coverage before merge.
