# scripts/ — Development Rules

## create-extension.cjs

When updating the extension scaffold template (`generateIndex`), enforce these rules in the generated code and comments:

### Extension Isolation Rules (embed in generated template comments)

1. **IPC handlers** belong in `src/index.js` via `api.ipc.registerHandler('${id}:channel', handler)`
2. **Renderer calls to own channels** go through `window.electronAPI.extensionBridge.invoke('${id}:channel', payload)` — never through a named method on `window.electronAPI`
3. **Never add new namespaces to `window.electronAPI`** — the preload is core-only. Extensions use `extensionBridge`
4. **Never modify core files**: `src/main/preload.ts`, `src/main/preload-webview.ts`, `src/shared/electron-api/manifest.ts`, `src/main/ipc/*.ts`
5. **NPM deps go in the extension's own `package.json`**, not the root
6. **Never import from other extensions, or from core source** — import only `@terminator/extension-sdk`, `@terminator/extension-ui` and the extension's own npm packages (`npm run lint` enforces it). An extension's API is what its `activate` returns, reached by a consumer that declares the provider in its manifest's extension dependencies (ADR 094). That is the rule even before the mechanism that hands the object over exists

### Scaffold must NOT include

- Any template that calls `window.electronAPI.git.status()` or similar extension-owned channels
- Any suggestion to modify `preload.ts`
- Any `window.electronAPI.myExtension = ...` patterns

### When adding new API stubs to generateIndex

- Use `api.ipc.registerHandler` for main-process handlers
- Show `extensionBridge.invoke` usage in renderer-side comments
- Reference `docs/EXTENSION-DEVELOPMENT.md` for full API surface
