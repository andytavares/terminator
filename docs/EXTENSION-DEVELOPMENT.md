# Extension Development Guide

An extension adds a feature to Terminator without touching the core. It has two halves: a **backend** that runs in the extension host process and talks to the core through the `ExtensionAPI` object, and an optional **view**, a web page the core shows in its own `WebContentsView`. The core and an extension meet only through the Extension SDK (Constitution II, [ADR 094](adr/094-extensions-follow-the-vs-code-model.md)).

The API is declared once, in `packages/extension-sdk/types/api.d.ts`. The core implements that declaration in `src/main/extensions/api.ts`, and the compiler checks the two agree. The SDK's current version is the `version` field of `packages/extension-sdk/package.json`; `packages/extension-sdk/CHANGELOG.md` lists what changed in each version and how to migrate.

The five built-in extensions in `extensions/` (Foundry, git-integration, notepad, remote-control, task-vault) follow every rule in this guide and are the working examples.

---

## Quick start

```bash
npm run create-extension -- my-extension
npm run create-extension -- my-extension --id com.acme.my-extension --dir /path/to/my-extension
```

`scripts/create-extension.cjs` writes `extensions/my-extension/` (or `--dir`) with a `package.json`, a `manifest.json` whose `main` is `src/index.js`, and a plain-JavaScript `src/index.js` that registers a setting, a command and a session listener. It does not create a view. Its commented-out examples show the rest of the API, including a channel registered as a spec with a zod schema.

| Argument       | Description                                                                           |
| -------------- | ------------------------------------------------------------------------------------- |
| `<name>`       | Kebab-case name. Becomes the directory name.                                          |
| `--id <id>`    | Reverse-domain id, such as `com.acme.my-extension`. Defaults to `com.example.<name>`. |
| `--dir <path>` | Output directory. Defaults to `extensions/<name>`.                                    |
| `--help`       | Print usage and exit.                                                                 |

Exit codes: `0` success, `1` bad arguments, `2` the directory already exists, `3` a file could not be written.

Run `npm install` at the repository root so the new workspace is linked, then `npm run dev`. Every directory under `extensions/` that holds a `manifest.json` is registered and activated at startup.

---

## Anatomy of an extension

A built-in extension, such as `extensions/task-vault/`, looks like this:

```
task-vault/
├── manifest.json            id, entry points, the surfaces it contributes
├── package.json             its own npm dependencies and the build:renderer script
├── tsconfig.json            extends ../../tsconfig.extension.json (typecheck only)
├── src/
│   ├── index.ts             backend: activate(api) / deactivate()
│   ├── index.js             esbuild output of index.ts (gitignored, never edited)
│   └── renderer/
│       ├── main.tsx         view entry: mountExtension(<App />)
│       └── App.tsx          routes on the ?view= parameter
├── index.html               view document with <div id="app">
├── vite.renderer.config.ts  builds the view into dist/
└── dist/index.html          the built view, named by manifest.renderer
```

`npm run build:extensions` (`scripts/build-extensions.cjs`) builds both halves of every extension: esbuild bundles `src/index.ts` into the file the manifest's `main` names (CommonJS, `platform: 'node'`), and when `vite.renderer.config.ts` exists it runs the extension's own `npm run build:renderer`. `npm run dev` and `npm run build` run it first. The compiled `src/index.js` is a build artifact: it is gitignored and never edited (Constitution X).

---

## The manifest

`manifest.json` is validated by `ExtensionManifestSchema` (`src/shared/schemas/extension.schema.ts`) when the extension is registered.

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "A short description of what this extension does.",
  "main": "src/index.js",
  "renderer": "dist/index.html",
  "minAppVersion": "0.1.0",
  "contributes": {
    "globalTab": { "label": "My Extension", "icon": "wrench", "view": "main" },
    "quickActions": { "group": { "mnemonic": "m", "label": "My Extension" } }
  }
}
```

| Field                   | Required | Description                                                                                                        |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                    | Yes      | Reverse-domain id (`^[a-z0-9]+(\.[a-z0-9-]+)+$`), such as `com.acme.git-tools`                                     |
| `name`                  | Yes      | Shown in Settings → Extensions                                                                                     |
| `version`               | Yes      | `X.Y.Z`                                                                                                            |
| `description`           | Yes      | Shown in Settings → Extensions                                                                                     |
| `main`                  | Yes      | The backend entry, CommonJS, relative to the extension directory                                                   |
| `renderer`              | No       | The view document, relative to the extension directory. Without it the extension has no view.                      |
| `minAppVersion`         | Yes      | The oldest app version it runs on. An older app marks the extension `error` and does not load it.                  |
| `contributes`           | No       | The surfaces and commands below                                                                                    |
| `extensionDependencies` | No       | Ids of extensions whose `activate` exports this one reads (see [Another extension's API](#another-extensions-api)) |

### `contributes`

Each surface shows the extension's view, with its `view` string passed as `?view=VALUE`, so one `index.html` serves every surface. `src/renderer/extensions/loader.ts` turns these entries into the core's tabs and panels; an extension cannot register a surface any other way.

| Key            | Fields                                                           | Where it appears                                                                           | Default `view` |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------- |
| `globalTab`    | `label`, `icon?`, `view?`                                        | An icon in the sidebar's app band; the view fills the main area                            | `main`         |
| `workspaceTab` | `label`, `icon?`, `view?`                                        | A tab scoped to the active workspace                                                       | `workspace`    |
| `projectTab`   | `label`, `view?`                                                 | A tab scoped to the selected project                                                       | `project`      |
| `sidebarPanel` | `label`, `icon?`, `defaultOpen?`, `view?`                        | A panel beside the terminal                                                                | `sidebar`      |
| `windowViews`  | `[{ id, view }]`                                                 | Views `api.window.openAuxiliary(id)` opens in their own window                             | —              |
| `commands`     | `[{ id, label, description?, shortcut?, mnemonic?, requires? }]` | Reserves the command's row in the Quick Actions panel (see [`api.commands`](#apicommands)) | —              |
| `quickActions` | `{ group: { mnemonic?, label } }`                                | Your group's letter and label in the Quick Actions panel                                   | —              |

`icon` takes one of the names `iconFromName` knows (`src/renderer/extensions/icon-from-name.ts`), such as `puzzle`, `wrench`, `terminal`, `git-branch`, `database`, `list` or `calendar`.

**Quick Actions letters.** Core letters are reserved for the core. Between extensions, load order wins a contested letter; the loser gets the first free letter of its own label and a warning is logged (`allocateExtensionGroups`, `src/renderer/quick-actions/groups.ts`).

---

## The backend

The `main` entry exports `activate` and may export `deactivate`:

```typescript
import type { Disposable, ExtensionAPI } from '@terminator/extension-sdk'

const disposables: Disposable[] = []

export function activate(api: ExtensionAPI): void {
  disposables.push(
    api.commands.register({ id: 'hello', label: 'Say hello' }, () =>
      api.notifications.showToast('info', 'Hello from My Extension', 'hello')
    )
  )
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
}
```

`activate` may be `async`. If it throws or rejects, the extension's status becomes `error` with the message, and nothing else is affected. What `activate` returns is the extension's API for other extensions.

### Where your backend runs

Every backend runs in the **extension host**, one Electron [`utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process) shared by all extensions and started by `src/main/extensions/host/host-process.ts`. It is never the main process. The API reaches the core over a `MessagePort`, which shapes it:

- A value the core holds is a promise: `settings.isBranchExcluded`, `globalShortcut.register`, `pty.spawnSession` / `openTerminal` / `getSession` / `setWorkspace` / `listSessions`, `workspace.addProject`, `ipc.isRemoteAccessible`, `dialog.*`, and every `issues` and `github` call.
- `settings.get`, `workspace.list` / `listProjects` and `issues.supportsTransitions` / `supportsCreate` are synchronous: they read a snapshot the core pushes on every change.
- A callback you pass (a command handler, a notification's `onClick`, `pty.onData`) stays in the extension host, and the core calls it by id. Registrations still return a `Disposable` at once.
- Values you pass and return must survive structured clone: plain data, no functions or class instances. An `Error` arrives with its `name` and `message`.
- `api.db` is the extension host's own connection to the app database, so `transaction(fn)` runs `fn` in your process.
- `electron` is not available. Use `api.paths` for `app.getAppPath()` and `app.getPath('userData')`, `api.dialog` for file dialogs, and `api.window` for windows. A store such as electron-store needs `cwd: api.paths.userData`. Node's own modules work: Remote Control's HTTP server runs here.

If the extension host crashes, the app stays up. It is restarted once and every backend activated
again in the same order as at startup: an extension after those in its `extensionDependencies`, so
`api.extensions.get` hands it the provider's new exports (keep nothing from the old ones). If a
provider does not come back, its dependants fail with it. If the host crashes again, the
extensions show as `error` in Settings → Extensions, with the reason on hover, until the next
launch. The panel shows such a change while it is open: it reads the list again each time main
broadcasts `extension:list-changed`.

Reloading an extension (or disabling and enabling it) runs your backend's code as it is on disk
then: the host forgets your entry point and every module under your extension directory before it
requires the entry point again. Packages from outside that directory stay loaded.

---

## What an extension may import

An extension imports only `@terminator/extension-sdk`, the design system `@terminator/extension-ui`, npm packages declared in its own `package.json`, and its own files. Core source (`src/**`), another extension and any other workspace package are off limits. `eslint.config.mjs` enforces it: `npm run lint` fails on a relative import that leaves the extension's directory or on any other `@terminator/*` package.

| Entry                                      | What it holds                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@terminator/extension-sdk`                | `ExtensionAPI` and its types, `ExtensionDB`, the issue-tracker and GitHub types, `defineChannel`, `dispatchChannel`, `noPayload`, `TaskVaultAPI` |
| `@terminator/extension-sdk/renderer`       | `invoke<T>(channel, payload = {})` for your own channels, and `mountExtension(<App />)`, which renders into `#app`                               |
| `@terminator/extension-sdk/node`           | `writeJsonAtomic(path, value)`: JSON through a temporary file and a rename, so a reader never sees half a file                                   |
| `@terminator/extension-sdk/types/renderer` | The `window.electronAPI` a view receives. `tsconfig.extension.json` loads it.                                                                    |

### Another extension's API

An extension's API is the value its `activate` returns. A consumer lists the provider in its manifest's `extensionDependencies` and reads that object with `api.extensions.get(id)`, the way VS Code's [`extensionDependencies`](https://code.visualstudio.com/api/references/extension-manifest) and `exports` work:

```jsonc
// manifest.json
{ "id": "com.example.planner", "extensionDependencies": ["terminator.task-vault"] }
```

```typescript
export function activate(api: ExtensionAPI): void {
  const vault = api.extensions.get('terminator.task-vault') // typed as TaskVaultAPI
  vault.open({ view: 'review' })
}
```

The host activates a provider before the extensions that depend on it. A dependency that is not installed, is disabled, failed to activate, or is part of a cycle fails the consumer's activation with a message naming it, and `get` throws for an id the manifest does not declare (`src/main/extensions/extension-host.ts`). The built-in providers' APIs are declared in the SDK (`types/extensions.d.ts`), so neither side imports the other; any other provider is read as `get<T>(id)`. A provider reloaded while its dependants run is not handed to them again: reload the dependants too.

### Dependencies

Declare every npm package the extension needs in its own `package.json`. `extensions/*` are npm workspaces, so `npm install` at the root hoists them. Versions are exact and each package has one version across the repository (Constitution IV, [ADR 097](adr/097-one-version-per-dependency.md)); `npm run lint:deps` (syncpack) checks it.

```json
{
  "name": "@terminator/extension-my-extension",
  "version": "0.1.0",
  "private": true,
  "scripts": { "build:renderer": "vite build --config vite.renderer.config.ts" },
  "dependencies": {
    "@terminator/extension-sdk": "4.0.0",
    "@terminator/extension-ui": "1.0.0",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "zod": "3.23.8"
  }
}
```

The workspace package versions shown are the ones in `packages/*/package.json` today; copy them from there. Never add an extension-only package to the root `package.json`.

---

## The view

A view is an ordinary web page. `ExtensionViewHost` (`src/main/extensions/extension-view-host.ts`) loads it into a `WebContentsView` placed over the area the core reserves for the surface:

- The URL is `ext://<extension id>/<manifest.renderer>?view=<view>&repoRoot=<path>`. The `ext://` protocol, registered in `src/main/index.ts`, serves only files inside the extension's directory, with `Cache-Control: no-store`.
- The view runs with `contextIsolation: true` and `nodeIntegration: false`, in the `ext-views` session partition, with the core's webview preload (`src/main/preload-webview.ts`). That preload gives the page `window.electronAPI`, typed by `@terminator/extension-sdk/types/renderer`.
- On every load the host injects the design system's stylesheet (tokens, icon scale, control resets) and stamps `data-theme` on `<html>`.
- The view is created the first time its surface is shown, after the extension's backend has activated (`ExtensionHost.whenActivated`), so it never calls a channel that is not registered yet.
- Reloading an extension from Settings → Extensions sends `extension:renderer-reload`, and the core remounts its views. The app does not need rebuilding.

### Setting up a view

`src/renderer/main.tsx` mounts the app and imports the fonts once:

```tsx
import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import '@terminator/extension-ui/fonts'
import { App } from './App'

mountExtension(<App />)
```

`src/renderer/App.tsx` routes on the surface's `view`:

```tsx
export function App(): JSX.Element {
  const view = new URLSearchParams(window.location.search).get('view')
  return view === 'sidebar' ? <Sidebar /> : <Main />
}
```

`index.html`:

```html
<!doctype html>
<html lang="en">
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

`vite.renderer.config.ts`:

```typescript
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'index.html') },
  },
})
```

### Talking to your backend

Call your own channels with `invoke` and listen for what your backend broadcasts with `extensionBridge.on`:

```typescript
import { invoke } from '@terminator/extension-sdk/renderer'

const result = await invoke<{ items: Item[] }>('my-ext:list', { limit: 20 })

useEffect(
  () =>
    window.electronAPI.extensionBridge.on('my-ext:changed', (data) => {
      setItems((data as { items: Item[] }).items)
    }),
  []
)
```

The backend side is [`api.ipc.registerHandler`](#apiipc) and [`api.window.broadcast`](#apiwindow).

### Workspace context

A view reads the repository it was opened for from the URL, and follows changes through `workspace:changed`, which the host also sends once when the view loads:

```typescript
const initial = new URLSearchParams(window.location.search).get('repoRoot')

useEffect(
  () =>
    window.electronAPI.extensionBridge.on('workspace:changed', (data) => {
      setRepoRoot((data as { repoRoot?: string | null }).repoRoot ?? null)
    }),
  []
)
```

`window.electronAPI.workspace.getActive()` answers what the operator has focused in the main window.

### Running another extension's command

A view can run a command another extension registered with an `args` schema ([ADR 083](adr/083-extension-commands-take-arguments.md)), by its full id `<extensionId>.command.<id>`:

```typescript
const key = 'terminator.git-integration.command.review-pull-request'
const result = await window.electronAPI.extension.runCommand(key, { repoRoot, number: 42 })
if (!result.ok && result.reason === 'not-registered') {
  // the provider is missing or disabled: fall back
}
await window.electronAPI.extension.hasCommand(key) // boolean
```

`runCommand` resolves `{ ok: true }` or `{ ok: false, reason }`; `reason` is `'not-registered'`, `'invalid-args: …'` or `'failed: …'`. It is not reachable over the remote bridge.

### Keys the core handles in your view

- **`⌘P` / `Ctrl+P`** opens the core's Quick Actions panel even while focus is in your view: the host watches `before-input-event` on every view (`isQuickActionsOpenShortcut`).
- **`Esc` twice within 500 ms** leaves your extension and returns the operator to their terminal ([ADR 026](adr/026-double-escape-extension-exit.md)). The listener in the webview preload is passive and bubble-phase, so your own single-`Esc` handlers run as normal. It stands down inside a text field and while a dialog is open; `Dialog` from the design system reports open dialogs over `electronAPI.ui.setModalDepth`, and a modal you write yourself must call it too. Do not stop `Esc` propagation at the window level, or the gesture stops working in your view.

---

## The design system — `@terminator/extension-ui`

The core and every extension build their UI from one design system (Constitution XIII, [ADR 098](adr/098-one-design-system-documented-in-storybook.md)), `packages/extension-ui`. It is source-only TypeScript with `react`, `react-dom` and `lucide-react` as peer dependencies. Every component has Storybook stories in both themes: `npm run storybook`.

```tsx
import { Dialog } from '@terminator/extension-ui'
;<Dialog
  title="Rename branch"
  onDismiss={close}
  actions={[
    { label: 'Cancel', onSelect: close },
    { label: 'Rename', tone: 'primary', onSelect: rename, disabled: !name.trim() },
  ]}
>
  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
</Dialog>
```

An action with `submit: true` makes the dialog a form: Enter in a field runs that action once.

| Export                                           | Use it for                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `Dialog`, `ConfirmDialog`                        | A modal question or form; yes/no with the consequence stated     |
| `Popover`                                        | A dropdown or picker: dismissible, not modal                     |
| `ToastRegion`, `Toast`                           | Transient messages, `role="status"`; mount the region once       |
| `EmptyState`                                     | Heading, one line of why, and the control that fills it          |
| `Button`, `IconButton`                           | Buttons; an icon-only control with an accessible name            |
| `Tabs`, `TabsRoot`, `TabList`, `Tab`, `TabPanel` | Accessible tabs: arrow keys, Home, End, `aria-selected`          |
| `SegmentedControl`                               | A small set of mutually exclusive options                        |
| `Markdown`                                       | Sanitised Markdown; links open through your `onOpenLink`         |
| `RelativeTime`, `formatRelativeTime`             | "5 minutes ago"; nothing for a time that does not parse          |
| `usePolling`, `everyWhileVisible`                | Read now and on an interval; tick only while the view is visible |
| `useDismissible`                                 | Outside-click, Escape and focus restore for your own surface     |
| `LAYERS`, `layerValue`, `nestedLayerValue`       | Stacking by name                                                 |

`packages/extension-ui/src/index.ts` is the complete export list.

What the package handles that is easy to get wrong alone:

- **Escape closes only the innermost surface.** Several dialogs in one document would otherwise all close on one keystroke.
- **A dialog renders in your view, never in the core.** The core cannot draw over a `WebContentsView` ([ADR 038](adr/038-dialogs-render-in-the-extension-view.md)).
- **Stacking comes from a named scale** (`panel` 100, `overlay` 200, `modal` 300, `toast` 400). A raw `z-index` number in an extension is a lint error.

### Styling

Every colour, space, radius, font and layer comes from the `--tm-*` tokens in `packages/extension-ui/src/tokens.css`, which the host injects into your document. The file holds both themes (`:root` is dark, `[data-theme='light']` light) and the host restamps `data-theme` when the operator switches. A hard-coded colour cannot follow the theme, and a `--tm-*` name that the file does not define makes the whole declaration invalid. Do not define tokens of your own.

- Fonts ship with the app: the `@terminator/extension-ui/fonts` import in your view entry bundles IBM Plex Sans and IBM Plex Mono beside your script. Without it your view draws in whatever fonts the machine has.
- Size lucide icons with the injected classes `tm-icon-sm` (12px), `tm-icon` (14px) and `tm-icon-lg` (16px). The `size` prop is a lint error in `extensions/*/src/**/*.tsx` (Constitution XII).
- Checkboxes and radios are themed by the injected stylesheet. Do not restyle them; `accent-color` has no effect.
- Diff and syntax colours (`--tm-diff-*`, `--tm-syntax-*`) clear WCAG AA against their backgrounds in both themes (`tests/unit/renderer/diff-syntax-contrast.spec.ts`).

`docs/EXTENSION-STYLE.md` holds the house rules: vocabulary, sentence case, button voice, empty states, icons, colour and layering. Its vocabulary rules are ESLint rules on `extensions/*/src/**/*.tsx`.

---

## ExtensionAPI reference

The `api` object passed to `activate` is the whole interface between the backend and the core. The namespaces below follow `packages/extension-sdk/types/api.d.ts`; read it for the exact types.

### `api.db`

One shared SQLite database, `<userData>/app.sqlite`, through Node's built-in [`node:sqlite`](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) (WAL journal, foreign keys on; [ADR 099](adr/099-node-sqlite-replaces-pglite.md)). The core creates no tables: create yours in `activate`, before you register handlers that read them. Prefix table names another extension could also choose; the `settings` table is shared and keyed `(extension_id, key)`.

```typescript
export async function activate(api: ExtensionAPI): Promise<void> {
  await api.db.exec(`CREATE TABLE IF NOT EXISTS my_notes (
    id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL
  )`)

  const rows = await api.db.query<{ id: string; body: string }>(
    'SELECT id, body FROM my_notes WHERE body LIKE ? ORDER BY created_at DESC',
    ['%todo%']
  )
  const first = await api.db.get('SELECT id FROM my_notes WHERE id = ?', ['a'])
  const changed = await api.db.run('DELETE FROM my_notes WHERE id = ?', ['a']) // rows changed

  await api.db.transaction(async (tx) => {
    await tx.run('INSERT INTO my_notes (id, body, created_at) VALUES (?, ?, ?)', [id, body, now])
    await tx.transaction(async (inner) => {
      // a nested call is a SAVEPOINT: if it throws and you catch it, only its writes are undone
    })
  })
}
```

The methods are `async` although SQLite is synchronous. Statements and transactions run one at a time in call order, so a statement issued while a transaction is open waits for it. Inside a transaction callback use the `tx` you are given, never `api.db`, or the call waits for the transaction that is waiting for it.

It is SQLite, not Postgres:

- Parameters are `?`, each a `string`, `number`, `bigint`, `null` or `Uint8Array`. `undefined` throws (`Provided value cannot be bound`): write `value ?? null`. Write booleans as `flag ? 1 : 0`.
- Store booleans as `INTEGER` 0/1, dates as ISO-8601 `TEXT`, JSON as `TEXT` read with `json_extract` / `json_remove`. Use `TEXT PRIMARY KEY` with `crypto.randomUUID()`, or `INTEGER PRIMARY KEY` for a rowid.
- `STRING_AGG(x, ',')` is `GROUP_CONCAT(x, ',')`. Prefer passing `new Date().toISOString()` over `datetime('now')`.
- There is no `ILIKE`. `LIKE` is case-insensitive for ASCII letters only: `'É' LIKE 'é'` is false.
- `ON CONFLICT (col) DO UPDATE SET v = excluded.v` and `ON CONFLICT DO NOTHING` work. `INSERT OR IGNORE` also drops rows that violate `NOT NULL` or `UNIQUE`; prefer `ON CONFLICT`.
- `COUNT(*)` comes back as a `number`.
- `ALTER TABLE ... ADD COLUMN` cannot add a `NOT NULL` column without a default. To change anything else, create a new table, copy and rename.
- Ask whether a column exists with `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`, and list tables with `SELECT name FROM sqlite_master WHERE type = 'table'`.
- Foreign keys are enforced. Inside a transaction, `PRAGMA defer_foreign_keys = ON` postpones the checks to commit.

Test against a real in-memory database (`new DatabaseSync(':memory:')`), not a mock; `extensions/notepad/tests/unit/db/db.spec.ts` shows how.

### `api.paths`

`paths.app` (Electron's `app.getAppPath()`) and `paths.userData` (`app.getPath('userData')`), taken when the extension activates.

### `api.dialog`

`showOpenDialog(options)` and `showSaveDialog(options)`: the operating system's file dialogs over the focused window, with a subset of Electron's options (`title`, `defaultPath`, `buttonLabel`, `filters`, and `properties` for open).

### `api.log`

`debug`, `info`, `warn` and `error`, written to the app's log under the extension's id.

### `api.settings`

`register(schema)` adds a section to Settings. A property with `workspaceScoped: true` can be overridden per workspace. Property types are `string`, `number`, `boolean`, `enum` (with `options`), `folder` and `action` (a button that invokes `channel`, optionally after `confirmMessage`); `secret` masks the value.

```typescript
api.settings.register({
  label: 'My Extension',
  properties: {
    'com.example.my-extension.enabled': {
      type: 'boolean',
      label: 'Enable feature',
      default: true,
      workspaceScoped: true,
    },
    'com.example.my-extension.mode': {
      type: 'enum',
      label: 'Mode',
      default: 'fast',
      options: ['fast', 'safe'],
    },
  },
})

const mode = api.settings.get<string>('com.example.my-extension.mode') // stored value, else the default
api.settings.set('com.example.my-extension.mode', 'safe')
```

Prefix every key with your extension id; nothing else keeps two extensions' keys apart.

`isBranchExcluded(branch, repoPath?)` resolves whether a branch matches Settings → Git → Branch Exclude Patterns: the override of the workspace that owns `repoPath`, else the global list. `*` matches anything, slashes included. The core owns the patterns, so your lists hide the same branches the core's pickers do:

```typescript
const excluded = await Promise.all(
  pulls.map((pr) => api.settings.isBranchExcluded(pr.headRefName, repoRoot))
)
const visible = pulls.filter((_, i) => !excluded[i])
```

### `api.globalShortcut`

`register(accelerator, handler)` binds a system-wide shortcut through Electron's `globalShortcut`; it fires even when another app is focused. It resolves to a `Disposable`, and rejects with `ACCELERATOR_TAKEN` when the accelerator is already held.

### `api.workspace`

```typescript
api.workspace.list() // [{ id, name, folderPath }]
api.workspace.listProjects(workspaceId) // [{ id, workspaceId, name, worktreePath? }]
```

`addProject(input)` registers a directory, such as a git worktree, as a project in a workspace, so it appears in the sidebar and can hold terminals. It resolves to the existing project when the workspace already has one for that **path**, and to `null` when it cannot be created. A name collision with a different path is disambiguated as `name (directory)`. The sidebar is told, so the project appears without a reload.

```typescript
const project = await api.workspace.addProject({
  workspaceId,
  name: 'feat/session-ulid',
  worktreePath: '/…/worktrees/feat-session-ulid',
  gitBranch: 'feat/session-ulid',
  isWorktree: true,
  issue: { tracker: 'linear', key: 'TAV-42' }, // optional: attach an issue as it is created
})
```

An `issue` is attached best-effort: if the link cannot be written the project is still returned. When the existing project is returned, the issue is attached to it.

`deleteProject(projectId)` removes a project and tells the sidebar; every terminal in it is closed (`src/main/terminal/project-sessions.ts`). Remove the project when you remove its worktree.

### `api.extensions`

`get(id)` returns another extension's `activate` exports. See [Another extension's API](#another-extensions-api).

### `api.shell`

`exec(options)` runs `git` or `gh`, never through a shell, and resolves for every outcome: read `exitCode`.

```typescript
const result = await api.shell.exec({
  command: 'git', // 'git' or 'gh'; anything else throws COMMAND_NOT_ALLOWED
  args: ['status', '--porcelain=v1', '-z'],
  cwd: repoRoot,
  timeoutMs: 5000, // default 10 000
})
if (result.exitCode !== 0) {
  api.notifications.showToast('error', `git status failed: ${result.stderr}`, 'gitFailed')
}
```

| Option               | What it does                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `timeoutMs`          | Past it the command is killed and resolves with `timedOut: true` and `exitCode` 124, as `timeout(1)` does                       |
| `maxBuffer`          | Most bytes kept per stream (default 1 MiB). Past it the command is stopped: `exceededMaxBuffer: true` and a non-zero `exitCode` |
| `env`                | Added over the minimal environment every command gets (PATH, HOME, git and gh credentials, `GIT_TERMINAL_PROMPT=0`)             |
| `encoding: 'buffer'` | `stdout` and `stderr` come back as bytes                                                                                        |
| `onOutput`           | Each chunk of stdout and stderr as it arrives, in text mode                                                                     |

Output is never trimmed. The core runs the command in the main process (`src/main/shell/shell-executor.ts`); a command that cannot start reports its spawn error as `stderr`. Unlike the renderer's `shell:exec` channel, `api.shell.exec` does not confine `cwd` to a workspace folder: a channel that takes a path from a caller must check it itself, as git-integration's `RepoRoot` schema does (`extensions/git-integration/src/ipc/repo-root.ts`).

### `api.github`

Pull requests and the GitHub API through the `gh` CLI the core runs. Each call takes a `GithubTarget`: the checkout gh runs in (`cwd`), or a repository without a checkout (`repository: 'owner/name'`), and optionally a `token` that is retried under gh's own login when GitHub rejects it.

```typescript
const target = { cwd: repoRoot }
const pr = await api.github.pullRequests.view(target, 42, ['number', 'title', 'state'])
const open = await api.github.pullRequests.list(target, {
  state: 'open',
  limit: 50,
  fields: ['number'],
})
const { number, url } = await api.github.pullRequests.create(target, { title, body, base, head })
await api.github.pullRequests.markReady(target, number)
await api.github.pullRequests.updateBranch(target, number)
const repo = await api.github.repositories.view(target, ['owner', 'name'])
await api.github.repositories.clone({ cwd: folder }, 'owner/name', 'name')

// Anything else in the REST or GraphQL API: the body as gh prints it.
const raw = await api.github.api(target, {
  path: 'repos/{owner}/{repo}/pulls/42/reviews',
  method: 'POST',
  body: { event: 'APPROVE' },
})
```

A failure rejects with a `GithubCommandError`: `message` is gh's own line, `stdout` holds GitHub's JSON error body, and `authenticationFailed`, `timedOut` and `exceededMaxBuffer` say why. `packages/extension-sdk/types/github.d.ts` has the full shape.

### `api.issues`

Linear and Jira are connected once, by the operator, in Settings → Integrations. An extension never holds a tracker credential and never contacts a tracker itself ([ADR 029](adr/029-core-issue-tracker-service.md)).

```typescript
const { issues, failures } = await api.issues.listMine({ limit: 25 })
for (const failure of failures) {
  if (failure.error !== 'not-connected') {
    api.notifications.showToast('warning', `${failure.tracker}: ${failure.error}`, 'fetchFailed')
  }
}

const found = await api.issues.search('session ulid')
const issue = await api.issues.get('linear', 'TAV-42') // description and comments are markdown
await api.issues.comment('linear', 'TAV-42', `PR opened: ${prUrl}`) // rejects on failure
const connected = await api.issues.connections() // never returns a credential
```

A tracker that fails is reported in `failures`; it does not fail the call. Say what is missing rather than showing a partial list as complete. An issue is identified by the pair `(tracker, key)`: two trackers can both have a `TAV-42`.

**Three writes, and only three**: a comment, a move along the issue's own workflow, and a new issue the operator asked for. There is no way to delete an issue or change a field of an existing one, and a test asserts the shape of that surface.

**Moving an issue** ([ADR 041](adr/041-an-extension-may-move-an-issue.md)):

```typescript
if (api.issues.supportsTransitions('linear')) {
  const options = await api.issues.states('linear', 'TAV-42') // what it can move to now
  await api.issues.transition('linear', 'TAV-42', 'in_review') // the tracker resolves the intent
  await api.issues.transition('linear', 'TAV-42', 'in_review', options[1].id) // or the operator's choice
}
```

The intent is `started`, `in_review` or `done`; the tracker decides which of its states that means. Only Linear implements it: `supportsTransitions('jira')` is `false`, and `states` / `transition` reject with the kind `unsupported`. Retry a failure; record an unsupported capability once and stop asking. Never emulate a move the tracker cannot make.

**Creating an issue** ([ADR 061](adr/061-one-project-per-order.md)), only on the operator's explicit word:

```typescript
if (api.issues.supportsCreate('linear')) {
  const teams = await api.issues.teams('linear')
  const issue = await api.issues.create('linear', {
    teamId: teams[0].id,
    title: 'Only list open tickets',
    description: 'Markdown body',
  })
}
```

Only Linear implements it; `teams` / `create` reject with `unsupported` for Jira. The types (`Issue`, `IssueListResult`, `TrackerConnection`, `TrackerId`, …) are exported from `@terminator/extension-sdk`; do not re-declare them.

### `api.notifications`

```typescript
api.notifications.showToast('success', 'Committed 3 files', 'committed')

const notification = api.notifications.createNotification({
  type: 'warning',
  title: 'Allow this command?',
  message: 'redis-cli -h prod-cache-01',
  key: 'permissionRequest',
  actions: [
    { id: 'allow', label: 'Allow', handler: () => allow() },
    { id: 'deny', label: 'Deny', handler: () => deny() },
  ],
  onClick: () => goToTheRun(), // where clicking the row goes
})
notification.dispose() // removes it
```

The extension never chooses where a notification appears. The core resolves its targets (system banner, notification centre, toast) from the operator's Settings → Notifications, with an optional per-extension override registered as the settings `<extensionId>.notify.<key>.system` / `.center` / `.toast`. An `error` always includes a toast. `key` names the kind of notification so the operator can configure it on its own.

**`actions` are answers; `onClick` is a destination.** Running an action settles the notification: the handler runs and the record is dropped. `onClick` leaves the row alone and makes it a link.

Navigating from a notification usually takes three calls, because your view may not exist yet:

```typescript
onClick: () => {
  api.window.focusSelf() // the window
  api.window.broadcast('extension:activate-global-tab', 'com.example.my-extension') // creates the view
  api.window.broadcast('my-ext:navigate', { itemId }) // where to go
}
```

The view may be created after that last broadcast, so hold the destination in the backend and let the view ask for it on mount: `extensions/task-vault/src/navigation.ts` is the pattern.

### `api.nativeMenu`

`addViewMenuItem({ id, label, onClick, accelerator?, type?, panelId? })` adds an item to the application's View menu; disposing it removes the item and rebuilds the menu. An `accelerator` here works while Terminator is focused. `type: 'checkbox'` with a `panelId` keeps the check mark in step with your sidebar panel.

### `api.commands`

`register(command, handler)` puts a command in the Quick Actions panel (`⌘P`). The handler receives a `CommandContext`, the core's focus at the moment it runs:

```typescript
api.commands.register(
  {
    id: 'push',
    label: 'Push',
    mnemonic: 'p', // one character, shown in the panel
    requires: 'repo', // 'repo' | 'session': dims the action with a stock reason otherwise
  },
  (ctx) => push(ctx.repoRoot!) // ctx: { projectId, sessionId, repoRoot }
)
```

A command declared in the manifest's `contributes.commands` but never registered shows dimmed with "Extension did not register this command": the manifest only reserves its row.

A command may declare a zod schema for `args`. Such a command is run by id from a view (see [Running another extension's command](#running-another-extensions-command)); the core validates the arguments before the handler runs, and only commands without `args` are listed in the panel.

```typescript
api.commands.register(
  {
    id: 'review-pull-request',
    label: 'Review pull request',
    args: z.object({ repoRoot: z.string().min(1), number: z.number().int().positive() }),
  },
  (ctx, args) => openReview(args.repoRoot, args.number)
)
```

A handler that needs to change your view broadcasts on your own channel, and brings the view forward:

```typescript
api.commands.register({ id: 'quick-create', label: 'New note', mnemonic: 'n' }, () => {
  api.window.broadcast('my-ext:ui.open-quick-create', {})
  api.window.showSelf('main')
})
```

`extensions/notepad/src/index.ts` (`notepad:quick-create`) and `extensions/task-vault/src/index.ts` (`task-vault:capture-to-inbox`) do this end to end, with a pending flag the view reads on mount for a command that fired before the view existed.

**`shortcut` binds nothing on its own.** It is shown beside the action in the panel. The one exception: a manifest command with a `shortcut` in an extension that contributes a `sidebarPanel` toggles that panel when the shortcut is pressed in the main window (`registerWebviewExtension`, `src/renderer/extensions/loader.ts`). To bind a key, use `api.nativeMenu.addViewMenuItem` with an `accelerator` (while Terminator is focused) or `api.globalShortcut.register` (from any app).

### `api.ipc`

`registerHandler(spec, options?)` registers an invoke channel that your view calls with `invoke(channel, payload)`. The core registers it in the main process and hands each call to your backend. Every channel is a `ChannelSpec` ([ADR 096](adr/096-every-ipc-channel-has-a-schema.md)), the same shape the core's own channels use: the channel name, a zod `schema`, the `invalid` response for a payload the schema rejects, and `run`, which receives the parsed payload.

```typescript
import { z } from 'zod'
import { defineChannel, noPayload } from '@terminator/extension-sdk'

const handler = api.ipc.registerHandler(
  defineChannel({
    channel: 'my-ext:do-thing',
    schema: z.object({ id: z.string().min(1) }),
    invalid: { error: 'VALIDATION_ERROR' },
    run: async ({ id }) => doThing(id),
  })
)

// A channel that takes nothing: the desktop view sends nothing, the remote bridge `{}`.
api.ipc.registerHandler(
  defineChannel({ channel: 'my-ext:status', schema: noPayload, invalid: null, run: () => status() })
)
```

`invalid` may be a function of the `ZodError`. An optional `onError(e)` turns an error `run` throws into a response instead of a rejected invoke. `registerHandler` throws for anything that is not a `ChannelSpec` with a schema, so a channel without one fails at activation. Do not re-check the payload inside `run`. To test, activate the extension and send each registered spec a malformed payload through `dispatchChannel`, asserting `run` is not called, rather than writing one rejection case per channel.

Name channels `<your prefix>:<name>` so they do not collide with the core's or another extension's; the core does not enforce a prefix.

**Remote access.** A channel is reachable only from the desktop app unless it is registered with `{ remoteAccessible: true }`; the remote-control bridge rejects every other channel. Opt in only the channels your view calls for ordinary use. Keep a channel local if it reads or writes a path the caller chooses, runs a command or arbitrary SQL, opens a native dialog or window, or administers the database: a remote client holds a password, not the desktop session, and the schema is the only check on what it sends. Foundry and git-integration keep their opted-in channels in one list each (`src/remote-access.ts`), and a spec in each extension asserts the list exactly.

`invokeChannel(channel, payload)` and `sendChannel(channel, payload)` call a registered handler from the backend; `onWindowEvent(channel, handler)` subscribes to the events the core pushes to the main window; `isRemoteAccessible(channel)` resolves whether the bridge admits a channel. Never use Electron's `ipcMain` directly.

### `api.terminal`

`onSessionCreate(handler)` receives `{ id, projectId, tabTitle, type }` for each new terminal; `onSessionClose(handler)` receives its id.

### `api.pty`

The core's `PtyManager` owns every terminal process and its metadata; an extension keeps no session registry of its own.

```typescript
const info = await api.pty.spawnSession({
  sessionId,
  cwd: '/repo',
  shell: '/bin/zsh',
  type: 'agent',
  origin: 'remote', // 'app' sessions belong to the desktop renderer
})
const stop = api.pty.onData(sessionId, (data) => send(data)) // batched, at most one per frame
api.pty.onExit(sessionId, (code) => cleanup(code)) // after the last batch of output
api.pty.write(sessionId, 'ls\r')
api.pty.resize(sessionId, 120, 40)
api.pty.kill(sessionId)

await api.pty.getSession(sessionId) // SessionInfo or undefined
await api.pty.setWorkspace(sessionId, 'ws-1') // null clears
await api.pty.listSessions()
```

`spawnSession` rejects with an error named `MissingCwdError` when `cwd` is not an existing directory. `onData` and `onExit` take any number of listeners and always return a disposer; a session that does not exist never calls them.

**A terminal the operator can see.** `spawnSession` gives a process and a stream but nothing on screen. `openTerminal` spawns a terminal and shows it as an ordinary tab in a project, typically one from `workspace.addProject`:

```typescript
const sessionId = await api.pty.openTerminal({
  projectId,
  cwd: worktreePath,
  tabTitle: branch,
  type: 'agent', // a person can still type into it
})
```

It resolves to `null` when the core cannot reach a window. Output produced before the tab mounts is held, not dropped, and released when it mounts. The tab's output reaches the window through the same batched, flow-controlled path as every terminal; use `api.pty.onData` in the backend to read it.

`closeTerminalTab(sessionId)` removes a tab `openTerminal` opened, ends its process if it still runs, and marks its session record closed. `kill` alone leaves the tab on screen marked `[exited]`:

```typescript
api.pty.onExit(sessionId, (exitCode) => {
  if (exitCode === 0) api.pty.closeTerminalTab(sessionId) // keep a failure on screen
})
```

### `api.window`

| Member                         | What it does                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `openAuxiliary(view, params?)` | Opens a window that loads your view document with `?view=<view>` and `params`. One window per `view`: a second call with params re-navigates it, without params it focuses it. |
| `broadcast(channel, data)`     | Sends `channel` to every window and every extension view                                                                                                                       |
| `focusSelf(viewParam?)`        | Focuses your view `viewParam` (default `main`) where it is already open                                                                                                        |
| `showSelf(view?)`              | Brings forward the surface you contributed for `view` and focuses it, as the core's "Open …" quick actions do                                                                  |
| `raise()`                      | Restores and focuses every application window                                                                                                                                  |

---

## Disposables

Every registration returns a `Disposable`. `dispose()` undoes it. Registrations you do not dispose in `deactivate` are disposed when the extension is unloaded.

---

## Installing, reloading and disabling

- **Built-in extensions** in `extensions/` load at startup with no install step.
- **A local extension**: build it, then Settings → Extensions → **Install from Directory**, and pick its directory. The backend activates at once; reload the window to show its surfaces. Installed extensions persist across restarts.
- **Reload** in Settings → Extensions unloads and activates the backend again and remounts its views, without rebuilding the app.
- **Disabling** an extension in Settings → Extensions calls its `deactivate` and disposes everything it registered.

---

## Constraints

1. Only the imports in [What an extension may import](#what-an-extension-may-import). `npm run lint` enforces it.
2. Reach the core only through `api`. Do not use `electron`, `ipcMain` or child processes for something the API covers; if it does not cover it, the API is extended first (Constitution II).
3. `api.shell.exec` runs only `git` and `gh`; anything else throws `COMMAND_NOT_ALLOWED`.
4. Every IPC channel has a schema, and is local-only unless registered `remoteAccessible`.
5. UI comes from the design system: its components, its tokens, its fonts (Constitution XIII), and `lucide-react` icons (Constitution XII).
6. `api.nativeMenu` adds to the View menu only.
7. The SDK follows semantic versioning: a breaking change bumps the major version, and `packages/extension-sdk/CHANGELOG.md` says how to migrate.
