# Extension Development Guide

An extension adds a feature to Terminator without touching the core. It has two halves. The **backend** runs in the extension host process and talks to the core through the `ExtensionAPI` object. The optional **view** is a web page. The core shows it in an `<iframe>` in its own window. The core and an extension meet only through the Extension SDK (Constitution II, [ADR 094](adr/094-extensions-follow-the-vs-code-model.md)).

The API is declared once, in `packages/extension-sdk/types/api.d.ts`. The core implements that declaration in `src/main/extensions/api.ts`. The compiler checks that the two agree. The SDK's current version is the `version` field of `packages/extension-sdk/package.json`. `packages/extension-sdk/CHANGELOG.md` lists the changes in each version and how to migrate.

The five built-in extensions in `extensions/` (Foundry, git-integration, notepad, remote-control, task-vault) follow every rule in this guide. They are the working examples.

---

## Quick start

```bash
npm run create-extension -- my-extension
npm run create-extension -- my-extension --id com.acme.my-extension --dir /path/to/my-extension
```

`scripts/create-extension.cjs` writes `extensions/my-extension/` (or `--dir`) with a `package.json`, a `manifest.json` whose `main` is `src/index.js`, and a plain-JavaScript `src/index.js` that registers a setting, a command and a session listener. It does not create a view. Its commented-out examples show the rest of the API. They include a channel registered as a spec with a zod schema.

| Argument       | Description                                                                           |
| -------------- | ------------------------------------------------------------------------------------- |
| `<name>`       | Kebab-case name. Becomes the directory name.                                          |
| `--id <id>`    | Reverse-domain id, such as `com.acme.my-extension`. Defaults to `com.example.<name>`. |
| `--dir <path>` | Output directory. Defaults to `extensions/<name>`.                                    |
| `--help`       | Print usage and exit.                                                                 |

Exit codes: `0` success, `1` bad arguments, `2` the directory already exists, `3` a file could not be written.

Run `npm install` at the repository root to link the new workspace. Then run `npm run dev`. At startup the app registers and activates every directory under `extensions/` that holds a `manifest.json`.

---

## Anatomy of an extension

A built-in extension, such as `extensions/task-vault/`, looks like this:

```
task-vault/
├── manifest.json            id, entry points, the surfaces it contributes
├── package.json             its own npm dependencies and the build:renderer script
├── tsconfig.json            extends ../../tsconfig.extension.json (typecheck only)
├── tsconfig.test.json       extends tsconfig.json and adds tests/ (typecheck only)
├── tsconfig.view.json       the view alone, without the Temporal types (ADR 108)
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

`npm run build:extensions` (`scripts/build-extensions.cjs`) builds both halves of every extension. esbuild bundles `src/index.ts` into the file that the manifest's `main` names (CommonJS, `platform: 'node'`). When `vite.renderer.config.ts` exists, the script runs the extension's own `npm run build:renderer`. `npm run dev` and `npm run build` run the script first. The compiled `src/index.js` is a build artifact. Git ignores it and nobody edits it (Constitution X).

---

## The manifest

`ExtensionManifestSchema` (`src/shared/schemas/extension.schema.ts`) validates `manifest.json` when the extension is registered. The host reads the file from disk at every start. A manifest change, such as a new `contributes` entry after a pull, shows after a restart. A manifest that no longer parses leaves the stored registration as it was.

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

| Field           | Required | Description                                                                                                                                                                                                                                        |
| --------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | Yes      | Reverse-domain id (`^[a-z0-9]+(\.[a-z0-9-]+)+$`), such as `com.acme.git-tools`                                                                                                                                                                     |
| `name`          | Yes      | Shown in Settings → Extensions                                                                                                                                                                                                                     |
| `version`       | Yes      | `X.Y.Z`. For the extensions in this repository, each release bumps the patch of every extension changed since the last release (`scripts/bump-extension-versions.mjs`), in `manifest.json` and `package.json`. About shows each installed version. |
| `description`   | Yes      | Shown in Settings → Extensions                                                                                                                                                                                                                     |
| `main`          | Yes      | The backend entry, CommonJS, relative to the extension directory                                                                                                                                                                                   |
| `renderer`      | No       | The view document, relative to the extension directory. Without it the extension has no view.                                                                                                                                                      |
| `minAppVersion` | Yes      | The oldest app version it runs on. An older app marks the extension `error` and does not load it.                                                                                                                                                  |
| `contributes`   | No       | The surfaces and commands below                                                                                                                                                                                                                    |

### `contributes`

Each surface shows the extension's view. The core passes the surface's `view` string as `?view=VALUE`, so one `index.html` serves every surface. `src/renderer/extensions/loader.ts` turns these entries into the core's tabs and panels. An extension cannot register a surface any other way.

A page shows only the view that its `?view=` names. An `App.tsx` that routes between heavy views can therefore load each view with [`React.lazy`](https://react.dev/reference/react/lazy) behind a `Suspense` boundary. Vite then builds each view as its own chunk ([dynamic import](https://vite.dev/guide/features#dynamic-import)). A page loads only the view it shows. git-integration's `src/renderer/App.tsx` does this.

| Key                | Fields                                                           | Where it appears                                                                                                                                   | Default `view` |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `globalTab`        | `label`, `icon?`, `view?`                                        | An icon in the sidebar's app band; the view fills the main area                                                                                    | `main`         |
| `workspaceTab`     | `label`, `icon?`, `view?`                                        | A tab scoped to the active workspace                                                                                                               | `workspace`    |
| `projectTab`       | `label`, `view?`                                                 | A tab scoped to the selected project                                                                                                               | `project`      |
| `sidebarPanel`     | `label`, `icon?`, `defaultOpen?`, `view?`                        | A panel beside the terminal                                                                                                                        | `sidebar`      |
| `insightsSection`  | `label`, `view?`                                                 | A section on the Insights view of Home, as tall as its content                                                                                     | `home`         |
| `windowViews`      | `[{ id, view }]`                                                 | Views `api.window.openAuxiliary(id)` opens in their own window                                                                                     | —              |
| `commands`         | `[{ id, label, description?, shortcut?, mnemonic?, requires? }]` | Reserves the command's row in the Quick Actions panel (see [`api.commands`](#apicommands))                                                         | —              |
| `quickActions`     | `{ group: { mnemonic?, label } }`                                | Your group's letter and label in the Quick Actions panel                                                                                           | —              |
| `startWorkOptions` | `[{ id, label, description, command }]`                          | A way to run work in Home's Start work launcher, after the agent tab, Claude in a terminal and Terminal only; `command` is one of your command ids | —              |
| `shellRoots`       | `[settingKey]`                                                   | Nowhere: directories `api.shell.exec` and `api.github` may run in (see [`api.shell`](#apishell))                                                   | —              |

`icon` takes one of the names `iconFromName` knows (`src/renderer/extensions/icon-from-name.ts`), such as `puzzle`, `wrench`, `terminal`, `git-branch`, `database`, `list` or `calendar`.

**Shell roots.** Each entry of `shellRoots` is the key of one of your own settings. The key starts with your extension id. Register it with `settings.register` as a `folder` setting. Its current value becomes a directory where your git and gh can run. A key that does not start with your id makes the core refuse the manifest at load (`INVALID_MANIFEST`). A key that you do not register as a `folder` adds nothing ([ADR 102](adr/102-shell-exec-runs-in-declared-roots.md)). git-integration declares its review clone folder. Foundry declares its data directory:

```json
"contributes": { "shellRoots": ["terminator.foundry.dataDir"] }
```

**Quick Actions letters.** The core reserves its own letters. When extensions contest a letter, load order decides. The loser gets the first free letter of its own label, and the app logs a warning (`allocateExtensionGroups`, `src/renderer/quick-actions/groups.ts`).

---

## The backend

The `main` entry exports `activate`. It can also export `deactivate`:

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

`activate` can be `async`. If it throws or rejects, the extension's status becomes `error` with the message. Nothing else is affected. The value that `activate` returns is the extension's API for other extensions.

### Where your backend runs

Every backend runs in the **extension host**. The host is one Electron [`utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process) that all extensions share. `src/main/extensions/host/host-process.ts` starts it. It is never the main process. The API reaches the core over a `MessagePort`. This has these effects:

- A value that the core holds is a promise: `settings.isBranchExcluded`, `globalShortcut.register`, `pty.spawnSession` / `openTerminal` / `runInTerminal` / `getSession` / `setWorkspace` / `listSessions`, `workspace.addProject`, `ipc.isRemoteAccessible`, `dialog.*`, and every `issues` and `github` call.
- `settings.get`, `workspace.list` / `listProjects` and `issues.supportsTransitions` / `supportsCreate` are synchronous. They read a snapshot that the core pushes on every change.
- A callback that you pass (a command handler, a notification's `onClick`, `pty.onData`) stays in the extension host. The core calls it by id. Registrations still return a `Disposable` at once.
- Values that you pass and return must survive structured clone: plain data, with no functions or class instances. An `Error` arrives with its `name` and `message`.
- `api.db` is the extension host's own connection to the app database, so `transaction(fn)` runs `fn` in your process.
- `electron` is not available. Use `api.paths` for `app.getAppPath()` and for your own data folder. Use `api.dialog` for file dialogs and `api.window` for windows. A store such as electron-store needs `cwd: api.paths.globalStorage`. Node's own modules work: Remote Control's HTTP server runs here.
- Every backend shares the host's memory. Import a large dependency the first time you need it (`await import(...)`), not at the top of your entry. Remote Control loads fastify only when its server starts. git-integration loads electron-store only at the first store read ([measurements](research/perf/2026-10-12-extension-host.md)).

If the extension host crashes, the app stays up. The app restarts the host once and activates every backend again. If the host crashes again, the extensions show as `error` in Settings → Extensions until the next launch. The reason shows on hover. The panel shows such a change while it is open: it reads the list again each time main broadcasts `extension:list-changed`.

Reloading an extension (or disabling and enabling it) runs your backend's code as it is on disk then. The host forgets your entry point and every module under your extension directory. Then it requires the entry point again. Packages from outside that directory stay loaded.

---

## What an extension may import

An extension imports only `@terminator/extension-sdk`, the design system `@terminator/extension-ui`, npm packages declared in its own `package.json`, and its own files. Do not import core source (`src/**`), another extension or any other workspace package. `eslint.config.mjs` enforces this. `npm run lint` fails on a relative import that leaves the extension's directory and on any other `@terminator/*` package.

| Entry                                      | What it holds                                                                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@terminator/extension-sdk`                | `ExtensionAPI` and its types, `ExtensionDB`, the issue-tracker and GitHub types, `defineChannel`, `dispatchChannel`, `noPayload`, `createIpcRegistrar`, `validationError`, `plural` |
| `@terminator/extension-sdk/renderer`       | `invoke<T>(channel, payload = {})` for your own channels, `mountExtension(<App />)`, which renders into `#app`, and `openInBrowser(url)`                                            |
| `@terminator/extension-sdk/node`           | `writeJsonAtomic(path, value)`: JSON through a temporary file and a rename, so a reader never sees half a file; `shellQuote(value)`                                                 |
| `@terminator/extension-sdk/types/renderer` | The `window.electronAPI` a view receives. `tsconfig.extension.json` loads it.                                                                                                       |

### Dependencies

Declare every npm package that the extension needs in its own `package.json`. `extensions/*` are npm workspaces, so `npm install` at the root hoists them. Versions are exact. Each package has one version across the repository (Constitution IV, [ADR 097](adr/097-one-version-per-dependency.md)). `npm run lint:deps` (syncpack) checks this.

```json
{
  "name": "@terminator/extension-my-extension",
  "version": "0.1.0",
  "private": true,
  "scripts": { "build:renderer": "vite build --config vite.renderer.config.ts" },
  "dependencies": {
    "@terminator/extension-sdk": "5.0.0",
    "@terminator/extension-ui": "1.0.0",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "zod": "3.23.8"
  }
}
```

The workspace package versions shown are the versions in `packages/*/package.json` today. Copy them from there. Never add an extension-only package to the root `package.json`.

---

## The view

A view is an ordinary web page. The core loads it into an `<iframe>` in the main window ([ADR 114](adr/114-extension-views-are-frames-in-the-window.md)). The frame fills the area that the core reserves for the surface:

- The URL is `ext://<extension id>/<manifest.renderer>?view=<view>&repoRoot=<path>`. The `ext://` protocol (`src/main/extensions/ext-protocol.ts`) serves only files inside the extension's directory. It sends `Cache-Control: no-store`.
- The core injects a small script into the page's `<head>` (`ext://core/frame-shim.js`). The script gives the page `window.electronAPI` over a `MessagePort` to the core. `@terminator/extension-sdk/types/renderer` types it. The script runs before your own module script.
- The core injects the design system's stylesheet (tokens, icon scale, control resets) the same way. It also stamps `data-theme` on `<html>`.
- The core gives the frame its port only after the extension's backend has activated (`ExtensionHost.whenActivated`). The frame therefore never calls a channel that is not registered yet.
- Reloading an extension from Settings → Extensions sends `extension:renderer-reload`. The core remounts its frames. You do not need to rebuild the app.
- A frame is page content, so the core's modals, drawers and toasts draw over it. Do not rely on your view being the topmost item on screen.

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

Call your own channels with `invoke`. Listen for your backend's broadcasts with `extensionBridge.on`:

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

A view reads the repository that it was opened for from the URL. It follows changes through `workspace:changed`. The host also sends `workspace:changed` once when the view loads:

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

`window.electronAPI.workspace.getActive()` returns the workspace that the operator has focused in the main window.

A backend brings its own project tab forward with `api.window.broadcast('extension:select-project-tab', { tabId: '<your extension id>' })`. It toggles its sidebar panel with `api.window.broadcast('extension:toggle-panel', '<your extension id>')`.

### Running another extension's command

A view can run a command that another extension registered with an `args` schema ([ADR 083](adr/083-extension-commands-take-arguments.md)). Use the full id `<extensionId>.command.<id>`:

```typescript
const key = 'terminator.git-integration.command.review-pull-request'
const result = await window.electronAPI.extension.runCommand(key, { repoRoot, number: 42 })
if (!result.ok && result.reason === 'not-registered') {
  // the provider is missing or disabled: fall back
}
await window.electronAPI.extension.hasCommand(key) // boolean
```

`runCommand` resolves `{ ok: true }` or `{ ok: false, reason }`. `reason` is `'not-registered'`, `'invalid-args: …'` or `'failed: …'`. The remote bridge cannot reach it.

### Watching a folder for changes

A view receives an event when files change under a folder that it asks to watch ([ADR 109](adr/109-a-file-watch-belongs-to-the-view-that-asked.md)):

```typescript
const stopListening = window.electronAPI.fs.onChanged(({ projectRoot, filename }) => reload())
const started = await window.electronAPI.fs.watchStart(repoRoot)
await reload() // after the watch has started, never before
if ('error' in started) pollInstead() // the remote browser client: WATCH_UNAVAILABLE
// when the view is done:
stopListening()
await window.electronAPI.fs.watchStop()
```

- The watch belongs to your view alone. Only the view that called `watchStart` receives `fs:changed` for that folder. Your `watchStop` does not affect another view that watches the same folder.
- Each `watchStart` adds a folder. `watchStop` ends all of this view's watches. The watches also end when the view closes or reloads.
- The watch covers everything under the folder except `node_modules` and `.git/objects`.
- The watch reports a burst of changes once: after 100 ms of quiet, or 1 s into a burst that has not ended. `filename` is the path that changed, relative to the folder. It is `null` when several paths changed.
- Read the data that you show after `watchStart` resolves. A change made before that point has no event.
- A git command that you run through `api.shell.exec` has `GIT_OPTIONAL_LOCKS=0`. So `git status` does not rewrite `.git/index` and report a change of its own. `git diff` against the working tree can still refresh the index once after a file is saved unchanged. Where that matters and the output does not list file names, pass `-c diff.autoRefreshIndex=false`.
- A linked worktree keeps its index outside its folder. To follow `git add` and `git commit` there, also watch the repository's git directory (`git rev-parse --path-format=absolute --git-common-dir`). The Git tab does this (`git:watch-roots`).

### Keys the core handles in your view

- **`⌘P` / `Ctrl+P`** opens the core's Quick Actions panel even while focus is in your view. The host watches `before-input-event` on every view (`isQuickActionsOpenShortcut`).
- **`Esc` twice within 500 ms** leaves your extension and returns the operator to their terminal ([ADR 026](adr/026-double-escape-extension-exit.md)). The listener in the core's frame script is passive and bubble-phase, so your own single-`Esc` handlers run as normal. The listener does nothing inside a text field, or while a modal `<dialog>` or a popover is open in your view. It reads `document.querySelector('dialog:modal, :popover-open')`. So `ModalShell` (and so `Dialog`), `Popover` and `Menu` need no reporting. Do not write a modal of your own: give `ModalShell` your content. Do not stop `Esc` propagation at the window level, or the gesture stops working in your view.

### Testing your view end to end

A view is an iframe on an `ext://` origin inside the main window's page. `tests/e2e/extension-page.ts` finds it as an `ExtensionView`. A spec can then click, type and drag in your view with ordinary locators:

```ts
const vault = await openFromAppBand(
  handle,
  'Task Vault',
  'terminator.task-vault/dist/index.html?view=main'
)
await vault.getByRole('button', { name: 'Add task', exact: true }).click()
```

- Read back the data that an action stored with `invokeChannel(page, channel, payload)`. It calls your channel exactly as your view does. Perform the action itself the way a user does.
- A spec cannot click a native file dialog. `answerNextOpenDialog` and `answerNextSaveDialog` answer the next dialog in main with the path that a user would pick.
- Playwright's keyboard reaches one page and never the operating system, so it cannot fire an `api.globalShortcut`. A macOS runner cannot press a system-wide key without Accessibility consent. Test the handler of a global shortcut in a unit test.
- `tests/e2e/task-vault-harness.ts` and `tests/e2e/notepad-harness.ts` are worked examples.

---

## The design system — `@terminator/extension-ui`

The core and every extension build their UI from one design system, `packages/extension-ui` (Constitution XIII, [ADR 098](adr/098-one-design-system-documented-in-storybook.md)). It is source-only TypeScript. Its peer dependencies are `react`, `react-dom` and `lucide-react`. Every component has Storybook stories in both themes. Run `npm run storybook` to see them.

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
| `ModalShell`                                     | Any other modal surface: the modal behaviour around your content |
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
| `Popover`, `Menu`, `MenuItem`                    | A native popover under its anchor; a menu with arrow keys        |
| `useCloseOnOutsidePress`                         | Outside-click for a list that cannot be a `Popover`              |
| `LAYERS`, `layerValue`                           | Stacking by name                                                 |

`packages/extension-ui/src/index.ts` is the complete export list.

The package handles these points, which are easy to get wrong without it:

- **A modal is the browser's own.** `ModalShell` is a native `<dialog>` opened with `showModal()` ([ADR 110](adr/110-modal-surfaces-use-the-native-dialog-element.md)). Focus stays inside it. The view behind it is inert. It paints above every `z-index`. Escape closes only the modal opened last. The remote client runs your view in a phone's browser, where the back gesture also dismisses it.
- **What you open from a modal must be inside it.** Everything outside an open modal dialog is inert. `Popover` and `ToastRegion` handle this. A surface that you portal must portal to `trigger.closest('dialog') ?? document.body`, not to `document.body`.
- **A dialog renders in your view.** It is a modal over your own document. The core's modals draw over your frame ([ADR 038](adr/038-dialogs-render-in-the-extension-view.md), [ADR 114](adr/114-extension-views-are-frames-in-the-window.md)).
- **Stacking of everything else comes from a named scale** (`panel` 100, `overlay` 200, `modal` 300, `toast` 400). A raw `z-index` number in an extension is a lint error.

### Styling

Every colour, space, radius, font and layer comes from the `--tm-*` tokens in `packages/extension-ui/src/tokens.css`, which the host injects into your document. The file holds both themes (`:root` is dark, `[data-theme='light']` is light). The host restamps `data-theme` when the operator switches. A hard-coded colour cannot follow the theme. A `--tm-*` name that the file does not define makes the whole declaration invalid. Do not define tokens of your own.

- Fonts ship with the app. The `@terminator/extension-ui/fonts` import in your view entry bundles IBM Plex Sans and IBM Plex Mono beside your script. Without the import, your view uses the fonts of the machine.
- Size lucide icons with the injected classes `tm-icon-sm` (12px), `tm-icon` (14px) and `tm-icon-lg` (16px). The `size` prop is a lint error in `extensions/*/src/**/*.tsx` (Constitution XII).
- Checkboxes and radios are themed by the injected stylesheet. Do not restyle them; `accent-color` has no effect.
- Diff and syntax colours (`--tm-diff-*`, `--tm-syntax-*`) clear WCAG AA against their backgrounds in both themes (`tests/unit/renderer/diff-syntax-contrast.spec.ts`).

`docs/EXTENSION-STYLE.md` holds the house rules: vocabulary, sentence case, button voice, empty states, icons, colour and layering. ESLint enforces its vocabulary rules on `extensions/*/src/**/*.tsx`.

---

## ExtensionAPI reference

The `api` object passed to `activate` is the whole interface between the backend and the core. The namespaces below follow `packages/extension-sdk/types/api.d.ts`. Read that file for the exact types.

### `api.db`

One shared SQLite database, `<userData>/app.sqlite`, through Node's built-in [`node:sqlite`](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) (WAL journal, foreign keys on; [ADR 099](adr/099-node-sqlite-replaces-pglite.md)). The core creates no tables. Create your tables in `activate`, before you register handlers that read them. Prefix a table name that another extension could also choose. The `settings` table is shared and keyed `(extension_id, key)`.

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

The methods are `async` although SQLite is synchronous. Statements and transactions run one at a time in call order. A statement issued while a transaction is open waits for it. Inside a transaction callback, use the `tx` that you are given, never `api.db`. Otherwise the call waits for the transaction, and the transaction waits for the call.

The database is SQLite, not Postgres:

- Parameters are `?`, each a `string`, `number`, `bigint`, `null` or `Uint8Array`. `undefined` throws (`Provided value cannot be bound`). Write `value ?? null`. Write booleans as `flag ? 1 : 0`.
- Store booleans as `INTEGER` 0/1, dates as ISO-8601 `TEXT`, JSON as `TEXT` read with `json_extract` / `json_remove`. Use `TEXT PRIMARY KEY` with `crypto.randomUUID()`, or `INTEGER PRIMARY KEY` for a rowid.
- Use `GROUP_CONCAT(x, ',')` for `STRING_AGG(x, ',')`. Pass `new Date().toISOString()` instead of `datetime('now')`.
- There is no `ILIKE`. `LIKE` is case-insensitive for ASCII letters only: `'É' LIKE 'é'` is false, and so is `LOWER('É') = 'é'` ([SQLite: LIKE](https://www.sqlite.org/lang_expr.html#like)). A search that must ignore case in every script filters in TypeScript with `toLowerCase()`. Notepad's `search.query` does this.
- `ON CONFLICT (col) DO UPDATE SET v = excluded.v` and `ON CONFLICT DO NOTHING` work. `INSERT OR IGNORE` also drops rows that violate `NOT NULL` or `UNIQUE`. Prefer `ON CONFLICT`.
- `COUNT(*)` comes back as a `number`.
- `ALTER TABLE ... ADD COLUMN` cannot add a `NOT NULL` column without a default. To change anything else, create a new table, copy the rows and rename it.
- To test whether a column exists, run `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`. To list tables, run `SELECT name FROM sqlite_master WHERE type = 'table'`.
- Foreign keys are enforced. Inside a transaction, `PRAGMA defer_foreign_keys = ON` postpones the checks to commit.

Test against a real in-memory database (`new DatabaseSync(':memory:')`), not a mock. `extensions/notepad/tests/unit/db/db.spec.ts` shows how.

### `api.paths`

`paths.app` is Electron's `app.getAppPath()`. `paths.globalStorage` is your extension's own data folder, `<userData>/extensions/<id>`. No other extension shares it. It matches VS Code's [`ExtensionContext.globalStorageUri`](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext). The folder can be missing. Create it (`mkdirSync(path, { recursive: true })`) before you write into it ([ADR 103](adr/103-each-extension-has-its-own-data-folder.md)).

An extension that kept data in the shared userData folder before 4.0.0 moves the data at the top of `activate` with `moveFromUserData` from `@terminator/extension-sdk/node`. Each path moves only while its new location does not exist. When both exist, the function touches neither. `api.log.warn` names the old copy:

```typescript
import { moveFromUserData } from '@terminator/extension-sdk/node'

export function activate(api: ExtensionAPI): void {
  moveFromUserData(api, [{ from: 'foundry', to: 'records' }])
  // ...
}
```

A spec that hands `activate` a `globalStorage` creates it with `makeTempDir(prefix)` from `tests/support/temp-dir.ts`. The root `tests/setup.ts` removes it when the spec file ends. CI fails a unit run that leaves any file in the temporary directory (`scripts/check-temp-leaks.mjs`).

### `api.dialog`

`showOpenDialog(options)` and `showSaveDialog(options)` show the operating system's file dialogs over the focused window. They take a subset of Electron's options (`title`, `defaultPath`, `buttonLabel`, `filters`, and `properties` for open).

### `api.log`

`debug`, `info`, `warn` and `error`, written to the app's log under the extension's id.

### `api.settings`

`register(schema)` adds a section to Settings. A property with `workspaceScoped: true` can also be set per workspace, in Workspace Settings. There, "Use global default" returns the property to the global value. Property types are `string`, `number`, `boolean`, `enum` (with `options`), `folder`, `list` (a `string[]`, edited one item per line) and `action` (a button that invokes `channel`, optionally after `confirmMessage`). `secret` masks the value.

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

// A workspace-scoped setting, for the repository the call is about (since SDK 5.0.0):
const enabled = api.settings.get<boolean>('com.example.my-extension.enabled', { repoPath })
```

Prefix every key with your extension id. Nothing else keeps the keys of two extensions apart.

`get(key, { repoPath })` resolves a `workspaceScoped` setting in this order. First, the value that the workspace owning `repoPath` sets for itself (its folder holds the path, or one of its projects' worktrees does). Second, the global value. Third, the schema's `default`. Without a scope, or for a path outside every workspace, `get` returns the global value. Pass the repository or worktree path that the work is in, as `isBranchExcluded` takes it. The core stores the workspace values in that workspace's settings, under `extensions`, by extension id and then key. `set` writes the global value only.

A view reads the stored values with `window.electronAPI.extension.getSettingsValues()`. The result holds only the values that have been set, so apply your own defaults. `extension.onSettingsChanged(handler)` calls `handler` after any setting changes, with `{ workspaceId }`. `workspaceId` is the workspace whose own value changed, or `null` for a global value (SDK 5.0.0). Re-read the values in `handler`. A change made in Settings then applies without reopening the view (Notepad's `src/stores/settings.store.ts`). Pop-out windows have `onSettingsChanged` too.

`isBranchExcluded(branch, repoPath?)` resolves whether a branch matches Settings → Git → Branch Exclude Patterns. It uses the override of the workspace that owns `repoPath`, else the global list. `*` matches anything, slashes included. The core owns the patterns, so your lists hide the same branches as the core's pickers:

```typescript
const excluded = await Promise.all(
  pulls.map((pr) => api.settings.isBranchExcluded(pr.headRefName, repoRoot))
)
const visible = pulls.filter((_, i) => !excluded[i])
```

### `api.globalShortcut`

`register(accelerator, handler)` binds a system-wide shortcut through Electron's `globalShortcut`. The shortcut fires even when another app is focused. `register` resolves to a `Disposable`. It rejects with `ACCELERATOR_TAKEN` when another holder has the accelerator.

### `api.workspace`

```typescript
api.workspace.list() // [{ id, name, folderPath }]
api.workspace.listProjects(workspaceId) // [{ id, workspaceId, name, worktreePath? }]
```

`addProject(input)` registers a directory, such as a git worktree, as a project in a workspace. The project appears in the sidebar and can hold terminals. `addProject` resolves to the existing project when the workspace already has one for that **path**. It resolves to `null` when it cannot create the project. A name collision with a different path becomes `name (directory)`. The core tells the sidebar, so the project appears without a reload.

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

The core attaches an `issue` on a best-effort basis. If the core cannot write the link, `addProject` still returns the project. When `addProject` returns an existing project, the core attaches the issue to it.

`deleteProject(projectId)` removes a project and tells the sidebar. It closes every terminal in the project (`src/main/terminal/project-sessions.ts`). Remove the project when you remove its worktree.

### `api.shell`

`exec(options)` runs `git` or `gh`, never through a shell. It resolves for every outcome, so read `exitCode`.

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

| Option               | What it does                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeoutMs`          | Past the limit the core kills the command. It resolves with `timedOut: true` and `exitCode` 124, as `timeout(1)` does                           |
| `maxBuffer`          | Most bytes kept per stream (default 1 MiB). Past the limit the core stops the command, with `exceededMaxBuffer: true` and a non-zero `exitCode` |
| `env`                | Added to the minimal environment that every command gets (PATH, HOME, git and gh credentials, `GIT_TERMINAL_PROMPT=0`)                          |
| `encoding: 'buffer'` | `stdout` and `stderr` come back as bytes                                                                                                        |
| `onOutput`           | Each chunk of stdout and stderr as it arrives, in text mode                                                                                     |

Output is never trimmed. The core runs the command in the main process (`src/main/shell/shell-executor.ts`). A command that cannot start reports its spawn error as `stderr`.

**`cwd` must be inside one of your shell roots** ([ADR 102](adr/102-shell-exec-runs-in-declared-roots.md)). The core reads the roots on every call:

- a workspace folder (`workspace.list()`'s `folderPath`);
- a project worktree (`workspace.listProjects(id)`'s `worktreePath`);
- `api.paths.globalStorage`, your own data folder, and nothing else in userData. The folder of another extension is outside ([ADR 103](adr/103-each-extension-has-its-own-data-folder.md));
- the value of each folder setting your manifest declares in [`contributes.shellRoots`](#contributes).

The core compares the `cwd` and each root after `realpath`, by path segment. A symlink or a `..` that leads out of a root is outside. A sibling such as `/repos/app-old` beside the root `/repos/app` is outside. The core judges a directory that does not exist yet by where it would be. When `cwd` is outside every root, `exec` runs nothing and rejects with an error named `CwdOutOfScopeError`:

```typescript
try {
  await api.shell.exec({ command: 'git', args: ['status'], cwd })
} catch (error) {
  if ((error as Error).name === 'CwdOutOfScopeError') return { error: 'NOT_IN_A_ROOT' }
  throw error
}
```

When the directory does not matter to the command (`gh api` with an explicit repository, `gh api user`), create `api.paths.globalStorage` and run the command there. The roots bound the core's side. A channel that takes a path from a caller must still check the path itself, as git-integration's `RepoRoot` schema does (`extensions/git-integration/src/ipc/repo-root.ts`).

### `api.github`

`api.github` gives access to pull requests and the GitHub API through the `gh` CLI that the core runs. Each call takes a `GithubTarget`. A `GithubTarget` names the checkout that gh runs in (`cwd`), or a repository without a checkout (`repository: 'owner/name'`, with `cwd: api.paths.globalStorage`). It can also hold a `token`. When GitHub rejects the `token`, the core retries under gh's own login. `cwd` follows the same shell roots as `api.shell.exec`. A `cwd` outside the roots is refused with `CwdOutOfScopeError`.

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

A failure rejects with a `GithubCommandError`. `message` is gh's own line. `stdout` holds GitHub's JSON error body. `authenticationFailed`, `timedOut` and `exceededMaxBuffer` give the reason. `packages/extension-sdk/types/github.d.ts` has the full shape.

### `api.issues`

The operator connects Linear once, in Settings → Integrations. An extension never holds a tracker credential and never contacts a tracker itself ([ADR 029](adr/029-core-issue-tracker-service.md)).

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

A tracker that fails appears in `failures`. It does not fail the call. Say what is missing. Do not show a partial list as complete. The pair `(tracker, key)` identifies an issue, because two trackers can both have a `TAV-42`.

**Three writes, and only three**: a comment, a move along the issue's own workflow, and a new issue that the operator asked for. No call deletes an issue or changes a field of an existing issue. A test asserts the shape of that surface.

**Moving an issue** ([ADR 041](adr/041-an-extension-may-move-an-issue.md)):

```typescript
if (api.issues.supportsTransitions('linear')) {
  const options = await api.issues.states('linear', 'TAV-42') // what it can move to now
  await api.issues.transition('linear', 'TAV-42', 'in_review') // the tracker resolves the intent
  await api.issues.transition('linear', 'TAV-42', 'in_review', options[1].id) // or the operator's choice
}
```

The intent is `started`, `in_review` or `done`. The tracker decides which of its states the intent means. A tracker that cannot move an issue answers `supportsTransitions` with `false`. Then `states` and `transition` reject with the kind `unsupported`. Retry a failure. Record an unsupported capability once and stop asking. Never emulate a move that the tracker cannot make.

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

`teams` and `create` reject with `unsupported` for a tracker that does not implement them. `@terminator/extension-sdk` exports the types (`Issue`, `IssueListResult`, `TrackerConnection`, `TrackerId`, …). Do not declare them again.

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

The extension never chooses where a notification appears. The core resolves the targets (system banner, notification centre, toast) from the operator's Settings → Notifications. An optional per-extension override exists as the settings `<extensionId>.notify.<key>.system`, `.center` and `.toast`. An `error` always includes a toast. `key` names the kind of notification, so the operator can configure each kind on its own.

**`actions` are answers; `onClick` is a destination.** Running an action settles the notification: the handler runs and the core drops the record. `onClick` leaves the row alone and makes it a link.

Navigation from a notification usually takes three calls, because your view may not exist yet:

```typescript
onClick: () => {
  api.window.focusSelf() // the window
  api.window.broadcast('extension:activate-global-tab', 'com.example.my-extension') // creates the view
  api.window.broadcast('my-ext:navigate', { itemId }) // where to go
}
```

The core can create the view after that last broadcast. So hold the destination in the backend and let the view ask for it on mount. `extensions/task-vault/src/navigation.ts` is the pattern.

### `api.nativeMenu`

`addViewMenuItem({ id, label, onClick, accelerator?, type?, panelId? })` adds an item to the application's View menu. Disposing the item removes it and rebuilds the menu. An `accelerator` works while Terminator is focused. `type: 'checkbox'` with a `panelId` keeps the check mark in step with your sidebar panel.

### `api.commands`

`register(command, handler)` puts a command in the Quick Actions panel (`⌘P`). The handler receives a `CommandContext`, which holds the core's focus at the moment the command runs:

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

A command that the manifest's `contributes.commands` declares but the backend never registers shows dimmed with "Extension did not register this command". The manifest only reserves the row.

A command can declare a zod schema for `args`. A view runs such a command by id (see [Running another extension's command](#running-another-extensions-command)). The core validates the arguments before the handler runs. The panel lists only commands without `args`.

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

A handler that must change your view broadcasts on your own channel and brings the view forward:

```typescript
api.commands.register({ id: 'quick-create', label: 'New note', mnemonic: 'n' }, () => {
  api.window.broadcast('my-ext:ui.open-quick-create', {})
  api.window.showSelf('main')
})
```

`extensions/notepad/src/index.ts` (`notepad:quick-create`) and `extensions/task-vault/src/index.ts` (`task-vault:capture-to-inbox`) do this end to end. They use a pending flag that the view reads on mount, for a command that ran before the view existed.

**`shortcut` binds nothing on its own.** The panel shows it beside the action. There is one exception. A manifest command with a `shortcut`, in an extension that contributes a `sidebarPanel`, toggles that panel when the operator presses the shortcut in the main window (`registerWebviewExtension`, `src/renderer/extensions/loader.ts`). To bind a key, use `api.nativeMenu.addViewMenuItem` with an `accelerator` (while Terminator is focused) or `api.globalShortcut.register` (from any app).

### `api.ipc`

`registerHandler(spec, options?)` registers an invoke channel that your view calls with `invoke(channel, payload)`. The core registers the channel in the main process and hands each call to your backend. Every channel is a `ChannelSpec` ([ADR 096](adr/096-every-ipc-channel-has-a-schema.md)), the same shape as the core's own channels. A `ChannelSpec` has four parts: the channel name, a zod `schema`, the `invalid` response for a payload that the schema rejects, and `run`, which receives the parsed payload.

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

`invalid` can be a function of the `ZodError`. An optional `onError(e)` turns an error that `run` throws into a response instead of a rejected invoke. `registerHandler` throws for anything that is not a `ChannelSpec` with a schema, so a channel without a schema fails at activation. Do not check the payload again inside `run`. To test, activate the extension and send each registered spec a malformed payload through `dispatchChannel`. Assert that `run` is not called. Do not write one rejection case per channel.

Name channels `<your prefix>:<name>` so they do not collide with the channels of the core or of another extension. The core does not enforce a prefix.

**Remote access.** A channel is reachable only from the desktop app unless you register it with `{ remoteAccessible: true }`. The remote-control bridge rejects every other channel. Opt in only the channels that your view calls for ordinary use. Keep a channel local if it does any of these: reads or writes a path that the caller chooses, runs a command or arbitrary SQL, opens a native dialog or window, or administers the database. A remote client holds a password, not the desktop session. The schema is the only check on what the client sends. Foundry and git-integration each keep their opted-in channels in one list (`src/remote-access.ts`). A spec in each extension asserts the list exactly.

`invokeChannel(channel, payload)` and `sendChannel(channel, payload)` call a registered handler from the backend. `onWindowEvent(channel, handler)` subscribes to the events that the core pushes to the main window. `isRemoteAccessible(channel)` resolves whether the bridge admits a channel. Never use Electron's `ipcMain` directly.

### `api.pty`

The core's `PtyManager` owns every terminal process and its metadata. An extension keeps no session registry of its own.

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

`spawnSession` rejects with an error named `MissingCwdError` when `cwd` is not an existing directory. `onData` and `onExit` take any number of listeners and always return a disposer. A session that does not exist never calls the listeners. `onExit` passes the process's exit code, or `null` when a signal ended the process (closing its tab, `kill`, a crash). node-pty reports such a process as exit code 0 with the signal beside it. The core does not pass that 0 on. Treat `null` as "no exit status", never as success.

**A terminal the operator can see.** `spawnSession` gives a process and a stream but shows nothing on screen. `openTerminal` spawns a terminal and shows it as an ordinary tab in a project, typically a project from `workspace.addProject`:

```typescript
const sessionId = await api.pty.openTerminal({
  projectId,
  cwd: worktreePath,
  tabTitle: branch,
  type: 'agent', // a person can still type into it
})
```

It resolves to `null` when the core cannot reach a window. The core holds the output produced before the tab mounts and releases it when the tab mounts. The tab's output reaches the window through the same batched, flow-controlled path as every terminal. To read the output in the backend, use `api.pty.onData`.

`closeTerminalTab(sessionId)` removes a tab that `openTerminal` opened, ends its process if the process still runs, and marks its session record closed. `kill` alone leaves the tab on screen, marked `[exited]`:

```typescript
api.pty.onExit(sessionId, (exitCode) => {
  if (exitCode === 0) api.pty.closeTerminalTab(sessionId) // keep a failure on screen
})
```

**A program whose exit status you need.** `runInTerminal` runs a program as the process of a new tab, with nothing typed into a shell. It resolves when the program ends, with `{ sessionId, exitCode }`. The core subscribes to the exit in the tick that spawns the process. So the core does not miss a program that exits at once. A listener added after `openTerminal` resolves can miss it. `exitCode` is `null` when a signal ended the process. Closing the tab before the program finished also gives `null`. When there is no window, `runInTerminal` runs nothing and resolves to `null`:

```typescript
const exit = await api.pty.runInTerminal({
  projectId,
  cwd: worktreePath,
  tabTitle: 'Tests',
  type: 'human',
  file: '/bin/sh',
  args: [scriptPath],
})
if (exit?.exitCode === 0) api.pty.closeTerminalTab(exit.sessionId)
```

### `api.agents`

`api.agents` runs agents over the Agent Client Protocol (since 5.2.0). Its members are `list`, `start`, `prompt`, `cancel`, `answer`, `setConfig`, `close`, `onUpdate`, `onPermission`, `onPermissionSettled`, `onEnd`, `runOnce` and `models`. `start({ cwd, tab: { projectId, title } })` shows the session as an agent tab. You can call `prompt` right after `cancel`. The prompt waits for the cancelled turn to end. Git integration's "Send to agent" starts one tab per folder, prompts it, and forgets it when it ends:

```ts
const started = await api.agents.start({ cwd: folder, tab: { projectId, title: tabTitle } })
if (started) {
  api.agents.onEnd(started.sessionId, () => agentTabs.delete(key))
  void api.agents.prompt(started.sessionId, message)
}
```

An ask (`onPermission`) carries `toolCallId` and `toolCallMeta`. `toolCallMeta` is the `_meta` of that tool call (the Claude agent sends `{ claudeCode: { toolName } }`). `answer` takes one of the ask's `options`. `onPermissionSettled(sessionId, listener)` tells you when an ask ended anywhere, including the session's tab. Its `outcome` is `allowed`, `rejected` or `cancelled`. Set `mode` in `start`. With `default`, the agent asks for every write and state-changing command. With `auto`, the agent decides.

### `api.window`

| Member                         | What it does                                                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openAuxiliary(view, params?)` | Opens a window that loads your view document with `?view=<view>` and `params`. One window per `view`. A second call with params navigates the window again. A second call without params focuses it. |
| `broadcast(channel, data)`     | Sends `channel` to every window and every extension view                                                                                                                                             |
| `focusSelf(viewParam?)`        | Focuses your view `viewParam` (default `main`) where the view is already open                                                                                                                        |
| `showSelf(view?)`              | Brings forward the surface that you contributed for `view` and focuses it, as the core's "Open …" quick actions do                                                                                   |
| `raise()`                      | Restores and focuses every application window                                                                                                                                                        |

---

## Reporting usage

The Usage screen counts every use of every feature. The core counts surfaces (window views and the Insights section), commands and native menu items for you. Count anything else yourself:

1. Declare it in the manifest. The core prefixes the extension id.

   ```json
   "contributes": { "usage": [{ "id": "export", "label": "Export a note" }] }
   ```

2. Record a use. `id` must match `^[a-z0-9][a-z0-9-]{0,59}$`. An undeclared id is dropped and logged.
   - Backend: `api.usage.record('export')`, or `api.usage.record('export', { failed: true })`.
   - View: `recordUsage('export')` from `@terminator/extension-sdk/renderer`. It calls the view's `window.electronAPI.usage.record`. The core takes the extension id from the frame, so a view cannot count under another extension. A window view (`contributes.windowViews`) runs on the app's preload, which has no `record`. There `recordUsage` does nothing, and only the opening of the window counts.
3. A command whose id holds data (`open-run-42`) counts under one id instead. Set `usage: 'go-to-run'` on its `CommandContribution` and declare `go-to-run` in the manifest. The Usage screen then does not list the command itself. Since 6.1.0.

## Disposables

Every registration returns a `Disposable`. `dispose()` undoes the registration. The core disposes the registrations that you do not dispose in `deactivate` when it unloads the extension.

---

## Installing, reloading and disabling

- **Built-in extensions** in `extensions/` load at startup with no install step.
- **A local extension**: build it. Then go to Settings → Extensions → **Install from Directory** and pick its directory. The backend activates at once. Reload the window to show its surfaces. Installed extensions persist across restarts.
- **Reload** in Settings → Extensions unloads the backend, activates it again and remounts its views. You do not need to rebuild the app.
- **Disabling** an extension in Settings → Extensions calls its `deactivate` and disposes everything it registered.

---

## Constraints

1. Only the imports in [What an extension may import](#what-an-extension-may-import). `npm run lint` enforces it.
2. Reach the core only through `api`. Do not use `electron`, `ipcMain` or child processes for something that the API covers. If the API does not cover it, extend the API first (Constitution II).
3. `api.shell.exec` runs only `git` and `gh`. Any other command throws `COMMAND_NOT_ALLOWED`. `api.shell.exec` and `api.github` run only inside your shell roots. A `cwd` anywhere else rejects with `CwdOutOfScopeError`.
4. Every IPC channel has a schema. A channel is local-only unless you register it `remoteAccessible`.
5. UI comes from the design system: its components, its tokens, its fonts (Constitution XIII), and `lucide-react` icons (Constitution XII).
6. `api.nativeMenu` adds to the View menu only.
7. The SDK follows semantic versioning. A breaking change bumps the major version. `packages/extension-sdk/CHANGELOG.md` says how to migrate.
