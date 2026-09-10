# Foundry Extension — Development Rules

Foundry is a software factory: a **Forge** that converges an idea or tracker issue into a compilable work order, and a **Line** that executes that order with typed agent roles, independent verification and risk-priced human gates, ending in a draft pull request.

Design documents: `specs/037-foundry-software-factory/`.

## The three rules that are specific to this extension

### 1. Nothing is written into a target repository

Foundry creates or modifies **exactly one thing** in a repository it works on: the change the order asked for. No scaffolding, no init step, no committed configuration, no marker file — and **never** a `.gitignore` entry, not even for Foundry's own default data directory.

Everything Foundry needs to run ships inside this extension. A repository contributes information, never installation. A repository _may_ carry its own `.foundry/recipes/…` and those win, but no repository is ever required to have one.

Foundry's own records go to `terminator.foundry.dataDir` when set, and to `<workdir>/.foundry/` when it is not. That path is resolved **once**, by `src/data-root.ts`; every writer receives an absolute path and never resolves it again.

### 2. Nothing is assumed about a repository's toolchain

There is no hardcoded `npm run lint`. `src/verify/toolchain-probe.ts` reads the target project's manifests — never executes them — and records the real command, or `null`. A `null` means the matching check reports **"not measured"**, never a pass. Boolean-coercing that third value anywhere in the verification path turns "we did not check" into "it is fine", which is the bug the ladder exists to prevent.

### 3. A question this policy asks by accident costs five minutes

`runtime/tool-decision.ts` decides every tool call an agent makes. Anything it
does not decide is **held for `DEFAULT_ASK_AFTER_MS` — five minutes** — before
handing back to a terminal that, in an unattended run, nobody is sitting at.

So reading a command correctly is a latency requirement here, not only a
correctness one. Measured on WO-0910-1fb: thirteen of a builder's 131 calls
were held and those thirteen ate 16.6 of the run's 26.7 minutes of tool time.
A held call averages 77 seconds; a taken one averages 5.

When you change `shell-split.ts`, `autonomy-policy.ts` or `read-only-policy.ts`,
the question is not only "does this let the wrong thing through". It is also
"does this hold the right thing", and the second one has a price tag. Every
defect ADR-049 found was the second kind: a discard that needed whitespace
after it, a parenthesis inside a quoted argument, a heredoc body read as shell,
a scratch file in the OS temp directory.

`shell-split.ts` tracks quoting and escaping. It is not a shell parser and must
not become one — heredocs are in because a heredoc is quoting, and that is the
whole of the licence.

## Extension Isolation (MANDATORY)

This is a fully isolated extension. The core application knows nothing about it.

### What this extension MAY do

- Call core IPC via `window.electronAPI.{terminal,workspace,project,git,shell,fs,settings,…}` for **core-owned channels only**
- Call its own IPC via `window.electronAPI.extensionBridge.invoke('foundry:…')`
- Register IPC handlers in `src/index.ts` via `api.ipc.registerHandler()`
- Use `api.shell.exec` for `git` and `gh` — those are the only two commands the core allowlist admits (`src/main/shell/shell-executor.ts`)

Verification commands (`npm test`, `pytest`, …) do **not** run through `api.shell.exec` and do **not** run as hidden child processes. They run as steps inside the supervised terminal session, which is what makes their output visible and their tool calls hook-gated.

### What this extension MUST NOT do

- **Never** modify `src/main/preload.ts`
- **Never** put a `foundry:*` channel in `src/renderer/electron.d.ts`
- **Never** add extension-only npm deps to the **root** `package.json` — they go in `extensions/foundry/package.json`
- **Never** import from another extension
- **Never** hardcode the extension id (`terminator.foundry`) in core application files

**The test**: if `extensions/foundry/` were deleted, would core still build and run without modification? It must.

### The one core capability this feature added

`ExtensionAPI.issues` gained `states()`, `transition(intent)` and `supportsTransitions()` in v2.3.0 (ADR-041). That is a **generic** capability — core learned that an extension may move an issue's workflow position; it learned nothing about Foundry. The provider methods are optional and only Linear implements them; Jira reports the capability as unsupported. See `specs/037-foundry-software-factory/contracts/extension-api-issues.md`.

## NPM Dependencies

Declared in `extensions/foundry/package.json` only. npm workspaces hoist them. Extension-owned dependencies, in full: **`zod`** (schema validation at every boundary) and **`js-yaml`** (recipes, roles and rules are hand-authored and need comments). That is the whole list.

`diff`, `marked`, `@dnd-kit/*` and `@terminator/extension-ui` were declared here and imported by nothing — carried over from the extension this replaced, which had a drag-and-drop board and rendered markdown. Foundry parses its own hunks and renders its own markup.

`react`, `react-dom`, `lucide-react` and `electron` are the application's, not this extension's, and are used through the hoist rather than redeclared.

## Build

`npm run build:extensions` bundles `src/index.ts` to `src/index.js` with esbuild. That output is a **build artefact**: gitignored, never edited by hand. Change the TypeScript and rebuild.

Extension specs live in `tests/` and are matched by the root `vitest.config.ts`. Note that `vi.mock` cannot intercept a module esbuild has inlined — any spec that calls `activate()` must import `../../src/index.ts`, not the bundle.

## Typecheck

`npm run typecheck:extensions` — `tsc --noEmit` over `extensions/foundry/tsconfig.json`. **Run it.** Nothing else does.

The root `tsconfig.json` is `files: []` plus project references with no `--build`, so `npm run typecheck` checks nothing; and even under `--build` the extension is in none of the three referenced projects. Neither `npm run build:extensions` (esbuild) nor the vite renderer build typechecks anything either — both strip types.

What that gap cost: `RULE_ICON` in `Inbox.tsx` is `Record<GateRuleId, …>`. A new gate rule was added without an entry, so `<Icon />` was handed `undefined`; React throws on that and unmounts the whole tree, and **every Foundry surface rendered blank**. The build was green, lint was clean, 2,293 unit tests passed, and the only thing that caught it was an e2e that opened the panel and looked at the screen.

`extensions/foundry/tsconfig.json` did not exist until then, so the script had been failing with "the specified path does not exist" for the whole life of the feature.
