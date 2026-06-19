# API Contract Changes: Remote Control Mobile UI

**Feature**: `specs/011-remote-control-mobile`
**Date**: 2026-06-19

---

## New Endpoints

### `GET /api/terminals`

List all active terminal sessions on the server.

**Auth**: Bearer token (same as all `/api/*` endpoints)

**Response**: `200 OK`

```json
[
  {
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "cwd": "/Users/user/repos/myproject",
    "createdAt": "2026-06-19T10:30:00.000Z"
  }
]
```

Returns `[]` when no terminals are active (not 404).

**Errors**: None beyond the global auth middleware (401/403).

---

### `POST /api/mobile-ticket`

Issue a single-use ticket for authenticating the `/mobile/` HTML page load. Mirrors `POST /api/app-ticket` exactly.

**Auth**: Bearer token

**Response**: `201 Created`

```json
{ "ticket": "<32-byte hex string>" }
```

**Notes**: Ticket is consumed exactly once on `GET /mobile/?t=<ticket>`. Unused tickets expire with the same TTL as app tickets (managed by `WsTicketStore`).

---

### `GET /mobile/`

Serve the mobile HTML page, gated behind ticket auth (same pattern as `GET /app/`).

**Query param**: `?t=<ticket>` — single-use ticket from `POST /api/mobile-ticket`

**On valid ticket**:

- Consumes the ticket.
- Sets `HttpOnly` session cookie: `mobile-session=<token>; Path=/mobile; SameSite=Strict; Max-Age=28800`
- Responds `200` with `out/renderer-remote/mobile.html` content (Fastify reads and returns the file, same pattern as `/app/`).

**On missing/invalid ticket**: `302` redirect to `/` (login page).

---

## Static File Serving

### `GET /mobile/assets/*`

Served from `out/renderer-remote/` via `@fastify/static` with prefix `/mobile`. The mobile build outputs all JS/CSS chunks into `out/renderer-remote/assets/` — the same directory as the login SPA — so no additional static registration is needed beyond registering the prefix `/mobile` pointing at `loginStaticDir`.

**Auth**: Gated by the `mobile-session` cookie check (same middleware pattern as `/app/assets/*`).

---

## Unchanged Endpoints (consumed by mobile UI)

| Method     | Path                                  | Notes                                               |
| ---------- | ------------------------------------- | --------------------------------------------------- |
| `POST`     | `/api/terminals`                      | Mobile uses this for "New Terminal"                 |
| `GET`      | `/api/terminals/:sessionId`           | Unchanged                                           |
| `DELETE`   | `/api/terminals/:sessionId`           | Unchanged                                           |
| `POST`     | `/api/terminals/:sessionId/resize`    | Mobile calls this on viewport resize                |
| `POST`     | `/api/terminals/:sessionId/ws-ticket` | Mobile fetches a WS ticket to open xterm            |
| `GET`      | `/api/workspaces`                     | Mobile uses for workspace list + "New Terminal" CWD |
| `GET`      | `/api/projects`                       | Mobile uses for project CWD selection               |
| `GET (WS)` | `/api/terminals/:sessionId`           | Terminal PTY stream                                 |

---

## Mobile Session Cookie

Mirrors the existing `app-session` pattern:

| Property | Value                                    |
| -------- | ---------------------------------------- |
| Name     | `mobile-session`                         |
| Path     | `/mobile`                                |
| HttpOnly | Yes                                      |
| SameSite | Strict                                   |
| Max-Age  | 28800 (8 hours)                          |
| Scope    | Checked on `GET /mobile/*` requests only |
