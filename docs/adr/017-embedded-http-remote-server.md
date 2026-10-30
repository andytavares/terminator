# ADR-017: Embedded HTTP Server for Remote Browser Access

**Date**: 2026-06-11 (revised 2026-06-22)
**Status**: Accepted (credential handling superseded by [ADR-100](100-remote-control-credentials.md))

> **Revision history**
>
> - **2026-06-22**: The _decision_ (not a footnote) now changes the bind address from `127.0.0.1` to `0.0.0.0`. The Decision, Motivation, and Security Constraints sections below reflect the current model. A new "Threat Model & Accepted Risk" section documents what the bind change means and how the remaining controls compensate. This resolves the prior self-contradiction, where the body said "MUST bind 127.0.0.1" and an amendment said the opposite.

## Decision

Embed a Fastify HTTP + WebSocket server in the Electron **main process**. It provides browser-based remote access to Terminator's terminal sessions, workspaces, and projects. The server binds to **`0.0.0.0`**, so phones and tablets on the same LAN can connect directly. When the user enables it, an on-demand ngrok tunnel also makes it reachable off-LAN. **The bind address is not a security control.** Protection comes from the layered controls in "Threat Model & Accepted Risk" below.

## Motivation

1. **PTY is already in main process** (ADR-001): `PtyManager` in the main process handles all PTY lifecycle management. The HTTP server calls `ptyManager.spawn()`, `.write()`, `.kill()`, and `.resize()` directly. No second IPC hop is needed or possible (there is no supported way to invoke `ipcMain.handle` from main itself).

2. **On-demand activation**: The feature is off by default. The server only starts when the user explicitly enables it. This confines the security surface to an opt-in configuration.

3. **Direct LAN access**: Binding `0.0.0.0` lets a phone or tablet on the same network open `/mobile/` or `/app/` against the host's LAN IP without routing through ngrok. The earlier `127.0.0.1`-only design forced even same-room devices through a public tunnel. That was slower and a _larger_ internet exposure than a LAN bind. The trade is that any device on the local network can now reach the listener. See the threat model.

4. **Single process simplicity**: Running the HTTP server in the existing main process avoids the IPC complexity of a separate Node.js sidecar process. It still fully isolates the server from the renderer (the browser SPA is a separate Vite bundle with no access to Electron APIs).

## Alternatives Considered

- **Keep `127.0.0.1`-only + ngrok for all remote access**: Simpler threat model (loopback bind). Every remote device, including ones on the same WiFi, must then traverse a public ngrok tunnel. That is slower and exposes traffic to a third party. Rejected in favor of direct LAN access guarded by auth.

- **Separate Node.js sidecar process** (child_process): Stronger isolation, but it requires a full IPC bridge between the sidecar and the main process to access `PtyManager` and `workspaceStore`. The added complexity brings no security benefit given the auth controls below.

- **Electron `remote` module**: Deprecated and removed in Electron 14+. Not viable.

- **Express instead of Fastify**: Express has been in maintenance mode since 2015 (single maintainer). Fastify has multiple maintainers, is TypeScript-first, and provides a built-in `inject()` test API. `inject()` enables full route testing without a live port, which is critical to meet the 80% coverage gate (Constitution §VI).

## Security Constraints

- The server binds to `0.0.0.0`. Security explicitly does NOT rely on the bind address.
- The server MUST validate every protected request (`/api/*`, `/ws/*`) against a bcrypt-hashed password (work factor 10). The WebSocket upgrade routes are the exception: they authenticate via single-use ticket.
- The server MUST rate-limit failed password attempts per client IP. After 10 failures within 15 minutes, it locks the client out (HTTP 429) until the window drains (`auth-rate-limiter.ts`). This makes a single shared password tolerable on a network-reachable listener.
- The server MUST check the `Host` header on every protected request (allowlist: loopback, RFC-1918 private ranges, ngrok domains) to prevent DNS-rebinding attacks. It rejects a missing `Host`.
- WebSocket upgrades require a short-lived (30s), single-use ticket, so the password never appears in server logs or URLs.
- A dedicated HttpOnly SameSite=Strict session cookie (8h TTL) gates `/app/` and `/mobile/` static assets. The server issues it only after it consumes a valid one-time ticket.
- The IPC bridge (`/api/bridge`) is **default-deny**: only channels in the central allowlist (`src/main/remote/remote-accessible-channels.ts`) may be invoked, sent, or subscribed. See "Threat Model" for what that allowlist intentionally includes.
- The app spawns ngrok as a child process and kills it when the feature is disabled. The public URL exists only while the feature is active.

## Threat Model & Accepted Risk

**Exposure.** With a `0.0.0.0` bind, these parties can reach the listener:

1. Any device on the same LAN (the intended use), and
2. Anyone with the ngrok URL while the tunnel is active.

**Trust boundary.** The single shared bcrypt password is the primary credential. Defense in depth comes from: the per-IP rate limiter (brute-force resistance), the `Host`-header check (DNS-rebinding resistance), single-use tickets (no password in logs/URLs), and HttpOnly session cookies (no token in JS-reachable storage for the static surfaces).

**`/app/` is full remote control by design.** The `/app/` surface serves the entire Electron renderer in the browser. Its bridge allowlist therefore intentionally includes the channels the app needs to function, including `shell:exec`. `shell:exec` remains sandboxed (command allowlist `git`/`gh`, cwd-pinned, `shell: false`; see ADR-006). Even so, an authenticated remote client _can_ run `git`/`gh` as the user, including `gh` acting on the user's GitHub account.

**Accepted risk.** An attacker who (a) reaches the listener and (b) brute-forces or otherwise obtains the password gains full remote control of the app, including sandboxed `git`/`gh` execution. The team accepts this because the feature is opt-in, off by default, password-gated, rate-limited, and intended for a single trusted user who accesses their own machine. Users who expose the tunnel publicly should treat the password as a high-value secret. **The allowlist deliberately excludes internal channels that the browser does not need (e.g. `dialog:*`, `remote:*` server controls, `db:health`). No browser client can reach them.**

## Consequences

- The Electron app gains three new npm dependencies: `fastify`, `@fastify/websocket`, `@fastify/static`.
- The decision adds a second Vite renderer entry (`src/renderer-remote/`) for the browser SPA. This bundle uses `@xterm/xterm@6` (new package namespace) independently of the Electron renderer's `xterm@5`.
- The `before-quit` handler calls `ExtensionHost.unloadAll()` before `ptyManager.killAll()`. The remote server (and ngrok) therefore stop in the correct order as part of extension teardown.
- All new files in `extensions/remote-control/` must reach ≥80% test coverage before merge.
- One place makes the remote attack surface auditable: the allowlist set in `src/main/remote/remote-accessible-channels.ts`. A test asserts that it stays in sync with what the `/app/` shim actually uses.
