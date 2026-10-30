# Foundry Extension — Development Rules

Foundry is a software factory. A **Forge** converges an idea or tracker issue into a compilable work order. A **Line** executes that order with typed agent roles, independent verification and risk-priced human gates, and ends in a draft pull request.

Design documents: `specs/037-foundry-software-factory/`.

## The rules that are specific to this extension

### 1. Nothing is written into a target repository

Foundry creates or modifies **exactly one thing** in a repository it works on: the change the order asked for. It adds no scaffolding, no init step, no committed configuration and no marker file. It **never** adds a `.gitignore` entry, not even for the default data directory of Foundry.

Everything that Foundry needs to run ships inside this extension. A repository contributes information, never installation. A repository can carry its own `.foundry/recipes/…`, and those recipes win. No repository must have one.

The records of Foundry go to `terminator.foundry.dataDir` when it is set, and to `<workdir>/.foundry/` when it is not. With no workspace open, `<workdir>` is `records/` in the `api.paths.globalStorage` of Foundry. `src/data-root.ts` resolves that path **once**. Every writer receives an absolute path and never resolves it again.

A lane worktree is the one exception, and it is not really an exception. `provisionDependencies` in `src/line/worktree.ts` symlinks the installed folders of the origin checkout into the worktree of the lane. A fresh `git worktree add` has none, so every check command fails before it reads the change. Foundry does not know which folders: they are the `context.environment.share` of the order, which the repository profile fills (the node hint lends `node_modules`; a repository with another toolchain names its own). Each entry is a folder name matched beside every directory that holds a tracked file, wherever the origin has it. Foundry lends it only into a place that the `.gitignore` of the repository already covers. After linking, it checks with `git check-ignore` and removes the link again if the check says otherwise. A repository that does not ignore a shared folder therefore gets nothing added, and no repository gets an untracked file that it did not already tolerate. An empty list lends nothing. The `environment.prepare` of the order installs what the links cannot supply. `prepareNewCheckouts` (`src/line/lane-commands.ts`) runs it once, in its own visible tab, in each lane checkout cut for the run (not one reattached). It records `checkout.prepared` or `checkout.prepare-failed` with the exit code. A lane whose prepare failed or did not run reports its checks as not measured ("the checkout could not be prepared"), never as a failure of the change.

The folder of Foundry holds `records/` and the `runtime/` of the supervision runtime. Earlier builds kept them in the shared userData folder as `foundry/` and `foundry-runtime/`. `moveFromSharedUserData` (`src/storage-folder.ts`) moves them on the first activation, unless the new folder exists. It also runs `git worktree repair` in each lane worktree that moved with the records (ADR 103).

### 2. Nothing is assumed about a repository's toolchain

There is no hardcoded `npm run lint`, and no code knows what a `package.json` is. The commands of a repository come from its **profile** (`src/profile/`). The profile resolves each field from four sources, and the first source to answer wins: `operator` (saved on the Checks step, stored under the data root), `repository` (the `.foundry/profile.yaml` of the repository, read only), `scout` (what an agent read from the README and proved) and `hint`. Every entry carries its source, so a surface says where a command came from. Nothing is `null`-coerced. An empty entry means that the matching check reports **"not measured"**, never a pass. Boolean coercion of that third value anywhere in the verification path turns "we did not check" into "it is fine". The ladder exists to prevent that bug.

Knowledge of a toolchain is **data in `hints/*.yaml`**, one file per ecosystem. `src/profile/hints.ts` reads it against the files a repository has and never executes it. A new ecosystem is a new hint file, with no `.ts` changes. Foundry assumes that the base branch passes and runs nothing on it by itself (ADR 137). The operator's **Prove** on the Checks step runs one command on a fresh base checkout (`runOnFreshBase` in `src/line/baseline.ts`). The `proof` of the profile keeps the exit code and commit.

`tests/verify/ecosystem-neutral.spec.ts` guards this rule. It tokenises every file under `src/` and fails on a string, template or regex literal that names the tool of an ecosystem (`npm`, `node_modules`, `pytest`, `cargo`, `.tsx`, …). A code path that needs to know it is looking at one toolchain is a hint file or a profile field that nobody has written yet. The guard reads literals, so a comment can still give an example.

### 3. Claude Code's settings decide; Foundry decides two things

Each agent starts with `settingSources: ['project']` (it never loads the `~/.claude` of the operator) and the settings that `runtime/role-settings.ts` builds from its role: a permission mode, `allow`, `ask` and `deny` rules, and a sandbox for roles that do not write freely. Claude checks every subcommand, subshell and control-flow body against those rules, so Foundry reads no shell command. Read-only, documentation-only and restricted-write roles run in `default` mode, because the Claude ACP adapter offers no `dontAsk` mode. `tool-decision.ts` refuses every ask that such a role raises, so nothing waits: a call that no rule allows is refused at once. A free writer runs in `auto` (or `acceptEdits` when `terminator.foundry.letAutoModeDecide` is off). `escorted` keeps `default`. Hard refusals (`runtime/deny-rules.ts`, and `git -C … push`) are `deny` rules, so they hold in every mode.

`runtime/tool-decision.ts` receives an ask that the settings left open. It decides one thing itself: it allows an `Artifact` publish only for the page of the order in its outputs directory. It refuses the other asks of a read-only, documentation-only or restricted-write role with a reason (`refusesUnlistedCalls` in `role-settings.ts`). At `lights-out` it refuses any other ask with a reason. At other autonomy levels it returns `null`, and the ask goes to the operator at once (`permission-bridge.ts` holds it with no timer).

A refusal never cancels a turn. The runner answers the ask with the reject option of the agent, and the agent carries on. The runner rejects a typed answer from the operator in the same way, then sends it as a normal prompt after the running turn has ended. The core starts agents with `clientCapabilities: {}`, so `AskUserQuestion` is unavailable and Foundry has no question path.

When you change the rules of a role, test them in `tests/runtime/role-settings.spec.ts`. The spec checks the documentation-only globs there against `isDocumentationRelative`.

### 4. Disk is the truth, memory is the read path, and a change is pushed

`src/state/foundry-index.ts` holds orders, run graphs, gates and ledgers in
memory, one index per data root. Every writer of these records goes through
a store module (`order/store.ts`, `gates/store.ts`, `writeRunGraph` in
`ipc/run-channels.ts`). The writer writes to disk **first**, and only then tells the
index. The index then broadcasts `foundry:changed` `{ kind, orderId }`. A new
writer of any of these records must do the same. Otherwise the surfaces keep showing
the old data.

- **Reads come from the index, never from a fresh parse.** Do not read
  `order.json`, `gates.json`, `run-graph.json` or `ledger.jsonl` directly. Use the
  store. Reads return copies, so a caller can edit what it receives.
- **The index does not notice a record edited by hand under the data root** until the
  application restarts. A spec that writes records while the app is running
  restarts it (`restartFoundry` in `tests/e2e/foundry-harness.ts`).
- **Files that the index does not hold still announce.** `ci.json`, `refinery.json`
  and `observed-files.json` are plain files. The code that writes one calls
  `indexFor(root).announce({ kind: 'graph', orderId })`. State that lives only in
  the process (held tool calls, stalls, stranded agents, intake sessions, the
  feed) calls `announceLive(orderId)`, with an empty `orderId` when the state is not tied to one order.
- **No process in a read path.** The queue of the refinery reads the files that a checkout
  changed from `observed-files.json`. The executor writes that file when a step settles
  (`recordObservedFiles`). `computeQueueEntries` spawns nothing, and
  `tests/ipc/read-path-ipc.spec.ts` fails if it does.
- **The renderer does not poll the data of Foundry.** `useFoundryQuery({ key, kinds, orderId }, read)`
  (`src/renderer/foundry-query.ts`, TanStack Query) reads on mount. It reads again, once a burst
  settles, for a matching `foundry:changed` or any `workspace:changed`. A view can keep one
  fallback poll (`usePolling` from `@terminator/extension-ui`), for data that changes without a
  Foundry write, such as the transcript of an agent. That poll stops while
  `document.hidden`. The store pushes signals: its writes announce `signals`. `rg -c "setInterval\(" extensions/foundry/src/components
extensions/foundry/src/renderer` is the count to keep small.

### 5. Every function within the size limits

`npm run lint` limits every function here, specs included, to 30 lines
(blank lines and comments aside), complexity 10 and three parameters
(`eslint.config.mjs`). Split a component that outgrows the limits into a state hook, a
plain function that works out what it draws, and named parts. The state hook
calls the others in the order of their effects, because effects run in that
order. Split a spec `describe` longer than 30 lines into describes by topic.
Pass more than three values as one named object where that is the natural
shape. A spec never casts with `as unknown as`: `partialFake`
(`tests/support/fakes.ts`) stands in for an object faked in part. Check a split drawing or
layout against what it did before, call for call, and
not only against its specs.

## Where things live

`src/index.ts` is only the composition. `activate` builds an
`ActivationContext` (`{ api, dataRoot }`, `src/ipc/register.ts`) and hands it to
the module that owns each part. `deactivate` asks each module to stop. Add code to
the owning module, never back into `index.ts`.

| Responsibility                                                                                               | Module                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Registering a channel (`reg`), the disposables, `ActivationContext`                                          | `src/ipc/register.ts`                                                                             |
| Where the records live, the untracked notice, the three rungs (`resolveSources`)                             | `src/workspace-root.ts` (at `src/` because `resolveSources` finds the built-ins from `__dirname`) |
| Foundry's own folder, moving its data out of the shared userData folder                                      | `src/storage-folder.ts`                                                                           |
| The in-memory index, `announceLive`, `indexFor`, the store helpers                                           | `src/state/live-index.ts`                                                                         |
| Setting readers (autonomy, models, budgets, critical paths, read-only tools)                                 | `src/state/settings.ts`                                                                           |
| The settings page contribution                                                                               | `src/state/settings-schema.ts`                                                                    |
| The supervision runtime's parts (`runtime`), held calls, stalls, stranded agents                             | `src/runtime/runtime-state.ts`                                                                    |
| Starting and stopping the runtime, the stall watcher                                                         | `src/runtime/supervision-runtime.ts`                                                              |
| Notifications for a held call, `notePending` / `noteResolved`                                                | `src/runtime/held-calls.ts`                                                                       |
| The palette's run entries and `gotoRun`                                                                      | `src/runtime/palette-commands.ts`                                                                 |
| A role's Claude settings (mode, allow, ask, deny, sandbox); the project's proven commands                    | `src/runtime/role-settings.ts`, `src/runtime/agent-policy.ts`                                     |
| The tracker port and write-back deps                                                                         | `src/trackers/issues-port.ts`                                                                     |
| The sensor tick                                                                                              | `src/sensors/sensor-tick.ts`                                                                      |
| One architect turn, one read-only round (red team, scout)                                                    | `src/forge/intake-turn.ts`, `src/forge/intake-sessions.ts`                                        |
| The Forge loop: follow-ups, review rounds, hand-off, release                                                 | `src/forge/forge-loop.ts`                                                                         |
| The executor's deps (worktrees, sessions, rungs)                                                             | `src/line/executor-deps.ts`                                                                       |
| One run's shared context (`OrderRun`, `RunContext`), checkouts, conversations                                | `src/line/run-context.ts`                                                                         |
| One node's agent session, from launch to the end of its turn                                                 | `src/line/node-session.ts`                                                                        |
| Rungs and commands in a lane's checkout, the base checkout, reinstall                                        | `src/line/lane-commands.ts`                                                                       |
| Running an order to its tail                                                                                 | `src/line/execute-run.ts`                                                                         |
| Shipping and CI round deps, settling the ship node                                                           | `src/line/ship-deps.ts`                                                                           |
| One more CI round on drafts already open (inbox "another round", refinery recheck)                           | `src/line/ci-round-again.ts`                                                                      |
| Stopping an order, adopting runs a previous process left                                                     | `src/line/run-control.ts`                                                                         |
| The refinery tick                                                                                            | `src/line/refinery-run.ts`                                                                        |
| Standings drawn from this process, "deciding"                                                                | `src/ipc/standing.ts`                                                                             |
| Channel registration per surface                                                                             | `src/ipc/{forge,line,inbox,record,supervision,model,ui}-registration.ts`                          |
| The Forge's state (`useForgeState`), what it draws (`deriveForge`), its steps (`STEP_BODIES`)                | `src/components/Forge.tsx`                                                                        |
| The Floor's state (`useFloor`) and its panels                                                                | `src/components/Floor.tsx`                                                                        |
| The factory hall's state (`useFactoryHall`), what it draws (`hallModel`), its parts                          | `src/components/factory/FactoryHall.tsx`                                                          |
| The signal dock's shared query and promotion, used by the Inbox and the factory site                         | `src/renderer/use-signals.ts`                                                                     |
| The window's chrome; each view loaded with `React.lazy` as its own chunk (budget: `vite.renderer.config.ts`) | `src/renderer/App.tsx`                                                                            |

## Extension Isolation (MANDATORY)

This extension is fully isolated. The core application knows nothing about it.

### What this extension MAY do

- Call core IPC through `window.electronAPI.{terminal,workspace,project,git,shell,fs,settings,…}` for **core-owned channels only**.
- Call its own IPC through `window.electronAPI.extensionBridge.invoke('foundry:…')`.
- Register IPC channels through `reg` in `src/ipc/register.ts`, each a `ChannelSpec` with the zod schema of its payload (`foundryChannel` in `src/ipc/channel.ts`; ADR 096). The schema sits beside the module that answers the channel. The host parses the payload before `run` sees it, and `run` takes the parsed type. Never parse or cast a payload by hand. `tests/channel-schemas.spec.ts` checks that every registered channel has a schema. A test of the rules of one schema is the concern of zod, not of this repository.
- Use `api.shell.exec` for `git` and `gh`. These are the only two commands that the core allowlist admits (`src/main/shell/shell-executor.ts`). The default timeout of the core is 10 seconds, so a call that can take longer passes `timeoutMs` (`git commit` 300 s, rebase and push 120 s). A result with `timedOut` set is a failure that says it timed out.
- Run each `api.shell.exec` inside a root that the core allows (ADR 102, ADR 103): a workspace folder, a project worktree, the `api.paths.globalStorage` of Foundry, or `terminator.foundry.dataDir`, which `manifest.json` declares in `contributes.shellRoots`. Every records root that `src/workspace-root.ts` resolves, and every lane worktree under it, is inside one of those. Any other folder rejects with `CwdOutOfScopeError` and runs nothing.

Verification commands (`npm test`, `pytest`, …) do **not** run through `api.shell.exec` and do **not** run as hidden child processes. Each runs in a terminal tab of its own in the checkout of the lane (`SupervisedRunner.runCommand`), so its output is visible. Its verdict is the exit status of that tab. No agent runs it and nothing reads back a transcript. The script of the command is the process of the tab (`api.pty.runInTerminal`). Nothing is typed into a shell, and the exit code is the one that node-pty reports. The tab starts as `$SHELL -i -l -c "exec $SHELL <script>"`, so the startup files of the user (`.zshrc`, `.bash_profile`) are read as they are for a typed command. What they export (`JAVA_HOME`, `GOPATH`, nvm) reaches the check. `exec` makes the script, not that shell, the process whose exit is reported. A command that a signal ended, or whose tab was closed before it finished, has no exit code. `runCommand` returns `null` and the check reports "not measured" (rule 2), never a pass.

### What this extension MUST NOT do

- **Never** modify `src/main/preload.ts`.
- **Never** put a `foundry:*` channel in `src/shared/electron-api/manifest.ts`.
- **Never** add extension-only npm dependencies to the **root** `package.json`. Put them in `extensions/foundry/package.json`.
- **Never** import from another extension.
- **Never** hardcode the extension id (`terminator.foundry`) in core application files.

**The test**: if you deleted `extensions/foundry/`, would core still build and run without modification? It must.

### The one core capability this feature added

`ExtensionAPI.issues` gained `states()`, `transition(intent)` and `supportsTransitions()` in v2.3.0 (ADR-041). That is a **generic** capability: core learned that an extension can move the workflow position of an issue, and learned nothing about Foundry. The provider methods are optional, and only Linear implements them. See `specs/037-foundry-software-factory/contracts/extension-api-issues.md`.

## NPM Dependencies

Declare dependencies in `extensions/foundry/package.json` only, at the one version that the repository uses for each (ADR 097). npm workspaces hoist them. Besides the SDK, the design system, `react`, `react-dom` and `lucide-react` for the view, the dependencies of Foundry are **`zod`** (schema validation at every boundary) and **`js-yaml`** (people write recipes, roles and rules by hand, and they need comments). The backend runs in the extension host and does not import `electron` (ADR 094). `api.paths`, `api.dialog` and `api.window` cover what it used `electron` for.

## Build

`npm run build:extensions` bundles `src/index.ts` to `src/index.js` with esbuild. That output is a **build artefact**: it is gitignored and you never edit it by hand. Change the TypeScript and rebuild.

Extension specs live in `tests/`, and the root `vitest.config.ts` matches them. Note that `vi.mock` cannot intercept a module that esbuild has inlined. Any spec that calls `activate()` must import `../../src/index.ts`, not the bundle. `tests/helpers/foundry-host.ts` activates Foundry over a host with real files, real `git` and a `gh` that the spec answers for. `tests/helpers/line-run.ts` adds an agreed order and agents that do its work. Reuse them instead of writing another host. A spec that drives `activate` mocks the supervised runner and the control server with `tests/helpers/supervision-mocks.ts`. The rest of `tests/helpers/` holds what specs used to copy: order parts, Forge turns, ledger reads, bridge calls, hall views. Add to it instead of writing a second copy in a spec.

Get the temporary directory of a spec from `temporaryDirectory` in `tests/helpers/foundry-host.ts` (or `makeTempDir` from the root `tests/support/temp-dir.ts`). The root `tests/setup.ts` removes it when the spec file ends, passed or failed. Never call `mkdtempSync` in `os.tmpdir()` directly: the CI unit job fails a run that leaves anything in the temporary directory (`scripts/check-temp-leaks.mjs`). `tests/live/` runs without `tests/setup.ts` and removes its own directories.

## Typecheck

`npm run typecheck` checks the core, both packages and every extension. `scripts/typecheck.mjs` runs `tsc -p extensions/foundry/tsconfig.json`, which extends `tsconfig.extension.json`, for `src/`. Then it runs `tsc -p extensions/foundry/tsconfig.test.json` for the specs under `tests/`. Vitest strips types, so a spec that no longer matches the type it builds runs green. Examples are an order that lacks a field the schema now fills in, and a mock whose arguments are untyped. Only the second check catches them. The root `npx tsc --noEmit` checks nothing: the root `tsconfig.json` is `files: []` with project references. Neither `npm run build:extensions` (esbuild) nor the vite renderer build typechecks anything either, because both strip types.

A type error that the typecheck would catch otherwise ships through a green build, clean lint and passing unit tests, and blanks every Foundry surface at runtime. An example is a `Record` keyed by a union that lacks a member.
