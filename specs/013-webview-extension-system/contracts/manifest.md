# Contract: Extension Manifest (`manifest.json`)

**Version**: 2.0.0
**Feature**: 013-webview-extension-system
**Date**: 2026-06-24

---

## Overview

Every Terminator extension must have a `manifest.json` at the root of its directory. The manifest is the only configuration the core app reads. Extensions never modify core application code.

## Schema

```json
{
  "id": "com.example.my-tool",
  "name": "My Tool",
  "version": "1.0.0",
  "description": "Short description (shown in Settings UI).",
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
      "label": "My Tool",
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

---

## Field Reference

### Top-level fields

| Field           | Type     | Required | Description                                                                                                                   |
| --------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `string` | ✅       | Reverse-domain ID. Pattern: `/^[a-z0-9]+(\.[a-z0-9-]+)+$/`. Must be globally unique.                                          |
| `name`          | `string` | ✅       | Human-readable display name. Max 100 chars.                                                                                   |
| `version`       | `string` | ✅       | Semver string (X.Y.Z).                                                                                                        |
| `description`   | `string` | ✅       | Short description for Settings UI. Max 300 chars.                                                                             |
| `main`          | `string` | ✅       | Relative path to the CommonJS main entry (from manifest directory). Must end in `.cjs` or be a `.js` file exporting CommonJS. |
| `renderer`      | `string` | ❌       | Relative path to the HTML renderer entry. If absent, the extension has no UI.                                                 |
| `minAppVersion` | `string` | ✅       | Minimum compatible app version (semver). Extensions are rejected at install if the running app version is below this.         |
| `contributes`   | `object` | ❌       | UI surface declarations. Required if `renderer` is present. Ignored if `renderer` is absent.                                  |

### `contributes` fields

All `contributes` surface keys are optional. An extension with `renderer` but no `contributes` loads a webview but registers no tab/panel entries.

#### `contributes.globalTab`

Registers a tab in the global sidebar (workspace-independent).

| Field   | Type     | Required | Description                                                                                     |
| ------- | -------- | -------- | ----------------------------------------------------------------------------------------------- |
| `label` | `string` | ✅       | Tab label text. Max 50 chars.                                                                   |
| `icon`  | `string` | ❌       | Icon name from the curated set (see below). Defaults to `puzzle`.                               |
| `view`  | `string` | ❌       | Appended as `?view=VALUE` to the webview URL. Allows one HTML entry to serve multiple surfaces. |

#### `contributes.workspaceTab`

Registers a tab in the workspace-level tab strip.

| Field   | Type     | Required | Description                     |
| ------- | -------- | -------- | ------------------------------- |
| `label` | `string` | ✅       | Tab label text. Max 50 chars.   |
| `icon`  | `string` | ❌       | Icon name from the curated set. |
| `view`  | `string` | ❌       | Passed as `?view=VALUE`.        |

#### `contributes.projectTab`

Registers a tab in the project-level tab strip.

| Field   | Type     | Required | Description                   |
| ------- | -------- | -------- | ----------------------------- |
| `label` | `string` | ✅       | Tab label text. Max 50 chars. |
| `view`  | `string` | ❌       | Passed as `?view=VALUE`.      |

#### `contributes.sidebarPanel`

Registers a collapsible panel in the right sidebar.

| Field         | Type      | Required | Description                                                    |
| ------------- | --------- | -------- | -------------------------------------------------------------- |
| `label`       | `string`  | ✅       | Panel header label. Max 50 chars.                              |
| `defaultOpen` | `boolean` | ❌       | Whether the panel is expanded by default. Defaults to `false`. |
| `view`        | `string`  | ❌       | Passed as `?view=VALUE`.                                       |

#### `contributes.windowViews`

Array of auxiliary window view registrations. Each opens in a separate `BrowserWindow` via `api.window.openAuxiliary()`.

| Field  | Type     | Required | Description                                                           |
| ------ | -------- | -------- | --------------------------------------------------------------------- |
| `id`   | `string` | ✅       | Unique view ID used to open the view. Pattern: `/^[a-z][a-z0-9-]*$/`. |
| `view` | `string` | ✅       | Passed as `?view=VALUE` to the webview URL.                           |

#### `contributes.commands`

Array of keyboard command registrations.

| Field         | Type     | Required | Description                                                                    |
| ------------- | -------- | -------- | ------------------------------------------------------------------------------ |
| `id`          | `string` | ✅       | Unique command ID. Pattern: `/^[a-z0-9-]+:[a-z0-9-]+$/` (e.g. `my-tool:open`). |
| `label`       | `string` | ✅       | Human-readable label (shown in command palette).                               |
| `shortcut`    | `string` | ❌       | Electron accelerator string (e.g. `CmdOrCtrl+Shift+M`). Registered globally.   |
| `description` | `string` | ❌       | Tooltip / description for Settings UI.                                         |

When a registered shortcut fires, the core broadcasts `ext:command:{id}` to the extension's `WebContentsView` via `webContents.send()`. The extension listens inside its renderer:

```js
window.electronAPI.extensionBridge.on('ext:command:my-tool:open', () => {
  /* open panel */
})
```

---

## Curated Icon Names

Use these strings in `contributes.*.icon`. Unrecognized names fall back to `puzzle`.

`puzzle`, `wrench`, `terminal`, `git-branch`, `git-pull-request`, `database`, `code`, `layers`, `settings`, `file`, `search`, `box`, `star`, `zap`, `globe`, `cpu`, `flask`, `chart-bar`, `list`, `calendar`

---

## Validation Rules

1. `id` must match `/^[a-z0-9]+(\.[a-z0-9-]+)+$/` — no uppercase, at least two segments.
2. `version` must be a valid semver string (three dot-separated integers).
3. `minAppVersion` must be a valid semver string.
4. `main` path must resolve to an existing file within the extension directory at install time.
5. `renderer` path (if present) must resolve to an existing `.html` file within the extension directory.
6. `contributes.commands[].shortcut` is validated as a non-empty string; accelerator validity is not pre-checked (invalid accelerators are silently skipped by Electron).
7. Unknown `contributes` keys are silently ignored.
8. Unknown top-level keys are silently ignored.

---

## Directory Layout (recommended)

```
my-extension/
├── manifest.json
├── dist/
│   ├── main.cjs           ← compiled Node.js main (CJS)
│   ├── index.html         ← renderer entry point
│   ├── index.js           ← renderer bundle
│   └── assets/
│       ├── logo.png
│       └── styles.css
└── src/
    ├── main/
    │   └── index.ts       ← extension main source
    └── renderer/
        ├── App.tsx         ← renderer source
        └── main.tsx        ← renderer entry
```

---

## Webview URL Format

When the core mounts a `WebContentsView` for a contribution, the URL is:

```
ext://{id}/dist/index.html?workspaceId={ws}&projectId={proj}&repoRoot={path}&view={viewParam}
```

- `workspaceId`, `projectId`, `repoRoot` — current active workspace context at mount time (may be empty strings if no workspace is active)
- `view` — the `view` field from the `contributes` surface entry (omitted if not declared)

The extension's renderer should read these from `new URLSearchParams(window.location.search)`.
