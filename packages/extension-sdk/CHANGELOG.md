# Changelog — @terminator/extension-sdk

## 2.1.0

### Added

- `api.ipc.registerHandler(spec, opts?)` takes a `ChannelSpec` (ADR 096): the core parses the
  payload with `spec.schema` before `spec.run` sees it, and answers a payload the schema rejects
  with `spec.invalid` without calling `run`. `onError` turns a thrown error into a response.
- `dispatchChannel(spec, payload)` (main entry): that parse step, shared by the core's invoke
  table and extension channels; extension tests use it to answer a registered spec.
- `noPayload` (main entry): the schema of a channel that takes no payload.
- `RegisterHandlerOptions`, `RegisterChannel` and `RegisterUnvalidatedChannel` in
  `types/api.d.ts`.

### Deprecated

- `api.ipc.registerHandler(channel, handler, opts?)`, whose handler receives the payload
  unvalidated. It is removed once every first-party extension declares its schemas.

## 2.0.0

### Changed

- The SDK is the single declaration of the Extension API (Constitution II, ADR 094).
  `types/api.d.ts` now declares everything the core builds: `db` (`ExtensionDB`), `issues`
  and the tracker types (`types/issues.d.ts`), `settings.isBranchExcluded`,
  `workspace.createProject` / `deleteProject`, the whole `pty` surface, notification `onClick`,
  command `args`, and `window.focusSelf`. `src/main/extensions/api.ts` implements it and the
  compiler checks the two agree.
- The package is source-only TypeScript, like `@terminator/extension-ui`, with `react`,
  `react-dom` and `zod` as peer dependencies.

### Added

- `defineChannel` / `ChannelSpec` (main entry): the channel shape the core registers its
  invoke channels with.
- `@terminator/extension-sdk/renderer`: `invoke<T>(channel, payload = {})` and
  `mountExtension(view)`.
- `@terminator/extension-sdk/node`: `writeJsonAtomic(path, value)`.
- `window.electronAPI.workspace.getActive` and `ui.setModalDepth` in the view declaration,
  which views already received.

### Removed

- `ICON_NAMES` and `IconName`: declared without a runtime value, and imported by nothing.
- From the view declaration, members an extension view does not receive:
  `terminal.onOutput`, `extension.updatePanelBounds`, `extensionEvents.onToast`,
  `onSelectProjectTab`, `onMenuToggleSidebar`, `onMenuCloseTab`, `onMenuOpenAbout`, and
  `notification.show`.
- The main entry no longer re-exports `ElectronAPI`; a view gets it through
  `@terminator/extension-sdk/types/renderer`.
