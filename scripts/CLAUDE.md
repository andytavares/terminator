# scripts/ — Development Rules

## create-extension.cjs

When updating the extension scaffold template (`generateIndex`), enforce these rules in the generated code and comments. `generateIndex` joins one function per part of the generated file, from `indexHeader` to `indexFooter`; a new stub is a new part, which keeps each within the function size limits.

### Extension Isolation Rules (embed in generated template comments)

1. **IPC handlers** belong in the backend entry (`src/index.js`) via `api.ipc.registerHandler({ channel: '${id}:channel', schema, invalid, run })`: a `ChannelSpec` with a zod `schema`, the only form the core accepts since SDK 3.0 (ADR 096). zod goes in the extension's own `package.json`
2. **Renderer calls to own channels** go through `window.electronAPI.extensionBridge.invoke('${id}:channel', payload)` — never through a named method on `window.electronAPI`
3. **Never add new namespaces to `window.electronAPI`** — the preload is core-only. Extensions use `extensionBridge`
4. **Never modify core files**: `src/main/preload.ts`, `src/main/preload-webview.ts`, `src/shared/electron-api/manifest.ts`, `src/main/ipc/*.ts`
5. **NPM deps go in the extension's own `package.json`**, not the root
6. **Never import from other extensions, or from core source** — import only `@terminator/extension-sdk`, `@terminator/extension-ui` and the extension's own npm packages (`npm run lint` enforces it). An extension's API is what its `activate` returns, reached by a consumer that lists the provider in its manifest's `extensionDependencies` and reads it with `api.extensions.get(id)` (ADR 094, SDK 3.0.0). A scaffold that shows a dependency shows both halves, never an import of the provider's source

### Scaffold must NOT include

- Any template that calls `window.electronAPI.git.status()` or similar extension-owned channels
- Any suggestion to modify `preload.ts`
- Any `window.electronAPI.myExtension = ...` patterns

### When adding new API stubs to generateIndex

- Use `api.ipc.registerHandler` with a channel spec for backend handlers
- Name no API version in a stub heading; the header line carries the SDK version (`SDK_VERSION`)
- `tests/unit/scripts/create-extension.spec.js` and `tests/integration/scripts/create-extension.spec.js` check the template and the CLI output; change them first
- Show `extensionBridge.invoke` usage in renderer-side comments
- Reference `docs/EXTENSION-DEVELOPMENT.md` for full API surface
