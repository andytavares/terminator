# Research: Remote Control Browser Access

**Feature**: 008-remote-control-browser  
**Date**: 2026-06-11

---

## Decision 1: PTY Fan-Out Strategy

**Decision**: Keep `PtyManager` unmodified. The remote server layer owns a `WsSubscriberManager` — an in-memory `Map<sessionId, Set<WebSocket>>`. When a remote terminal session is created, `ptyManager.spawn()` is called with an `onData` closure that broadcasts output to all subscribers in the set. The first WebSocket client to subscribe is tracked as the "primary" connection (the only one permitted to send input back to the PTY).

**Rationale**: `PtyManager.spawn()` accepts exactly one `onData` callback. A closure that internally delegates to the subscriber set is the simplest adaptation without touching `PtyManager`. This keeps the remote server fully self-contained (Constitution §II YAGNI, §VII).

**Alternatives considered**:

- Modify `PtyManager` to hold a set of subscribers internally → rejected; violates YAGNI and couples PtyManager to HTTP concerns.
- Separate PTY manager for remote sessions → no gain, just duplication.

---

## Decision 2: Password Hashing — bcryptjs

**Decision**: Use `bcryptjs` (pure-JS bcrypt, zero native compilation) with work factor 10.

**Rationale**: Electron main process CAN run native modules, but `bcrypt` (C++ addon) requires a per-Electron-version native recompile step that complicates the build. `bcryptjs` is a drop-in API-compatible pure-JS implementation with no build toolchain risk. Work factor 10 adds ~100ms hash time — imperceptible for a manual login action.

**Alternatives considered**:

- `bcrypt` (C++ native) → correct but adds native rebuild complexity with `electron-rebuild`.
- `@node-rs/bcrypt` (Rust via napi-rs) → excellent but same native compilation concern.
- Plaintext comparison → rejected; violates security spec (FR-007) and bcrypt is the standard.

---

## Decision 3: WsTicket Storage & Expiry

**Decision**: Tickets stored in a module-level `Map<string, { sessionId: string; expiresAt: number }>` inside `ws-ticket-store.ts`. A `setInterval` running every 60 seconds prunes expired entries. The interval is cleared in `remoteServer.stop()`.

**Rationale**: No persistence needed — tickets are ephemeral and worthless after 30 seconds. An in-memory map is the simplest correct implementation (Constitution §V). No external dependency required.

**Alternatives considered**:

- Redis / SQLite → massively over-engineered for sub-30s single-process tokens.
- Store on the Fastify request context → not suitable, tickets are created before the WS upgrade.

---

## Decision 4: ngrok Process Management

**Decision**: `child_process.spawn('ngrok', ['http', String(port)])` (no shell). Poll `http://localhost:4040/api/tunnels` with up to 10 attempts spaced 500ms apart. Extract `tunnels[0].public_url` from the JSON response. On disable or app quit, send `SIGTERM` to the child process.

**Rationale**: ngrok's local agent REST API (`localhost:4040/api/tunnels`) is the official stable interface for reading the tunnel URL. stdout parsing is fragile and format-dependent. The polling approach (10 × 500ms = max 5s wait) matches the SC-001 "connected in 30 seconds" target.

**Alternatives considered**:

- Parse stdout for the URL line → brittle, breaks with ngrok version changes.
- `ngrok` Node.js SDK (`@ngrok/ngrok`) → adds a dependency when spawning the binary achieves the same result.

---

## Decision 5: LAN URL Detection

**Decision**: Use `os.networkInterfaces()` to find the first non-loopback, non-internal IPv4 address. Fall back to `127.0.0.1` if none found.

**Rationale**: Node.js stdlib — no dependency needed (Constitution §IV: "stdlib MUST be used when it fully satisfies the requirement").

---

## Decision 6: Browser SPA Build Entry

**Decision**: Add `src/renderer-remote/` as a second renderer entry in `electron.vite.config.ts`. The SPA uses `@xterm/xterm@6`, `@xterm/addon-attach`, and `@xterm/addon-fit`. It is built to `out/renderer-remote/` and served by `@fastify/static` from the remote server's static route.

**Rationale**: `electron-vite` natively supports multiple renderer entry points via the `renderer` array config. This keeps the remote SPA entirely separate from the Electron renderer bundle — no shared Vite chunks, no risk of cross-contaminating the `xterm@5` / `@xterm/xterm@6` package namespaces.

**Alternatives considered**:

- Serve from the same renderer bundle → namespace collision between `xterm@5` (Electron renderer) and `@xterm/xterm@6` (browser SPA).
- Separate npm workspace → unnecessary complexity; same repo entry point is sufficient.

---

## Decision 7: Main-Process → LogWindow Bridge

**Decision**: The remote server uses `makeLogger('remote-control')` (existing logger) for file logging AND calls `mainWindow?.webContents.send('log:push', { level, message })` to push log entries to the renderer's LogWindow in real time.

The renderer adds a listener for `log:push` in `App.tsx` (or a dedicated effect) that calls `useLogStore().addEntry(level, message)`.

**Rationale**: The `LogWindow` reads from `useLogStore` (Zustand). The log store's `addEntry` is the correct integration point. The existing `installLogInterceptor()` only intercepts renderer `console.*` calls — it does not receive main-process events. A dedicated `log:push` IPC event is the minimal bridge (Constitution §V: least code).

**Alternatives considered**:

- Write to file only (existing `logger.ts`) → satisfies file logging but does not meet SC-009 (LogWindow visibility).
- Overloading `log:write` (renderer→main) → wrong direction.

---

## Decision 8: Settings Schema Migration

**Decision**: Add `remoteControl` to `GlobalSettings` and `GlobalSettingsSchema` (Zod). The new fields: `enabled: boolean`, `port: number`, `password: string` (plaintext, for display), `passwordHash: string` (bcrypt hash, for comparison). Default: `{ enabled: false, port: 7681, password: '', passwordHash: '' }`.

**Rationale**: Storing both plaintext (for display in Settings UI) and bcrypt hash (for fast comparison without rehashing on every request) follows the same pattern as any local secrets manager. The plaintext is only ever in `electron-store` on the local machine.

**Alternatives considered**:

- Rehash on every request comparison → ~100ms per request at work factor 10, unacceptable.
- Store hash only, not plaintext → user cannot see/copy their password from Settings UI, violating FR-023.

---

## Decision 9: Port Change While Server is Running

**Decision**: When the user changes the port in Settings while the remote server is running, the system automatically restarts the server on the new port. The sequence: stop server on old port → start server on new port → restart ngrok if active → push updated URLs via `remote:status` IPC and show a toast. No manual toggle required.

**Rationale**: FR-020 establishes the principle that Remote Control changes take effect immediately without an app restart. Applying the same principle to port changes gives a consistent, predictable UX. A "deferred / requires manual toggle" approach would violate FR-020's spirit and confuse users who change the port and see the old URL still displayed.

**Alternatives considered**:

- Defer to manual toggle — requires user to toggle off/on; creates a confusing intermediate state where the displayed port doesn't match the running server.
- Disable the port field while running — prevents configuration without stopping service; adds UI complexity.

---

## Decision 10: ngrok Management Port

**Decision**: `NgrokManager.start()` always passes `--web-addr 0.0.0.0:4041` when spawning ngrok. Terminator polls `http://localhost:4041/api/tunnels` (not 4040) for the tunnel URL.

**Rationale**: ngrok's default management port is 4040. If the user has an existing ngrok session for another project, port 4040 is occupied and Terminator's URL polling would either fail or return the wrong tunnel's URL. Pinning Terminator's management port to 4041 costs one CLI flag and eliminates the conflict entirely.

Source: https://ngrok.com/docs/agent/config/#web_addr  
Quote: _"web_addr: networkAddress — Address to serve the local web interface and api on. Defaults to 127.0.0.1:4040."_

**Alternatives considered**:

- Accept the collision risk → wrong URL silently served, support burden.
- Detect 4040 in use and surface a toast → blocks the user unnecessarily; they may not know why.
- User-configurable management port → adds Advanced Settings complexity for a problem the user shouldn't need to know about.

---

## Decision 11: Max Concurrent WebSocket Subscribers

**Decision**: `maxSubscribers` is a user-configurable setting (default: 5, valid range: 1–20) stored in `RemoteControlSettings`. `WsSubscriberManager.addSubscriber()` checks the current count before adding. If the cap is reached, the WebSocket connection is rejected with close code `4003` (subscriber limit reached) and the event is logged.

**Rationale**: An authenticated attacker with the ngrok URL and password could open unlimited WebSocket connections to a single terminal session, causing unbounded memory growth. A configurable cap (not hardcoded) lets power users who legitimately need more than 5 observers (e.g., classroom demos) raise the limit, while the default 5 protects against accidental or malicious flooding. `maxSubscribers` changes apply to new connections only — existing subscribers are not disconnected.

**Alternatives considered**:

- No cap (unlimited) → DoS vector; memory grows unbounded with no visibility.
- Hardcoded cap of 2 or 5 → inflexible; legitimate broadcast use cases blocked.
- Hardcoded cap of 5 (non-configurable) → simpler, but power users would need to fork or patch.
