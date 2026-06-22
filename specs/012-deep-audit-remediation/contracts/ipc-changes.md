# IPC Contract Changes: Deep Audit Remediation

This document captures all IPC channel additions and semantic changes introduced by this feature. All new channels must also appear in `specs/001-extension-first-terminal/contracts/ipc-channels.md` and `src/renderer/electron.d.ts`.

---

## New Channels

### `db:health`

**Direction**: renderer → main (invoke)  
**Handler**: `src/main/ipc/db.ipc.ts` (new file) or inline in `src/main/db/index.ts`  
**Remote-accessible**: No (`remoteAccessible: false`)

**Request**: `{}` (no payload)

**Response**:

```typescript
{ ok: boolean; message?: string }
```

**Purpose**: Surface DB initialization status in the Settings → About panel. Called on-demand, not polled.

---

## Modified Channel Semantics

### All existing `ipcMain.handle` channels

**Change**: The bridge dispatcher now enforces a `remoteAccessible` flag before executing any channel invoked via the WebSocket bridge. Channels without `{ remoteAccessible: true }` at their registration site are rejected with:

```json
{ "type": "error", "id": "<request-id>", "error": "channel not remote-accessible" }
```

This is a **breaking change for any WebSocket client** that was invoking non-allowlisted channels. The mobile remote-control UI must only invoke channels that have been explicitly marked.

**Channels marked `remoteAccessible: true`** (audit required during implementation — this list is non-exhaustive):

- Channels explicitly invoked by the mobile remote-control renderer
- Determined by auditing `extensions/remote-control/src/` call sites

---

## Registration Signature Change

```typescript
// Before
ipcMain.handle(channel: string, listener: IpcHandler): void

// After (patched version only — Electron's real signature unchanged)
ipcMain.handle(channel: string, listener: IpcHandler, opts?: { remoteAccessible?: boolean }): void
```

The third argument is consumed by the monkey-patch only. It is not forwarded to Electron's real `ipcMain.handle`. TypeScript types for the patched version must be updated in `src/main/index.ts` or a local `.d.ts` augmentation.
