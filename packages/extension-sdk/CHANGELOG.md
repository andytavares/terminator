# Changelog — @terminator/extension-sdk

## 5.2.0

### Added

- `api.agents`: agents the app runs over the Agent Client Protocol (ACP).
- `api.agents.list()`: the agents that can start, `claude` and the ones in the `agents` setting.
- `api.agents.start(input)`: starts a session, as a tab of a project when `tab` is set; null when
  the agent did not start.
- `api.agents.prompt(sessionId, text)`: sends a prompt; resolves when the turn ends.
- `api.agents.cancel(sessionId)`: cancels the running turn.
- `api.agents.setConfig(sessionId, configId, value)`: sets a session option such as the model.
- `api.agents.close(sessionId)`: ends the agent process and closes its tab.
- `api.agents.onUpdate`, `onPermission`, `onEnd`: listen to a session's updates, asks and exit.
- `api.agents.onPermissionSettled(sessionId, listener)`: an ask ended, wherever it was answered,
  as `{ requestId, outcome: 'allowed' | 'rejected' | 'cancelled' }` (`AgentPermissionSettled`).
  `AgentPermissionAsk` carries `toolCallId` and `toolCallMeta`.
- `api.agents.answer(sessionId, requestId, optionId)`: answers a tool-call ask.
- `api.agents.runOnce(input)`: one prompt in a throwaway session, with every ask rejected.
- `api.agents.models(agentId?)`: the `model` option of an agent's sessions.

## 5.1.0

### Added

- `ThreadFacet.links`: up to four `{ label, url }` buttons on the thread's drawer in Home, for
  where the work's result is (Foundry publishes a research order's artifact this way).

## 5.0.0

Major, because a view's file watch changed owner (see Changed (breaking)): a view that relied on
another view's watch, or used the watch from the remote browser client, must change. Everything
under Added is optional, so an extension that did neither runs unchanged.

### Added

- `@terminator/extension-sdk/node`: `shellQuote(value)`, a value single-quoted for a POSIX shell.
  The core's hook commands and Foundry's launch lines use it.
- `createIpcRegistrar(api, { invalid?, onError? })`: `handle` for desktop-only channels,
  `handleRemote` for ones the remote client may call, and `cleanup`. Notepad and Task Vault each
  kept a copy. `invalid` defaults to the new `validationError(error)`, the answer
  `{ error: 'VALIDATION_ERROR', message }` the core's channels give.
- `HOME_MEASURES` and `SEND_TO_AGENT_ACTION`: the measure ids and the ask action id Home reads by
  name when an extension publishes with `api.home`, and `contributes.startWorkOptions` for a way
  to run work in Start work. Home names no extension; it reads these.
- `plural(count, word, many?)`, which git-integration and Foundry each kept a copy of.
- `@terminator/extension-sdk/renderer`: `openInBrowser(url)`, a view's way to open an address in
  the person's browser. Task Vault and Foundry each kept a copy.
- `settings.get(key, { repoPath })` (`SettingScope`): a `workspaceScoped` setting resolves to the
  value the workspace owning `repoPath` sets for itself, else the global value, else the schema's
  default. Without a scope it is the global value, as before. Workspace Settings shows every
  `workspaceScoped` setting with "Use global default"; the values live in that workspace's
  settings under `extensions`, by extension id then key. `workspaceScoped` was declared since 2.x
  but nothing stored or read a per-workspace value.
- A view's `extension.onSettingsChanged` handler receives a `SettingsChange`, `{ workspaceId }`:
  the workspace whose own value changed, or `null` for a global value.
- `@terminator/extension-sdk/vite`: `extensionViewConfig(directory, { plugins, chunkSizeWarningLimit? })`,
  the Vite config of an extension's view (`index.html` built to `dist/` with relative URLs).
- A `list` setting type (`SettingDefinition.type`): the value is a `string[]`, which Settings
  edits in a multi-line box, one item per line, trimmed, blank lines dropped (the design
  system's `ListInput`). Give it a `default` of `[]`.
- A view's `extension.onSettingsChanged(handler)`: called after any extension setting changes,
  whoever changed it, so a view re-reads `getSettingsValues()` and applies the change at once.
  Returns the unsubscribe. A pop-out window (`api.window.openAuxiliary`) has it too.

### Changed (breaking)

- `defineChannel` returns a new spec whose `run` calls the given one, instead of the same object
  under a cast. A channel answers as before; code that compared the returned spec to its
  argument by identity would not.
- A view's `fs.watchStart(projectRoot)` watch belongs to that view (ADR 109). The signatures are
  unchanged; the behaviour is not, and a view that relied on the old one must change:
  - Only the view that called `watchStart` receives `fs.onChanged` for that folder. Before, the
    event went to the main window and every extension view.
  - A view may watch several folders: each `watchStart` adds one, where it used to replace the
    one folder the whole app watched. `watchStop` ends this view's watches and nobody else's.
    They also end when the view closes or reloads.
  - A burst of changes is one event: after 100 ms of quiet, or 1 s into a burst that has not
    ended. `filename` is `null` when more than one path changed.
  - `node_modules` and `.git/objects` are not watched.
  - The remote browser client has no watch: `watchStart` answers
    `{ error: 'WATCH_UNAVAILABLE' }` and `onChanged` never fires, so a view polls there.
    `fs:watch-start`, `fs:watch-stop` and `fs:changed` are no longer reachable over the bridge.
- `shell.exec` runs git with `GIT_OPTIONAL_LOCKS=0`: `git status` no longer rewrites
  `.git/index`, which a file watch would report and which could lock the index against the
  person's own git command.

### Fixed

- `fs.onChanged` never fired in the app: nothing called `fs.watchStart`. The Git tab now does,
  and reads status on a change instead of every three seconds.
- On Linux a watch missed every `git add` after the first: Node builds a recursive watch there
  from one watch per file, and git replaces its index by a rename. The core now watches each
  directory.
- `workspace.getActive()` in a view answered `{ workspaceId: null, projectId: null, repoRoot:
null }` whatever was on screen: nothing told the core what the main window showed. The app
  renderer now reports it (`workspace.setActive`, internal to the app), and views also receive it
  as `workspace:changed`.
- A view's `extensionEvents.onSelectProjectTab` subscription is driven by a broadcast of
  `extension:select-project-tab` with `{ tabId }`, the payload the core always read; the
  e2e probe extension (`tests/e2e/fixtures/extensions/probe`) is its first sender.
- `shell.exec` stopped only the command itself on a timeout, and nothing when the app quit, so
  what a command had started outlived it (on macOS `/usr/bin/git` is an xcrun shim that can start
  `xcodebuild`). Each command now runs in a process group of its own, which a timeout and the
  app quitting stop whole. The result is unchanged.
- `git.isRepo` answered `{ isRepo: false }` when git could not answer (it timed out, did not
  start, or a signal ended it), so a real repository looked like a plain folder. It now answers
  `{ error }` then, and `{ isRepo: false }` only when git said the path is not a repository. The
  return type gains the `{ error: string }` member, as `git.currentBranch`'s has; code that reads
  `isRepo` must now narrow with `'error' in answer` first.

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
- `pty.onExit` passes `number | null`: `null` when a signal ended the process, closing its tab
  included. node-pty reports such a process as exit code 0, and the core passed that 0 on, so a
  terminal killed before its process finished read as a success.
- `ipc.isRemoteAccessible(channel)` returns `Promise<boolean>`.
- `shell.exec` and every `github` call reject with an error named `CwdOutOfScopeError`, and run
  nothing, when `cwd` is outside the extension's shell roots: the workspace folders, the project
  worktrees, the extension's own `paths.globalStorage`, and the folder settings
  `contributes.shellRoots` declares. Both sides are compared after resolving symlinks (ADR 102,
  ADR 103). A gh call whose `cwd` does not matter, because it names `repository`, passes
  `paths.globalStorage`; the home directory is not a root, and neither is any other extension's
  folder.
- `settings.get` and `workspace.list` / `listProjects` stay synchronous and read a snapshot the
  core pushes on every change. `issues.supportsTransitions` / `supportsCreate` are fixed facts
  of a tracker and stay synchronous.

### Added

- `pty.openTerminal(input)`: replaces `openTerminalTab`, as a promise.
- `pty.runInTerminal(input)`, with `RunInTerminalInput` and `TerminalExit`: runs a program as
  the process of a new tab, nothing typed into a shell, and resolves when it ends with
  `{ sessionId, exitCode }`; `exitCode` is `null` when a signal or a closed tab ended it. Resolves
  `null`, running nothing, when there is no window. The exit is subscribed in the tick the process
  is spawned, so one that exits at once is not missed.
- `SpawnSessionOptions.args`: arguments for `shell`, in place of the login flag `-l`.
- `workspace.addProject(input)`: replaces `createProject`, as a promise.
- `paths.app`: the application's directory, for what used to come from `electron.app`.
- `paths.globalStorage`: the extension's own data folder, `<userData>/extensions/<id>`, which no
  other extension shares; VS Code's `ExtensionContext.globalStorageUri`. The extension creates it
  when it first writes (ADR 103).
- `moveFromUserData(api, moves)` from `@terminator/extension-sdk/node`: moves what an extension
  kept in the shared userData folder into `paths.globalStorage` at activation, each path only while
  its new location does not exist; when both exist it leaves both and logs where the old one is.
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
- `paths.userData`, which earlier 4.0.0 builds had: the application's whole data folder, shared by
  every extension and a shell root for each. Use `paths.globalStorage`, and `moveFromUserData` for
  data an extension already wrote there (ADR 103).

### Migrating from 3.x

- An extension backend cannot import `electron`: use `api.paths`, `api.dialog` and
  `api.window`. A store such as electron-store needs `cwd: api.paths.globalStorage`.
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
