# Paved-path cleanup

Source: the Phase 1 audit (https://claude.ai/artifact/PRzpXjK9DWD9NEjiYc538n) and the interview of 2026-10-27.
Foundry is out of scope (a separate session audits it), except the Jira patch in D4.

## Problem

Terminator has custom code where a documented paved path exists, duplicate implementations of the same idea, features nobody uses, and tests that cannot fail when our behaviour breaks.

The audit measured less waste than expected:

- About 5% of production code outside Foundry can be replaced or deleted (about 7,000 of 128,126 lines).
- 88% of the 241 sampled tests earn their place.

The parts the original ask did not cover:

- **The coverage gate.** The constitution (VI, XIV) says Vitest gates coverage and outside services never gate. ADR 095 made Codecov's changed-line check the gate, because the old whole-file Vitest gate produced the padding tests the owner wants gone. The code follows ADR 095, and the constitution was not updated.
- **Defects found on the way:**
  - The PR diff parser drops content lines that start with `---` or `+++`.
  - `ci:local` fails on a commit with no diff.
  - The remote-control WebSocket has no heartbeat.
  - "Connected devices" omits `/app` sessions.
  - The "Run as" choice cannot be used with a keyboard.
  - The notepad README claims FTS5 search, but search filters in JavaScript.
  - 70 workflow refs are pinned by tag, not by SHA.
- **Stored data and dependents of removed features.** Removed features leave data in `app.sqlite`. The Jira provider is read by Foundry and declared in the SDK.

## Decisions from the interview

| Topic                       | Decision                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Coverage gate               | Keep Codecov `codecov/patch` (80% of changed lines) as the gate. Amend the constitution to allow it.                         |
| Jira                        | Delete the provider. Patch Foundry's intake to Linear only.                                                                  |
| Other users                 | Only the owner. No deprecation period, no SDK no-op version.                                                                 |
| PR split                    | One PR with all changes, one commit per unit.                                                                                |
| Merge-flow                  | Keep. It is a requirement.                                                                                                   |
| Task-vault                  | Keep areas + archive and the database console with full access. Delete weekly review and kanban, and drop their data.        |
| Contributions calendar      | Keep.                                                                                                                        |
| Metrics bar                 | Keep. The owner has it on (`showMetricsBar: true` in `~/Library/Application Support/@andytavares/terminator/settings.json`). |
| Remote control              | Keep `/mobile` (used on the phone) and `/app`. Fix the heartbeat and "Connected devices".                                    |
| Context menus               | Keep the DOM menus. Add `role="menu"` and arrow keys.                                                                        |
| Date picker                 | Keep the custom `DateTimePicker`.                                                                                            |
| Claude Code hooks           | Keep. The owner types `claude` by hand in terminal tabs. Merge the three hook scripts into one. Keep the cost table.         |
| Spikes                      | Run each one inside the PR. A replacement lands only if its trial passes. If it fails, drop it and list it in the PR.        |
| `@codemirror/language-data` | Add it. Remove the 10 static language packs.                                                                                 |

## Goals

1. Fix the seven defects above.
2. Delete code with no user: the units in D and E.
3. Merge duplicates into the one implementation that already exists (unit I).
4. Replace custom code with a paved path where a trial proves it (unit K).
5. Delete tests that test Zod, React, or a mock's own return value (unit H).
6. Make the constitution match the gate that runs.

## Non-goals and deferrals

| Item                                                             | Reason                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Foundry, except the Jira patch                                   | A separate session owns it.                                                                 |
| Merge-flow, contributions calendar, metrics bar, areas + archive | The owner uses them.                                                                        |
| Database console isolation                                       | The owner keeps full access. This breaks Constitution II, so ADR 131 records the exception. |
| `/mobile` removal                                                | The owner uses it on the phone.                                                             |
| Native context menus                                             | They conflict with Constitution XIII. Fix the DOM menus instead.                            |
| Native date inputs                                               | The owner rejected the Chromium picker.                                                     |
| Removing the global hooks and the cost table                     | Hand-typed `claude` sessions need them.                                                     |
| Moving core JSON stores to electron-store                        | The file-format migration risk is not worth about 100 lines.                                |
| Linear `listMine` request count                                  | A speed fix, not a paved-path change.                                                       |
| `@codemirror/merge` for diffs                                    | The PR pane needs comments, agent notes and gutter selection.                               |
| Contributions via GraphQL `contributionsCollection`              | It is unverified that the semantics match ADR 108.                                          |

## Units, files and interfaces

All units ship in one draft PR on branch `073-paved-path-cleanup`, one commit per unit, in this order.

### A. Governance

- `.specify/memory/constitution.md`: version 4.0.0 → 5.0.0 (MAJOR, because VI and XIV are redefined).
  - VI: the gate is Codecov `codecov/patch`, at 80% of the changed lines.
  - XIV: `codecov/patch` is the one outside service allowed to gate, and `ci:local` reports it as not run.
  - XIV: the seed is Vitest's own (`--sequence.seed`), not `TEST_SEED`.
- `docs/adr/131-paved-path-cleanup.md`: records the amendment, the database-console exception to II, and the Jira removal.
- `CLAUDE.md` files that mention `TEST_SEED` or the Vitest gate: update them.

### B. CI

- `.github/workflows/*.yml`: pin each of the 70 `uses:` refs to a full SHA, with the tag in a comment.
- `.github/dependabot.yml`: add the `github-actions` ecosystem.
- `scripts/ci-local.mjs`: with no diff, run the full unit suite instead of zero specs, so the "Merge reports and write coverage" step finds reports.

### C. Diff parser bug

- `extensions/git-integration/src/github/pr-review-service.ts:1230` (`draftLine`) and `:1265` (`parsePrFileDiff`): replace them with `src/git/git-parser.ts` `parseDiff`.
- Write the failing spec first, in `extensions/git-integration/tests/unit/pr-review-service.spec.ts`.

### D. Core deletions

1. Remove the leftover PGlite migration:
   - `src/main/db/legacy-pglite-import.ts` and its calls at `src/main/index.ts:71,511,528`
   - `electron-builder.cjs:48-49`
   - `@electric-sql/pglite` in `package.json` and the lock file
   - All 5 published releases are v0.1.166 or later, after the v0.1.145 import shipped.
2. Remove the SpecKit-Pilot credential migration at `src/main/integrations/tracker-store.ts:187-249` and `src/main/index.ts:20,407`.
3. Remove inter-extension dependencies:
   - `src/main/extensions/extension-host.ts:91-121,333-340`
   - `host/host-runtime.ts:98,112-119`
   - `host-api.ts:339`
   - `extension.schema.ts:114`
   - SDK `types/extensions.d.ts` and `api.d.ts:541-548` (`api.extensions.get`, `TaskVaultAPI`)
4. Remove Jira:
   - `src/main/integrations/providers/jira.provider.ts`, `src/main/integrations/adf-to-markdown.ts`
   - The Jira branch of `src/shared/schemas/integrations.schema.ts:7,30`
   - SDK `types/issues.d.ts:6`, which becomes `TrackerId = 'linear'`
   - The settings UI for Jira credentials
   - `tests/e2e/jira-stub.ts`, `tests/e2e/tracker-stub-jira.ts`, `tests/fixtures/integrations/jira/`, and the Jira specs
   - In Foundry, `'jira'` leaves `extensions/foundry/src/forge/intake-source.ts:46,64`, `src/ipc/forge-channels.ts:60,174` and `src/ipc/ui-registration.ts:102,110`. Tell the Foundry session before the push.
   - Keep the Jira URL recognition in `pr-review-service.ts:995-999`. It reads links in PR text and does not use the provider.
5. Remove `api.terminal.onSessionCreate` and `onSessionClose`: `src/main/extensions/api.ts:782-790`, `host-api.ts:324-325`, `api-server.ts:49-50`, `api.d.ts:632-633`.
6. Bump `packages/extension-sdk` to 6.0.0.

### E. Extension deletions

- Task-vault weekly review:
  - `WeeklyReview*.tsx` (8 files), `ipc/weekly-review.ipc.ts`, `vault/weekly-review-repository.ts`, `utils/review-log.ts` and their specs.
  - Remove `WEEKLY_REVIEWS_SCHEMA` and `WEEKLY_REVIEW_ACTIONS_SCHEMA` from `extensions/task-vault/src/vault/db.ts`.
  - A migration runs `DROP TABLE IF EXISTS weekly_review_actions; DROP TABLE IF EXISTS weekly_reviews;`.
- Task-vault kanban:
  - `KanbanBoard.tsx`, `KanbanLaneEditor.tsx`, `ipc/kanban.ipc.ts`, `KanbanLane`/`KanbanConfig` in `vault/types.ts`, and their specs.
  - A migration deletes the `settings` row `('task-vault', 'kanban_config')`.
- The remote-control "Copy Caddyfile" command: `server/ngrok-manager.ts:18-38`, `index.ts:330`.
- The legacy recurrence fallback at `task-vault/src/vault/recurrence.ts:89-133`. A one-time migration first moves the `metadata` end conditions into the columns.

### F. Dead CSS

Delete the classes no source file uses:

- 69 in `task-vault.css`
- 27 in `notepad.css`
- 2 in `remote-control-view.css`
- about 85 lines in core: the `.home__*`, `.ledger__*` and `.logbook__*` rules, `.skeleton--*`, `.unified-sidebar__bulk-*`, `.alert-badge--corner`

Screenshot each surface before and after, in both themes.

### G. Scripts

- Delete `scripts/{forge,harness,detect-stack,generate-test-prs,cleanup-test-prs}.sh`, `run-tests.cjs`, `feature-coverage.mjs`, its spec, and `docs/research/feature-coverage.md`.
- `scripts/e2e-select.mjs:131-155`: use `path.matchesGlob`.
- Delete `tests/support/test-seed.ts` and `announceTestOrder`. Use Vitest's seed. In `scripts/stability.mjs`, pass `--sequence.seed`.

### H. Tests

Delete:

- `tests/unit/schemas/*`, except the specs that pin persisted defaults
- `git-integration/tests/unit/pr-review.schema.spec.ts` and `merge-flow.schema.spec.ts`
- `notepad/tests/components/NoteEditor.spec.tsx`
- `git-integration/tests/unit/syntax.spec.ts` (it goes with I1)
- every `*/tests/**/renderer/main.spec.tsx`
- `tests/integration/ipc/git-extension.ipc.spec.ts`
- `src/main/remote/__tests__/ipc-registry.spec.ts` and `remote-accessible-channels.spec.ts`
- the setter-call tests in `usePrReview.spec.tsx`
- `TerminalSession.spec.tsx:813-817,840-848`

Rewrite:

- `task-vault/tests/notifications/task-scheduler.spec.ts` on `createVaultDb`
- `github-ipc.spec.ts`: the per-enum describes become `it.each`

### I. Merge duplicates and fixes

1. Highlighting: one `highlight(code, ext)` on `hljs.getLanguage`, replacing `FileDiffView.tsx:19-72` and `utils/syntax.ts:12-81`.
2. Check names: one check-name list (`pr-review-service.ts:792-793` and `:1099-1117`).
3. PR file diffs: reuse the patches from the PR detail fetch (`src/ipc/github/pr-files.ts:44-52`).
4. Worktrees: the core parser through the SDK `listWorktrees` with `detached`/`prunable`, replacing `git/local-inventory.ts:42-58`.
5. Complexity: the diff pane reads the tree-sitter `insights.ts` result, replacing `pr-review-service.ts:97-145`.
6. Context menu: remove the `TabCtxMenu` (:466) and `SessionTabCtxMenu` (:523) copies in `src/renderer/components/terminal/TabBar.tsx`. Use `ContextMenu.tsx`.
7. Radio groups and tabs: `SegmentedControl`/`Tabs` in `RunAsChoices.tsx`, `OverviewScreen.tsx:214-231`, `StartWork.tsx:233-250` and `BreakoutWindowView.tsx:27-44`. This fixes the keyboard defect.
8. Stored JSON: `readStoredJson`/`writeStoredJson` in the 6 private `localStorage` helpers.
9. Dates: one `localDate`, plus `Intl.DateTimeFormat` for month and weekday names in task-vault.
10. Shortcuts: delete the renderer ⌘, and ⌘W branches in `useKeyboardShortcuts.ts:73-76,170-174`.
11. Hooks: merge `agent-ask-hook`, `agent-session-hook` and `integrations/session-hook` into one hook script with one installer.
12. Remote control:
    - Add the ws heartbeat (ping, then `terminate` on no pong) in `remote-control/src/server`.
    - List `/app` bridge sessions in "Connected devices" (`connected-devices.ts`).
13. Notepad README: correct `extensions/notepad/README.md:15` if K4 fails.

### K. Trials (each one lands only if its trial passes)

1. **Menus.** Use `popover="auto"` and CSS anchor positioning in `packages/extension-ui` (`Popover`, one `Menu`), with `role="menu"` and arrow keys. Then move the core and the 7 extension callers off `useDismissible`, `use-menu-placement` and `close-context-menus`.
2. **Modal state.** Replace the modal counters with a `dialog:modal, :popover-open` query: `modal-depth.ts`, `modal.store.ts`, `useModalEffect`, and SDK `ui.setModalDepth` (removed in 6.0.0).
3. **Terminal links.** Replace the link overlay with xterm `ILink.activate`/`decorations` (`xterm.d.ts:1407,1423`). This deletes `src/renderer/terminal/link-pointer.ts`.
4. **Notepad search.** Use SQLite FTS5 `MATCH`/`snippet()`/`bm25()` in `notepad/src/ipc/search.ipc.ts`, with sync triggers, inside Electron 44.
5. **Markdown tables.** Use the `@lezer/markdown` GFM table nodes in `notepad/src/editor/markdownTable.ts:35-220`.
6. **Language loading.** Use `@codemirror/language-data` in `notepad/src/editor/NoteEditor.tsx:8-58`.
7. **Release age.** Add `min-release-age=14` to `.npmrc`. Delete `scripts/check-release-age.mjs` only if `npm ci` applies the setting.
8. **Test selection.** Use `vitest --changed` with `forceRerunTriggers` in `scripts/test-select.mjs`, while keeping the rule "an unplaceable path runs everything".
9. **Local CI.** Use `act` in place of `scripts/ci-plan.mjs`/`ci-linux.mjs`, only if it runs `ci.yml` as it is.

## Acceptance criteria

Each item is true or false. The check that proves it is in brackets.

- [ ] The constitution is version 5.0.0. VI names `codecov/patch` as the gate. XIV allows that one outside gate and names `--sequence.seed`. [`rg -n "5.0.0|codecov/patch|sequence.seed" .specify/memory/constitution.md`]
- [ ] `docs/adr/131-paved-path-cleanup.md` exists and records the gate amendment, the database-console exception and the Jira removal. [read the file]
- [ ] No workflow `uses:` ref is pinned by tag. [`rg -n "uses: [^ ]+@v[0-9]" .github/workflows` → no output]
- [ ] `npm run ci:local` exits 0 on a commit with no diff against `origin/main`. [run it on a clean branch]
- [ ] A PR patch with a removed line `--- x` and an added line `+++i;` parses to 1 remove, 1 add and the correct line numbers. [the new spec in `pr-review-service.spec.ts` fails before C and passes after]
- [ ] `@electric-sql/pglite`, `legacy-pglite`, `jira` (outside PR-link recognition), `extensionDependencies`, `onSessionCreate`, `weekly_review`, `kanban`, `Caddyfile` and `TEST_SEED` appear in no source file. [`rg -il "<term>" src extensions packages scripts tests` for each term]
- [ ] An existing `app.sqlite` that holds weekly-review tables and a `kanban_config` row starts with both gone, and its areas, archive and tasks unchanged. [a migration spec on `createVaultDb`, seeded with all four]
- [ ] Every surface touched by F, I or K looks the same as before in light and dark. [story screenshots plus screenshots of the running app before and after]
- [ ] Every menu opens with the keyboard, moves with the arrow keys, and closes with Escape. [an e2e spec that addresses the menu by role]
- [ ] "Run as" can be chosen with the keyboard alone. [an e2e spec using arrow keys]
- [ ] A phone that drops off the network frees its viewer slot within two heartbeat intervals. [a spec that stops answering pings]
- [ ] A browser on `/app` shows in "Connected devices". [a spec on `connected-devices`]
- [ ] Foundry intake accepts only `linear`, and Foundry's specs pass. [`npx vitest run extensions/foundry` exits 0]
- [ ] Each K trial is either in the diff with its evidence in the PR, or listed under "not done" with the reason. [the PR body]
- [ ] Production and test lines go down from 177,412 and 203,899. [`python3 loc.py` before and after, both in the PR]
- [ ] `npx knip`, `npx knip --production` and `npx jscpd` still report 0. [their output in the PR]
- [ ] The docs for each removed feature are gone or updated in the same PR (Constitution VIII). [`rg -il "weekly review|kanban|jira|caddy" docs README.md extensions/*/README.md`]

## Open decisions

None. Every item on the map is decided or deferred with a reason above.

## End-to-end verification

1. Run `npm run ci:local -- --all` and confirm exit 0. Put the output in the PR's Checks section.
2. Run `npm run ci:local:e2e` and confirm exit 0.
3. Run `npm run package`, start the packaged app with the owner's own profile, and check by hand:
   - The metrics bar shows.
   - A merge conflict opens merge-flow.
   - Task-vault areas, archive and the database console work, and weekly review and kanban are gone.
   - Notepad search finds a word in a note.
   - Every menu works from the keyboard.
   - ⌘-click opens a link in the terminal.
   - Typing `claude` in a terminal tab still raises asks on Home.
   - The phone connects to `/mobile` and shows in "Connected devices", and drops out after you turn off Wi-Fi.
4. Push only after the PR is confirmed open (`gh pr view --json state`).
