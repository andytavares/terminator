# Foundry Extension — Development Rules

Foundry is a software factory: a **Forge** that converges an idea or tracker issue into a compilable work order, and a **Line** that executes that order with typed agent roles, independent verification and risk-priced human gates, ending in a draft pull request.

Design documents: `specs/037-foundry-software-factory/`.

## The rules that are specific to this extension

### 1. Nothing is written into a target repository

Foundry creates or modifies **exactly one thing** in a repository it works on: the change the order asked for. No scaffolding, no init step, no committed configuration, no marker file — and **never** a `.gitignore` entry, not even for Foundry's own default data directory.

Everything Foundry needs to run ships inside this extension. A repository contributes information, never installation. A repository _may_ carry its own `.foundry/recipes/…` and those win, but no repository is ever required to have one.

Foundry's own records go to `terminator.foundry.dataDir` when set, and to `<workdir>/.foundry/` when it is not; with no workspace open, `<workdir>` is `records/` in Foundry's own `api.paths.globalStorage`. That path is resolved **once**, by `src/data-root.ts`; every writer receives an absolute path and never resolves it again.

A lane worktree is the one exception, and it is not really an exception: `src/line/worktree.ts`'s `provisionDependencies` symlinks the origin checkout's installed folders into the lane's worktree — a fresh `git worktree add` has none, so every check command fails before it reads the change. Which folders is not Foundry's to know: they are the order's `context.environment.share`, which the repository profile fills (the node hint lends `node_modules`; a repository with another toolchain names its own). Each entry is a folder name matched beside every directory that holds a tracked file, wherever the origin has it, and it is lent only into a place the repository's own `.gitignore` already covers. It checks with `git check-ignore` after linking and removes the link again if that says otherwise, so a repository that does not ignore a shared folder gets nothing added, and none ever gets an untracked file it did not already tolerate. An empty list lends nothing. What the links cannot supply is installed by the order's `environment.prepare`: `prepareNewCheckouts` (`src/line/lane-commands.ts`) runs it once, in its own visible tab, in each lane checkout cut for the run (not one reattached), and records `checkout.prepared` or `checkout.prepare-failed` with the exit code. A lane whose prepare failed or did not run reports its checks as not measured — "the checkout could not be prepared" — never as a failure of the change.

Foundry's folder holds `records/` and the supervision runtime's `runtime/`. Earlier builds kept them in the shared userData folder as `foundry/` and `foundry-runtime/`; `moveFromSharedUserData` (`src/storage-folder.ts`) moves them on the first activation, unless the new one exists, and runs `git worktree repair` in each lane worktree that moved with the records (ADR 103).

### 2. Nothing is assumed about a repository's toolchain

There is no hardcoded `npm run lint`, and no code that knows what a `package.json` is. What a repository's commands are comes from its **profile** (`src/profile/`), resolved per field from four sources, first to answer wins: `operator` (saved on the Checks step, stored under the data root), `repository` (the repository's own `.foundry/profile.yaml`, read only), `scout` (what an agent read from the README and proved), `hint`. Every entry carries its source, so a surface says where a command came from. Nothing is `null`-coerced: an empty entry means the matching check reports **"not measured"**, never a pass, and boolean-coercing that third value anywhere in the verification path turns "we did not check" into "it is fine", which is the bug the ladder exists to prevent.

Knowledge of a toolchain is **data in `hints/*.yaml`**, one file per ecosystem, read by `src/profile/hints.ts` against the files a repository has — never executed. A new ecosystem is a new hint file; no `.ts` changes. A command is trusted only once it has been **proven on the base branch** (`src/line/baseline.ts` runs it there and the profile's `proof` keeps the exit code and commit); an order whose base already fails says so rather than blaming the change.

`tests/verify/ecosystem-neutral.spec.ts` guards this: it tokenises every file under `src/` and fails on a string, template or regex literal naming an ecosystem's tool (`npm`, `node_modules`, `pytest`, `cargo`, `.tsx`, …). A code path that needs to know it is looking at one toolchain is a hint file or a profile field that has not been written yet. The guard reads literals, so a comment may still give an example.

### 3. Claude Code's settings decide; Foundry decides two things

Each agent starts with `settingSources: ['project']` (it never loads the operator's `~/.claude`) and the settings `runtime/role-settings.ts` builds from its role: a permission mode, `allow`, `ask` and `deny` rules, and a sandbox for roles that do not write freely. Claude reads every subcommand, subshell and control-flow body against those rules, so Foundry reads no shell command. Read-only, documentation-only and restricted-write roles run in `dontAsk` mode: what no rule allows is refused at once, so nothing waits. A free writer runs in `auto` (or `acceptEdits` when `terminator.foundry.letAutoModeDecide` is off); `escorted` keeps `default`. Hard refusals (`runtime/deny-rules.ts`, and `git -C … push`) are `deny` rules, so they hold in every mode.

What reaches `runtime/tool-decision.ts` is an ask the settings left open. It decides one thing itself: an `Artifact` publish is allowed only for the order's own page in its outputs directory. At `lights-out` it refuses any other ask with a reason; elsewhere it returns `null` and the ask goes to the operator at once (`permission-bridge.ts` holds it with no timer). A role that publishes a document runs in `default` mode instead of `dontAsk`, since `dontAsk` would refuse its `Artifact` ask before Foundry saw it.

A refusal never cancels a turn: the runner answers the ask with the agent's reject option and the agent carries on. An operator's typed answer is rejected the same way, then sent as a normal prompt once the running turn has ended. The core starts agents with `clientCapabilities: {}`, so `AskUserQuestion` is unavailable and Foundry has no question path.

When you change a role's rules, test them in `tests/runtime/role-settings.spec.ts`. The documentation-only globs there are checked against `isDocumentationRelative`.

### 4. Disk is the truth, memory is the read path, and a change is pushed

`src/state/foundry-index.ts` holds orders, run graphs, gates and ledgers in
memory, one index per data root. Everything that writes one of them goes through
a store module (`order/store.ts`, `gates/store.ts`, `writeRunGraph` in
`ipc/run-channels.ts`), writes to disk **first**, and only then tells the
index; the index then broadcasts `foundry:changed` `{ kind, orderId }`. A new
writer of any of these records must do the same, or the surfaces keep showing
what was there before.

- **Reads come from the index, never from a fresh parse.** Do not read
  `order.json`, `gates.json`, `run-graph.json` or `ledger.jsonl` directly; use the
  store. Reads return copies, so a caller may edit what it was given.
- **A record edited by hand under the data root is not noticed** until the
  application restarts. A spec that writes records while the app is running
  restarts it (`restartFoundry` in `tests/e2e/foundry-harness.ts`).
- **Files the index does not hold still announce.** `ci.json`, `refinery.json`
  and `observed-files.json` are plain files; the code that writes one calls
  `indexFor(root).announce({ kind: 'graph', orderId })`. State that lives only in
  the process (held tool calls, stalls, stranded agents, intake sessions, the
  feed) calls `announceLive(orderId)` — empty when not tied to one order.
- **No process in a read path.** The refinery's queue reads the files a checkout
  changed from `observed-files.json`, written by the executor when a step settles
  (`recordObservedFiles`). `computeQueueEntries` spawns nothing, and
  `tests/ipc/read-path-ipc.spec.ts` fails if it does.
- **The renderer does not poll Foundry's own data.** `useFoundryQuery({ key, kinds, orderId }, read)`
  (`src/renderer/foundry-query.ts`, TanStack Query) reads on mount and again, once a burst
  settles, for a matching `foundry:changed` or any `workspace:changed`. The one
  fallback poll a view may keep (`usePolling` from `@terminator/extension-ui`) is for what changes without a
  Foundry write — an agent's transcript — and it stops while
  `document.hidden`. Signals are pushed: the signal store's writes announce `signals`. `rg -c "setInterval\(" extensions/foundry/src/components
extensions/foundry/src/renderer` is the count to keep small.

### 5. Every function within the size limits

`npm run lint` holds every function here, specs included, to at most 30 lines
(blank lines and comments aside), complexity 10 and three parameters
(`eslint.config.mjs`). A component that outgrows them becomes a state hook, a
plain function that works out what it draws, and named parts; the state hook
calls the others in the order their effects ran, because effects run in that
order. A spec `describe` longer than 30 lines is split into describes by topic.
Pass more than three values as one named object where that is the natural
shape. A spec never casts with `as unknown as`: `partialFake`
(`tests/support/fakes.ts`) stands in for an object faked in part. A drawing or a
layout that is split is checked against what it did before, call for call, and
not only against its specs.

## Where things live

`src/index.ts` is only the composition: `activate` builds an
`ActivationContext` (`{ api, dataRoot }`, `src/ipc/register.ts`) and hands it to
the module that owns each part, and `deactivate` asks each to stop. Add code to
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

This is a fully isolated extension. The core application knows nothing about it.

### What this extension MAY do

- Call core IPC via `window.electronAPI.{terminal,workspace,project,git,shell,fs,settings,…}` for **core-owned channels only**
- Call its own IPC via `window.electronAPI.extensionBridge.invoke('foundry:…')`
- Register IPC channels through `reg` in `src/ipc/register.ts`, each a `ChannelSpec` with the zod schema of its payload (`foundryChannel` in `src/ipc/channel.ts`; ADR 096). The schema sits beside the module that answers the channel, the host parses the payload before `run` sees it, and `run` takes the parsed type — never parse or cast a payload by hand. `tests/channel-schemas.spec.ts` checks every registered channel has one; a test of one schema's rules is zod's concern, not this repository's
- Use `api.shell.exec` for `git` and `gh` — those are the only two commands the core allowlist admits (`src/main/shell/shell-executor.ts`). Core's default timeout is 10 seconds, so a call that can take longer passes `timeoutMs` (`git commit` 300 s, rebase and push 120 s), and a result with `timedOut` set is a failure that says it timed out
- Run each `api.shell.exec` inside a root the core allows (ADR 102, ADR 103): a workspace folder, a project worktree, Foundry's own `api.paths.globalStorage`, or `terminator.foundry.dataDir`, which `manifest.json` declares in `contributes.shellRoots`. Every records root `src/workspace-root.ts` resolves, and every lane worktree under it, is inside one of those. Anywhere else rejects with `CwdOutOfScopeError` and runs nothing

Verification commands (`npm test`, `pytest`, …) do **not** run through `api.shell.exec` and do **not** run as hidden child processes. Each runs in a terminal tab of its own in the lane's checkout (`SupervisedRunner.runCommand`), so its output is visible, and its verdict is that tab's exit status — no agent runs it and no transcript is read back. The command's script is the tab's own process (`api.pty.runInTerminal`): nothing is typed into a shell, and the exit code is the one node-pty reports. The tab starts as `$SHELL -i -l -c "exec $SHELL <script>"`, so the user's startup files (`.zshrc`, `.bash_profile`) are read as they were for a typed command, and what they export (`JAVA_HOME`, `GOPATH`, nvm) reaches the check; `exec` leaves the script, not that shell, as the process whose exit is reported. A command a signal ended, or whose tab was closed before it finished, has no exit code; `runCommand` returns `null` and the check reports "not measured" (rule 2), never a pass.

### What this extension MUST NOT do

- **Never** modify `src/main/preload.ts`
- **Never** put a `foundry:*` channel in `src/shared/electron-api/manifest.ts`
- **Never** add extension-only npm deps to the **root** `package.json` — they go in `extensions/foundry/package.json`
- **Never** import from another extension
- **Never** hardcode the extension id (`terminator.foundry`) in core application files

**The test**: if `extensions/foundry/` were deleted, would core still build and run without modification? It must.

### The one core capability this feature added

`ExtensionAPI.issues` gained `states()`, `transition(intent)` and `supportsTransitions()` in v2.3.0 (ADR-041). That is a **generic** capability — core learned that an extension may move an issue's workflow position; it learned nothing about Foundry. The provider methods are optional and only Linear implements them; Jira reports the capability as unsupported. See `specs/037-foundry-software-factory/contracts/extension-api-issues.md`.

## NPM Dependencies

Declared in `extensions/foundry/package.json` only, at the one version the repository uses for each (ADR 097). npm workspaces hoist them. Besides the SDK, the design system, `react`, `react-dom` and `lucide-react` for the view, Foundry's own dependencies are **`zod`** (schema validation at every boundary) and **`js-yaml`** (recipes, roles and rules are hand-authored and need comments). The backend runs in the extension host and does not import `electron` (ADR 094); `api.paths`, `api.dialog` and `api.window` cover what it used it for.

## Build

`npm run build:extensions` bundles `src/index.ts` to `src/index.js` with esbuild. That output is a **build artefact**: gitignored, never edited by hand. Change the TypeScript and rebuild.

Extension specs live in `tests/` and are matched by the root `vitest.config.ts`. Note that `vi.mock` cannot intercept a module esbuild has inlined — any spec that calls `activate()` must import `../../src/index.ts`, not the bundle. `tests/helpers/foundry-host.ts` activates Foundry over a host with real files, real `git` and a `gh` the spec answers for; `tests/helpers/line-run.ts` adds an agreed order and agents that do its work. Reuse them rather than writing another host. A spec that drives `activate` mocks the supervised runner and the control server with `tests/helpers/supervision-mocks.ts`. The rest of `tests/helpers/` holds what specs used to copy: order parts, Forge turns, ledger reads, bridge calls, hall views. Add to it rather than writing a second copy in a spec.

A spec's temporary directory comes from `temporaryDirectory` in `tests/helpers/foundry-host.ts` (or `makeTempDir` from the root `tests/support/temp-dir.ts`), which the root `tests/setup.ts` removes when the spec file ends, passed or failed. Never `mkdtempSync` in `os.tmpdir()` directly: the CI unit job fails a run that leaves anything in the temporary directory (`scripts/check-temp-leaks.mjs`). `tests/live/` runs without `tests/setup.ts` and removes its own.

## Typecheck

`npm run typecheck` checks the core, both packages and every extension (`typecheck:extensions` runs `tsc -p extensions/foundry/tsconfig.json`, which extends `tsconfig.extension.json`, for `src/`, then `tsc -p extensions/foundry/tsconfig.test.json` for the specs under `tests/`). Vitest strips types, so a spec that no longer matches the type it builds — an order missing a field the schema now fills in, a mock whose arguments are untyped — runs green and is caught only by that second check. The root `npx tsc --noEmit` checks nothing: the root `tsconfig.json` is `files: []` with project references. Neither `npm run build:extensions` (esbuild) nor the vite renderer build typechecks anything either — both strip types.

A type error the typecheck would catch — a `Record` keyed by a union missing a member, for example — otherwise ships through a green build, clean lint and passing unit tests, and blanks every Foundry surface at runtime.
