# Extension Development Guide

Extensions allow you to add functionality to Terminator without modifying its core code. They run in the main process and contribute to four integration points: settings, sidebar, context menus, and keyboard shortcuts.

---

## Extension Structure

An extension is a directory with two required files:

```
my-extension/
├── extension.json   # Manifest
└── index.js         # Entry point (CommonJS)
```

### Manifest (`extension.json`)

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "A short description of what this extension does.",
  "main": "index.js",
  "minAppVersion": "0.1.0"
}
```

| Field           | Required | Description                                                              |
| --------------- | -------- | ------------------------------------------------------------------------ |
| `id`            | Yes      | Reverse-domain identifier. Must be unique. Example: `com.acme.git-tools` |
| `name`          | Yes      | Human-readable name shown in the Extensions panel                        |
| `version`       | Yes      | Semver string (`X.Y.Z`)                                                  |
| `description`   | Yes      | Shown in the Extensions panel                                            |
| `main`          | Yes      | Relative path to the entry point file                                    |
| `minAppVersion` | Yes      | Minimum Terminator version required (semver range, e.g. `0.1.0`)         |

---

## Entry Point

The entry point must export an `activate` function. It may optionally export `deactivate`.

```js
// index.js

/**
 * Called when the extension is loaded or enabled.
 * @param {ExtensionAPI} api
 */
function activate(api) {
  // Register contributions here
}

/**
 * Called when the extension is disabled (without app restart).
 * Clean up any resources not covered by Disposable.dispose().
 */
function deactivate() {
  // Optional cleanup
}

module.exports = { activate, deactivate }
```

If `activate` throws, the extension transitions to `status: 'error'` and the app remains stable. The error message is shown in the Extensions panel.

---

## ExtensionAPI Reference

The `api` object passed to `activate` provides access to all contribution points.

### `api.app`

```js
api.app.version // string — current Terminator version, e.g. "0.1.0"
```

### `api.settings`

Register a settings section that appears in both the Global and Workspace settings panels.

```js
const disposable = api.settings.register({
  label: 'My Extension Settings',
  properties: {
    apiUrl: {
      type: 'string',
      label: 'API URL',
      description: 'The endpoint to call',
      default: 'https://example.com',
    },
    timeout: {
      type: 'number',
      label: 'Timeout (ms)',
      default: 5000,
      min: 100,
      max: 30000,
    },
    enabled: {
      type: 'boolean',
      label: 'Enable feature',
      default: true,
    },
    mode: {
      type: 'enum',
      label: 'Mode',
      default: 'fast',
      options: ['fast', 'safe', 'verbose'],
    },
  },
})

// Read a setting value (respects workspace overrides)
const url = api.settings.get('apiUrl')
```

Call `disposable.dispose()` in `deactivate()` to remove the settings section.

### `api.sidebar`

Add an item below the workspace list in the sidebar.

```js
const disposable = api.sidebar.registerItem({
  id: 'my-panel',
  label: 'My Panel',
  tooltip: 'Open My Panel',
  onClick: () => {
    // Handle click
  },
})
```

### `api.contextMenu`

Add items to right-click menus. The `target` parameter specifies which context menu to inject into.

```js
// Available targets: 'workspace', 'project', 'tab', 'terminal'
const disposable = api.contextMenu.registerItem('workspace', {
  id: 'open-in-editor',
  label: 'Open in Editor',
  onClick: (workspaceId) => {
    // workspaceId is the id of the workspace that was right-clicked
    console.log('Open workspace:', workspaceId)
  },
})
```

### `api.keyboard`

Register a keyboard shortcut. Throws synchronously if the accelerator conflicts with a reserved core shortcut.

```js
const disposable = api.keyboard.register('CmdOrCtrl+Shift+K', () => {
  // Handle shortcut
})
```

**Reserved shortcuts** — cannot be claimed by extensions:
`Cmd+1–9`, `Cmd++`, `Cmd+-`, `Cmd+Left`, `Cmd+Right`, `Cmd+T`, `Cmd+W`, `Cmd+,`

Use Electron accelerator syntax. See the [Electron Accelerator docs](https://www.electronjs.org/docs/latest/api/accelerator).

### `api.terminal`

Subscribe to terminal session lifecycle events.

```js
const onCreate = api.terminal.onSessionCreate((session) => {
  // session: { id, projectId, tabTitle, type: 'human' | 'agent' }
  console.log('New session:', session.id)
})

const onClose = api.terminal.onSessionClose((sessionId) => {
  console.log('Session closed:', sessionId)
})
```

---

## Disposables

Every registration method returns a `Disposable`:

```js
interface Disposable {
  dispose(): void
}
```

Call `dispose()` to undo the registration (remove the menu item, unregister the shortcut, etc.). If you do not call `dispose()` during `deactivate()`, the extension host cleans up automatically when the extension is unloaded.

**Best practice**: collect disposables and dispose all of them in `deactivate()`:

```js
const disposables = []

function activate(api) {
  disposables.push(api.sidebar.registerItem({ ... }))
  disposables.push(api.keyboard.register('CmdOrCtrl+Shift+X', () => {}))
}

function deactivate() {
  disposables.forEach(d => d.dispose())
  disposables.length = 0
}
```

---

## Installing an Extension

1. Open Terminator.
2. Press `Cmd+,` to open Settings → select **Extensions**.
3. Click **Install from Directory** and select your extension directory.
4. The extension is activated immediately if it loads without errors.

Extensions persist across app restarts. Enabled extensions are reloaded automatically on startup.

---

## Disabling / Re-enabling

Use the toggle in Settings → Extensions. Disabling calls `deactivate()` and removes all contributions without restarting the app. Re-enabling calls `activate()` again.

---

## Working Example

A complete working extension is at `tests/fixtures/sample-extension/`. It demonstrates:

- Registering a settings section
- Adding a workspace context menu item
- Registering a keyboard shortcut

Study it as a starting point.

---

## Constraints

1. **No internal imports** — extensions must not import from `src/main/`, `src/renderer/`, or `src/shared/`. The `ExtensionAPI` object is the only allowed interface.
2. **CommonJS only** — extension entry points must use `module.exports`, not ES module `export`. The extension host uses `require()`.
3. **Synchronous `activate`** — `activate` may return a Promise (async), but errors thrown synchronously or from the resolved Promise both result in `status: 'error'`.
4. **Main process context** — extensions run in the Electron main process with full Node.js access. Future versions may sandbox extensions in a separate process.
