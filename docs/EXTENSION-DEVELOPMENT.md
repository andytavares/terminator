# Extension Development Guide

Extensions let you add functionality to Terminator without touching its core code. They contribute to the application through the `ExtensionAPI` — a stable, versioned interface. This guide covers everything you need to write, test, and distribute an extension.

**Current API version**: 2.0.0 (webview renderer isolation — see [ADR-022](adr/022-webview-isolated-extension-renderer.md))

---

## Quick Start: Scaffold a New Extension

The fastest way to start is the scaffolding CLI. It generates a complete, working hello-world extension in seconds:

```bash
npm run create-extension -- my-extension
```

This creates `extensions/my-extension/` with a `manifest.json` and a `src/index.ts` that demonstrates every API surface. Run `npm run dev` and your extension loads automatically.

Options:

```bash
npm run create-extension -- <name> [--id <reverse-domain-id>] [--dir <output-dir>]

# Examples:
npm run create-extension -- git-tools
npm run create-extension -- git-tools --id com.acme.git-tools
npm run create-extension -- git-tools --dir /path/to/my/extensions/git-tools
```

See [Scaffolding CLI Reference](#scaffolding-cli-reference) at the end of this guide for full options.

---

## Extension Structure

An extension is a directory with a manifest and an entry point:

```
my-extension/
├── manifest.json     # Required: extension metadata
└── src/
    └── index.ts      # Required: activate() / deactivate() entry point
```

### Manifest (`manifest.json`)

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "A short description of what this extension does.",
  "main": "dist/main.cjs",
  "renderer": "dist/index.html",
  "minAppVersion": "0.1.0",
  "contributes": {
    "globalTab": {
      "label": "My Extension",
      "icon": "wrench",
      "view": "main"
    }
  }
}
```

| Field           | Required | Description                                                               |
| --------------- | -------- | ------------------------------------------------------------------------- |
| `id`            | Yes      | Reverse-domain identifier, globally unique. Example: `com.acme.git-tools` |
| `name`          | Yes      | Human-readable name shown in the Extensions panel                         |
| `version`       | Yes      | Semver string (`X.Y.Z`)                                                   |
| `description`   | Yes      | Shown in the Extensions panel                                             |
| `main`          | Yes      | Relative path to the compiled main-process entry (CommonJS)               |
| `renderer`      | No       | Relative path to the webview HTML entry (`dist/index.html`)               |
| `minAppVersion` | Yes      | Minimum Terminator version required (semver, e.g. `0.1.0`)                |
| `contributes`   | No       | UI surface declarations (see [Renderer UI](#renderer-ui) section)         |

### Entry Point

The entry point must export an `activate` function and may export `deactivate`:

```typescript
import type { ExtensionAPI } from '@terminator/extension-sdk'

const disposables: Array<{ dispose(): void }> = []

export function activate(api: ExtensionAPI): void {
  // Register your contributions here
  disposables.push(
    api.sidebar.registerItem({
      id: 'my-panel',
      label: 'My Panel',
      onClick: () => api.notifications.showToast('info', 'Hello from My Panel!'),
    })
  )
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
}
```

If `activate` throws, the extension transitions to `status: 'error'` and the app remains stable.

### Extension Dependencies (`package.json`)

If your extension needs npm packages that aren't part of Terminator's core, declare them in an optional `package.json` alongside `manifest.json`. Extensions are registered as npm workspaces so their dependencies are hoisted automatically:

```
my-extension/
├── manifest.json
├── package.json     # Optional: extension-specific npm dependencies
└── src/
    └── renderer.tsx
```

```json
{
  "name": "@terminator/extension-my-extension",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "some-library": "^1.0.0"
  }
}
```

Run `npm install` from the repo root after adding a new `package.json`. Core dependencies (React, Zustand, Zod, etc.) are provided by the host app — do not redeclare them.

---

## ExtensionAPI Reference

The `api` object passed to `activate` is the sole interface between your extension and the host application. **Do not import from `src/main/`, `src/renderer/`, or `src/shared/` directly.**

### `api.app`

```typescript
api.app.version // string — current Terminator version, e.g. "0.1.0"
```

---

### `api.settings` — Register and Read Settings

Register a settings section that appears in the Global and Workspace settings panels. Settings declared as `workspaceScoped: true` can be overridden per workspace.

```typescript
const disposable = api.settings.register({
  label: 'My Extension Settings',
  properties: {
    'myext.enabled': {
      type: 'boolean',
      label: 'Enable feature',
      default: true,
      workspaceScoped: true, // Can be overridden per workspace
    },
    'myext.apiUrl': {
      type: 'string',
      label: 'API URL',
      description: 'The endpoint to call',
      default: 'https://example.com',
    },
    'myext.timeout': {
      type: 'number',
      label: 'Timeout (ms)',
      default: 5000,
      min: 100,
      max: 30000,
    },
    'myext.mode': {
      type: 'enum',
      label: 'Mode',
      default: 'fast',
      options: ['fast', 'safe', 'verbose'],
    },
  },
})

// Read a value (workspace setting takes precedence when in a workspace context)
const url = api.settings.get<string>('myext.apiUrl')
```

**Naming**: prefix all setting keys with your extension ID to avoid collisions. The host enforces this at registration time.

---

### `api.sidebar` — Sidebar Contributions

#### Register a simple sidebar item

Adds a clickable item beneath the workspace list.

```typescript
const disposable = api.sidebar.registerItem({
  id: 'my-panel-trigger',
  label: 'My Panel',
  tooltip: 'Open My Panel',
  onClick: () => {
    /* handle click */
  },
})
```

#### Register a full sidebar panel _(v1.1.0)_

Registers a React component as a full UI panel in a layout slot (e.g., the right sidebar).

```typescript
import { GitSidebarPanel } from './components/GitSidebarPanel'

const disposable = api.sidebar.registerPanel('right-sidebar', {
  id: 'git-changes',
  title: 'Git Changes',
  component: GitSidebarPanel,
  defaultVisible: api.settings.get('git.sidebar.defaultOpen') ?? false,
})
```

Available slots: `'right-sidebar'`. More slots will be added in future API versions.

---

### `api.topBar` — Project View Menu Items _(v1.1.0)_

Register a menu item in the top bar of the project view.

```typescript
const disposable = api.topBar.registerMenuItem({
  id: 'git-view-toggle',
  label: 'Git',
  tooltip: 'Open Git view',
  onClick: () => openGitView(),
})
```

---

### `api.contextMenu` — Context Menu Contributions

Add items to right-click menus.

```typescript
// Available targets: 'workspace' | 'project' | 'tab' | 'terminal'
const disposable = api.contextMenu.registerItem('workspace', {
  id: 'open-in-editor',
  label: 'Open in Editor',
  onClick: (workspaceId) => {
    // workspaceId is the id of the right-clicked entity
  },
})
```

---

### `api.keyboard` — Keyboard Shortcuts

Register a keyboard shortcut. Throws synchronously if the accelerator conflicts with a reserved core shortcut.

```typescript
const disposable = api.keyboard.register('CmdOrCtrl+Shift+G', () => {
  // Handle shortcut
})
```

**Reserved shortcuts** (cannot be claimed by extensions):
`Cmd+1–9`, `Cmd++`, `Cmd+-`, `Cmd+Left`, `Cmd+Right`, `Cmd+T`, `Cmd+W`, `Cmd+,`

Use [Electron accelerator syntax](https://www.electronjs.org/docs/latest/api/accelerator).

---

### `api.terminal` — Terminal Session Events

Subscribe to terminal session lifecycle events.

```typescript
const onCreate = api.terminal.onSessionCreate((session) => {
  // session: { id, projectId, tabTitle, type: 'human' | 'agent' }
})

const onClose = api.terminal.onSessionClose((sessionId) => {
  // sessionId: string
})
```

---

### `api.shell` — Sandboxed Shell Execution _(v1.1.0)_

Run `git` or `gh` commands in the main process. Execution is sandboxed to the current project directory.

```typescript
const result = await api.shell.exec({
  command: 'git', // 'git' or 'gh' only
  args: ['status', '--porcelain=v1', '-z'],
  cwd: projectRoot, // Must be within the project root
  timeoutMs: 5000, // Optional, default: 10000
})

if (result.exitCode !== 0) {
  api.notifications.showToast('error', `git status failed: ${result.stderr}`)
  return
}
// result.stdout contains the porcelain output
```

**Security**: `command` must be `'git'` or `'gh'`. `cwd` must be within the workspace folder. Arguments are passed directly to the OS — no shell expansion.

---

### `api.notifications` — Toasts _(v1.1.0)_

Display a toast notification using the application's standard feedback system.

```typescript
api.notifications.showToast('info', 'Checking git status...')
api.notifications.showToast('success', 'Committed 3 files')
api.notifications.showToast('warning', 'gh CLI not authenticated')
api.notifications.showToast('error', 'Could not create pull request')
```

Available types: `'info'` | `'success'` | `'warning'` | `'error'`

---

### `api.nativeMenu` — Native Application Menu _(v1.1.0)_

Add items to the application's native **View** menu (macOS menu bar, Windows/Linux system menu).

```typescript
const disposable = api.nativeMenu.addViewMenuItem({
  id: 'git-sidebar-toggle',
  label: 'Toggle Git Sidebar',
  accelerator: 'CmdOrCtrl+Shift+G', // Optional; shown next to label in menu
  onClick: () => toggleSidebar(),
})
```

Items appear in registration order within the View submenu. Disposing removes the item and rebuilds the menu. Use this alongside `api.keyboard.register()` for the same action — the native menu item gives discoverability at the OS level; the keyboard shortcut gives speed.

---

### `api.fs` — File System Watch Events _(v1.1.0)_

Subscribe to file change events for the current project root. Uses OS-level `fs.watch` with polling fallback.

```typescript
const watcher = api.fs.watch((event) => {
  // event: { projectRoot, eventType: 'change' | 'rename', filename: string | null }
  scheduleStatusRefresh(event.projectRoot)
})

// In deactivate():
watcher.dispose()
```

**Note**: `filename` may be `null` on some Linux filesystems when using the polling fallback.

---

### `api.ipc` — Custom IPC Handlers _(v1.1.0)_

Register named IPC handlers in the main process. The renderer side calls these via `window.electronAPI.invoke(channel, payload)`.

```typescript
const handler = api.ipc.registerHandler('my-ext:do-thing', async (payload) => {
  // payload is the argument passed from the renderer
  const result = await someMainProcessWork(payload)
  return result // returned value is resolved to the renderer's invoke() call
})

// In deactivate():
handler.dispose()
```

**Channel naming**: prefix every channel with your extension ID followed by `:` to avoid collisions with core channels and other extensions. For example `com.acme.my-ext:fetch-data`.

**Error handling**: throw or return `{ error: string }` to signal failure. The renderer receives the rejection or error payload.

---

## Disposables

Every registration method returns a `Disposable`:

```typescript
interface Disposable {
  dispose(): void
}
```

Calling `dispose()` undoes the registration. If you do not call `dispose()` in `deactivate()`, the extension host cleans up automatically on unload.

**Best practice** — collect and dispose all registrations:

```typescript
const disposables: Array<{ dispose(): void }> = []

export function activate(api: ExtensionAPI): void {
  disposables.push(api.sidebar.registerItem({ ... }))
  disposables.push(api.keyboard.register('CmdOrCtrl+Shift+H', () => {}))
  disposables.push(api.fs.watch((event) => { ... }))
}

export function deactivate(): void {
  disposables.forEach(d => d.dispose())
  disposables.length = 0
}
```

---

## Renderer Extensions (`renderer.tsx`)

Some extensions need to contribute UI directly into the renderer: sidebar panels with React components, additional project tabs, or renderer-side keyboard shortcuts. This is done through a second entry point — `renderer.tsx` — that runs in the renderer process.

### When you need `renderer.tsx`

- Your extension contributes a **sidebar panel** (React component in the right sidebar)
- Your extension contributes a **project tab** (a new tab in the project view)
- Your extension needs **renderer-side keyboard shortcuts** (beyond the main-process bindings from `api.keyboard`)

### Structure

```
my-extension/
├── manifest.json
├── package.json
└── src/
    ├── index.ts        # Main process: activate(api), IPC handlers, settings, etc.
    └── renderer.tsx    # Renderer process: self-registers UI components
```

### How it works

The host app uses a Vite glob import to discover `extensions/*/src/renderer.tsx` at build time. Each `renderer.tsx` is executed as a side effect on import and self-registers into the extension registry via `useExtensionRegistry`. The core app never imports your extension directly.

### Example `renderer.tsx`

```typescript
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { MyPanel } from './components/MyPanel'
import { MyProjectView } from './components/MyProjectView'

const registry = useExtensionRegistry.getState()

// Register a sidebar panel
registry.registerSidebarPanel({
  id: 'my-sidebar-panel',
  label: 'My Panel',
  component: MyPanel, // ComponentType<{ repoRoot: string | null; onClose: () => void }>
  defaultOpen: false,
})

// Register a project tab
registry.registerProjectTab({
  id: 'my-project-tab',
  label: 'My Tab',
  component: MyProjectView, // ComponentType<{ repoRoot: string | null }>
})

// Register a renderer-side keyboard shortcut
registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+Shift+M',
  description: 'Toggle my panel',
  action: () => useExtensionRegistry.getState().togglePanel('my-sidebar-panel'),
})
```

### Registry API

| Method                               | Description                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `registerSidebarPanel(panel)`        | Adds a React component to the right sidebar. Returns an unregister function.                                       |
| `registerProjectTab(tab)`            | Adds a tab to the project view. Returns an unregister function.                                                    |
| `registerGlobalTab(tab)`             | Adds a persistent tab to the global tab bar (survives workspace/project switches). Returns an unregister function. |
| `registerWorkspaceTab(tab)`          | _(v1.3.0)_ Adds a workspace-scoped tab icon to every workspace card header. Returns an unregister function.        |
| `registerKeyboardShortcut(shortcut)` | Binds a renderer-side keyboard shortcut. Returns an unregister function.                                           |
| `togglePanel(panelId)`               | Opens or closes a registered sidebar panel.                                                                        |
| `setActiveProjectTab(tabId)`         | Activates a registered project tab.                                                                                |
| `setActiveWorkspaceTab(tabId)`       | _(v1.3.0)_ Activates a registered workspace tab (or clears it when `null`).                                        |

Component prop shapes:

- Sidebar panel: `{ repoRoot: string | null; onClose: () => void }`
- Project tab: `{ repoRoot: string | null }`
- Global tab: `Record<string, never>` (reads state from stores internally)
- Workspace tab: `Record<string, never>` (reads active workspace from `useWorkspaceStore()` internally)

### Note on the internal import

`renderer.tsx` is the **only** place where importing from `src/renderer/extensions/registry` is permitted. All other extension code (including `index.ts`) must use only the `ExtensionAPI` object.

---

## Installing an Extension

**Pre-bundled extensions** (like the git integration) load automatically. No install step needed.

**Local extensions**:

1. Build your extension (compile TypeScript if needed, or use `.js` directly).
2. Open Terminator → `Cmd+,` → **Extensions**.
3. Click **Install from Directory** and select your extension directory.
4. The extension activates immediately.

Extensions persist across restarts.

---

## Disabling / Enabling

Toggle in Settings → Extensions. Disabling calls `deactivate()` and removes all contributions without restarting the app.

To disable per-workspace, add to `.terminator/settings.json` in your project root:

```json
{
  "com.example.my-extension": {
    "myext.enabled": false
  }
}
```

---

## Constraints

1. **No internal imports** — only the `ExtensionAPI` object. Do not import from `src/main/`, `src/renderer/`, or `src/shared/`. Exception: `renderer.tsx` may import `useExtensionRegistry` from `src/renderer/extensions/registry`.
2. **Shell commands**: `api.shell.exec` only allows `git` and `gh`. Any other command is rejected with `COMMAND_NOT_ALLOWED`.
3. **CWD scope**: `api.shell.exec` `cwd` must be within the current workspace folder.
4. **Panel slots**: only one panel per slot per extension.
5. **Settings key namespacing**: all setting keys must be prefixed with the extension ID (enforced at registration).
6. **IPC channel namespacing**: all channels registered via `api.ipc.registerHandler` must be prefixed with the extension ID followed by `:` (e.g., `com.acme.my-ext:channel-name`).
7. **Native menu**: `api.nativeMenu.addViewMenuItem` adds to the View submenu only. Other native menus (File, Edit, Help) are not exposed.
8. **API versioning**: breaking changes bump the MAJOR version. Additive changes bump MINOR. Check `api.app.version` to feature-detect if needed.

---

## Scaffolding CLI Reference

```bash
npm run create-extension -- <name> [options]
```

| Argument / Option | Description                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `<name>`          | Kebab-case extension name (e.g., `my-extension`). Becomes the directory name under `extensions/`. |
| `--id <id>`       | Reverse-domain extension ID (e.g., `com.acme.my-extension`). Defaults to `com.example.<name>`.    |
| `--dir <path>`    | Custom output directory. Defaults to `extensions/<name>`.                                         |
| `--help`          | Print usage and exit.                                                                             |

**Exit codes**: `0` success, `1` bad arguments, `2` directory already exists, `3` filesystem error.

The generated `src/index.js` is a complete working hello-world demonstrating all v1.2.0 API surfaces. v1.1.0-specific surfaces (shell, fs, registerPanel, topBar) and v1.2.0-specific surfaces (globalShortcut, registerGlobalTab, workspace, window, createNotification) are included as commented-out stubs with `// TODO:` markers so you can activate them incrementally. The v1.3.0 renderer-registry addition (`registerWorkspaceTab`) must be added manually to your `renderer.tsx`.

---

## Working Example

The pre-bundled git integration extension at `extensions/git-integration/` is the canonical real-world example. It demonstrates:

- `api.ipc.registerHandler` (custom git: and github: IPC channels)
- `api.sidebar.registerPanel` (right sidebar git status)
- `api.topBar.registerMenuItem` (Git view in project top bar)
- `api.shell.exec` (git status, diff, stage, commit; gh pr create)
- `api.notifications.showToast` (all operation outcomes)
- `api.fs.watch` (sidebar auto-refresh)
- `api.settings.register` with `workspaceScoped` settings
- `renderer.tsx` with a sidebar panel, a project tab, a workspace-scoped tab (Code Reviews — `registerWorkspaceTab`), and renderer keyboard shortcuts

The Code Reviews tab is registered as a workspace tab (`registerWorkspaceTab`), not a global tab. Its icon appears on hover in each workspace card header; clicking it shows the PR review UI scoped to that workspace's repository root.

---

## CSS Token Contract (`--tm-*`)

Extensions MUST use only `--tm-*` CSS custom properties for colors, typography, and spacing. The host application guarantees these tokens are set on `:root` before any extension CSS is evaluated.

**Using internal core tokens (`--bg-*`, `--text-*`, `--border-*`, `--accent`) or hardcoded hex values is a contract violation** and will break when the host design system evolves.

### Surface Backgrounds

| Token                | Default   | Usage                          |
| -------------------- | --------- | ------------------------------ |
| `--tm-bg-base`       | `#0C0C0F` | Deepest application background |
| `--tm-bg-surface`    | `#111116` | Panel and sidebar backgrounds  |
| `--tm-bg-elevated`   | `#18181F` | Modals, dropdowns, tooltips    |
| `--tm-bg-card`       | `#1C1C25` | Card and list item backgrounds |
| `--tm-bg-card-hover` | `#22222E` | Hovered card/list backgrounds  |
| `--tm-bg-input`      | `#16161C` | Form input backgrounds         |

### Text

| Token                 | Default   | Usage                         |
| --------------------- | --------- | ----------------------------- |
| `--tm-text-primary`   | `#E2E2EE` | Primary readable text         |
| `--tm-text-secondary` | `#7070A0` | Secondary / metadata text     |
| `--tm-text-muted`     | `#3A3A5A` | Hints, placeholders, disabled |

### Borders

| Token                | Default                  | Usage                 |
| -------------------- | ------------------------ | --------------------- |
| `--tm-border`        | `rgba(255,255,255,0.06)` | Subtle separators     |
| `--tm-border-strong` | `rgba(255,255,255,0.12)` | High-contrast borders |

### Semantic / Accent

| Token              | Default                 | Usage                                     |
| ------------------ | ----------------------- | ----------------------------------------- |
| `--tm-accent`      | `#5C6BC0`               | Primary accent — overridden per-workspace |
| `--tm-accent-dim`  | `rgba(92,107,192,0.18)` | Tinted accent background                  |
| `--tm-accent-glow` | `rgba(92,107,192,0.35)` | Glow / shadow effects                     |
| `--tm-danger`      | `#E05C5C`               | Error / destructive actions               |
| `--tm-success`     | `#4ade80`               | Success states                            |
| `--tm-warning`     | `#facc15`               | Warning / caution states                  |

### Spacing / Shape

| Token            | Default | Usage                              |
| ---------------- | ------- | ---------------------------------- |
| `--tm-radius-xs` | `4px`   | Extra-small radius (chips, badges) |
| `--tm-radius-sm` | `6px`   | Small radius (buttons, inputs)     |
| `--tm-radius-md` | `10px`  | Medium radius (cards, tiles)       |
| `--tm-radius-lg` | `16px`  | Large radius (modals, panels)      |

### Typography

| Token            | Usage                                                    |
| ---------------- | -------------------------------------------------------- |
| `--tm-font-ui`   | IBM Plex Sans — sidebar chrome, labels, dialogs, buttons |
| `--tm-font-mono` | IBM Plex Mono — terminals, code, file paths, diffs       |

### Migration from `--color-*`

If your extension was written before this contract existed, use this table:

| Old (remove)                         | New (use instead)        |
| ------------------------------------ | ------------------------ |
| `var(--color-bg, #161b22)`           | `var(--tm-bg-surface)`   |
| `var(--color-bg-secondary, #1a1a1a)` | `var(--tm-bg-base)`      |
| `var(--color-text, #e6edf3)`         | `var(--tm-text-primary)` |
| `var(--color-text-muted, #8b949e)`   | `var(--tm-text-muted)`   |
| `var(--color-border, #333)`          | `var(--tm-border)`       |
| `var(--color-accent, #58a6ff)`       | `var(--tm-accent)`       |
| `#98c379` (green)                    | `var(--tm-success)`      |
| `#e06c75` (red)                      | `var(--tm-danger)`       |
| `#d19a66` (orange)                   | `var(--tm-warning)`      |

Full contract reference: [`specs/003-pr-review/contracts/extension-token-api.md`](../specs/003-pr-review/contracts/extension-token-api.md)

---

## Extension API v1.2.0 — New Namespaces

These namespaces were added alongside the Task Vault extension (ADR-012).

### `api.sidebar.registerGlobalTab(tab)`

Registers a permanent tab in the top-level tab bar (next to terminal tabs). Survives workspace navigation.

```typescript
api.sidebar.registerGlobalTab({
  id: 'my-extension',
  label: 'My Extension',
  component: MyViewComponent,
  permanent: true,
})
```

### `registry.registerWorkspaceTab(tab)` _(v1.3.0, renderer registry only)_

Registers a workspace-scoped tab. Unlike `registerGlobalTab` (which adds an icon to the global sidebar header), workspace tabs appear as hover-reveal icons inside each workspace card header. Clicking one activates the tab's component in the main content area with that workspace set as active.

The component receives **no props** — it must read its workspace context from `useWorkspaceStore()` internally.

```typescript
// In renderer.tsx:
import React from 'react'
import { GitPullRequest } from 'lucide-react'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { MyWorkspaceView } from './components/MyWorkspaceView'

const registry = useExtensionRegistry.getState()

registry.registerWorkspaceTab({
  id: 'my-workspace-view',
  label: 'My View',
  icon: React.createElement(GitPullRequest),
  component: MyWorkspaceView, // ComponentType<Record<string, never>>
})
```

Inside `MyWorkspaceView`:

```typescript
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'

export function MyWorkspaceView() {
  const { workspaces, activeWorkspaceId } = useWorkspaceStore()
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  // ... render using activeWorkspace
}
```

**Tab mutual-exclusion rules:**

- Activating a workspace tab clears any active global tab and active project tab.
- Activating a global tab clears any active workspace tab.
- Clicking a project or session row clears any active workspace tab and shows the terminal.

**When to use workspace tab vs global tab:**

| Need                                                           | Use                    |
| -------------------------------------------------------------- | ---------------------- |
| Feature is scoped to one workspace at a time (e.g. PR reviews) | `registerWorkspaceTab` |
| Feature is truly app-global (e.g. Task Vault, notifications)   | `registerGlobalTab`    |

### `api.globalShortcut.register(accelerator, handler)`

Registers a global keyboard shortcut. Returns a `Disposable` — call `.dispose()` in `deactivate()`.

```typescript
const disposable = api.globalShortcut.register('CommandOrControl+Shift+Space', () => {
  // open overlay
})
disposables.push(disposable)
```

### `api.workspace` — Workspace and Project Access _(v1.2.0)_

Read-only access to the workspace list and per-workspace project list. Also provides delete-event subscriptions.

```typescript
const workspaces = api.workspace.list()
// [{ id, name, folderPath }, ...]

const projects = api.workspace.listProjects(workspaces[0].id)
// [{ id, workspaceId, name }, ...]

disposables.push(
  api.workspace.onDelete((workspaceId) => {
    // Clean up any state keyed to this workspace
  })
)
disposables.push(
  api.workspace.onProjectDelete((projectId) => {
    // Clean up any state keyed to this project
  })
)
```

---

### `api.window` — Auxiliary Window Management _(v1.2.0)_

Opens a secondary `BrowserWindow` that renders an extension-specific view from the same renderer URL with a `?view=` query param.

```typescript
api.window.openAuxiliary('my-extension-view', { runId: '123' })
// The renderer detects the `view` param and renders the corresponding component
```

Use `api.ipc.registerHandler` to back the auxiliary window's data needs.

---

### `api.notifications.createNotification(opts): Disposable`

Creates a persistent notification in the notification center (without an ephemeral toast). Supports optional action buttons with callbacks that run in the main process.

```typescript
const notif = api.notifications.createNotification({
  type: 'info',
  title: 'Build complete',
  message: '3 files changed',
  actions: [{ id: 'open', label: 'Open log', handler: () => openLogWindow() }],
})

// Remove the notification when the extension is torn down:
notif.dispose()
```

Returns a `Disposable` — calling `.dispose()` dismisses the notification.

### Renderer-side: `registry.registerKeyboardShortcut(shortcut)`

Registers a keyboard shortcut that fires a renderer-side action.

```typescript
registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+R',
  description: 'Open Weekly Review',
  action: () => myStore.getState().setView('review'),
})
```

### MCP Sidecar Pattern

Extensions can ship a standalone MCP stdio server. See ADR-013. The server reads `TASK_VAULT_PATH` from environment and registers tools via `@modelcontextprotocol/sdk`. Users configure it in their MCP client (Claude Desktop, etc.) pointing to the compiled `src/mcp/server.js` within the extension directory.

---

## Renderer UI

Extension UIs run in isolated `WebContentsView` contexts — completely separate from the host renderer. Your extension's `dist/index.html` loads with its own browser process and has `window.electronAPI` injected by a dedicated preload.

### Why isolation matters

- Extensions bundle their own React/framework — no version conflicts with the host.
- Your renderer cannot crash the host app.
- No rebuild of the core app ever required when you update extension UI.

### Getting started

Install the SDK for full TypeScript types:

```bash
npm install --save-dev @terminator/extension-sdk
```

Create `src/renderer/App.tsx`:

```tsx
import React from 'react'

export function App(): JSX.Element {
  const view = new URLSearchParams(window.location.search).get('view')
  // Route based on ?view= param from manifest.contributes.*.view
  return <div>Hello from {view} view</div>
}
```

Create `src/renderer/main.tsx`:

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const el = document.getElementById('app')!
createRoot(el).render(<App />)
```

Create `index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>My Extension</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

Create `vite.renderer.config.ts`:

```typescript
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
{ "scripts": { "build:renderer": "vite build --config vite.renderer.config.ts" } }
```

### `manifest.contributes` reference

| Key            | Type                                            | Description                                  |
| -------------- | ----------------------------------------------- | -------------------------------------------- |
| `globalTab`    | `{ label, icon?, view? }`                       | Top-level tab in the global tab bar          |
| `workspaceTab` | `{ label, icon?, view? }`                       | Tab scoped to the active workspace           |
| `projectTab`   | `{ label, view? }`                              | Tab scoped to a project                      |
| `sidebarPanel` | `{ label, icon?, defaultOpen?, view? }`         | Collapsible sidebar panel                    |
| `windowViews`  | `Array<{ id: string; view: string }>`           | Auxiliary window views                       |
| `commands`     | `Array<{ id, label, shortcut?, description? }>` | Keyboard shortcuts / command palette entries |

The `view` string is passed as `?view=VALUE` in the webview URL. One `index.html` serves all surfaces.

### Receiving workspace context

URL params on mount:

```typescript
const view = new URLSearchParams(window.location.search).get('view')
const repoRoot = new URLSearchParams(window.location.search).get('repoRoot')
```

Subscribe to live updates:

```typescript
useEffect(() => {
  return window.electronAPI.extensionBridge.on('workspace:changed', (data) => {
    const { repoRoot } = data as { repoRoot?: string | null }
    setRepoRoot(repoRoot ?? null)
  })
}, [])
```

### Commands and keyboard shortcuts

Commands declared in `contributes.commands` are registered by the core app. When a shortcut fires, the core broadcasts `ext:command:<id>` to the extension's webview:

```typescript
useEffect(() => {
  return window.electronAPI.extensionBridge.on('ext:command:my-ext:action', () => {
    // Handle command
  })
}, [])
```

### Calling extension IPC handlers

```typescript
const result = await window.electronAPI.extensionBridge.invoke('my-ext:my-handler', payload)
```

---

## Migration Guide: v1 → v2

If you have an existing extension using the `renderer.tsx` + registry import pattern:

1. **Create** `src/renderer/App.tsx` — render your existing components, route by `?view=` param.
2. **Create** `src/renderer/main.tsx` and `index.html` — standard Vite entry.
3. **Create** `vite.renderer.config.ts` and add `"build:renderer"` to `package.json`.
4. **Update** `manifest.json` — add `"renderer": "dist/index.html"` and `"contributes": { ... }`.
5. **Run** `npm run build:renderer` to verify `dist/index.html` is produced.
6. **Delete** `src/renderer.tsx` (old bundled renderer).
7. **Replace** `useExtensionRegistry` imports in renderer code with `window.electronAPI.extensionBridge` calls.
8. **Replace** registry keyboard shortcuts with `contributes.commands` entries in the manifest.
9. **Replace** overlay components with `extensionBridge.on('ext:command:<id>', ...)` handlers.

Key behavioural differences in the webview model:

- `registry.setActiveGlobalTab()` — not available. Navigation between extension surfaces uses URL params.
- `registry.updateGlobalTab(..., { badge })` — not available. Badge updates require a separate IPC mechanism if needed.
- Core store imports (`useWorkspaceStore`, etc.) — not available. Use `extensionBridge` and URL params instead.
