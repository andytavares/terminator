# Foundry Extension — Development Rules

Foundry is a software factory: a **Forge** that converges an idea or tracker issue into a compilable work order, and a **Line** that executes that order with typed agent roles, independent verification and risk-priced human gates, ending in a draft pull request.

Design documents: `specs/037-foundry-software-factory/`.

## The rules that are specific to this extension

### 1. Nothing is written into a target repository

Foundry creates or modifies **exactly one thing** in a repository it works on: the change the order asked for. No scaffolding, no init step, no committed configuration, no marker file — and **never** a `.gitignore` entry, not even for Foundry's own default data directory.

Everything Foundry needs to run ships inside this extension. A repository contributes information, never installation. A repository _may_ carry its own `.foundry/recipes/…` and those win, but no repository is ever required to have one.

Foundry's own records go to `terminator.foundry.dataDir` when set, and to `<workdir>/.foundry/` when it is not. That path is resolved **once**, by `src/data-root.ts`; every writer receives an absolute path and never resolves it again.

A lane worktree is the one exception, and it is not really an exception: `src/line/worktree.ts`'s `provisionDependencies` symlinks the origin checkout's installed `node_modules` into the lane's worktree — a fresh `git worktree add` has none, so every check command fails before it reads the change — but only into a directory the repository's own `.gitignore` already covers. It checks with `git check-ignore` after linking and removes the link again if that says otherwise, so a repository that does not ignore `node_modules` gets nothing added, and none ever gets an untracked file it did not already tolerate.

### 2. Nothing is assumed about a repository's toolchain

There is no hardcoded `npm run lint`. `src/verify/toolchain-probe.ts` reads the target project's manifests — never executes them — and records the real command, or `null`. A `null` means the matching check reports **"not measured"**, never a pass. Boolean-coercing that third value anywhere in the verification path turns "we did not check" into "it is fine", which is the bug the ladder exists to prevent.

### 3. A question this policy asks by accident costs five minutes

`runtime/tool-decision.ts` decides every tool call an agent makes. Anything it
does not decide is **held for `DEFAULT_ASK_AFTER_MS` — five minutes** — before
handing back to a terminal that, in an unattended run, nobody is sitting at.

So reading a command correctly is a latency requirement here, not only a
correctness one: a held call costs minutes where a decided one costs seconds.

With `terminator.foundry.letAutoModeDecide` on (the default), an abstention at
`standard` or `lights-out` goes to Claude Code's auto mode instead of the hold
(ADR 077), destructive actions included. Only `escorted` still holds for a person.

When you change `shell-split.ts`, `autonomy-policy.ts` or `read-only-policy.ts`,
the question is not only "does this let the wrong thing through". It is also
"does this hold the right thing", and the second one has a price tag. Every
defect ADR-049 found was the second kind: a discard that needed whitespace
after it, a parenthesis inside a quoted argument, a heredoc body read as shell,
a scratch file in the OS temp directory.

`shell-split.ts` tracks quoting and escaping. It is not a shell parser and must
not become one — heredocs are in because a heredoc is quoting, and that is the
whole of the licence.

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
- **The renderer does not poll Foundry's own data.** `usePushed(read, show,
{ kinds, orderId })` reads on mount and again for a matching change. The one
  fallback poll a view may keep (`usePolling` from `@terminator/extension-ui`) is for what changes without a
  Foundry write — an agent's transcript, a sensor's signals — and it stops while
  `document.hidden`. `rg -c "setInterval\(" extensions/foundry/src/components
extensions/foundry/src/renderer` is the count to keep small.

## Where things live

`src/index.ts` is only the composition: `activate` builds an
`ActivationContext` (`{ api, dataRoot }`, `src/ipc/register.ts`) and hands it to
the module that owns each part, and `deactivate` asks each to stop. Add code to
the owning module, never back into `index.ts`.

| Responsibility                                                                   | Module                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Registering a channel (`reg`), the disposables, `ActivationContext`              | `src/ipc/register.ts`                                                                             |
| Where the records live, the untracked notice, the three rungs (`resolveSources`) | `src/workspace-root.ts` (at `src/` because `resolveSources` finds the built-ins from `__dirname`) |
| The in-memory index, `announceLive`, `indexFor`, the store helpers               | `src/state/live-index.ts`                                                                         |
| Setting readers (autonomy, models, budgets, critical paths, read-only tools)     | `src/state/settings.ts`                                                                           |
| The settings page contribution                                                   | `src/state/settings-schema.ts`                                                                    |
| The supervision runtime's parts (`runtime`), held calls, stalls, stranded agents | `src/runtime/runtime-state.ts`                                                                    |
| Starting and stopping the runtime, the stall watcher                             | `src/runtime/supervision-runtime.ts`                                                              |
| Notifications for a held call, `notePending` / `noteResolved`                    | `src/runtime/held-calls.ts`                                                                       |
| The palette's run entries and `gotoRun`                                          | `src/runtime/palette-commands.ts`                                                                 |
| Workspace trust, the probed-command and read-only decisions                      | `src/runtime/agent-policy.ts`                                                                     |
| The tracker port and write-back deps                                             | `src/trackers/issues-port.ts`                                                                     |
| The sensor tick                                                                  | `src/sensors/sensor-tick.ts`                                                                      |
| One architect turn, one read-only round (red team, scout)                        | `src/forge/intake-turn.ts`, `src/forge/intake-sessions.ts`                                        |
| The Forge loop: follow-ups, review rounds, hand-off, release                     | `src/forge/forge-loop.ts`                                                                         |
| The executor's deps (worktrees, sessions, rungs)                                 | `src/line/executor-deps.ts`                                                                       |
| Running an order to its tail                                                     | `src/line/execute-run.ts`                                                                         |
| Shipping and CI round deps, settling the ship node                               | `src/line/ship-deps.ts`                                                                           |
| Stopping an order, adopting runs a previous process left                         | `src/line/run-control.ts`                                                                         |
| The refinery tick                                                                | `src/line/refinery-run.ts`                                                                        |
| Standings drawn from this process, "deciding"                                    | `src/ipc/standing.ts`                                                                             |
| Channel registration per surface                                                 | `src/ipc/{forge,line,inbox,record,supervision,model,ui}-registration.ts`                          |

## Extension Isolation (MANDATORY)

This is a fully isolated extension. The core application knows nothing about it.

### What this extension MAY do

- Call core IPC via `window.electronAPI.{terminal,workspace,project,git,shell,fs,settings,…}` for **core-owned channels only**
- Call its own IPC via `window.electronAPI.extensionBridge.invoke('foundry:…')`
- Register IPC channels through `reg` in `src/ipc/register.ts`, each a `ChannelSpec` with the zod schema of its payload (`foundryChannel` in `src/ipc/channel.ts`; ADR 096). The schema sits beside the module that answers the channel, the host parses the payload before `run` sees it, and `run` takes the parsed type — never parse or cast a payload by hand. `tests/channel-schemas.spec.ts` checks every registered channel has one; a test of one schema's rules is zod's concern, not this repository's
- Use `api.shell.exec` for `git` and `gh` — those are the only two commands the core allowlist admits (`src/main/shell/shell-executor.ts`). Core's default timeout is 10 seconds, so a call that can take longer passes `timeoutMs` (`git commit` 300 s, rebase and push 120 s), and a result with `timedOut` set is a failure that says it timed out

Verification commands (`npm test`, `pytest`, …) do **not** run through `api.shell.exec` and do **not** run as hidden child processes. Each runs in a terminal tab of its own in the lane's checkout (`SupervisedRunner.runCommand`), so its output is visible, and its verdict is that tab's exit status — no agent runs it and no transcript is read back.

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

Declared in `extensions/foundry/package.json` only. npm workspaces hoist them. Extension-owned dependencies, in full: **`zod`** (schema validation at every boundary) and **`js-yaml`** (recipes, roles and rules are hand-authored and need comments). That is the whole list.

`react`, `react-dom`, `lucide-react` and `electron` are the application's, not this extension's, and are used through the hoist rather than redeclared.

## Build

`npm run build:extensions` bundles `src/index.ts` to `src/index.js` with esbuild. That output is a **build artefact**: gitignored, never edited by hand. Change the TypeScript and rebuild.

Extension specs live in `tests/` and are matched by the root `vitest.config.ts`. Note that `vi.mock` cannot intercept a module esbuild has inlined — any spec that calls `activate()` must import `../../src/index.ts`, not the bundle.

## Typecheck

`npm run typecheck:extensions` — `tsc --noEmit` over `extensions/foundry/tsconfig.json`. **Run it.** Nothing else does.

The root `tsconfig.json` is `files: []` plus project references with no `--build`, so `npm run typecheck` checks nothing; and even under `--build` the extension is in none of the three referenced projects. Neither `npm run build:extensions` (esbuild) nor the vite renderer build typechecks anything either — both strip types.

A type error the typecheck would catch — a `Record` keyed by a union missing a member, for example — otherwise ships through a green build, clean lint and passing unit tests, and blanks every Foundry surface at runtime.
