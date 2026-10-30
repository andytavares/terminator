# scripts/ — Development Rules

## create-extension.cjs

When you update the extension scaffold template (`generateIndex`), enforce these rules in the generated code and comments. `generateIndex` joins one function per part of the generated file, from `indexHeader` to `indexFooter`. A new stub is a new part, which keeps each function within the size limits.

### Extension Isolation Rules (embed in generated template comments)

1. **IPC handlers** belong in the backend entry (`src/index.js`). Register them with `api.ipc.registerHandler({ channel: '${id}:channel', schema, invalid, run })`: a `ChannelSpec` with a zod `schema`. The core has accepted only this form since SDK 3.0 (ADR 096). Put zod in the extension's own `package.json`.
2. **Renderer calls to own channels** go through `window.electronAPI.extensionBridge.invoke('${id}:channel', payload)`. Never use a named method on `window.electronAPI`.
3. **Never add new namespaces to `window.electronAPI`**. The preload is core-only. Extensions use `extensionBridge`.
4. **Never modify core files**: `src/main/preload.ts`, `src/extension-frame/frame-shim.ts`, `src/shared/electron-api/manifest.ts`, `src/main/ipc/*.ts`.
5. **Put NPM dependencies in the extension's own `package.json`**, not the root.
6. **Never import from other extensions, or from core source**. Import only `@terminator/extension-sdk`, `@terminator/extension-ui` and the extension's own npm packages (`npm run lint` enforces it). Extensions cannot reach each other: SDK 6.0.0 removed `extensionDependencies` and `api.extensions.get` (ADR 133).

### Scaffold must NOT include

- A template that calls `window.electronAPI.git.status()` or a similar extension-owned channel
- A suggestion to modify `preload.ts`
- A `window.electronAPI.myExtension = ...` pattern

### When adding new API stubs to generateIndex

- Use `api.ipc.registerHandler` with a channel spec for backend handlers.
- Name no API version in a stub heading. The header line carries the SDK version (`SDK_VERSION`).
- `tests/unit/scripts/create-extension.spec.js` and `tests/integration/scripts/create-extension.spec.js` check the template and the CLI output. Change them first.
- Show `extensionBridge.invoke` usage in renderer-side comments.
- Reference `docs/EXTENSION-DEVELOPMENT.md` for the full API surface.
