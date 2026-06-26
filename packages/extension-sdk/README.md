# @terminator/extension-sdk

Type definitions for building Terminator extensions.

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
│   ├── main.cjs           ← Node.js entry (activate/deactivate)
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

### Main process (`src/index.ts`)

```typescript
import type { ExtensionAPI } from '@terminator/extension-sdk'

export function activate(api: ExtensionAPI): void {
  api.log.info('My extension activated')

  api.ipc.registerHandler('my-ext:hello', async (payload) => {
    return { greeting: `Hello, ${payload}!` }
  })
}

export function deactivate(): void {}
```

### Renderer (`src/renderer/App.tsx`)

```typescript
// window.electronAPI is typed via @terminator/extension-sdk
const result = await window.electronAPI.extensionBridge.invoke('my-ext:hello', 'World')

// Subscribe to events
const off = window.electronAPI.extensionBridge.on('my-ext:update', (data) => {
  console.log('Update:', data)
})
// Call off() to unsubscribe
```

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

## Allowed icon names

Use any name from `ICON_NAMES` exported by this package:

```typescript
import { ICON_NAMES } from '@terminator/extension-sdk'
// "puzzle" | "wrench" | "terminal" | "git-branch" | "git-pull-request" |
// "database" | "code" | "layers" | "settings" | "file" | "search" |
// "box" | "star" | "zap" | "globe" | "cpu" | "flask" | "chart-bar" |
// "list" | "calendar" | "check"
```

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
    emptyOutDir: false,
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
