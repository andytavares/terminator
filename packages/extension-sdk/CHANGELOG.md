# Changelog — @terminator/extension-sdk

## 4.0.0

Every member of the Extension API now crosses a process boundary: extension backends run in
the extension host, a `utilityProcess` (ADR 094), and the API reaches the core over a
`MessagePort`. A value the core holds is a promise or a snapshot the core pushes; a callback
stays in the extension host and the core calls it by id.

### Changed (breaking)

- `topBar` is removed, with `TopBarMenuContribution`. The core stored the items and nothing
  ever drew them.
- `settings.isBranchExcluded(branch, repoPath?)` returns `Promise<boolean>`.
- `globalShortcut.register(accelerator, handler)` returns `Promise<Disposable>` and rejects
  with `ACCELERATOR_TAKEN`.
- `pty.spawnSession`, `pty.getSession`, `pty.setWorkspace` and `pty.listSessions` return
  promises; `spawnSession` rejects with a `MissingCwdError` where it threw.
- `pty.onData` delivers output in batches of at most one per frame, every batch before the
  session's exit. `pty.onData` and `pty.onExit` always return a disposer: a session that does
  not exist never calls the listener (they returned `null`).
- `ipc.isRemoteAccessible(channel)` returns `Promise<boolean>`.
- `shell.exec` and every `github` call reject with an error named `CwdOutOfScopeError`, and run
  nothing, when `cwd` is outside the extension's shell roots: the workspace folders, the project
  worktrees, `paths.userData`, and the folder settings `contributes.shellRoots` declares. Both
  sides are compared after resolving symlinks (ADR 102). A gh call whose `cwd` does not matter,
  because it names `repository`, passes `paths.userData`; the home directory is not a root.
- `settings.get` and `workspace.list` / `listProjects` stay synchronous and read a snapshot the
  core pushes on every change. `issues.supportsTransitions` / `supportsCreate` are fixed facts
  of a tracker and stay synchronous.

### Added

- `pty.openTerminal(input)`: replaces `openTerminalTab`, as a promise.
- `workspace.addProject(input)`: replaces `createProject`, as a promise.
- `paths.app` and `paths.userData`: the application's directory and the per-user data
  directory, for what used to come from `electron.app`.
- `dialog.showOpenDialog(options)` / `showSaveDialog(options)`: the file dialogs, for what used
  to come from `electron.dialog`.
- `window.raise()`: restores and focuses every application window, for what used to come from
  `BrowserWindow.getAllWindows()`.
- Manifest `contributes.shellRoots`: keys of the extension's own `folder` settings whose
  directories git and gh may run in. A key outside the extension's id refuses the manifest at
  load; a key not registered as a `folder` setting adds nothing.

### Removed

- `pty.openTerminalTab` and `workspace.createProject`, the synchronous forms of
  `pty.openTerminal` and `workspace.addProject`.

### Migrating from 3.x

- An extension backend cannot import `electron`: use `api.paths`, `api.dialog` and
  `api.window`. A store such as electron-store needs `cwd: api.paths.userData`.
- Await the members above. A filter that needs `isBranchExcluded` asks for each candidate first,
  then filters synchronously.

## 3.0.0

### Added

- `api.ipc.registerHandler(spec, opts?)` takes a `ChannelSpec` (ADR 096): the core parses the
  payload with `spec.schema` before `spec.run` sees it, and answers a payload the schema rejects
  with `spec.invalid` without calling `run`. `onError` turns a thrown error into a response.
- `dispatchChannel(spec, payload)` (main entry): that parse step, shared by the core's invoke
  table and extension channels; extension tests use it to answer a registered spec.
- `noPayload` (main entry): the schema of a channel that takes no payload.
- `RegisterHandlerOptions` and `RegisterChannel` in `types/api.d.ts`.
- Extension APIs (ADR 094): the value an extension's `activate` returns is its API. A manifest's
  `extensionDependencies` lists the providers it uses; the host activates them first and fails
  the consumer's activation, naming the dependency, when one is missing, failed, disabled or in a
  cycle. `api.extensions.get(id)` returns a declared provider's exports and throws for any other
  id. `types/extensions.d.ts` declares the built-in providers' APIs (`TaskVaultAPI`,
  `VaultDestination`), and `get` is typed from `BuiltInExtensionExports`.
- `api.shell.exec` takes `maxBuffer` (past it the command is stopped and `exceededMaxBuffer` is
  set), `env` (added over the minimal environment every command gets), `encoding: 'buffer'`
  (stdout and stderr as bytes) and `onOutput` (each chunk as it arrives). `ShellExecOptions`
  and `ShellExecResult` name the shapes. Output is never trimmed, and a timeout is declared as
  the failure it always was: `timedOut: true`, `exitCode` 124.
- `api.github` (`types/github.d.ts`): pull request verbs over the gh CLI the core runs, as
  `api.issues` holds the tracker verbs. `pullRequests.view/list/create/markReady/updateBranch`,
  `repositories.view/clone`, and `api(target, request)` for the rest of the REST and GraphQL
  API. A `GithubTarget` names the checkout or `owner/name`, and an optional token that is
  retried without on an authentication failure; a failure rejects with `GithubCommandError`.

### Removed

- `api.ipc.registerHandler(channel, handler, opts?)`, whose handler received the payload
  unvalidated. Every channel is a `ChannelSpec` with a schema; the core throws when
  `registerHandler` is given anything else, so a plain-JavaScript bundle fails at activation
  rather than on its first payload.

## 2.0.0

### Changed

- The SDK is the single declaration of the Extension API (Constitution II, ADR 094).
  `types/api.d.ts` now declares everything the core builds: `db` (`ExtensionDB`), `issues`
  and the tracker types (`types/issues.d.ts`), `settings.isBranchExcluded`,
  `workspace.createProject` / `deleteProject`, the whole `pty` surface, notification `onClick`,
  command `args`, and `window.focusSelf`. `src/main/extensions/api.ts` implements it and the
  compiler checks the two agree.
- The package is source-only TypeScript, like `@terminator/extension-ui`, with `react`,
  `react-dom` and `zod` as peer dependencies.

### Added

- `defineChannel` / `ChannelSpec` (main entry): the channel shape the core registers its
  invoke channels with.
- `@terminator/extension-sdk/renderer`: `invoke<T>(channel, payload = {})` and
  `mountExtension(view)`.
- `@terminator/extension-sdk/node`: `writeJsonAtomic(path, value)`.
- `window.electronAPI.workspace.getActive` and `ui.setModalDepth` in the view declaration,
  which views already received.

### Removed

- `ICON_NAMES` and `IconName`: declared without a runtime value, and imported by nothing.
- From the view declaration, members an extension view does not receive:
  `terminal.onOutput`, `extension.updatePanelBounds`, `extensionEvents.onToast`,
  `onSelectProjectTab`, `onMenuToggleSidebar`, `onMenuCloseTab`, `onMenuOpenAbout`, and
  `notification.show`.
- The main entry no longer re-exports `ElectronAPI`; a view gets it through
  `@terminator/extension-sdk/types/renderer`.
