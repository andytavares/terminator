# Data Model: Remote Control Mobile UI

**Feature**: `specs/011-remote-control-mobile`
**Date**: 2026-06-19

## Overview

The mobile UI is a read/write client of the existing Fastify server. It introduces no new persistent storage. All state is in-memory, either in the React component tree or in the browser's `sessionStorage` (for the auth token, already established by the login flow).

---

## Server-Side Types

### TerminalSession _(existing, in `terminal.routes.ts`)_

```ts
interface TerminalSession {
  sessionId: string // UUID, PTY owner key
  cwd: string // resolved working directory path
  createdAt: string // ISO 8601 timestamp
}
```

**New usage**: `GET /api/terminals` returns `TerminalSession[]`. No field additions needed.

---

## Client-Side State (renderer-remote mobile)

### ConnectionStatus

```ts
type ConnectionStatus =
  | 'connected'
  | 'reconnecting' // actively attempting reconnect (1–3 attempts)
  | 'disconnected' // all reconnect attempts failed; shows retry button
```

**Used by**: `MobileTerminalView` and `useReconnect` hook.

---

### MobileTerminalViewState

```ts
interface MobileTerminalViewState {
  sessionId: string
  cwd: string
  status: ConnectionStatus
  reconnectAttempt: number // 0–3; resets to 0 on successful connect
}
```

**In-memory only** — lives in the `MobileTerminalView` component via `useState`. Not persisted; a full-page reload re-fetches terminals from the API.

---

### MobileAppRoute

```ts
type MobileAppRoute = { view: 'list' } | { view: 'terminal'; sessionId: string; cwd: string }
```

**Used by**: `MobileApp` root component for client-side "routing" (no router library — simple `useState` toggle between the two views).

---

## API Contract Summary

_(Full contracts in `contracts/`)_

| Method | Path                           | Auth                             | Purpose                                     |
| ------ | ------------------------------ | -------------------------------- | ------------------------------------------- |
| `GET`  | `/api/terminals`               | Bearer token (new)               | List all active terminal sessions           |
| `POST` | `/api/terminals`               | Bearer token (existing)          | Create a new terminal                       |
| `POST` | `/api/terminals/:id/ws-ticket` | Bearer token (existing)          | Get single-use WS upgrade ticket            |
| `GET`  | `/mobile/`                     | One-time ticket → session cookie | Serve mobile HTML                           |
| `POST` | `/api/mobile-ticket`           | Bearer token (new)               | Issue a one-time ticket for `/mobile/` auth |

---

## State Transitions: Terminal Connection

```
        ┌──────────┐
        │   IDLE   │  (before WS opened)
        └────┬─────┘
             │ fetch ticket + open WS
             ▼
        ┌──────────────┐
        │  CONNECTED   │  ← normal operation
        └──────┬───────┘
               │ WS closes (background / network drop)
               ▼
        ┌───────────────┐
        │ RECONNECTING  │  (attempt 1, 2, 3 — 2s between)
        └──────┬────────┘
         ╔═════╧══════╗
         ║ success    ║ failure (attempt 3)
         ▼            ▼
    CONNECTED    DISCONNECTED  → manual retry → RECONNECTING
```

---

## Entities NOT in scope

- Workspaces and Projects: consumed from existing `/api/workspaces` and `/api/projects` endpoints; no new fields.
- Auth tokens: session cookie pattern for `/mobile/` mirrors the `/app/` pattern exactly; no new token types.
- Terminal scrollback: owned by xterm.js in-memory buffer; not serialized or persisted.
