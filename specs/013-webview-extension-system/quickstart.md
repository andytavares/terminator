# Quickstart: Building a Terminator Extension

**Version**: 2.0.0 (WebContentsView model)
**Date**: 2026-06-24

---

## Overview

A Terminator extension is a directory containing:

- `manifest.json` — declares identity, entry points, and UI contributions
- A compiled Node.js main entry (CommonJS) — runs in the main process
- An HTML renderer entry — loaded in an isolated browser context (Electron `WebContentsView`)

Extensions are installed from **any directory on your filesystem**. No app rebuild required. Ever.

---

## Step 1 — Install the SDK

```bash
npm install --save-dev /path/to/terminator/packages/extension-sdk
# or, once published:
npm install --save-dev @terminator/extension-sdk
```

---

## Step 2 — Extension Directory Structure

```
my-extension/
├── manifest.json
├── package.json
├── dist/                  ← compiled output (the only thing the app needs)
│   ├── main.cjs           ← compiled main process entry
│   ├── index.html         ← renderer entry
│   └── index.js           ← renderer bundle
└── src/
    ├── main/
    │   └── index.ts
    └── renderer/
        ├── App.tsx
        └── main.tsx
```

---

## Step 3 — Write `manifest.json`

```json
{
  "id": "com.acme.my-tool",
  "name": "My Tool",
  "version": "1.0.0",
  "description": "My internal tool extension.",
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

**Rules**:

- `id` must be a reverse-domain string (e.g. `com.acme.my-tool`). Lowercase, dots and hyphens only.
- `main` and `renderer` are paths relative to the manifest directory.
- The `view` field in each contribution is passed as `?view=VALUE` to the renderer URL, so one HTML file can serve multiple surfaces.

---

## Step 4 — Write the Main Entry (`src/main/index.ts`)

```ts
import type { ExtensionAPI } from '@terminator/extension-sdk'

export function activate(api: ExtensionAPI): void {
  // Register IPC handlers, set up database tables, etc.
  api.logger.info('my-tool activated')

  // Optional: respond to deactivation
}

export function deactivate(): void {
  // Cleanup (optional)
}
```

Compile to `dist/main.cjs` with your bundler set to `format: 'cjs'`.

**Vite config example**:

```ts
// vite.config.main.ts
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'main.cjs',
    },
    outDir: 'dist',
    rollupOptions: {
      external: ['electron'],
    },
  },
})
```

---

## Step 5 — Write the Renderer (`src/renderer/App.tsx`)

The renderer is a standalone web app loaded into an isolated browser context. It has access to `window.electronAPI` (the full Terminator API surface) via the app's preload script.

```tsx
import React from 'react'

// Read context from URL params (set by the app at mount time)
const params = new URLSearchParams(window.location.search)
const view = params.get('view') ?? 'main'
const workspaceId = params.get('workspaceId') ?? null
const projectId = params.get('projectId') ?? null
const repoRoot = params.get('repoRoot') ?? null

export default function App() {
  if (view === 'main') return <MainView workspaceId={workspaceId} projectId={projectId} />
  return <div>Unknown view: {view}</div>
}

function MainView({
  workspaceId,
  projectId,
}: {
  workspaceId: string | null
  projectId: string | null
}) {
  const [workspaces, setWorkspaces] = React.useState<any[]>([])

  React.useEffect(() => {
    window.electronAPI.workspace.list().then(setWorkspaces)

    // Subscribe to workspace changes
    const unsub = window.electronAPI.extensionBridge.on(
      'workspace:changed',
      ({ workspaceId: id }) => {
        window.electronAPI.workspace.list().then(setWorkspaces)
      }
    )
    return unsub
  }, [])

  return (
    <div style={{ padding: 16 }}>
      <h2>My Tool</h2>
      <p>Active workspace: {workspaceId ?? 'none'}</p>
      <ul>
        {workspaces.map((ws) => (
          <li key={ws.id}>{ws.name}</li>
        ))}
      </ul>
    </div>
  )
}
```

**Entry point** (`src/renderer/main.tsx`):

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
```

**`index.html`**:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>My Tool</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./index.js"></script>
  </body>
</html>
```

**Vite config example** (renderer):

```ts
// vite.config.renderer.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: { index: 'index.html' },
    },
  },
})
```

---

## Step 6 — Build

Add to your extension's `package.json`:

```json
{
  "scripts": {
    "build:main": "vite build --config vite.config.main.ts",
    "build:renderer": "vite build --config vite.config.renderer.ts",
    "build": "npm run build:main && npm run build:renderer"
  }
}
```

Run:

```bash
npm run build
```

This produces `dist/main.cjs`, `dist/index.html`, and `dist/index.js`.

---

## Step 7 — Install in Terminator

1. Open Terminator
2. Go to **Settings → Extensions → Install Extension**
3. Select your extension's root directory (the folder containing `manifest.json`)
4. Your extension's tab/panel appears immediately — no app restart required

---

## Step 8 — Update Your Extension

1. Make changes to your source
2. Run `npm run build` in your extension directory
3. In Terminator: **Settings → Extensions → [Your Extension] → Reload**
4. Your changes appear immediately — no app rebuild, no app restart

---

## Using the Database

Extensions share the app's PGlite database. Use table prefixes to avoid conflicts:

```ts
// In activate():
await api.db.execute(`
  CREATE TABLE IF NOT EXISTS my_tool_notes (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`)
```

From the renderer (WebContentsView):

```ts
const result = await window.electronAPI.db.query(
  'SELECT * FROM my_tool_notes ORDER BY created_at DESC'
)
console.log(result.rows)
```

---

## Handling Commands (Keyboard Shortcuts)

Declare commands in the manifest:

```json
{
  "contributes": {
    "commands": [
      {
        "id": "my-tool:open",
        "label": "Open My Tool",
        "shortcut": "CmdOrCtrl+Shift+M"
      }
    ]
  }
}
```

Listen in the renderer:

```ts
window.electronAPI.extensionBridge.on('ext:command:my-tool:open', () => {
  // show a modal, focus an element, etc.
  setModalOpen(true)
})
```

---

## TypeScript Types

```ts
// types are imported from the SDK
import type { ExtensionAPI } from '@terminator/extension-sdk'

// window.electronAPI is typed globally in the SDK
// Your renderer gets full type safety without any imports:
const ws = await window.electronAPI.workspace.list() // typed as Workspace[]
```

---

## Multiple Views from One Entry

If your extension contributes multiple surfaces (e.g., a global tab AND a sidebar panel), use the `view` param to route:

```json
{
  "contributes": {
    "globalTab": { "label": "My Tool", "view": "main" },
    "sidebarPanel": { "label": "My Panel", "view": "sidebar" }
  }
}
```

```tsx
const view = new URLSearchParams(window.location.search).get('view')

export default function App() {
  if (view === 'main') return <MainView />
  if (view === 'sidebar') return <SidebarView />
  return null
}
```

Each surface gets its own `WebContentsView` instance — they're isolated from each other but share the same `window.electronAPI` bridge to the main process.

---

## Litmus Test

Your extension is correctly built if:

1. You can **move the extension directory to any location on disk** (e.g., `~/projects/my-ext` or `/tmp/my-ext`)
2. Install it in Terminator from that location
3. **All functionality works** — tabs appear, IPC calls succeed, database reads/writes work
4. You can **edit files and click Reload** to see changes — no app rebuild ever needed
