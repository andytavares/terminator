# Data Model: Webview-Isolated Extension System

**Feature**: 013-webview-extension-system
**Date**: 2026-06-24

---

## Entity: Extension

The runtime representation of an installed extension, stored in `electron-store` (file: `extensions.json` in the Electron userData directory).

| Field           | Type                                 | Required      | Description                                                                                                                 |
| --------------- | ------------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `string`                             | ✅            | Reverse-domain identifier, e.g. `com.acme.my-tool`. Unique key.                                                             |
| `name`          | `string`                             | ✅            | Human-readable display name.                                                                                                |
| `version`       | `string`                             | ✅            | Semver string (X.Y.Z).                                                                                                      |
| `description`   | `string`                             | ✅            | Short description displayed in Settings.                                                                                    |
| `entryPoint`    | `string`                             | ✅            | Absolute filesystem path to the compiled Node.js CJS main entry.                                                            |
| `rendererUrl`   | `string`                             | ❌            | `ext://` URL for the HTML renderer entry, e.g. `ext://com.acme.my-tool/dist/index.html`. Absent if the extension has no UI. |
| `contributes`   | `ExtensionContributes`               | ❌            | Parsed `contributes` block from `manifest.json`. Absent if the extension has no UI contributions.                           |
| `status`        | `'enabled' \| 'disabled' \| 'error'` | ✅            | Current activation state.                                                                                                   |
| `installedAt`   | `string`                             | ✅            | ISO 8601 datetime of installation.                                                                                          |
| `errorMessage`  | `string`                             | ❌            | Set when `status === 'error'`. Human-readable activation error.                                                             |
| `directoryPath` | `string`                             | ✅ (internal) | Absolute path to the extension's root directory. Used by `ext://` protocol handler. Never returned to the renderer.         |

**Identity & uniqueness**: `id` is the primary key. Duplicate `id` at install time returns `DUPLICATE_ID` error. ID format enforced by Zod: `/^[a-z0-9]+(\.[a-z0-9-]+)+$/`.

**State transitions**:

```
[not installed]
      │ install()
      ▼
   enabled ──── toggle(false) ──▶ disabled ──── toggle(true) ──▶ enabled
      │                                                               │
      │ activate() throws                                   activate() throws
      ▼                                                               ▼
   error ◀────────────────────────────────────────────────────────── error
      │
      │ reload()
      ▼
   enabled (or error again)
```

---

## Entity: ExtensionManifest

The on-disk `manifest.json` file format. Validated by Zod at install time.

```json
{
  "id": "com.acme.my-tool",
  "name": "My Tool",
  "version": "1.0.0",
  "description": "Short description of what this extension does.",
  "main": "dist/main.cjs",
  "renderer": "dist/index.html",
  "minAppVersion": "0.1.0",
  "contributes": {
    "globalTab": {
      "label": "My Tool",
      "icon": "wrench",
      "view": "main"
    },
    "workspaceTab": {
      "label": "My Tool WS",
      "icon": "layers",
      "view": "workspace"
    },
    "projectTab": {
      "label": "My Tool",
      "view": "project"
    },
    "sidebarPanel": {
      "label": "My Tool Panel",
      "defaultOpen": false,
      "view": "sidebar"
    },
    "windowViews": [{ "id": "my-detail", "view": "detail" }],
    "commands": [
      {
        "id": "my-tool:open",
        "label": "Open My Tool",
        "shortcut": "CmdOrCtrl+Shift+M",
        "description": "Open the My Tool panel"
      }
    ]
  }
}
```

**Field rules**:

- `main`: Relative path from manifest directory to the CJS main entry. Required.
- `renderer`: Relative path from manifest directory to the HTML renderer entry. Optional. If absent, extension has no UI.
- `minAppVersion`: Semver range. Extension is rejected if installed app version is below this.
- `contributes`: Optional. Each surface key is also optional. An extension without `contributes` (or without `renderer`) provides only main-process functionality.
- `contributes.*.view`: Optional string passed as `?view=VALUE` in the webview URL. If absent, no `view` param is appended.
- `contributes.*.icon`: Icon name string from the curated set. Resolved to a `lucide-react` component by the core. If absent or unrecognized, defaults to `Puzzle`.

---

## Entity: ExtensionContributes

The `contributes` block, stored on the `Extension` record and used by the renderer loader to register UI surfaces.

```typescript
interface ExtensionContributes {
  globalTab?: {
    label: string // max 50 chars
    icon?: string // curated icon name
    view?: string // passed as ?view=VALUE in webview URL
  }
  workspaceTab?: {
    label: string
    icon?: string
    view?: string
  }
  projectTab?: {
    label: string
    view?: string
  }
  sidebarPanel?: {
    label: string
    defaultOpen?: boolean
    view?: string
  }
  windowViews?: Array<{
    id: string // used with registry.registerWindowView(id, component)
    view: string
  }>
  commands?: Array<{
    id: string
    label: string
    shortcut?: string // Electron-style accelerator, e.g. "CmdOrCtrl+Shift+G"
    description?: string
  }>
}
```

---

## Entity: ExtensionPanelPortal (runtime, renderer-side)

Not persisted. A React component that renders a placeholder `<div>` for an extension surface. Uses `ResizeObserver` to report its bounds to the main process, which positions a `WebContentsView` to overlay it exactly.

| Property        | Type              | Description                                                                                 |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `extensionId`   | `string`          | Extension ID. Used to identify the target `WebContentsView` in main.                        |
| `viewParam`     | `string`          | The `view` value passed as a URL param to the WebContentsView URL.                          |
| `extensionName` | `string`          | Display name. Shown in the loading spinner.                                                 |
| `isActive`      | `boolean`         | Whether this surface is the currently selected tab/panel. Controls visibility sent to main. |
| `loading`       | `boolean` (state) | True until `extension:panel-loaded` IPC push is received. Controls spinner overlay.         |

## Entity: ExtensionWebContentsView (runtime, main-process-side)

Not persisted. A `WebContentsView` instance managed by `ExtensionViewHost` in the main process.

| Property      | Type              | Description                             |
| ------------- | ----------------- | --------------------------------------- |
| `view`        | `WebContentsView` | The Electron view instance.             |
| `extensionId` | `string`          | Extension ID.                           |
| `url`         | `string`          | The `ext://` URL loaded into this view. |
| `isLoaded`    | `boolean`         | True after `did-finish-load` fires.     |

---

## Entity: WebviewPreload (runtime, compiled artifact)

`src/main/preload-webview.ts` → compiled to `dist-electron/preload/webview.js`.

Exposes the same `window.electronAPI` surface as `src/main/preload.ts`. The webview preload's `ipcRenderer` connects directly to the main process (separate channel from the core renderer's `ipcRenderer`). No API restriction — all IPC channels accessible, with main-process handlers enforcing their own constraints.

---

## Entity: ExtensionSDK Package

`packages/extension-sdk/` — a standalone npm package published as `@terminator/extension-sdk`.

| File                  | Content                                                      |
| --------------------- | ------------------------------------------------------------ |
| `types/api.d.ts`      | Re-export of `ExtensionAPI` interface (main-process side)    |
| `types/renderer.d.ts` | Re-export of `ElectronAPI` interface (webview renderer side) |
| `types/index.d.ts`    | Barrel export + `ICON_NAMES` constant                        |
| `README.md`           | Getting started, build setup, manifest reference             |
| `package.json`        | `name: @terminator/extension-sdk`, `types: types/index.d.ts` |

---

## Curated Icon Names

The following icon name strings are valid in `contributes.*.icon`. Each maps to a `lucide-react` component in the core's `iconFromName()` helper. Unrecognized names fall back to `Puzzle`.

| Name               | Lucide Component |
| ------------------ | ---------------- |
| `puzzle`           | `Puzzle`         |
| `wrench`           | `Wrench`         |
| `terminal`         | `Terminal`       |
| `git-branch`       | `GitBranch`      |
| `git-pull-request` | `GitPullRequest` |
| `database`         | `Database`       |
| `code`             | `Code`           |
| `layers`           | `Layers`         |
| `settings`         | `Settings`       |
| `file`             | `File`           |
| `search`           | `Search`         |
| `box`              | `Box`            |
| `star`             | `Star`           |
| `zap`              | `Zap`            |
| `globe`            | `Globe`          |
| `cpu`              | `Cpu`            |
| `chart-bar`        | `BarChart`       |
| `list`             | `List`           |
| `calendar`         | `Calendar`       |
| `flask`            | `FlaskConical`   |

---

## New IPC Channels

| Channel                         | Direction                   | Handler                         | Description                                                                                                                                                                               |
| ------------------------------- | --------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension:update-panel-bounds` | renderer→main               | `ExtensionViewHost`             | Sent by `ExtensionPanelPortal` on mount, resize, and visibility change. Payload: `{ id, bounds: {x,y,width,height}, visible, dpr }`. Main calls `view.setBounds()` + `view.setVisible()`. |
| `extension:panel-loaded`        | main→renderer (push)        | —                               | Sent by main when `WebContentsView.webContents` fires `did-finish-load`. Payload: `{ id: string }`. Renderer dismisses spinner.                                                           |
| `extension:renderer-reload`     | main→renderer (push)        | —                               | Broadcast after `extension:reload` succeeds. Payload: `{ id: string }`. Renderer re-initiates bounds/visibility sync for the new view.                                                    |
| `workspace:get-active`          | webview→main                | `src/main/ipc/workspace.ipc.ts` | Returns `{ workspaceId, projectId, repoRoot }`. Called on-demand by extensions inside WebContentsViews.                                                                                   |
| `workspace:active-changed`      | renderer→main (send)        | `src/main/index.ts`             | Sent by renderer when active workspace/project changes. Main broadcasts `workspace:changed` to all `WebContentsView` instances.                                                           |
| `workspace:changed`             | main→WebContentsView (push) | —                               | Sent to all extension views when workspace/project changes. Payload: `{ workspaceId, projectId, repoRoot }`.                                                                              |
