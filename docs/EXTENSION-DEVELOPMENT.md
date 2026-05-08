# Extension Development Guide

Extensions let you add functionality to Terminator without touching its core code. They contribute to the application through the `ExtensionAPI` — a stable, versioned interface. This guide covers everything you need to write, test, and distribute an extension.

**Current API version**: 1.1.0

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
  "main": "src/index.ts",
  "minAppVersion": "0.1.0"
}
```

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Reverse-domain identifier, globally unique. Example: `com.acme.git-tools` |
| `name` | Yes | Human-readable name shown in the Extensions panel |
| `version` | Yes | Semver string (`X.Y.Z`) |
| `description` | Yes | Shown in the Extensions panel |
| `main` | Yes | Relative path to the entry point |
| `minAppVersion` | Yes | Minimum Terminator version required (semver, e.g. `0.1.0`) |

### Entry Point

The entry point must export an `activate` function and may export `deactivate`:

```typescript
import type { ExtensionAPI } from '../../src/main/extensions/api'

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
  disposables.forEach(d => d.dispose())
  disposables.length = 0
}
```

If `activate` throws, the extension transitions to `status: 'error'` and the app remains stable.

---

## ExtensionAPI Reference

The `api` object passed to `activate` is the sole interface between your extension and the host application. **Do not import from `src/main/`, `src/renderer/`, or `src/shared/` directly.**

### `api.app`

```typescript
api.app.version  // string — current Terminator version, e.g. "0.1.0"
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
      workspaceScoped: true,   // Can be overridden per workspace
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
  onClick: () => { /* handle click */ },
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
  command: 'git',                          // 'git' or 'gh' only
  args: ['status', '--porcelain=v1', '-z'],
  cwd: projectRoot,                        // Must be within the project root
  timeoutMs: 5000,                         // Optional, default: 10000
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
api.notifications.showToast('info',    'Checking git status...')
api.notifications.showToast('success', 'Committed 3 files')
api.notifications.showToast('warning', 'gh CLI not authenticated')
api.notifications.showToast('error',   'Could not create pull request')
```

Available types: `'info'` | `'success'` | `'warning'` | `'error'`

---

### `api.nativeMenu` — Native Application Menu _(v1.1.0)_

Add items to the application's native **View** menu (macOS menu bar, Windows/Linux system menu).

```typescript
const disposable = api.nativeMenu.addViewMenuItem({
  id: 'git-sidebar-toggle',
  label: 'Toggle Git Sidebar',
  accelerator: 'CmdOrCtrl+Shift+G',  // Optional; shown next to label in menu
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

1. **No internal imports** — only the `ExtensionAPI` object. Do not import from `src/main/`, `src/renderer/`, or `src/shared/`.
2. **Shell commands**: `api.shell.exec` only allows `git` and `gh`. Any other command is rejected with `COMMAND_NOT_ALLOWED`.
3. **CWD scope**: `api.shell.exec` `cwd` must be within the current workspace folder.
4. **Panel slots**: only one panel per slot per extension.
5. **Settings key namespacing**: all setting keys must be prefixed with the extension ID (enforced at registration).
6. **Native menu**: `api.nativeMenu.addViewMenuItem` adds to the View submenu only. Other native menus (File, Edit, Help) are not exposed.
7. **API versioning**: breaking changes bump the MAJOR version. Additive changes bump MINOR. Check `api.app.version` to feature-detect if needed.

---

## Scaffolding CLI Reference

```bash
npm run create-extension -- <name> [options]
```

| Argument / Option | Description |
|---|---|
| `<name>` | Kebab-case extension name (e.g., `my-extension`). Becomes the directory name under `extensions/`. |
| `--id <id>` | Reverse-domain extension ID (e.g., `com.acme.my-extension`). Defaults to `com.example.<name>`. |
| `--dir <path>` | Custom output directory. Defaults to `extensions/<name>`. |
| `--help` | Print usage and exit. |

**Exit codes**: `0` success, `1` bad arguments, `2` directory already exists, `3` filesystem error.

The generated `src/index.ts` is a complete working hello-world demonstrating all v1.1.0 API surfaces. v1.1.0-specific surfaces (shell, fs, registerPanel, topBar) are included as commented-out stubs with `// TODO:` markers so you can activate them incrementally.

---

## Working Example

The pre-bundled git integration extension at `extensions/git-integration/` is the canonical real-world example. It demonstrates:

- `api.sidebar.registerPanel` (right sidebar git status)
- `api.topBar.registerMenuItem` (Git view in project top bar)
- `api.shell.exec` (git status, diff, stage, commit; gh pr create)
- `api.notifications.showToast` (all operation outcomes)
- `api.fs.watch` (sidebar auto-refresh)
- `api.settings.register` with `workspaceScoped` settings
