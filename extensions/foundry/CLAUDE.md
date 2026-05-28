# Foundry Extension — Development Rules

## Extension Isolation (MANDATORY)

This is a **fully isolated extension**. The core application knows nothing about this extension until it is loaded. Violations break the architecture.

### What this extension MAY do

- Import from `../../../../src/main/extensions/api` (the ExtensionAPI type only)
- Call core IPC via `window.electronAPI.{terminal,workspace,project,git,shell,fs,settings,...}` for **core-owned channels only**
- Call own IPC via `window.electronAPI.extensionBridge.invoke('foundry:...')`
- Register IPC handlers in `src/index.ts` via `api.ipc.registerHandler()`

### Extension-owned IPC — always use extensionBridge

All `foundry:*` channels are registered by this extension. Call them from the renderer via:

```typescript
const result = await window.electronAPI.extensionBridge.invoke('foundry:harness-read', {
  workspaceRoot,
})
if ('error' in result) {
  addToast({ type: 'error', message: result.error })
  return
}
```

### What this extension MUST NOT do

- **Never** modify `src/main/preload.ts` (core file)
- **Never** modify `src/renderer/electron.d.ts` (core file)
- **Never** add extension-only npm deps to the **root** `package.json` — add to `extensions/foundry/package.json`
- **Never** import from other extensions (`extensions/speckit-pilot/...`, `extensions/task-vault/...`)
- **Never** hardcode the extension ID (`terminator.foundry`) in core app files
- **Never** use `'project-tab'` as a PanelSlot — only `'right-sidebar'` and `'global-tab'` are valid
- **Never** edit `extensions/foundry/src/index.js` directly — it is a build artifact

## NPM Dependencies

Add deps to `extensions/foundry/package.json` only. npm workspaces hoist them automatically.

## Listening for Push Events

```typescript
// In renderer component (useEffect)
const unsub = window.electronAPI.extensionBridge.on('foundry:run-event', (data) => {
  const { runId, event } = data as { runId: string; event: RunEvent }
  // update store
})
return () => unsub()
```

## Run Console Launch

The run console is opened via `api.window.openAuxiliary('foundry-run', { runId })` from the renderer. It is NOT a `'project-tab'` panel contribution.

## CSS Rules

- Use ONLY `var(--token-name)` CSS custom properties from the core app
- Never introduce raw hex colors or new CSS variable definitions
- Icons: Tabler Icons only, flat, inheriting text color

## Isolation Test

Before marking any task done, ask: "If `extensions/foundry/` were deleted, would the core app still build and run without modification?" If no, fix the violation first.
