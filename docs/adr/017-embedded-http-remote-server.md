# ADR-017: Embedded HTTP Server for Remote Browser Access

**Date**: 2026-06-11 (revised 2026-06-22)
**Status**: Accepted

> **Revision history**
>
> - **2026-06-22**: Bind address changed from `127.0.0.1` to `0.0.0.0` as the _decision_ (not a footnote). The Decision, Motivation, and Security Constraints sections below reflect the current model; a new "Threat Model & Accepted Risk" section documents what the bind change means and how the remaining controls compensate. Resolves the prior self-contradiction where the body said "MUST bind 127.0.0.1" while an amendment said the opposite.

## Decision

Embed a Fastify HTTP + WebSocket server in the Electron **main process** to provide browser-based remote access to Terminator's terminal sessions, workspaces, and projects. The server binds to **`0.0.0.0`** so phones and tablets on the same LAN can connect directly, and it is additionally reachable off-LAN via an on-demand ngrok tunnel when the user enables it. **The bind address is not a security control** — protection comes from the layered controls in "Threat Model & Accepted Risk" below.

## Motivation

1. **PTY is already in main process** (ADR-001): All PTY lifecycle management lives in `PtyManager` in the main process. The HTTP server calls `ptyManager.spawn()`, `.write()`, `.kill()`, and `.resize()` directly — no second IPC hop is needed or possible (there is no supported way to invoke `ipcMain.handle` from main itself).

2. **On-demand activation**: The feature is off by default. The server only starts when the user explicitly enables it. This contains the security surface to an opt-in configuration.

3. **Direct LAN access**: Binding `0.0.0.0` lets a phone/tablet on the same network open `/mobile/` or `/app/` against the host's LAN IP without routing through ngrok. The earlier `127.0.0.1`-only design forced even same-room devices through a public tunnel, which was both slower and a _larger_ internet exposure than a LAN bind. The trade is that the listener is now reachable by any device on the local network — see the threat model.

4. **Single process simplicity**: Running the HTTP server in the existing main process avoids the IPC complexity of a separate Node.js sidecar process, while still achieving full isolation from the renderer (the browser SPA is a separate Vite bundle with no access to Electron APIs).

## Alternatives Considered

- **Keep `127.0.0.1`-only + ngrok for all remote access**: Simpler threat model (loopback bind), but every remote device — including ones on the same WiFi — must traverse a public ngrok tunnel, which is slower and exposes traffic to a third party. Rejected in favor of direct LAN access guarded by auth.

- **Separate Node.js sidecar process** (child_process): Stronger isolation, but requires a full IPC bridge between the sidecar and the main process to access `PtyManager` and `workspaceStore`. The added complexity brings no security benefit given the auth controls below.

- **Electron `remote` module**: Deprecated and removed in Electron 14+. Not viable.

- **Express instead of Fastify**: Express has been in maintenance mode since 2015 (single maintainer). Fastify is multi-maintainer, TypeScript-first, and provides a built-in `inject()` test API that enables full route testing without a live port — critical for meeting the 80% coverage gate (Constitution §VI).

## Security Constraints

- Server binds to `0.0.0.0`. The bind address is explicitly NOT relied on for security.
- Every protected request (`/api/*`, `/ws/*`) MUST be validated against a bcrypt-hashed password (work factor 10), except the WebSocket upgrade routes which authenticate via single-use ticket.
- Failed password attempts MUST be rate-limited per client IP — after 10 failures within 15 minutes the client is locked out (HTTP 429) until the window drains (`auth-rate-limiter.ts`). This is what makes a single shared password tolerable on a network-reachable listener.
- `Host` header MUST be checked on every protected request (allowlist: loopback, RFC-1918 private ranges, ngrok domains) to prevent DNS-rebinding attacks. A missing `Host` is rejected.
- WebSocket upgrades require a short-lived (30s), single-use ticket so the password never appears in server logs or URLs.
- `/app/` and `/mobile/` static assets are gated behind a dedicated HttpOnly SameSite=Strict session cookie (8h TTL) issued only after a valid one-time ticket is consumed.
- The IPC bridge (`/api/bridge`) is **default-deny**: only channels in the central allowlist (`src/main/remote/remote-accessible-channels.ts`) may be invoked/sent/subscribed. See "Threat Model" for what that allowlist intentionally includes.
- ngrok is spawned as a child process and killed when the feature is disabled — the public URL exists only while the feature is active.

## Threat Model & Accepted Risk

**Exposure.** With a `0.0.0.0` bind, the listener is reachable by:

1. Any device on the same LAN (the intended use), and
2. Anyone with the ngrok URL while the tunnel is active.

**Trust boundary.** The single shared bcrypt password is the primary credential, defended in depth by: the per-IP rate limiter (brute-force resistance), the `Host`-header check (DNS-rebinding resistance), single-use tickets (no password in logs/URLs), and HttpOnly session cookies (no token in JS-reachable storage for the static surfaces).

**`/app/` is full remote control by design.** The `/app/` surface serves the entire Electron renderer in the browser, so its bridge allowlist intentionally includes the channels the app needs to function — including `shell:exec`. `shell:exec` remains sandboxed (command allowlist `git`/`gh`, cwd-pinned, `shell: false`; see ADR-006), but an authenticated remote client _can_ run `git`/`gh` as the user — including `gh` acting on the user's GitHub account.

**Accepted risk.** An attacker who (a) reaches the listener and (b) brute-forces or otherwise obtains the password gains full remote control of the app, including sandboxed `git`/`gh` execution. This is accepted because the feature is opt-in, off by default, password-gated, rate-limited, and intended for a single trusted user accessing their own machine. Users exposing the tunnel publicly should treat the password as a high-value secret. **Internal channels not needed by the browser (e.g. `dialog:*`, `remote:*` server controls, `db:health`) are deliberately excluded from the allowlist and remain unreachable from any browser client.**

## Consequences

- The Electron app gains three new npm dependencies: `fastify`, `@fastify/websocket`, `@fastify/static`.
- A second Vite renderer entry (`src/renderer-remote/`) is added for the browser SPA. This bundle uses `@xterm/xterm@6` (new package namespace) independently of the Electron renderer's `xterm@5`.
- The `before-quit` handler calls `ExtensionHost.unloadAll()` before `ptyManager.killAll()`, so the remote server (and ngrok) stop in the correct order as part of extension teardown.
- All new files in `extensions/remote-control/` must reach ≥80% test coverage before merge.
- The remote attack surface is auditable in exactly one place — the allowlist set in `src/main/remote/remote-accessible-channels.ts`, with a test asserting it stays in sync with what the `/app/` shim actually uses.
