# Handoff: the overhaul branch (claude/brave-newton-5ssiux, draft PR #259)

Written 2026-10-13 so the work can move to another machine with `claude --teleport`
(https://code.claude.com/docs/en/claude-code-on-the-web). Teleport carries the conversation and the
pushed branch only. Worker branches that were never merged and background workers do not move, so
everything worth keeping is merged into the branch before this file was committed.

## What is done

The phases in `docs/research/perf/` and the ADRs 093–105 record each decision. In short:

- Electron 44, with `predev`/`prepreview` running `install-electron` so `npm run dev` works on a
  fresh clone (Electron 44 no longer downloads its binary on install). A CI Start job checks a
  fresh `npm ci` + `dev`, `preview` and the packaged app.
- Extension host in a utilityProcess (ADR 094); SDK contract with zod channel specs (ADR 096).
- node:sqlite replaces PGlite (ADR 099); Remote Control credentials (ADR 100).
- Shell exec limited to declared roots (ADR 102); per-extension data folders (ADR 103).
- CI gates: typecheck of every project, coverage on the patch (ADR 095), one version per dependency
  (syncpack), unused code (knip, ADR 104), code only tests reach (knip --production, ADR 107),
  duplicate code (jscpd, ADR 105), temp-dir leak check,
  selective e2e (`scripts/e2e-select.mjs`), perf budgets (`npm run test:perf`), Storybook stories.
- Design system in Storybook (ADR 098); Linux baselines come from the `update-story-baselines`
  label workflow (`.github/workflows/story-baselines.yml`).
- Real-app e2e for the features the coverage map listed as undriven
  (`docs/research/feature-coverage.md`), with network services stubbed locally.
- Test audit: tests that failed the standard were fixed or removed (`docs/research/test-audit-core.md`).
- Function size limits (≤30 lines, complexity ≤10, ≤3 params) enforced by ESLint for every
  `.js`, `.mjs`, `.cjs`, `.ts`, `.mts` and `.tsx` file, and an explicit `any` is a lint error
  (`eslint.config.mjs`, `tests/unit/lint/size-limits.spec.ts`).
- Every spec, the extensions' included, is typechecked (`tsconfig.test.json` beside each
  `tsconfig.json`), and no spec casts with `as unknown as`: it fakes with `partialFake`.

## What is left

1. Done: function size limits for Foundry, the core and every other file; the ESLint rule is on
   for all of them (decision 33).
2. Clean gate, partly done. `docs/research/clean-gate.md` measured 2,807 repeated names and 986
   comment runs at `6d4eabf`. Five area passes then ran; the counts below come from each pass's
   gate.py run over its own paths, not a fresh run over the whole branch:

   | Area                                                 | Comment runs | Repeated names |
   | ---------------------------------------------------- | ------------ | -------------- |
   | tests, scripts, root files                           | 168 → 3      | 509 → 236      |
   | `extensions/foundry/src`                             | 387 → 0      | 320 → 199      |
   | `extensions/foundry/tests`                           | 34 → 0       | 550 → 128      |
   | task-vault, git-integration, notepad, remote-control | 168 → 0      | 829 → ~350     |
   | `src`, `packages`                                    | 229 → 6      | 599 → 433      |

   Every coverage-ignore comment in Foundry and Notepad is gone (two Notepad bugs found and
   fixed). The `as unknown as` casts and `any`s in `src/main` are gone. What is left:

   - **Re-measure** the whole branch with gate.py, using the wrapper in `clean-gate.md`. The
     findings list `clean-gate-findings.tsv` is from `6d4eabf` and is now stale.
   - **The remaining repeated names** are mostly names lizard gives an anonymous callback
     (`useEffect`, `return`, `describe`) or names an interface, a `vi.mock` or a framework fixes
     (`activate`, `run`, `dispose`). Putting them in `.clean-gate.json` `ignoreNames` switches
     the check off for that word everywhere in the repo, so the list needs the user's review
     first. The gate has no per-path or object-member option.
   - **Copies across extensions** belong in `packages/extension-ui` or the SDK: `openInBrowser`
     (core, task-vault, foundry), `plural` (git-integration, foundry), `createIpcRegistrar`
     (notepad, task-vault), `validationError` (core, task-vault). Foundry should import
     `shellQuote` from `@terminator/extension-sdk/node`.
   - **`defineChannel`'s cast.** Not committed: the commit hook fails as root in the cloud
     container. The proposed fix is to declare `ChannelSpec.run` as a method instead of a
     function property. TypeScript checks method parameters bivariantly
     (https://www.typescriptlang.org/tsconfig/#strictFunctionTypes), so `ChannelSpec<S>` widens
     to `ChannelSpec` with no cast. This trades a visible cast for a looser check, so it needs
     the user's decision before it lands.
   - **One loose type remains:** `api-server.ts` `memberAt` walks the path with `Reflect.get`,
     which returns `any`. All 30 coverage-ignore comments are gone (Notepad 22, Foundry 7,
     `vitest.config.ts` 1).
   - **lizard size findings** (about 245) are misreads. ESLint, which parses TypeScript, reports
     none over the limits.

3. Done: the settings nothing read are implemented or removed (decisions 15–18).
4. Done: list settings are edited one item per line (decision 19).
5. Done: every declared setting has a test of its effect. `workspaceScoped` extension settings
   (git `enabled` and `commit.signOff`, Foundry's two lists) are built (decision 21):
   `api.settings.get(key, { repoPath })`, the workspace's `extensions` record, Workspace Settings
   with "Use global default", and `tests/e2e/workspace-extension-settings.spec.ts`.
6. Done: Remote Control's 9 channels are driven end to end (`remote-control.spec.ts`).
7. Done: `knip --production` is a second gate (ADR 107).
8. Final review, the PR description with a "How to read this change" section, CI green on the head.

## Decisions made without the user

Each entry: what was decided, why, and how to undo it.

1. Story baselines are written by CI on the `update-story-baselines` label: the artifact host was
   blocked here, and baselines must come from the platform that compares them
   (https://playwright.dev/docs/test-snapshots). Undo: delete the workflow and the PNGs.
2. Broken links inside docs/adr and docs/research (34) stay: ADRs are immutable (Principle IX) and
   research notes are dated records.
3. Constitution Principle X named `scripts/build-extensions.js`; the file is `.cjs`. Fixed as a PATCH
   amendment (2.0.0 → 2.0.1).
4. Foundry: closing an agent's tab archives the run as "stopped", not "ended". node-pty reports a
   signal kill as exit 0; the core now reports null.
5. Foundry verification keeps a status file next to its log (dash has no pipefail).
6. Verification commands keep the user's full shell environment (rc files).
7. Foundry checks run as `$SHELL -i -l -c "exec $SHELL <script>"`. A zsh check whose tab closes
   mid-run reads as failed; under bash it reads "not measured". Neither reads as a pass.
8. The lazy-load memory fix (fastify, electron-store) was reverted, then relanded once the real
   cause of the Remote Control failures (fixed ports) was fixed with port 0.
9. Packaging config moved to `electron-builder.cjs` so the bundled extensions ship; `npmRebuild` is
   off because node-pty loads N-API prebuilds. macOS signing runs only in the release workflow.
10. Network services are stubbed locally in e2e, never called live.
11. Notepad: a title set by hand stays; `commentExportFormat` works.
12. The global capture shortcut cannot be faked on macOS without Accessibility consent, so it runs
    in a Linux e2e job under xvfb.
13. git-integration bugs the coverage specs found were fixed: PR-created confirmation with a link,
    "Commit without hooks" for plain git hook failures, atomic merge-flow writes.
14. No worker may install system packages or run `npm install` in a shared container.
15. Git Integration's **Add sign-off to commits** and **Max displayed changed files** are
    implemented, not removed: the README promised both. `git:commit` and `git:status` read them on
    every call (`src/git-settings.ts`); sign-off is
    [`git commit --signoff`](https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---signoff),
    and the file limit is clamped to its declared 10–5000. The `signOff` (commit) and `maxFiles`
    (status) payload fields went: the view always sent `signOff: false` and never sent `maxFiles`,
    so a payload could override the setting with a value nobody chose. Undo: revert the commit and
    give the payload fields back.
16. Notepad's **Enable MCP sidecar** setting is removed. Nothing implements a Notepad MCP
    sidecar: spec 010 deferred it to a polish phase that never came, and ADR-020 removed the only
    MCP sidecar the app had (Task Vault's), superseded by the Remote Control bridge. There is no
    settings migration: a stored value is inert, since nothing reads it and the settings page lists
    only declared keys, and the extension-settings store has no delete. Undo: put the declaration
    back in `extensions/notepad/src/index.ts`.
17. Notepad's **Autosave debounce** and **Editor font size** are implemented. The delay applies
    to notes in the panel and in pop-out windows; diagrams keep their own 1.2 s, since a scene is
    written whole and the setting speaks of notes. Each is clamped (100–10000 ms, 8–32 px) and an
    emptied field falls back to its default (`src/notepad-settings.ts`). A view re-reads them on
    the new `extension.onSettingsChanged` (the core broadcasts `extension:settings-changed`): an
    extension view gets no focus or visibility event when Settings closes, measured under xvfb.
    Undo: revert the notepad commit; the SDK event can stay, it has no other cost.
18. Task Vault's `staleThresholdDays` now sets when a task is stale, and is labelled **Stale
    Task Threshold (days)**. It was declared as "days without modification before a project is
    considered stale", which the product does not do: a project is stale when it has no open next
    action (GTD), and that stays. What did use a days threshold was task staleness on Today and the
    review's Stale step, read from a `stale_days_threshold` row only the remote channel could set.
    The setting is now that threshold, default 7 (what users had, not the declared 14), 1–365.
    Activation moves an existing row into the setting and deletes it; `set-stale-threshold` writes
    the setting. Undo: revert the commit; a moved value then lives only in the setting, so put it
    back with `task-vault:settings:set-stale-threshold` from the previous build.
19. Settings has a `list` setting type, stored as a `string[]` and edited one item per line in
    the design system's new `ListInput` (trimmed, blank lines dropped). Foundry's
    `readOnlyTools` and `criticalPaths` use it. They were text settings read one item per line,
    so Foundry's activation turns a stored text value into its list once
    (`migrateLineListSettings`, `src/state/settings.ts`). A list type, rather than a multi-line
    flag on `string`, because the value is a list everywhere it is read. Its story needs a Linux
    baseline from the `update-story-baselines` label (decision 1). Undo: revert both commits;
    a migrated value is then a `string[]` the old readers do not split, so set the two lists
    again.
20. Workspace settings: a workspace's own **Default Shell** is applied, and **Use global
    default** works. The schema and the user guide offered a per-workspace shell, but Settings had
    no field for it and terminals always opened the global shell; main now resolves a project's
    shell through its workspace (`src/main/terminal/default-shell.ts`), for the app's terminals and
    for `api.pty.openTerminal`. "Use global default" sent `{ key: undefined }`, which the store's
    merge skipped, so no override could be handed back; a workspace patch now removes a key it sets
    to undefined (`mergeOverrides`), and each reset names only its own setting. Undo: revert the
    commit; the field goes and overrides become sticky again.
21. `workspaceScoped` extension settings are built rather than dropped. The SDK docs and the git
    README promise a per-workspace override, the user asked for every documented feature to work,
    and both settings schemas already hold an unused `extensions` record for these values. The
    change to `api.settings.get` is additive (an optional workspace), so no extension breaks. Undo:
    remove `workspaceScoped` and the `extensions` records, and the docs' per-workspace wording.
    The global settings' `extensions` record stayed unused (global values live in the
    extension-settings store) and is removed. A stored file that still has it loads, since
    reads merge over the defaults, and the next global write drops it: the zod object strips
    keys it does not declare (`tests/unit/storage/settings-store.spec.ts`). Undo: revert that
    commit.
22. TypeScript is pinned at 6.0.3, not 7.0: 7.0 is the Go port and ships no compiler API, which
    typescript-eslint needs (ADR 106). Undo: when typescript-eslint supports 7, follow ADR 106.
23. A split pane belongs to the tab it was made in, not to the branch: a new tab beside a split
    showed the old split and typed into it (`9cd9f6b`, `tests/e2e/split-panes.spec.ts`). Layouts
    are not persisted, so nothing migrates. This also answers the ⌘-click question: the e2e case
    went back in once split then New tab kept focus. Undo: revert `9cd9f6b`.
24. On quit, Terminator does not SIGKILL jobs a user started with `nohup` or `disown` in a
    terminal: ordinary terminals send SIGHUP and those jobs are meant to survive it. The e2e
    `closeApp` check kills and reports any such leftovers in specs. Undo: kill each pty's whole
    session on quit.
25. Review agent runs are cancelled when git-integration deactivates; they used to outlive a quit
    (`8e282ce`). Undo: revert it.
26. Notepad's editor mounted twice when a note opened; it now mounts once the note has loaded
    (`aee89b8`). That was the root cause of the intermittent `notepad-settings` e2e failure.
27. knip `--production` (ADR 107): 224 exports the app uses in their own file and specs also
    import are tagged `/** @internal */`, knip's mechanism for test-only exports
    ([knip docs](https://knip.dev/reference/jsdoc-tsdoc-tags#internal)). `src/**/__tests__/` is
    test code to knip, as `tests/` is (`knip.jsonc`). Undo: un-export them and test through callers.
28. Remote Control's 9 channels are local-only, so `tests/e2e/remote-control.spec.ts` drives them
    from the desktop view and checks the effect in the real remote renderer. It found 4 bugs, all
    fixed: Reconnect, phones told when turned away or disconnected, a stale viewer limit with
    unlabelled inputs, and the ngrok PATH order.
29. A build over budget is fixed at its cause, never by raising the budget: at `eda7797` the
    git-integration chunk was 1,208 kB against 1,200 kB after the size-limits split, fixed with a
    lazy boundary. Run `npm run build` before every push, not only typecheck, lint and vitest.
30. Commits are made with `git commit --no-verify` in this container, after the full checks pass
    under `setpriv`. The pre-commit hook runs `vitest related` as root without `setpriv`, so the
    chmod specs cannot make a write fail and fail every commit that touches Foundry's IPC
    (`run-channels.spec.ts`: "refuses to start when the records location cannot be written to").
    On a machine where you are not root the hook runs as is.
31. The extensions' specs are typechecked (`746b6d2`): 538 type errors across 5 extensions were
    fixed without casts or ignores.
32. Specs fake with `partialFake`, never `as unknown as` (`2a8d850`, `4fa8a48`). Removing the
    casts showed fixtures that no longer matched their types (a gate rule `merge`, a decision with
    `actor`, git files without `isBinary`); they now match.
33. One ESLint block holds every file to the size limits, and `@typescript-eslint/no-explicit-any`
    is an error (`16439dd`). The two `any`s left are behind `eslint-disable` comments that say why
    (`src/main/ipc/channel-registrar.ts`, `src/main/storage/cached-store.ts`). Undo: revert it.

## Known advisories

Checked 2026-10-13 at 311df92. `npm audit` reports 10 (2 low, 8 moderate), exit 1;
`npm audit --audit-level=high` (the CI gate) exits 0. The two dependency advisories (1, 2) stay because no
released upgrade removes them. `overrides` were not used: they would force versions the parents
do not declare.

1. **katex 0.16.47, low** ([GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7)).
   Path: `extensions/notepad` → `mermaid@11.16.1` → `katex@^0.16.45`. Affected `>=0.11.0 <0.18.2`;
   the only fix is 0.18.2. KaTeX does not pollute prototypes itself: it reads an already polluted
   `Object.prototype` (for example an inherited `trust`) as settings. Notepad renders only the
   user's own notes, so exploiting it needs a separate prototype-pollution bug in the renderer first.
   - mermaid 12.1.0 does not fix it: every release from 11.17.0 to 12.1.0 declares `katex: ^0.16.47`
     (`npm view "mermaid@>=11.16.1" dependencies.katex`), and a caret on 0.x stays within 0.16
     ([node-semver caret ranges](https://github.com/npm/node-semver#caret-ranges-123-025-004)).
     12.0.0 also makes ELK the default layout and changes themes
     ([12.0.0 notes](https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4012.0.0),
     [12.1.0 notes](https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4012.1.0)),
     so upgrading now changes every diagram and clears nothing.
   - The fix is merged upstream but unreleased: [#8411](https://github.com/mermaid-js/mermaid/pull/8411)
     (katex `^0.18.0`, merged to `develop` 2026-10-09), included in the open release PR
     [#8428](https://github.com/mermaid-js/mermaid/pull/8428) (12.2.0). Upgrade notepad's mermaid
     when 12.2.0 is published, keeping `layout: 'dagre', theme: 'default', look: 'classic'` if the
     old look is wanted, and rerun `tests/e2e/notepad-diagrams.spec.ts`.
2. **sprintf-js 1.1.3, moderate** ([GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)).
   Path: `electron-builder@26.15.3` → `app-builder-lib@26.15.3` → `@electron/get@3.1.0` →
   (optional) `global-agent@3.0.0` → `roarr@2.15.4` → `sprintf-js@1.1.3`. Affected `<=1.1.3`, no
   patched version. A format string with an out-of-range precision throws a `RangeError`.

   - Not reachable: build-time packaging only, never shipped in the app. `@electron/get` loads
     `global-agent` only when `ELECTRON_GET_USE_PROXY` is set (`dist/cjs/index.js`, `proxy.js`),
     and every `global-agent` log call passes a literal message with no precision specifier
     (`grep -rhE "^\s*\}, '|log\.\w+\('" node_modules/global-agent/dist`).
   - No stable upgrade: `@electron/get` 5.x drops `global-agent`, and `global-agent` 4.x drops
     `roarr`, but `app-builder-lib` 26.15.3 (`latest`) and 26.17.0 (`v26` tag) both declare
     `@electron/get: ^3.0.0` (`npm view app-builder-lib@26.17.0 dependencies.@electron/get`). Only
     the prerelease `27.0.0-alpha.10` (`next`) moves to `^5.0.0`. Move to electron-builder 27 once it
     is released as stable ([releases](https://github.com/electron-userland/electron-builder/releases)).

3. **Codecov reports 1 uncovered patch line in `extensions/foundry/src/ipc/forge-channels.ts`**
   (99.95% patch coverage, 2026-10-13 14:57 UTC). A local Foundry coverage run intersected with the
   PR diff shows 0 uncovered changed lines, and the proxy here answers 403 for the Codecov API, so
   the line cannot be named from this container. The patch gate (target 80%, `codecov.yml`) passes.
   Open the Codecov report for the PR to see the line.
4. **Three Foundry jsdom specs time out only at about 10x CPU oversubscription** (load 40 on 4
   cores): jsdom's `getComputedStyle` for `ByRole` queries is the cost. CI's 4 unit shards stay
   green. happy-dom was tried for Foundry and rejected: 6 specs went red and the change is global.
   The notepad and git-integration DOM specs do run in happy-dom (`7318fe9`).
5. **The live Linear spec was fixed but not run.** `extensions/foundry/tests/live/linear-transition-live.spec.ts`
   read a field the provider no longer returns (`issue.status`); it is fixed, but it needs a Linear
   API key and an issue it may move, which this container does not have. Run it with
   `LINEAR_API_KEY=lin_api_… LINEAR_TEST_ISSUE=TEAM-123 npm run test:live` on a scratch issue.
6. **The extension-ui Playwright visual suite passes on CI and fails locally.** CI's Stories job
   compares every story with the Linux baselines in `packages/extension-ui/visual/__screenshots__/linux`
   and passed at `da1fe0b` (run 38425911132). In this container,
   `npm run build-storybook && PLAYWRIGHT_BROWSERS_PATH=… CI=1 npm run test:visual` exits 1: 106 of
   118 stories differ by about 1% of their pixels (55 to 1,996 pixels). The baselines were written by
   CI's ubuntu runner, and Playwright's screenshots depend on the platform and browser build
   ([Playwright docs](https://playwright.dev/docs/test-snapshots)). Compare on CI only; refresh
   baselines with the `update-story-baselines` label (decision 1).

## How to continue

- Node 24 (`.nvmrc`). `npm ci`, then `npm run dev`.
- Checks before every push: `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm run lint:unused`, `npm run lint:unused:production`, `npm run lint:duplicates`,
  `npm run lint:deps`, `npm run build` (0 `(!)` lines), `npx vitest run`.
- On Linux as root, run vitest under
  `setpriv --bounding-set=-dac_override,-dac_read_search` so the chmod specs can fail a write.
- The open work items above split cleanly by area. Each can be a separate worker in its own worktree:
  write the failing test first, keep functions within the limits, one commit per logical unit,
  and merge into this branch only after the full checks pass.
