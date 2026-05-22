# scripts/ — Development Rules

## create-extension.cjs

When updating the extension scaffold template (`generateIndex`), enforce these rules in the generated code and comments:

### Extension Isolation Rules (embed in generated template comments)

1. **IPC handlers** belong in `src/index.js` via `api.ipc.registerHandler('${id}:channel', handler)`
2. **Renderer calls to own channels** go through `window.electronAPI.extensionBridge.invoke('${id}:channel', payload)` — never through a named method on `window.electronAPI`
3. **Never add new namespaces to `window.electronAPI`** — the preload is core-only. Extensions use `extensionBridge`
4. **Never modify core files**: `src/main/preload.ts`, `src/renderer/electron.d.ts`, `src/main/ipc/*.ts`
5. **NPM deps go in the extension's own `package.json`**, not the root
6. **Never import from other extensions** — cross-extension communication goes through the core stores or IPC events

### Scaffold must NOT include

- Any template that calls `window.electronAPI.git.status()` or similar extension-owned channels
- Any suggestion to modify `preload.ts`
- Any `window.electronAPI.myExtension = ...` patterns

### When adding new API stubs to generateIndex

- Use `api.ipc.registerHandler` for main-process handlers
- Show `extensionBridge.invoke` usage in renderer-side comments
- Reference `docs/EXTENSION-DEVELOPMENT.md` for full API surface
