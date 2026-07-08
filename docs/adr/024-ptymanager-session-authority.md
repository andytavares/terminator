# ADR-024: PtyManager Is the Single Session Authority

**Status**: Accepted
**Date**: 2026-07-07
**Relates to**: ADR-001 (PTY in main process), ADR-017 (embedded remote server)

## Context

Terminal session state was split across three registries: `PtyManager`'s
internal map (PTY handle + cwd), `terminal.ipc.ts`'s `activeSessionRegistry`
(projectId, tabTitle, type), and the remote-control extension's
`terminal.routes.ts` maps (`sessions`, `workspaceOverrides`, plus an entire
adoption subsystem — `adoptedSessions`, two disposer maps, rollback logic, and
origin-aware grace-period teardown — whose only purpose was reconciling PTYs
the _other_ path had created). Neither view knew the other's metadata, so
`GET /api/terminals` merged and de-duplicated two lists, and "what is a
terminal session" had no single answer.

## Decision

`PtyManager` owns all session state and fan-out:

- **`spawnSession(opts)`** spawns with full metadata: `origin` (`'app'` — created
  by the Electron renderer; `'remote'` — created by the remote browser surface),
  `type`, `projectId`, `tabTitle`, and stamps `createdAt`/`pid`.
- **`onData` / `onExit`** are multi-subscriber fan-outs with disposers. Exit
  listeners fire after the session is removed; all listeners die with the
  session.
- **`getSession` / `listSessions` / `setWorkspace`** expose and update the
  metadata (workspace assignment moved here from the routes' override map).

Both consumers are now thin views: `terminal.ipc.ts` translates IPC payloads
and relays pushes to the renderer window; `terminal.routes.ts` manages only
its own WebSocket subscribers and one broadcast listener per streamed session.

**Kill policy**: remote teardown paths (DELETE, grace-period expiry, server
cleanup) kill only `origin: 'remote'` sessions. `'app'` sessions belong to the
Electron renderer and are never killed by the remote surface — this replaces
the adoption bookkeeping with a metadata check.

The ExtensionAPI's `api.pty` gains the new surface additively (v1.4.0); the
v1.1.0 `spawn`/`attachOnData`/`attachOnExit` remain as deprecated aliases, so
no existing extension breaks.

## Consequences

- The adoption subsystem (~120 lines: adopt-on-connect, rollback on
  subscriber-limit, disposer maps) is deleted; no equivalent replaces it.
- `GET /api/terminals` is a single `listSessions()` map — no merging — and app
  sessions now report a real `createdAt`.
- Remote endpoints (`GET/DELETE/PATCH /api/terminals/:id`, resize, ws-ticket)
  answer for any live session, not just ones the remote surface had "adopted";
  DELETE on an app session stops streaming it without killing it.
- Session lifecycle bugs now have one home; `pty-manager.spec.ts` tests the
  fan-out and metadata through the authority's own interface.
