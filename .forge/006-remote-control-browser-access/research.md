# PRD: Remote Control / Browser Access for Terminator

**Feature:** Remote Control — Browser-Based Terminal & App Access  
**Status:** Research / Pre-implementation  
**Branch:** remote-control  
**Authored:** 2026-06-11

---

## Executive Summary

Terminator is an Electron desktop app where all terminal I/O, PTY lifecycle management, git operations, workspace state, and task data live exclusively in the Electron main process and are surfaced to the local renderer via a typed IPC layer. This feature adds a **password-protected HTTP + WebSocket server** embedded in the main process, exposed to the internet via a **Cloudflare Tunnel** (or ngrok/Caddy as alternatives), enabling users to interact with their Terminator environment — open terminals, view workspaces, monitor git state — from any browser on any device without installing Electron.

---

## Problem Statement

When away from the primary machine, users have no way to access their live Terminator environment (running terminals, tasks, git state). The Electron client cannot be used remotely. The goal is to expose the full Terminator UX (terminal streaming, project navigation, task management) through a standard web browser, secured so only the owner can connect.

---

## Relevant Codebase Files

| File                                                           | Note                                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `package.json`                                                 | Confirms `node-pty 1.0.0`, `xterm 5.3.0`, `xterm-addon-fit 0.8.0`, `zod 3.23.8`; no HTTP server deps today |
| `src/main/index.ts`                                            | App bootstrap: `PtyManager` singleton, all IPC handler registrations, `createWindow()` lifecycle           |
| `src/main/terminal/pty-manager.ts`                             | `PtyManager` class: `spawn()`, `write()`, `resize()`, `kill()`, `onData` callback chain                    |
| `src/main/ipc/terminal.ipc.ts`                                 | `registerTerminalHandlers` — shows how `onData` is wired to `webContents.send`                             |
| `src/main/storage/settings-store.ts`                           | `electron-store` wrapper; pattern for adding `remoteControl` settings key                                  |
| `src/shared/types/index.ts`                                    | `GlobalSettings`, `TerminalSession`, `Workspace` — data models the remote API will expose                  |
| `specs/001-extension-first-terminal/contracts/ipc-channels.md` | Full IPC channel catalogue — maps every domain to an HTTP endpoint in Phase 2                              |
| `docs/ARCHITECTURE.md`                                         | Process model diagram; PTY/IPC separation rationale                                                        |
| `docs/adr/001-pty-in-main-process.md`                          | Canonical rationale: PTY must live in main process                                                         |

---

## Architecture

### High-Level Diagram

```
Browser (any device, any location)
         │  HTTPS / WSS
         ▼
[Tunnel Endpoint] ← Cloudflare Tunnel (recommended) OR ngrok OR Caddy (LAN)
         │  HTTP + WS  (localhost only — never 0.0.0.0)
         ▼
[Fastify HTTP Server + @fastify/websocket]   ← NEW — runs in Electron main process
         │  Session token middleware (every request validated)
         │
         ├── GET  /health                    → { ok: true }
         ├── GET  /api/workspaces            → workspaceStore.getAll()
         ├── GET  /api/projects?workspaceId= → workspaceStore.getProjects()
         ├── POST /api/terminals             → ptyManager.spawn()
         ├── GET  /api/terminals/:id         → session metadata
         ├── DELETE /api/terminals/:id       → ptyManager.kill()
         ├── POST /api/terminals/:id/resize  → ptyManager.resize()
         ├── WS   /ws/terminals/:id          → ptyManager.write() + onData fan-out
         ├── GET  /api/settings              → sanitized GlobalSettings
         └── GET  /  (static)                → browser-side React SPA bundle
              └── xterm.js v6 + @xterm/addon-attach
```

The existing `PtyManager` singleton is accessed **directly** by the Fastify server — no second IPC hop. The server lives in `src/main/remote/` and is initialized alongside the IPC handlers in `app.whenReady()`.

---

## Technology Choices

### HTTP/WebSocket Server: Fastify + @fastify/websocket

**Why Fastify over Express:**

- Multi-maintainer, actively maintained — satisfies Constitution Principle IV (dependency stewardship).
- TypeScript-first with full type inference.
- `@fastify/websocket` is the official plugin, built on `ws@8` (well-maintained, multi-maintainer).
- Fastify's `inject()` API enables full route testing without binding a real port — critical for meeting the 80% coverage gate.
- Express has been in maintenance mode since 2015.

Source: https://fastify.dev/docs/latest/Guides/Getting-Started/  
Quote: _"Fastify parses 'application/json' and 'text/plain' request payloads natively... everything is a plugin."_

Source: https://github.com/fastify/fastify-websocket  
Quote: _"@fastify/websocket provides WebSocket support for Fastify. Built upon ws@8. WebSocket route handlers receive the WebSocket socket connection and the Fastify request object."_

### Tunneling: On-Demand Model (Toggle On/Off)

**Design principle:** Remote Control is an opt-in, on-demand feature — not always-on infrastructure. When the user enables it in Settings, Terminator starts both the Fastify HTTP server AND a tunnel process. When the user disables it, both are stopped and the public URL disappears. No persistent DNS records, no account config required.

The tunnel process is spawned as a child process by the Electron main process and killed when the feature is toggled off or the app quits.

#### Tunneling: ngrok

```bash
ngrok http 7681
```

- Generates a random HTTPS URL per session (e.g. `https://a1b2c3d4.ngrok-free.app`).
- Terminator spawns `ngrok` as a child process and reads the active public URL from the ngrok local API (`http://localhost:4040/api/tunnels`) — no stdout parsing required.
- When the user disables Remote Control, Terminator kills the ngrok process — the URL is immediately gone.
- New random URL on every enable — intentional, reduces the surface for enumeration.
- Installation: `brew install ngrok` (Homebrew) or download from ngrok.com.

Source: https://ngrok.com/docs/getting-started/  
Quote: _"ngrok creates a public HTTPS endpoint that routes incoming traffic to your local service, with a valid certificate that ngrok automatically manages for you. All accounts come with a free dev domain."_

Source: https://ngrok.com/docs/agent/api/  
Quote: _"The ngrok agent API is exposed on localhost:4040. GET /api/tunnels returns all running tunnels with their public URLs."_

**URL discovery flow:**

1. Terminator spawns `ngrok http <port>` as a child process.
2. Polls `http://localhost:4040/api/tunnels` (max 10 attempts, 500ms apart) until the tunnel is up.
3. Extracts `tunnels[0].public_url` from the JSON response and displays it in the Settings UI.
4. On disable, sends `SIGTERM` to the ngrok process.

**LAN-only (no tunnel):** For users on the same network, the feature works without any tunnel — the local URL `http://localhost:7681` (or the machine's LAN IP) is all that's needed. Terminator displays the LAN URL alongside the tunnel URL in Settings. Optionally Caddy can be used for HTTPS on LAN.

Source: https://caddyserver.com/docs/caddyfile/directives/basicauth  
Quote: _"Caddy's basic_auth directive protects resources by requiring username and password credentials. Passwords must be hashed — use the caddy hash-password command. Basic auth is not secure over plain HTTP."_

Caddy is the right choice when no public internet access is needed (home network, office LAN). Terminator generates a ready-to-use Caddyfile template in the Settings UI.

### Terminal Streaming: node-pty + xterm.js v6 + @xterm/addon-attach

The existing `PtyManager.onData` callback is a clean injection point — the remote WebSocket server registers a second `onData` subscriber per session and forwards bytes to connected WebSocket clients. No changes to `PtyManager` are needed.

Source: https://github.com/microsoft/node-pty  
Quote: _"node-pty provides forkpty(3) bindings for node.js... Wetty — Browser based Terminal over HTTP and HTTPS."_

Source: https://github.com/xtermjs/xterm.js/tree/master/addons/addon-attach  
Quote: _"The attach addon enables attaching to a web socket. `const attachAddon = new AttachAddon(webSocket); terminal.loadAddon(attachAddon)`."_

**Note on xterm.js versioning:** The Electron renderer uses `xterm@5.3.0` (legacy package name). The browser remote SPA must use `@xterm/xterm@6` (new namespace) + `@xterm/addon-attach@6`. These are separate bundles and do not conflict. Both must be pinned to the same major version.

---

## Security Model

### Three-Layer Defense in Depth

**Layer 1 — User-configurable password with random fallback (mandatory, all scenarios)**

The user can set a custom password in Settings. If no password is set, Terminator automatically generates a cryptographically random one on first enable:

```typescript
// On enable, if no password is stored:
const password = settings.remoteControl.password || crypto.randomBytes(16).toString('base64url')
```

The password is stored in `electron-store` under `remote-control.password`. A bcrypt hash of the password is what gets compared at request time — the plaintext is only ever stored locally in `electron-store` (same threat model as any local secrets manager).

Every HTTP request and WebSocket upgrade must carry this password in `Authorization: Bearer <password>`. Missing or wrong password → HTTP 401. The password is always visible in Settings (since it's a local secret the user needs to copy to their browser).

**Password UX rules:**

- Settings UI shows the current password in a masked field with a show/copy button.
- "Generate new" button replaces it with a fresh random password and disconnects all active WebSocket clients.
- If the user clears the field and saves, a new random password is auto-generated (never allow an empty/no-password state).
- The generated random password uses `base64url` encoding (e.g. `mK9xP2-vQrTs4nLw`) — memorable enough to type manually if needed, but not guessable.

**Layer 2 — Tunnel-layer authentication (Cloudflare Access or ngrok policies)**

When using Cloudflare Tunnel, Cloudflare Access email-OTP or OAuth is configured in the Cloudflare dashboard. The tunnel never reaches the Terminator server unless the user passes this gate. This is defense-in-depth — even if someone obtains the tunnel URL, they face a second auth layer.

**Layer 3 — Caddy BasicAuth (LAN-only)**

For LAN use without a public tunnel, Caddy reverse-proxies `localhost:<port>` and enforces bcrypt-hashed BasicAuth. Terminator provides a generated Caddyfile and a copy button in the Settings UI.

### Additional Security Hardening

- **Bind to `127.0.0.1` only** — never `0.0.0.0`. The server is never directly internet-accessible.
- **DNS rebinding protection** — `Host` header check in auth middleware: reject requests where `Host` is not `localhost`, `127.0.0.1`, or the known tunnel domain.
- **Feature off by default** — remote control is disabled until the user explicitly enables it in Settings.
- **No secrets in URLs** — session token in `Authorization` header only; WebSocket uses a short-lived one-time ticket issued via `POST /api/terminals/:id/ws-ticket` to avoid token appearing in server logs or browser history.

Source: https://www.electronjs.org/docs/latest/tutorial/security  
Quote: _"If you're running a local HTTP server for internal app communication, this presents fewer risks since it's typically not exposed to external networks. Validating all IPC communication between processes. Following the principle of minimal required access."_

---

## Acceptance Criteria

1. **Server starts on enable:** When Remote Control is enabled and settings saved, `curl http://localhost:7681/health` returns `{ "ok": true }` with HTTP 200.

2. **Session token enforcement:** `GET /api/workspaces` without a Bearer token returns HTTP 401 `{ "error": "UNAUTHORIZED" }`. Same request with the correct token returns HTTP 200 with the workspace list.

3. **Terminal create via HTTP:** `POST /api/terminals` with `{ projectId, type, cwd, tabTitle, scrollbackLimit }` and a valid Bearer token returns `{ sessionId: "<uuid>" }` with HTTP 201.

4. **Terminal streaming via WebSocket:** After creating a terminal, a WebSocket client connects to `ws://localhost:7681/ws/terminals/<sessionId>` with a valid ticket. Within 2 seconds, the browser receives shell prompt output as UTF-8 text frames. Sending `echo hello\r` causes the PTY to echo back `hello`.

5. **Terminal resize:** `POST /api/terminals/<sessionId>/resize` with `{ cols: 120, rows: 40 }` returns HTTP 200 and `ptyManager.resize` is called with those dimensions.

6. **Terminal close:** `DELETE /api/terminals/<sessionId>` returns HTTP 200 and the PTY session is removed from `ptyManager.getSessionIds()`.

7. **Workspace and project listing:** `GET /api/workspaces` matches `workspaceStore.getAll()`. `GET /api/projects?workspaceId=<id>` returns that workspace's projects.

8. **Browser SPA loads:** Navigating to `http://localhost:7681/` serves an HTML page with an xterm.js v6 terminal connected via `@xterm/addon-attach` to the WebSocket stream.

9. **Localhost-only binding:** `netstat` shows Fastify bound to `127.0.0.1:<port>`, not `0.0.0.0`.

10. **Graceful shutdown:** On Electron `before-quit`, `remoteServer.stop()` completes before `ptyManager.killAll()`. No port-in-use errors on restart.

11. **Settings persistence:** Port, enabled state, and session token survive app restart via `electron-store`.

12. **Coverage gate:** All new files in `src/main/remote/` reach ≥ 80% statement, branch, function, and line coverage.

---

## Implementation Plan

### Phase 1 — Core HTTP + WebSocket server (terminal streaming)

**New files:**

| File                                       | Purpose                                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/remote/remote-server.ts`         | Fastify instance factory; `start(ptyManager, settingsStore)` and `stop()` exports. Binds `127.0.0.1` only.                                         |
| `src/main/remote/auth.middleware.ts`       | Fastify `onRequest` hook — validates Bearer token, checks Host header for DNS rebinding protection.                                                |
| `src/main/remote/terminal.routes.ts`       | `POST /api/terminals`, `DELETE /api/terminals/:id`, `POST /api/terminals/:id/resize`, `POST /api/terminals/:id/ws-ticket`, `WS /ws/terminals/:id`. |
| `src/main/remote/workspace.routes.ts`      | `GET /api/workspaces`, `GET /api/projects`.                                                                                                        |
| `src/main/remote/static.routes.ts`         | Serves the browser SPA from `out/remote/` via `@fastify/static`.                                                                                   |
| `src/renderer-remote/`                     | Separate Vite entry point: xterm.js v6 + `@xterm/addon-attach` + minimal React shell.                                                              |
| `src/main/remote/remote-server.spec.ts`    | Route tests using `fastify.inject()` — no live port needed.                                                                                        |
| `src/main/remote/auth.middleware.spec.ts`  | Verifies 401 on missing/wrong token, 200 on correct token, DNS rebinding rejection.                                                                |
| `src/main/remote/terminal.routes.spec.ts`  | Mocks `PtyManager`, tests all terminal routes and WS stream.                                                                                       |
| `src/main/remote/workspace.routes.spec.ts` | Mocks workspace store, tests list routes.                                                                                                          |

**Modified files:**

| File                                                           | Change                                                                                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main/index.ts`                                            | Call `remoteServer.start()` inside `app.whenReady()` when `settings.remoteControl.enabled`. Call `remoteServer.stop()` in `before-quit` before `ptyManager.killAll()`.                           |
| `src/shared/types/index.ts`                                    | Add `remoteControl: { enabled: boolean; port: number; password: string }` to `GlobalSettings`. `password` is the plaintext stored locally; empty string triggers auto-generation on next enable. |
| `src/shared/schemas/settings.schema.ts`                        | Add `remoteControl` defaults (enabled: false, port: 7681, password: '').                                                                                                                         |
| `docs/ARCHITECTURE.md`                                         | Add Remote Control Server section to process model diagram.                                                                                                                                      |
| `README.md`                                                    | Add Remote Control to features list.                                                                                                                                                             |
| `docs/adr/`                                                    | New ADR-017: embedded HTTP server for remote access.                                                                                                                                             |
| `specs/001-extension-first-terminal/contracts/ipc-channels.md` | Add HTTP endpoints section.                                                                                                                                                                      |

**New npm dependencies (root `package.json`):**

```json
"fastify": "^4.28.1",
"@fastify/websocket": "^11.0.1",
"@fastify/static": "^8.0.0"
```

**New npm dependencies (browser SPA):**

```json
"@xterm/xterm": "^6.0.0",
"@xterm/addon-attach": "^0.11.0",
"@xterm/addon-fit": "^0.10.0"
```

### Phase 2 — Settings UI

Add a "Remote Control" section to the existing Settings panel:

- **Toggle to enable/disable** — starts or stops the Fastify server AND the tunnel process immediately (no restart required).
- **Port number input** (validated 1024–65535, default 7681).
- **Active tunnel URL** — displayed prominently while enabled, with a one-click copy button. Shows "No tunnel active" when disabled.
- **ngrok status indicator** — shows whether `ngrok` is installed (`which ngrok`) with a `brew install ngrok` hint if not.
- **LAN URL** — also displayed (e.g. `http://192.168.1.x:7681`) for same-network access without a tunnel.
- **Password field** — masked input; user can set a custom password or leave it to use the auto-generated one. Show/copy button alongside. "Generate new" button replaces it with a fresh random value and disconnects active clients. Clearing the field and saving auto-generates a new one — empty password is never allowed.
- **Installation status** — shows whether `cloudflared`/`ngrok` is installed with a `brew install` hint if not.

### Phase 3 — Extended API endpoints (deferred)

Map remaining IPC channels to HTTP endpoints following the same Fastify route pattern:

- `GET /api/git/branches?path=` — git branch listing.
- `POST /api/git/checkout` — branch switching.
- `GET /api/task-vault/...` — task board read operations.
- `GET /api/settings` — sanitized GlobalSettings (no secrets).

These are deferred until the core terminal streaming is stable. All new endpoints must be documented in `ipc-channels.md` before merge.

---

## Risks and Mitigations

| Risk                                       | Mitigation                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R1: Port collision** (`EADDRINUSE`)      | Catch in `start()`, surface as toast with message to change port in Settings.                                                                                                              |
| **R2: Session token in logs/history**      | Use `Authorization: Bearer` for all HTTP calls; WebSocket uses a short-lived one-time ticket endpoint.                                                                                     |
| **R3: node-pty native module**             | Already in the main process — same Node.js context, no rebuild needed. Zero risk.                                                                                                          |
| **R4: xterm.js version mismatch**          | Pin `@xterm/xterm` and `@xterm/addon-attach` to the same v6 major. Separate bundles, no conflict with Electron renderer's `xterm@5`.                                                       |
| **R5: URL changes every session**          | On-demand model means a new URL per enable. The Settings UI prominently displays the current URL with a one-click copy. This is acceptable since the user starts the tunnel intentionally. |
| **R6: CORS**                               | Browser SPA served from same origin as API — no CORS config needed for standard use.                                                                                                       |
| **R7: Coverage gate**                      | Fastify `inject()` enables full route testing. WebSocket tests use `ws` package in `devDependencies`. All new files must hit ≥ 80% before merge.                                           |
| **R8: IPC handlers not directly callable** | HTTP routes call service modules directly (`ptyManager.write()`, `workspaceStore.getAll()`) — NOT re-invoking `ipcMain.handle`. Same service layer, different caller.                      |
| **R9: DNS rebinding attacks**              | Auth middleware rejects requests where `Host` header is not `localhost`, `127.0.0.1`, or the configured tunnel domain.                                                                     |
| **R10: `before-quit` ordering**            | `remoteServer.stop()` must be awaited before `ptyManager.killAll()` to drain in-flight WebSocket connections.                                                                              |

---

## Out of Scope

- Mobile-native app (this is a browser-based web UI only).
- Multi-user / collaborative sessions (single-owner, single-session token).
- Remote file upload/download beyond what terminals naturally support.
- Remote control of the Electron window itself (maximize, minimize, etc.).
- Authentication via TOTP/2FA at the app level (Cloudflare Access handles this at the tunnel layer).
