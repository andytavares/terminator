# ADR-023: Channel Manifest and Declared Remote Access

**Status**: Accepted
**Date**: 2026-07-07
**Amends**: ADR-017 (embedded HTTP remote server — audit model)

## Context

The `window.electronAPI` surface was hand-declared twice — once in
`src/main/preload.ts` over `ipcRenderer` and once in
`src/renderer-remote/electron-api-shim.ts` over the WebSocket bridge — plus a
third hand-maintained allowlist (`remote-accessible-channels.ts`). Adding a
channel required three synchronized edits, and the copies had silently
diverged: the shim subscribed to push channels (`fs:changed`,
`notifications:push`, `menu:*`, `extension:toggle-panel`) that the allowlist
missed, so remote `/app/` never received those events, and the shim's
`onTogglePanel` expected a `{panelId}` wrapper that main never sent.

Remote reachability was also decided in three disconnected places. The
allowlist file claimed to be "the remote attack surface", but
`api.ipc.isRemoteAccessible` widened it at runtime to **every channel present
in the invoke registry** — which, because `ipcMain.handle` was globally
monkey-patched to capture all registrations, meant every internal core invoke
channel (`dialog:open-directory`, `workspace:get-active`, `remote:*` controls)
was reachable by an authenticated remote client. Default-deny did not hold.

## Decision

1. **One channel manifest.** `src/shared/electron-api/manifest.ts` declares
   every `electronAPI` method once: dot path, kind (`invoke` / `send` /
   `event` / `local`), channel, payload/handler-arg mappings, and remote
   behavior (`same` / `stub` / `omit`). Both adapters are generated from it by
   `buildElectronApi` — the preload supplies the `ipcRenderer` transport and
   native-only locals; the shim supplies the WebSocket transport and browser
   stubs. Adding a channel is one manifest row.

2. **The allowlist is derived.** `REMOTE_ACCESSIBLE_CHANNELS` is computed from
   the manifest (every spec with remote behavior `same`).
   `manifest.spec.ts` pins the exact expected channel list, so any change to
   the remote surface is a reviewable test diff.

3. **Remote access is declared at registration.** All channel registration
   goes through `channel-registrar.ts` (core) or `api.ipc.registerHandler`
   (extensions, ExtensionAPI v1.3.0); both record the channel and its
   `remoteAccessible` flag in the bridge registry. The `ipcMain` monkey-patch
   is removed. `isRemoteAccessible` consults only the derived core set and the
   declared flag — registry presence alone no longer grants access.
   Extension channels default to `remoteAccessible: true` (extension panels
   are served remotely and must keep working); `{ remoteAccessible: false }`
   opts a channel out.

## Consequences

- Internal core channels are no longer reachable through the bridge. This
  closes the silent widening described above; the shim never called those
  channels, so no legitimate client is affected.
- Remote `/app/` now receives the push events the shim always subscribed to
  (`fs:changed`, `notifications:push`, menu and extension panel events) —
  these are subscribe-only channels, adding no new invoke surface.
- Extensions must not call `ipcMain` directly. Notepad and Task Vault were
  migrated to `api.ipc.registerHandler`; handlers registered outside the API
  are invisible to the bridge registry and unreachable remotely.
- The preload and shim are thin adapters (~60 lines each) with no
  hand-maintained method lists. `electron.d.ts` remains the compile-time type
  for renderer consumers; the manifest is the runtime authority.
