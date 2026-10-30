# ADR-023: Channel Manifest and Declared Remote Access

**Status**: Accepted
**Date**: 2026-07-07
**Amends**: ADR-017 (embedded HTTP remote server — audit model)

## Context

The `window.electronAPI` surface was hand-declared twice: once in
`src/main/preload.ts` over `ipcRenderer`, and once in
`src/renderer-remote/electron-api-shim.ts` over the WebSocket bridge. A third
hand-maintained allowlist (`remote-accessible-channels.ts`) added to the
burden. Adding a channel required three synchronized edits, and the copies had
silently diverged. The shim subscribed to push channels (`fs:changed`,
`notifications:push`, `menu:*`, `extension:toggle-panel`) that the allowlist
missed, so remote `/app/` never received those events. The shim's
`onTogglePanel` expected a `{panelId}` wrapper that main never sent.

Three disconnected places also decided remote reachability. The
allowlist file claimed to be "the remote attack surface", but
`api.ipc.isRemoteAccessible` widened it at runtime to **every channel present
in the invoke registry**. A global monkey-patch of `ipcMain.handle` captured
all registrations, so an authenticated remote client could reach every internal
core invoke channel (`dialog:open-directory`, `workspace:get-active`, `remote:*`
controls). Default-deny did not hold.

## Decision

1. **One channel manifest.** `src/shared/electron-api/manifest.ts` declares
   every `electronAPI` method once: dot path, kind (`invoke` / `send` /
   `event` / `local`), channel, payload/handler-arg mappings, and remote
   behavior (`same` / `stub` / `omit`). `buildElectronApi` generates both
   adapters from it. The preload supplies the `ipcRenderer` transport and
   native-only locals. The shim supplies the WebSocket transport and browser
   stubs. Adding a channel is one manifest row.

2. **The allowlist is derived.** The manifest determines `REMOTE_ACCESSIBLE_CHANNELS`
   (every spec with remote behavior `same`).
   `manifest.spec.ts` pins the exact expected channel list, so any change to
   the remote surface is a reviewable test diff.

3. **Registration declares remote access.** All channel registration
   goes through `channel-registrar.ts` (core) or `api.ipc.registerHandler`
   (extensions, ExtensionAPI v1.3.0). Both record the channel and its
   `remoteAccessible` flag in the bridge registry. The `ipcMain` monkey-patch
   is removed. `isRemoteAccessible` consults only the derived core set and the
   declared flag. Registry presence alone no longer grants access.
   Extension channels default to `remoteAccessible: true` (extension panels
   are served remotely and must keep working). `{ remoteAccessible: false }`
   opts a channel out.

## Consequences

- The bridge no longer reaches internal core channels. This
  closes the silent widening described above. The shim never called those
  channels, so no legitimate client is affected.
- Remote `/app/` now receives the push events the shim always subscribed to
  (`fs:changed`, `notifications:push`, menu and extension panel events).
  These are subscribe-only channels, so they add no new invoke surface.
- Extensions must not call `ipcMain` directly. Notepad and Task Vault were
  migrated to `api.ipc.registerHandler`. The bridge registry cannot see handlers
  registered outside the API, so they are unreachable remotely.
- The preload and shim are thin adapters (~60 lines each) with no
  hand-maintained method lists. `electron.d.ts` remains the compile-time type
  for renderer consumers. The manifest is the runtime authority.
