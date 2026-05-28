# Extension API Contributions: Foundry

**Date**: 2026-05-28  
**Extension**: `terminator.foundry`  
**ExtensionAPI version**: v1.2.0  
**Registered in**: `extensions/foundry/src/renderer.tsx` (UI contributions) + `extensions/foundry/src/index.ts` (main process)

---

## Panels

### Right-Sidebar Panel

Registered via `api.panels.registerPanel('right-sidebar', panel)`.

| Field          | Value             |
| -------------- | ----------------- |
| id             | `foundry.sidebar` |
| title          | `Foundry`         |
| component      | `FoundryPanel`    |
| defaultVisible | `false`           |

**Displays**: Harness status bar + active run cards + "New run" button. Switches to first-run setup wizard when no AGENTS.md exists.

---

### History Global Tab

Registered via `api.panels.registerGlobalTab(tab)`.

| Field     | Value                       |
| --------- | --------------------------- |
| id        | `foundry.history`           |
| label     | `History`                   |
| icon      | `ti-history` (Tabler Icons) |
| component | `HistoryView`               |
| permanent | `false`                     |

**Displays**: Filterable run history table + gate timeline detail panel.

---

## Top Bar

### Start Foundry Run Button

Registered via `api.topBar.addItem(item)`.

| Field   | Value                                                 |
| ------- | ----------------------------------------------------- |
| id      | `foundry.start-run`                                   |
| label   | `Start Foundry Run`                                   |
| tooltip | `Start a new Foundry run in the active project (⌘⇧R)` |
| onClick | Opens NewRunWizard for the active workspace           |

---

## Commands (Command Palette)

All commands registered via `api.commands.register(command, handler)`.

| Command ID              | Label              | Category | Shortcut | Description                                       |
| ----------------------- | ------------------ | -------- | -------- | ------------------------------------------------- |
| `foundry:open-panel`    | Open Foundry Panel | Foundry  | `⌘⇧A`    | Opens the Foundry right-sidebar panel             |
| `foundry:new-run`       | Start New Run      | Foundry  | `⌘⇧R`    | Opens the New Run wizard for the active workspace |
| `foundry:open-history`  | Open Run History   | Foundry  | —        | Opens the History global tab                      |
| `foundry:open-settings` | Foundry Settings   | Foundry  | —        | Opens the harness settings view                   |
| `foundry:setup-harness` | Set Up Harness     | Foundry  | —        | Opens the first-run harness setup wizard          |

---

## Keyboard Shortcuts

Registered via `api.keyboard.register(accelerator, handler)`.

| Accelerator                | Action                                            |
| -------------------------- | ------------------------------------------------- |
| `CommandOrControl+Shift+A` | Open Foundry panel (same as `foundry:open-panel`) |
| `CommandOrControl+Shift+R` | Start new run (same as `foundry:new-run`)         |

---

## Sidebar Rail Icon

Registered via `api.sidebar.registerItem(item)`.

| Field   | Value                                   |
| ------- | --------------------------------------- |
| id      | `foundry.rail`                          |
| label   | `Foundry`                               |
| tooltip | `Foundry — Agentic Harness`             |
| onClick | Toggles the Foundry right-sidebar panel |

---

## Settings

Registered via `api.settings.register(schema)`.

| Key                                    | Type      | Label                       | Scope  | Default |
| -------------------------------------- | --------- | --------------------------- | ------ | ------- |
| `terminator.foundry.enabled`           | `boolean` | Enable Foundry              | global | `true`  |
| `terminator.foundry.defaultProviderId` | `string`  | Default Provider ID         | global | `""`    |
| `terminator.foundry.providers`         | `string`  | Providers JSON (no secrets) | global | `"[]"`  |

Workspace-level provider override is stored in `.foundry/harness.json` (not in app settings).

---

## Filesystem Watch

Registered via `api.fs.watch(handler)` in main process.

**Used for**: Detecting agent-written file changes during a run. When a `change` event fires for a file inside the active workspace root, the run engine checks if the file is within the workspace and adds it to the current iteration's `fileChanges` list.

**Events consumed**: `{ projectRoot, eventType: 'change' | 'rename', filename }` — only `change` and `rename` events within the active run's `workspaceRoot` are processed.

---

## Notifications

Used via `api.notifications.showToast(type, message)` for:

- Provider connection test result (success/error)
- Harness health alerts (sensor failing, feedforward gap, stale reference)
- Run abort confirmation
- Keychain storage unavailable warning

---

## Context Menu

No context menu contributions in v1.

---

## Native Menu

No native menu contributions in v1.
