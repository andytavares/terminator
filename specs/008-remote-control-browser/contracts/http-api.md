# HTTP API Contract: Remote Control Server

**Feature**: 008-remote-control-browser  
**Base URL**: `http://127.0.0.1:<port>` (default port: 7681)  
**Authentication**: All endpoints except `/health` require `Authorization: Bearer <password>` header.  
**Host validation**: Requests where the `Host` header is not `localhost`, `127.0.0.1`, or the active ngrok tunnel domain are rejected with `403 Forbidden`.

---

## Unauthenticated Endpoints

### `GET /health`

Health check. No authentication required.

**Response 200**:

```json
{ "ok": true }
```

---

## Workspace & Project Endpoints

### `GET /api/workspaces`

Returns all workspaces.

**Response 200**:

```json
[
  {
    "id": "uuid",
    "name": "string",
    "folderPath": "string",
    "color": "string",
    "tags": ["string"]
  }
]
```

---

### `GET /api/projects?workspaceId=<uuid>`

Returns projects for a workspace.

**Query**: `workspaceId` (required, UUID)

**Response 200**:

```json
[
  {
    "id": "uuid",
    "workspaceId": "uuid",
    "name": "string",
    "worktreePath": "string | undefined",
    "gitBranch": "string | undefined"
  }
]
```

**Response 400**: `{ "error": "VALIDATION_ERROR", "message": "workspaceId required" }`

---

## Terminal Endpoints

### `POST /api/terminals`

Creates a new terminal session and spawns a PTY.

**Request body**:

```json
{
  "cwd": "string", // Required. Absolute path or "~"
  "type": "human", // Required. Always "human" for remote sessions.
  "tabTitle": "string", // Required. 1–100 chars.
  "scrollbackLimit": 10000 // Optional. Default 10000. Range: 1000–100000.
}
```

**Response 201**:

```json
{ "sessionId": "uuid" }
```

**Response 400**: `{ "error": "VALIDATION_ERROR", "message": "..." }`

---

### `GET /api/terminals/:sessionId`

Returns metadata for an active terminal session.

**Response 200**:

```json
{
  "sessionId": "uuid",
  "cwd": "string",
  "createdAt": "ISO8601 timestamp",
  "subscriberCount": 1
}
```

**Response 404**: `{ "error": "NOT_FOUND" }`

---

### `DELETE /api/terminals/:sessionId`

Terminates the PTY and disconnects all WebSocket subscribers.

**Response 200**: `{ "ok": true }`

**Response 404**: `{ "error": "NOT_FOUND" }`

---

### `POST /api/terminals/:sessionId/resize`

Resizes the terminal PTY.

**Request body**:

```json
{
  "cols": 120, // Required. Positive integer.
  "rows": 40 // Required. Positive integer.
}
```

**Response 200**: `{ "ok": true }`

**Response 400**: `{ "error": "VALIDATION_ERROR", "message": "..." }`

**Response 404**: `{ "error": "NOT_FOUND" }`

---

### `POST /api/terminals/:sessionId/ws-ticket`

Issues a short-lived, single-use WebSocket upgrade ticket for the given terminal session.

**Response 201**:

```json
{ "ticket": "64-char hex string" }
```

Ticket expires in 30 seconds. Used once in the WebSocket upgrade below.

**Response 404**: `{ "error": "NOT_FOUND" }`

---

## WebSocket Endpoint

### `GET /ws/terminals/:sessionId?ticket=<ticket>`

Upgrades to a WebSocket connection for terminal streaming.

**Query**: `ticket` — a valid, unexpired, unused WsTicket for the given `sessionId`.

**On connection established**: PTY output is forwarded as UTF-8 text frames.

**Client → server frames**: Raw text sent by the browser (keyboard input). Only accepted from the primary (first) subscriber. Input from subsequent subscribers is silently dropped.

**Server → client frames**: UTF-8 text — raw PTY output bytes.

**Close codes**:

- `4001` — ticket invalid or expired
- `4002` — session not found
- `1000` — normal closure (PTY exited or session deleted)

---

## Static Assets

### `GET /` and `GET /*`

Serves the remote-control browser SPA from `out/renderer-remote/`. All unmatched routes return `index.html` (SPA client-side routing).

---

## Error Response Format

All error responses follow:

```json
{
  "error": "ERROR_CODE",
  "message": "human-readable description"
}
```

Standard codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL_ERROR`.
