# Changelog — @terminator/extension-sdk

## 6.2.0

Minor: additive.

### Added

- `StartAgentInput.onStartFailed(reason)`: the core calls it when `api.agents.start` could not start the session. `reason` is the agent's own error details, else its message. `start` still resolves null.

## 6.1.0

Minor: additive.

### Added

- `api.usage.record(feature, outcome?)` and the view's `window.electronAPI.usage.record` count one use of an id. The id comes from the manifest's new `contributes.usage` list. The core adds the extension id.
- `recordUsage(feature, outcome?)` in `@terminator/extension-sdk/renderer`: the view's call. The view's own API types it.
- `CommandContribution.usage`: the `contributes.usage` id a command counts under. Use it for a command whose id holds data.

## 6.0.0

Major: four APIs are removed, and a tracker is no longer one of two.

### Changed (breaking)

- `TrackerId` is `'linear'`. Jira is removed.
- `MineSelector` is `{ kind: 'assignee'; email }`. The `query` kind was Jira's JQL.
- `TrackerConnection` has no `site`. `WorkKey` takes a `TrackerId`.
- Migrate: stop passing `'jira'`. The core ignores a stored Jira link or credential on read.
- `ExtensionAPI['terminal']` is removed. `onSessionCreate` and `onSessionClose` never fired for an extension.
- Migrate: watch `api.pty` or `api.workspace` instead.
- `api.extensions.get`, the manifest's `extensionDependencies`, `TaskVaultAPI`, `VaultDestination` and `BuiltInExtensionExports` (`types/extensions.d.ts`) are removed.
- The host no longer orders activation by dependency. The host does not read what `activate` returns.
- Migrate: share state through `api.ipc` channels, or keep each extension self-contained.
- `SessionSnapshot` is removed with `api.terminal`.
- `window.electronAPI.ui.setModalDepth` is removed from the view declaration, and with it the `ui` namespace.
- The double-Escape exit now asks the view's own document whether a modal dialog or a popover is open.
- Migrate: stop calling it. A `<dialog>` opened with `showModal()` and a `popover` element count without a report.

### Added

- The view's `listWorktrees` entries carry `detached` and `prunable`.

## 5.2.0

### Added

- `api.agents`: the agents the app runs over the Agent Client Protocol (ACP).
- `api.agents.list()`: the agents that can start. These are `claude` and the agents in the `agents` setting.
- `api.agents.start(input)`: starts a session. It starts the session as a tab of a project when `tab` is set. It returns null when the agent did not start.
- `api.agents.prompt(sessionId, text)`: sends a prompt. It resolves when the turn ends.
- `api.agents.cancel(sessionId)`: cancels the running turn.
- `api.agents.setConfig(sessionId, configId, value)`: sets a session option, such as the model.
- `api.agents.close(sessionId)`: ends the agent process and closes its tab.
- `api.agents.onUpdate`, `onPermission`, `onEnd`: listen to the updates, asks and exit of a session.
- `api.agents.onPermissionSettled(sessionId, listener)`: reports that an ask ended, wherever the person answered it. It reports `{ requestId, outcome: 'allowed' | 'rejected' | 'cancelled' }` (`AgentPermissionSettled`).
- `AgentPermissionAsk` carries `toolCallId` and `toolCallMeta`.
- `api.agents.answer(sessionId, requestId, optionId)`: answers a tool-call ask.
- `api.agents.runOnce(input)`: runs one prompt in a throwaway session. It rejects every ask.
- `api.agents.models(agentId?)`: returns the `model` option of the sessions of an agent.

## 5.1.0

### Added

- `ThreadFacet.links`: up to four `{ label, url }` buttons on the drawer of the thread in Home. They point to where the result of the work is. Foundry uses them to publish the artifact of a research order.

## 5.0.0

Major, because the owner of a view's file watch changed (see Changed (breaking)). A view that relied on the watch of another view must change. A view that used the watch from the remote browser client must also change. Everything under Added is optional. An extension that did neither runs unchanged.

### Added

- `@terminator/extension-sdk/node`: `shellQuote(value)` returns a value single-quoted for a POSIX shell. The hook commands of the core and the launch lines of Foundry use it.
- `createIpcRegistrar(api, { invalid?, onError? })` returns `handle`, `handleRemote` and `cleanup`. `handle` is for desktop-only channels. `handleRemote` is for channels the remote client may call. Notepad and Task Vault each kept a copy. `invalid` defaults to the new `validationError(error)`. It answers `{ error: 'VALIDATION_ERROR', message }`, as the channels of the core do.
- `HOME_MEASURES` and `SEND_TO_AGENT_ACTION`: the measure ids and the ask action id. Home reads them by name when an extension publishes with `api.home`.
- `contributes.startWorkOptions` adds a way to run work in Start work. Home names no extension. It reads these.
- `plural(count, word, many?)`. git-integration and Foundry each kept a copy of it.
- `@terminator/extension-sdk/renderer`: `openInBrowser(url)` is the way for a view to open an address in the browser of the person. Task Vault and Foundry each kept a copy.
- `settings.get(key, { repoPath })` (`SettingScope`): a `workspaceScoped` setting resolves to the value that the workspace owning `repoPath` sets for itself. Else it resolves to the global value. Else it resolves to the default of the schema. Without a scope it is the global value, as before.
- Workspace Settings shows every `workspaceScoped` setting with "Use global default". The values live in the settings of that workspace under `extensions`, by extension id and then key.
- `workspaceScoped` was declared since 2.x. Nothing stored or read a per-workspace value.
- The `extension.onSettingsChanged` handler of a view receives a `SettingsChange`, `{ workspaceId }`. `workspaceId` is the workspace whose own value changed. It is `null` for a global value.
- `@terminator/extension-sdk/vite`: `extensionViewConfig(directory, { plugins, chunkSizeWarningLimit? })` is the Vite config of the view of an extension. It builds `index.html` to `dist/` with relative URLs.
- A `list` setting type (`SettingDefinition.type`): the value is a `string[]`. Settings edits it in a multi-line box. Each line is one item. The box trims each item and drops blank lines. This is the `ListInput` of the design system. Give the setting a `default` of `[]`.
- `extension.onSettingsChanged(handler)` in a view: the core calls it after any extension setting changes, whoever changed it. The view re-reads `getSettingsValues()` and applies the change at once. It returns the unsubscribe. A pop-out window (`api.window.openAuxiliary`) has it too.

### Changed (breaking)

- `defineChannel` returns a new spec whose `run` calls the given one. Before, it returned the same object under a cast. A channel answers as before. Code that compared the returned spec to its argument by identity would not.
- The `fs.watchStart(projectRoot)` watch of a view belongs to that view (ADR 109). The signatures are unchanged. The behaviour is not. A view that relied on the old behaviour must change:
  - Only the view that called `watchStart` receives `fs.onChanged` for that folder. Before, the event went to the main window and to every extension view.
  - A view may watch several folders. Each `watchStart` adds one. Before, it replaced the one folder that the whole app watched.
  - `watchStop` ends the watches of this view and of no other view. The watches also end when the view closes or reloads.
  - A burst of changes is one event. The event comes after 100 ms of quiet, or 1 s into a burst that has not ended. `filename` is `null` when more than one path changed.
  - `node_modules` and `.git/objects` are not watched.
  - The remote browser client has no watch. `watchStart` answers `{ error: 'WATCH_UNAVAILABLE' }` and `onChanged` never fires, so a view polls there.
  - `fs:watch-start`, `fs:watch-stop` and `fs:changed` are no longer reachable over the bridge.
- `shell.exec` runs git with `GIT_OPTIONAL_LOCKS=0`. `git status` no longer rewrites `.git/index`. A file watch would report that rewrite. It could also lock the index against the own git command of the person.

### Fixed

- `fs.onChanged` never fired in the app, because nothing called `fs.watchStart`. The Git tab now calls it. The Git tab reads status on a change, instead of every three seconds.
- On Linux, a watch missed every `git add` after the first. Node builds a recursive watch there from one watch per file. Git replaces its index by a rename. The core now watches each directory.
- `workspace.getActive()` in a view answered `{ workspaceId: null, projectId: null, repoRoot: null }` whatever was on screen. Nothing told the core what the main window showed. The app renderer now reports it (`workspace.setActive`, internal to the app). Views also receive it as `workspace:changed`.
- The `extensionEvents.onSelectProjectTab` subscription of a view is driven by a broadcast of `extension:select-project-tab` with `{ tabId }`. This is the payload the core always read. The e2e probe extension (`tests/e2e/fixtures/extensions/probe`) is its first sender.
- On a timeout, `shell.exec` stopped only the command itself. When the app quit, it stopped nothing. What a command had started outlived the command. On macOS, `/usr/bin/git` is an xcrun shim that can start `xcodebuild`. Each command now runs in a process group of its own. A timeout and the app quitting stop the whole group. The result is unchanged.
- `git.isRepo` answered `{ isRepo: false }` when git could not answer. Git could not answer when it timed out, did not start, or a signal ended it. A real repository then looked like a plain folder. Now `git.isRepo` answers `{ error }` in these cases. It answers `{ isRepo: false }` only when git said the path is not a repository.
- The return type gains the `{ error: string }` member, as `git.currentBranch` has. Code that reads `isRepo` must now narrow with `'error' in answer` first.

## 4.0.0

Every member of the Extension API now crosses a process boundary. Extension backends run in the extension host, a `utilityProcess` (ADR 094). The API reaches the core over a `MessagePort`. A value the core holds is a promise or a snapshot that the core pushes. A callback stays in the extension host, and the core calls it by id.

### Changed (breaking)

- `topBar` is removed, with `TopBarMenuContribution`. The core stored the items, and nothing ever drew them.
- `settings.isBranchExcluded(branch, repoPath?)` returns `Promise<boolean>`.
- `globalShortcut.register(accelerator, handler)` returns `Promise<Disposable>`. It rejects with `ACCELERATOR_TAKEN`.
- `pty.spawnSession`, `pty.getSession`, `pty.setWorkspace` and `pty.listSessions` return promises. `spawnSession` rejects with a `MissingCwdError` where it threw.
- `pty.onData` delivers output in batches. It sends at most one batch per frame. It sends every batch before the exit of the session.
- `pty.onData` and `pty.onExit` always return a disposer. A session that does not exist never calls the listener. Before, they returned `null`.
- `pty.onExit` passes `number | null`. It passes `null` when a signal ended the process, including when closing its tab ended it.
- node-pty reports such a process as exit code 0. The core passed that 0 on. A terminal killed before its process finished then read as a success.
- `ipc.isRemoteAccessible(channel)` returns `Promise<boolean>`.
- `shell.exec` and every `github` call reject with an error named `CwdOutOfScopeError`, and run nothing, when `cwd` is outside the shell roots of the extension. The shell roots are:
  - the workspace folders
  - the project worktrees
  - the own `paths.globalStorage` of the extension
  - the folder that the settings declared in `contributes.shellRoots` name
- The core compares both sides after it resolves symlinks (ADR 102, ADR 103).
- A gh call can name `repository`, so its `cwd` does not matter. Such a call passes `paths.globalStorage`. The home directory is not a root. The folder of any other extension is not a root.
- `settings.get` and `workspace.list` / `listProjects` stay synchronous. They read a snapshot that the core pushes on every change.
- `issues.supportsTransitions` / `supportsCreate` are fixed facts of a tracker. They stay synchronous.

### Added

- `pty.openTerminal(input)`: replaces `openTerminalTab`, as a promise.
- `pty.runInTerminal(input)`, with `RunInTerminalInput` and `TerminalExit`: runs a program as the process of a new tab. Nothing is typed into a shell. It resolves when the program ends, with `{ sessionId, exitCode }`. `exitCode` is `null` when a signal or a closed tab ended the program.
- `pty.runInTerminal` resolves `null` and runs nothing when there is no window.
- The core subscribes to the exit in the tick that spawns the process. It does not miss a process that exits at once.
- `SpawnSessionOptions.args`: arguments for `shell`, in place of the login flag `-l`.
- `workspace.addProject(input)`: replaces `createProject`, as a promise.
- `paths.app`: the directory of the application. Use it for what used to come from `electron.app`.
- `paths.globalStorage`: the own data folder of the extension, `<userData>/extensions/<id>`. No other extension shares it. It is the `ExtensionContext.globalStorageUri` of VS Code. The extension creates it when it first writes (ADR 103).
- `moveFromUserData(api, moves)` from `@terminator/extension-sdk/node`: at activation, it moves what an extension kept in the shared userData folder into `paths.globalStorage`. It moves each path only while its new location does not exist. When both exist, it leaves both and logs where the old one is.
- `dialog.showOpenDialog(options)` / `showSaveDialog(options)`: the file dialogs. Use them for what used to come from `electron.dialog`.
- `window.raise()`: restores and focuses every application window. Use it for what used to come from `BrowserWindow.getAllWindows()`.
- Manifest `contributes.shellRoots`: keys of the own `folder` settings of the extension. Git and gh may run in the directories that these keys name.
- A key outside the id of the extension makes the core refuse the manifest at load. A key not registered as a `folder` setting adds nothing.

### Removed

- `pty.openTerminalTab` and `workspace.createProject`. They were the synchronous forms of `pty.openTerminal` and `workspace.addProject`.
- `paths.userData`, which earlier 4.0.0 builds had. It was the whole data folder of the application. Every extension shared it, and it was a shell root for each. Use `paths.globalStorage`. Use `moveFromUserData` for data an extension already wrote there (ADR 103).

### Migrating from 3.x

- An extension backend cannot import `electron`. Use `api.paths`, `api.dialog` and `api.window`.
- A store such as electron-store needs `cwd: api.paths.globalStorage`.
- Await the members above.
- A filter that needs `isBranchExcluded` asks for each candidate first. Then it filters synchronously.

## 3.0.0

### Added

- `api.ipc.registerHandler(spec, opts?)` takes a `ChannelSpec` (ADR 096). The core parses the payload with `spec.schema` before `spec.run` sees it. The core answers a payload that the schema rejects with `spec.invalid`, without calling `run`. `onError` turns a thrown error into a response.
- `dispatchChannel(spec, payload)` (main entry): that parse step. The invoke table of the core and the extension channels share it. Extension tests use it to answer a registered spec.
- `noPayload` (main entry): the schema of a channel that takes no payload.
- `RegisterHandlerOptions` and `RegisterChannel` in `types/api.d.ts`.
- Extension APIs (ADR 094): the value that the `activate` of an extension returns is its API.
- A manifest's `extensionDependencies` lists the providers the extension uses. The host activates them first. The host fails the activation of the consumer, and names the dependency, when a provider is missing, failed, disabled or in a cycle.
- `api.extensions.get(id)` returns the exports of a declared provider. It throws for any other id.
- `types/extensions.d.ts` declares the APIs of the built-in providers (`TaskVaultAPI`, `VaultDestination`). `get` is typed from `BuiltInExtensionExports`.
- `api.shell.exec` takes `maxBuffer`. Past it, the core stops the command and sets `exceededMaxBuffer`.
- `api.shell.exec` takes `env`. The core adds it over the minimal environment that every command gets.
- `api.shell.exec` takes `encoding: 'buffer'`, which returns stdout and stderr as bytes.
- `api.shell.exec` takes `onOutput`, which receives each chunk as it arrives.
- `ShellExecOptions` and `ShellExecResult` name the shapes.
- The core never trims output. A timeout is now declared as the failure it always was: `timedOut: true`, `exitCode` 124.
- `api.github` (`types/github.d.ts`): pull request verbs over the gh CLI that the core runs. `api.issues` holds the tracker verbs in the same way.
- `api.github` has `pullRequests.view/list/create/markReady/updateBranch` and `repositories.view/clone`. It has `api(target, request)` for the rest of the REST and GraphQL API.
- A `GithubTarget` names the checkout or `owner/name`. It has an optional token. The core retries without the token on an authentication failure. A failure rejects with `GithubCommandError`.

### Removed

- `api.ipc.registerHandler(channel, handler, opts?)`. Its handler received the payload unvalidated.
- Every channel is a `ChannelSpec` with a schema. The core throws when `registerHandler` is given anything else. A plain-JavaScript bundle therefore fails at activation, not on its first payload.

## 2.0.0

### Changed

- The SDK is the single declaration of the Extension API (Constitution II, ADR 094). `types/api.d.ts` now declares everything the core builds:
  - `db` (`ExtensionDB`)
  - `issues` and the tracker types (`types/issues.d.ts`)
  - `settings.isBranchExcluded`
  - `workspace.createProject` / `deleteProject`
  - the whole `pty` surface
  - notification `onClick`
  - command `args`
  - `window.focusSelf`
- `src/main/extensions/api.ts` implements the declaration. The compiler checks that the two agree.
- The package is source-only TypeScript, like `@terminator/extension-ui`. It has `react`, `react-dom` and `zod` as peer dependencies.

### Added

- `defineChannel` / `ChannelSpec` (main entry): the channel shape with which the core registers its invoke channels.
- `@terminator/extension-sdk/renderer`: `invoke<T>(channel, payload = {})` and `mountExtension(view)`.
- `@terminator/extension-sdk/node`: `writeJsonAtomic(path, value)`.
- `window.electronAPI.workspace.getActive` and `ui.setModalDepth` in the view declaration. Views already received them.

### Removed

- `ICON_NAMES` and `IconName`. They were declared without a runtime value, and nothing imported them.
- From the view declaration, the members that an extension view does not receive:
  - `terminal.onOutput`
  - `extension.updatePanelBounds`
  - `extensionEvents.onToast`
  - `onSelectProjectTab`
  - `onMenuToggleSidebar`
  - `onMenuCloseTab`
  - `onMenuOpenAbout`
  - `notification.show`
- The main entry no longer re-exports `ElectronAPI`. A view gets it through `@terminator/extension-sdk/types/renderer`.
