# Data Model: Remote Control Browser Access

**Feature**: 008-remote-control-browser  
**Date**: 2026-06-11

---

## Persisted Entities (electron-store)

### RemoteControlSettings

Added to `GlobalSettings` in `src/shared/types/index.ts` and `src/shared/schemas/settings.schema.ts`.

```typescript
remoteControl: {
  enabled: boolean // Default: false. Feature is off until user enables.
  port: number // Default: 7681. Valid range: 1024–65535.
  password: string // Plaintext — shown in Settings UI. Empty string = auto-generate on enable.
  passwordHash: string // bcrypt hash (work factor 10) — used for request validation. Never exposed to UI.
}
```

**Validation rules**:

- `port` must be an integer in [1024, 65535].
- `password` empty string triggers auto-generation; empty is never persisted after enable.
- `passwordHash` is always derived from `password` — never set independently by the UI.

**State transitions**:

- `enabled: false → true`: start server + ngrok, auto-generate password if empty.
- `enabled: true → false`: stop server + ngrok, disconnect all WS clients.
- `password` changed: rehash → update `passwordHash`, disconnect all active WS clients.

---

## In-Memory Entities (remote server process lifetime)

### RemoteTerminalSession

Tracked in `WsSubscriberManager` — not persisted. Lives only while the remote server is running.

```typescript
interface RemoteTerminalSession {
  sessionId: string // UUID — same ID used in PtyManager
  cwd: string
  createdAt: Date
  subscribers: Set<WebSocket> // All connected WS clients
  primarySubscriber: WebSocket | null // First connected client — only one that may write to PTY
}
```

**State transitions**:

- Created: `POST /api/terminals` → `ptyManager.spawn()` called.
- Subscriber added: WS upgrade with valid ticket → added to `subscribers`; if first, also set as `primarySubscriber`.
- Subscriber removed: WS close/error → removed from `subscribers`; if was `primarySubscriber`, `primarySubscriber` set to `null` (next subscriber to connect becomes primary).
- Destroyed: `DELETE /api/terminals/:id` or PTY process exit → all subscribers receive close frame, session removed.

---

### WsTicket

Stored in `WsTicketStore` (module-level Map). Expires after 30 seconds. Single-use.

```typescript
interface WsTicket {
  ticket: string // 32-byte hex string (crypto.randomBytes(32).toString('hex'))
  sessionId: string // The terminal session this ticket grants access to
  expiresAt: number // Date.now() + 30_000
}
```

**State transitions**:

- Created: `POST /api/terminals/:id/ws-ticket` → inserted into store, returned to caller.
- Consumed: WS upgrade validates ticket → entry deleted (single-use).
- Expired: background interval (60s) → entries with `expiresAt < Date.now()` deleted.

---

### NgrokProcess

Managed by `NgrokManager`. Not persisted — tracked in memory.

```typescript
interface NgrokProcess {
  process: ChildProcess // The spawned ngrok child process
  publicUrl: string // e.g. "https://a1b2c3.ngrok-free.app"
  port: number
}
```

**State transitions**:

- Started: Remote Control enabled + ngrok binary found → `spawn('ngrok', ['http', port])` + poll until URL available.
- Running: URL displayed in Settings UI.
- Crashed: `process.on('exit')` fires unexpectedly → `mainWindow.webContents.send('remote:tunnel-disconnected')` + toast shown.
- Stopped: Remote Control disabled or app quit → `process.kill('SIGTERM')`.

---

## IPC Events (additions to existing channels)

### New: `log:push` (main → renderer)

Used by the remote server to emit events to the LogWindow.

```typescript
// Payload sent by main process:
{ level: 'log' | 'info' | 'warn' | 'error', message: string }
```

### New: `remote:tunnel-disconnected` (main → renderer)

Signals ngrok process crashed. Renderer shows a toast with "Reconnect" button.

```typescript
// Payload: none (void)
```

### New: `remote:tunnel-reconnect` (renderer → main)

User clicked "Reconnect" in the toast. Main process restarts ngrok.

```typescript
// Payload: none (void)
```

### New: `remote:status` (main → renderer)

Sent when Remote Control is enabled/disabled or when the tunnel URL changes. Renderer updates Settings panel.

```typescript
{
  running: boolean
  publicUrl: string | null // null when tunnel is not active
  lanUrl: string // always set when server is running, e.g. "http://192.168.1.10:7681"
  ngrokInstalled: boolean
}
```
