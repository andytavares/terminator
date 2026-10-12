# @terminator/extension-sdk

The Extension API every Terminator extension is written against, and the helpers they share.
The core implements `types/api.d.ts`; the compiler checks it does (ADR 094).

Since 4.0.0 an extension's backend runs in the extension host, a separate process, and the API
crosses a `MessagePort`: values the core holds are promises or snapshots it pushes, callbacks are
called by id, and the backend cannot import `electron` (use `api.paths`, `api.dialog`,
`api.window`). See `CHANGELOG.md` for the migration from 3.x and
`docs/EXTENSION-DEVELOPMENT.md#where-your-backend-runs-sdk-400`.

An extension imports only this package, `@terminator/extension-ui` and the npm packages in its
own `package.json`. `npm run lint` rejects anything else, including core source and other
extensions.

| Entry                                      | What it holds                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `@terminator/extension-sdk`                | `ExtensionAPI`, `ExtensionDB`, the issue-tracker types, `defineChannel`, `dispatchChannel`, `noPayload` |
| `@terminator/extension-sdk/renderer`       | `invoke<T>(channel, payload = {})`, `mountExtension(<App />)`                                           |
| `@terminator/extension-sdk/node`           | `writeJsonAtomic(path, value)`                                                                          |
| `@terminator/extension-sdk/types/renderer` | The `window.electronAPI` an extension view receives (loaded through `tsconfig`)                         |

The main entry also declares `GithubAPI` (`api.github`, pull requests over gh), the shell
option and result types (`ShellExecOptions`, `ShellExecResult`), and the built-in extensions'
APIs (`TaskVaultAPI`, `BuiltInExtensionExports`).

Source-only TypeScript, with `react`, `react-dom` and `zod` as peer dependencies. See
`CHANGELOG.md`.

## Using another extension's API

An extension's API is the value its `activate` returns. List the provider in your manifest and
read it through the API; never import its source:

```jsonc
{ "id": "com.example.planner", "extensionDependencies": ["terminator.task-vault"] }
```

```typescript
const vault = api.extensions.get('terminator.task-vault') // TaskVaultAPI
```

The host activates the provider first. A missing, failed, disabled or cyclic dependency fails
your activation with a message naming it, and `get` throws for an id you did not declare.

## Installation

```
npm install --save-dev @terminator/extension-sdk
```

## Quick Start

### Extension structure

```
my-extension/
├── manifest.json          ← declares id, main, renderer, contributes
├── dist/
│   ├── main.cjs           ← backend entry (activate/deactivate), run in the extension host
│   └── index.html         ← webview entry (renderer UI)
└── src/
    ├── index.ts           ← main process source
    └── renderer/
        ├── App.tsx
        └── main.tsx
```

### `manifest.json`

```json
{
  "id": "com.example.my-tool",
  "name": "My Tool",
  "version": "1.0.0",
  "description": "Example extension",
  "main": "dist/main.cjs",
  "renderer": "dist/index.html",
  "minAppVersion": "0.1.0",
  "contributes": {
    "globalTab": {
      "label": "My Tool",
      "icon": "wrench",
      "view": "main"
    }
  }
}
```

### Backend (`src/index.ts`)

```typescript
import { z } from 'zod'
import { defineChannel, type ExtensionAPI } from '@terminator/extension-sdk'

export function activate(api: ExtensionAPI): void {
  api.log.info('My extension activated')

  // The payload is parsed with `schema` before `run` sees it (ADR 096).
  api.ipc.registerHandler(
    defineChannel({
      channel: 'my-ext:hello',
      schema: z.string(),
      invalid: { error: 'VALIDATION_ERROR' },
      run: (name) => ({ greeting: `Hello, ${name}!` }),
    })
  )
}

export function deactivate(): void {}
```

### Renderer (`src/renderer/App.tsx`)

```typescript
import { invoke } from '@terminator/extension-sdk/renderer'

const result = await invoke<{ greeting: string }>('my-ext:hello', 'World')

// Subscribe to events
const off = window.electronAPI.extensionBridge.on('my-ext:update', (data) => {
  console.log('Update:', data)
})
// Call off() to unsubscribe
```

## Shared UI — `@terminator/extension-ui`

UI components live next door:

```bash
npm install @terminator/extension-ui
```

Your extension renders in its own `WebContentsView`, which loads neither the host
stylesheet nor the host's components — so without this package every extension
ends up writing its own dialog, and they end up disagreeing about what Escape
does. It ships `Dialog`, `ConfirmDialog`, `Popover`, `ToastRegion`, `EmptyState`,
`IconButton`, `useDismissible` and the layer scale, source-only, with `react`,
`react-dom` and `lucide-react` as peer dependencies.

```tsx
import { ConfirmDialog } from '@terminator/extension-ui'
;<ConfirmDialog
  title="Delete this note?"
  body="It is removed from this machine and cannot be recovered."
  confirmLabel="Delete"
  tone="danger"
  onConfirm={remove}
  onDismiss={close}
/>
```

Two behaviours you would otherwise have to implement yourself, and one you
cannot discover from the DOM:

- Escape closes only the **innermost** open surface.
- Stacking comes from `LAYERS` / `var(--tm-layer-*)`, not from raw numbers.
- The host's double-Escape "exit extension" gesture must stand down while a
  modal is open. `Dialog` reports depth over `electronAPI.ui.setModalDepth`; a
  hand-rolled modal that does not will let a user's second Escape close your
  extension and discard whatever they were typing.

Colours, spacing and radii come from the `--tm-*` tokens the host injects into
your document. They carry both light and dark, and the host sets `data-theme` on
your `<html>` — so a hardcoded hex is a colour that cannot follow the theme.

See `docs/EXTENSION-STYLE.md` for the house rules and
`docs/EXTENSION-DEVELOPMENT.md` for the full API.

## Manifest `contributes`

| Surface       | Key            | Fields                                     |
| ------------- | -------------- | ------------------------------------------ |
| Global tab    | `globalTab`    | `label`, `icon?`, `view?`                  |
| Workspace tab | `workspaceTab` | `label`, `icon?`, `view?`                  |
| Project tab   | `projectTab`   | `label`, `view?`                           |
| Sidebar panel | `sidebarPanel` | `label`, `icon?`, `defaultOpen?`, `view?`  |
| Window views  | `windowViews`  | `[{ id, view }]`                           |
| Commands      | `commands`     | `[{ id, label, shortcut?, description? }]` |

The `view` string is passed as `?view=VALUE` in the webview URL, letting one `index.html` serve multiple surfaces.

## Icon names

`contributes.*.icon` takes one of the names `iconFromName` knows
(`src/renderer/extensions/icon-from-name.ts`), such as `puzzle`, `wrench`, `terminal`,
`git-branch`, `database`, `list` or `calendar`.

## Build setup (Vite example)

```typescript
// vite.renderer.config.ts
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true, // the esbuild main bundle goes to src/, so nothing else lives in dist/
    rollupOptions: { input: resolve(__dirname, 'index.html') },
  },
})
```

Add to `package.json`:

```json
{
  "scripts": {
    "build:renderer": "vite build --config vite.renderer.config.ts"
  }
}
```

## Installing locally

1. Build your extension: `npm run build:renderer`
2. Open Terminator → Settings → Extensions → Install Extension
3. Point at your extension directory
4. After edits, click Reload — no app rebuild required
