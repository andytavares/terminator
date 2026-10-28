# @terminator/extension-sdk

The Extension API every Terminator extension is written against, and the helpers they share.
`types/api.d.ts` declares the API; the core implements it in `src/main/extensions/api.ts` and the
compiler checks the two agree ([ADR 094](../../docs/adr/094-extensions-follow-the-vs-code-model.md)).
The version is `6.0.0`; `CHANGELOG.md` lists each version's changes and how to migrate.

This README is a map of the package. How to write an extension (the manifest, the backend, the
view, the build and every API namespace) is in the
[Extension Development Guide](../../docs/EXTENSION-DEVELOPMENT.md).

## What the package exports

An extension imports only this package, `@terminator/extension-ui` and the npm packages in its
own `package.json`. `npm run lint` rejects anything else, including core source and other
extensions ([What an extension may import](../../docs/EXTENSION-DEVELOPMENT.md#what-an-extension-may-import)).

| Entry                                      | Source                | What it holds                                                                                                                                                                                 |
| ------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@terminator/extension-sdk`                | `src/index.ts`        | The types in `types/api.d.ts`, `types/issues.d.ts` and `types/github.d.ts`; `ChannelSpec`, `defineChannel`, `dispatchChannel`, `noPayload`, `createIpcRegistrar`, `validationError`, `plural` |
| `@terminator/extension-sdk/renderer`       | `src/renderer.tsx`    | `invoke<T>(channel, payload = {})`, `mountExtension(<App />)` and `openInBrowser(url)`, for an extension's view                                                                               |
| `@terminator/extension-sdk/node`           | `src/node.ts`         | `writeJsonAtomic(path, value)`, `shellQuote(value)`                                                                                                                                           |
| `@terminator/extension-sdk/types/renderer` | `types/renderer.d.ts` | `ElectronAPI`, the `window.electronAPI` an extension view receives (`tsconfig.extension.json` loads it)                                                                                       |

The declaration files:

| File                  | Declares                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types/api.d.ts`      | `ExtensionAPI`, the object passed to `activate`, and its types: `Disposable`, `ExtensionDB`, `PtyManagerAPI`, `ShellExecOptions`, `ShellExecResult` |
| `types/github.d.ts`   | `GithubAPI` (`api.github`) and its request and pull-request types                                                                                   |
| `types/issues.d.ts`   | The issue-tracker types behind `api.issues`, such as `TrackerId`, `Issue` and `IssueSummary`                                                        |
| `types/renderer.d.ts` | `ElectronAPI`, the view's `window.electronAPI`                                                                                                      |

Source-only TypeScript, with `react`, `react-dom` and `zod` as peer dependencies. It is a
workspace package: an extension under `extensions/` declares it in its own `package.json` at the
version in this package's `package.json` ([Dependencies](../../docs/EXTENSION-DEVELOPMENT.md#dependencies)).

## Where a backend runs

Since 4.0.0 every extension backend runs in the extension host, one Electron `utilityProcess`
that `src/main/extensions/host/host-process.ts` starts and `src/main/extensions/host/entry.ts`
runs. The API crosses a `MessagePort`: a value the core holds is a promise or a snapshot the core
pushes, a callback is called by id, and `electron` cannot be imported (use `api.paths`,
`api.dialog` and `api.window`). See
[Where your backend runs](../../docs/EXTENSION-DEVELOPMENT.md#where-your-backend-runs).

The manifest's `main` is the backend: a CommonJS file exporting `activate(api)` and optionally
`deactivate()`. An extension offers nothing to another extension: what `activate` returns is not read.

## A minimal extension

`npm run create-extension -- my-extension` writes `extensions/my-extension/` with a
`manifest.json` and a plain-JavaScript backend, `extensions/my-extension/src/index.js`
([Quick start](../../docs/EXTENSION-DEVELOPMENT.md#quick-start)). The built-in extensions are laid
out like this ([Anatomy of an extension](../../docs/EXTENSION-DEVELOPMENT.md#anatomy-of-an-extension)):

```
my-extension/
├── manifest.json            id, main, renderer, contributes
├── package.json             its own dependencies and the build:renderer script
├── src/
│   ├── index.ts             backend: activate(api) / deactivate()
│   ├── index.js             esbuild output of index.ts, named by manifest.main (gitignored)
│   └── renderer/
│       ├── main.tsx         view entry: mountExtension(<App />)
│       └── App.tsx          routes on the ?view= parameter
├── index.html               view document
├── vite.renderer.config.ts  builds the view into dist/
└── dist/index.html          the built view, named by manifest.renderer
```

`manifest.json`, validated by `ExtensionManifestSchema` in `src/shared/schemas/extension.schema.ts`
([The manifest](../../docs/EXTENSION-DEVELOPMENT.md#the-manifest)):

```json
{
  "id": "com.example.my-tool",
  "name": "My Tool",
  "version": "1.0.0",
  "description": "Example extension",
  "main": "src/index.js",
  "renderer": "dist/index.html",
  "minAppVersion": "0.1.0",
  "contributes": {
    "globalTab": { "label": "My Tool", "icon": "wrench", "view": "main" }
  }
}
```

The `contributes` keys are `globalTab`, `workspaceTab`, `projectTab`, `sidebarPanel`,
`insightsSection`, `windowViews`, `commands`, `quickActions` and `shellRoots`; the guide's
[`contributes`](../../docs/EXTENSION-DEVELOPMENT.md#contributes) table gives each one's fields.

The backend, `src/index.ts`. Every channel is a `ChannelSpec` whose payload is parsed with its
zod `schema` before `run` sees it ([ADR 096](../../docs/adr/096-every-ipc-channel-has-a-schema.md)):

```typescript
import { z } from 'zod'
import { defineChannel, type ExtensionAPI } from '@terminator/extension-sdk'

export function activate(api: ExtensionAPI): void {
  api.log.info('My extension activated')
  api.ipc.registerHandler(
    defineChannel({
      channel: 'my-tool:hello',
      schema: z.string(),
      invalid: { error: 'VALIDATION_ERROR' },
      run: (name) => ({ greeting: `Hello, ${name}!` }),
    })
  )
}

export function deactivate(): void {}
```

The view, `src/renderer/App.tsx`, calls the channel and listens for what the backend broadcasts
with `api.window.broadcast`
([Talking to your backend](../../docs/EXTENSION-DEVELOPMENT.md#talking-to-your-backend)):

```typescript
import { invoke } from '@terminator/extension-sdk/renderer'

const result = await invoke<{ greeting: string }>('my-tool:hello', 'World')
const off = window.electronAPI.extensionBridge.on('my-tool:update', (data) => console.log(data))
```

## Building

`npm run build:extensions` (`scripts/build-extensions.cjs`) builds every directory under
`extensions/`: esbuild bundles `src/index.ts` into the file `manifest.main` names, and when the
extension has a `vite.renderer.config.ts` it runs that extension's `npm run build:renderer`
(`vite build --config vite.renderer.config.ts`) into `dist/`. `npm run dev` and `npm run build`
run it first. The guide's [Setting up a view](../../docs/EXTENSION-DEVELOPMENT.md#setting-up-a-view)
has the `index.html` and `vite.renderer.config.ts` to start from.

An extension outside `extensions/` is built by its own scripts, then installed from Settings →
Extensions → **Install from Directory**; **Reload** there runs its backend again from disk and
remounts its views without rebuilding the app
([Installing, reloading and disabling](../../docs/EXTENSION-DEVELOPMENT.md#installing-reloading-and-disabling)).

## The design system

A view's UI comes from `@terminator/extension-ui` (`packages/extension-ui`): its components,
the `--tm-*` tokens the host injects into the view, and its fonts. See
[The design system](../../docs/EXTENSION-DEVELOPMENT.md#the-design-system--terminatorextension-ui)
and `docs/EXTENSION-STYLE.md`.
