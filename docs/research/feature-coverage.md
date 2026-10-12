# Feature coverage of the e2e suite

What the Playwright suite (`tests/e2e/*.spec.ts`) drives in the real app, measured rather than read off the specs. Every spec ran with an IPC trace (`tests/e2e/ipc-trace.ts`) that records each channel a renderer invoked or sent and each event main pushed. That trace is joined with what the running app offers once every bundled extension is active (`tests/e2e/tools/feature-inventory.spec.ts`): every IPC channel main handles, every extension command, every extension setting.

**Driven is not asserted.** A feature counts as driven when some spec caused its IPC. A spec that opens a view drives every channel the view loads with, whether or not it checks the result. The lists below say where a feature is never even reached. They do not say which reached features are tested well.

## Run

2026-10-12, Linux (xvfb), Node 24.21.0, Electron 44.7.0, at commit 9f30e5c, `--workers=4`.

- 188 passed, 6 failed, 18 did not run (212 tests in 41 spec files).
- Three specs could not start here: `remote-app.spec.ts`, `git-integration-contrast.spec.ts` and `git-integration-stacking.spec.ts` need Playwright's own Chromium, and this container's egress policy blocks `cdn.playwright.dev`. 17 of the 18 tests that did not run are in these files. CI installs Chromium for them. Their IPC is missing from the counts below, which undercounts Git Integration's review views most.
- Three fail on Linux and at the base commit f33208a alike, so they are not caused by this branch: `extension.spec.ts:52` and `quick-actions.spec.ts:225` press ⌘ shortcuts (`Meta+,`, `Meta+P`) that the app binds to Ctrl on Linux, and `sidebar-sorting.spec.ts:69` drags under xvfb. CI runs e2e on macOS. Their traces up to the failure are counted.

Task Vault and Notepad were measured again on 2026-10-12 at commit 85e9d06, Linux (xvfb), `--workers=1`, over their 13 specs only, three runs in a row, 77 passed each time:

```bash
E2E_IPC_TRACE=/tmp/trace npx playwright test tests/e2e/task-vault-*.spec.ts tests/e2e/notepad-*.spec.ts --workers=1
FEATURE_INVENTORY=/tmp/inventory.json E2E_TOOLS=1 npx playwright test tests/e2e/tools/feature-inventory.spec.ts
node scripts/feature-coverage.mjs /tmp/inventory.json /tmp/trace
```

Their two sections below merge that run with the specs the full run had already credited. `notepad:notes.openWindow` is driven by `notepad-outline.spec.ts`, which that run left out. The other sections are still the full run's.

## Findings

- **Extension settings: 0 of 149 driven.** No spec writes an extension setting through `extension:update-setting`. `extension.spec.ts` opens Settings → Extensions and toggles extensions, but writes no setting.
- **Integrations (issue trackers) are barely reached.** Of the 16 `integrations:*` channels only `integrations:status`, `integrations:issue-get` and `integrations:link-get` are reached, by views loading. Connect, search, link and comment never run.
- **Git Integration: 6 of 56 extension channels.** Staging, commit, push, conflict resolution, PR creation and the review agent (`git:stage`, `git:commit`, `git:push`, `git:resolve-conflict`, `github:pr-create`, `review-agent:start`, ...) are never reached. Some of the PR review channels may be reached by the two Chromium specs that could not run here.
- **Task Vault: 68 of 68, Notepad: 43 of 43** (re-measured on 2026-10-12 over the 13 `task-vault-*` and `notepad-*` specs, see below; they were 11 of 69 and 8 of 43). Driving them found nine bugs, each fixed with a failing test first: the GTD clarify flow skipped every other inbox item, a kanban lane's dot colour was never saved, a write in the SQL console did not refresh the vault, dragging a note to reorder never saved, search ignored case only for ASCII, Ctrl+Shift+F did nothing on Linux and Windows, typing near a comment orphaned it, renaming a diagram left the list stale, and the export's comment formats wrote no comments.
- **Foundry: 60 of 60** is real but shallow: `foundry-channels.spec.ts` invokes every Foundry channel on purpose, so a full count says the channels answer, not that Foundry's flows are exercised.
- **Core IPC: 61 of 113.** Never reached: `git:fetch`, `git:checkout`, `git:create-branch`, `git:remove-worktree`; `shell:exec`, `shell:open-path`, `shell:open-external`; all four `fs:*` channels; `extension:install`, `extension:uninstall`, `extension:reload`; every `menu:*` event; `notifications:dismiss` and `notifications:trigger-action`; `project:rename`, `project:delete`, the two `reorder` channels.
- **Commands: 3 of 8.** Foundry's two commands and Git Integration's commit, pull and create-PR are never run.
- **Core Quick Actions: 7 of 28.** Never run through the panel or a shortcut: split down, close tab, clear, previous tab, both recent-tab cycles, both workspace cycles, open home, overview, next waiting, resume, the log, and the five issue actions.

## Regenerate

```bash
npm run build
E2E_IPC_TRACE=/tmp/trace npx playwright test
FEATURE_INVENTORY=/tmp/inventory.json E2E_TOOLS=1 npx playwright test tests/e2e/tools/feature-inventory.spec.ts
node scripts/feature-coverage.mjs /tmp/inventory.json /tmp/trace
```

The last command prints everything from here down.

## Coverage

| Area                            | Driven | Total | Share |
| ------------------------------- | ------ | ----- | ----- |
| Core IPC (window.electronAPI)   | 61     | 113   | 54%   |
| terminator.foundry IPC          | 60     | 60    | 100%  |
| terminator.git-integration IPC  | 6      | 56    | 11%   |
| terminator.notepad IPC          | 43     | 43    | 100%  |
| terminator.remote-control IPC   | 4      | 9     | 44%   |
| terminator.task-vault IPC       | 68     | 68    | 100%  |
| Commands (Quick Actions, menus) | 3      | 8     | 38%   |
| Core Quick Actions              | 7      | 28    | 25%   |
| Extension settings              | 0      | 149   | 0%    |

### Core IPC: 61 of 113 driven

Not driven by any spec:

- `terminal:list-sessions` — terminal.listSessions (invoke)
- `terminal:close-all` — terminal.closeAll (invoke)
- `workspace:reorder` — workspace.reorder (invoke)
- `workspace:get-active` — workspace.getActive (invoke)
- `project:delete` — project.delete (invoke)
- `project:rename` — project.rename (invoke)
- `project:reorder` — project.reorder (invoke)
- `git:fetch` — git.fetch (invoke)
- `git:checkout` — git.checkout (invoke)
- `git:create-branch` — git.createBranch (invoke)
- `git:remove-worktree` — git.removeWorktree (invoke)
- `dialog:open-directory` — dialog.openDirectory (invoke)
- `extension:install` — extension.install (invoke)
- `extension:uninstall` — extension.uninstall (invoke)
- `extension:reload` — extension.reload (invoke)
- `extension:update-setting` — extension.updateSetting (invoke)
- `extension:run-command` — extension.runCommand (invoke)
- `extension:set-bottom-inset` — extension.setBottomInset (send)
- `extension:set-left-inset` — extension.setLeftInset (send)
- `shell:exec` — shell.exec (invoke)
- `shell:open-path` — shell.openPath (invoke)
- `shell:open-external` — shell.openExternal (invoke)
- `fs:watch-start` — fs.watchStart (invoke)
- `fs:watch-stop` — fs.watchStop (invoke)
- `fs:changed` — fs.onChanged (event)
- `fs:read-file` — fs.readFile (invoke)
- `extension:toggle-panel` — extensionEvents.onTogglePanel (event)
- `extension:select-project-tab` — extensionEvents.onSelectProjectTab (event)
- `menu:open-settings` — extensionEvents.onMenuOpenSettings (event)
- `menu:open-home` — extensionEvents.onMenuOpenHome (event)
- `menu:toggle-sidebar` — extensionEvents.onMenuToggleSidebar (event)
- `menu:close-tab` — extensionEvents.onMenuCloseTab (event)
- `menu:open-about` — extensionEvents.onMenuOpenAbout (event)
- `extension:renderer-reload` — extensionEvents.onExtensionRendererReload (event)
- `quick-actions:open` — quickActions.onOpen (event)
- `notifications:dismiss` — notifications.dismiss (invoke)
- `notifications:trigger-action` — notifications.triggerAction (invoke)
- `db:health` — db.health (invoke)
- `log:write` — logger.write (send)
- `integrations:connect` — integrations.connect (invoke)
- `integrations:disconnect` — integrations.disconnect (invoke)
- `integrations:set-mine` — integrations.setMine (invoke)
- `integrations:issue-list-mine` — integrations.listMine (invoke)
- `integrations:issue-search` — integrations.search (invoke)
- `integrations:issue-comment` — integrations.comment (invoke)
- `integrations:link-set` — integrations.linkSet (invoke)
- `integrations:link-clear` — integrations.linkClear (invoke)
- `integrations:context-preview` — integrations.contextPreview (invoke)
- `integrations:set-inject-context` — integrations.setInjectContext (invoke)
- `integrations:status-changed` — integrations.onStatusChanged (event)
- `integrations:link-changed` — integrations.onLinkChanged (event)
- `integrations:context-injected` — integrations.onContextInjected (event)

<details><summary>Driven, and by which specs</summary>

- `terminal:create` — terminal.create (invoke): close-session.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `terminal:close` — terminal.close (invoke): close-session.spec.ts, session-home.spec.ts, split-panes.spec.ts, terminal.spec.ts
- `terminal:attach` — terminal.attach (invoke): close-session.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `terminal:input` — terminal.input (send): monitor-wall.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-surfaces.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts
- `terminal:resize` — terminal.resize (send): close-session.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `terminal:acknowledge` — terminal.acknowledge (send): close-session.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `terminal:output` — terminal.onOutput (event): close-session.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `terminal:cleanup-orphans` — terminal.cleanupOrphans (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `terminal:process-exit` — terminal.onProcessExit (event): close-session.spec.ts, foundry-intake.spec.ts, resume-session.spec.ts, session-home.spec.ts, split-panes.spec.ts, terminal.spec.ts
- `workspace:list` — workspace.list (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `workspace:create` — workspace.create (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `workspace:update` — workspace.update (invoke): workspace.spec.ts
- `workspace:delete` — workspace.delete (invoke): workspace.spec.ts
- `project:list` — project.list (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `project:create` — project.create (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `project:update-branch` — project.updateBranch (invoke): branch-name.spec.ts
- `workspace:project-added` — project.onAdded (event): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `workspace:project-removed` — project.onRemoved (event): foundry-intake.spec.ts
- `git:is-repo` — git.isRepo (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `git:current-branch` — git.currentBranch (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `git:change-stats` — git.changeStats (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `git:list-branches` — git.listBranches (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts
- `git:suggest-worktree-path` — git.suggestWorktreePath (invoke): branch-name.spec.ts
- `git:create-worktree` — git.createWorktree (invoke): branch-name.spec.ts
- `git:list-worktrees` — git.listWorktrees (invoke): branch-name.spec.ts
- `settings:get-global` — settings.getGlobal (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `settings:update-global` — settings.updateGlobal (invoke): branch-exclude-patterns.spec.ts, close-session.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `settings:get-workspace` — settings.getWorkspace (invoke): close-session.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `settings:update-workspace` — settings.updateWorkspace (invoke): settings.spec.ts
- `extension:list` — extension.list (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `extension:toggle` — extension.toggle (invoke): extension.spec.ts
- `extension:get-settings-schemas` — extension.getSettingsSchemas (invoke): extension.spec.ts, git-sidebar.spec.ts, settings.spec.ts
- `extension:get-settings-values` — extension.getSettingsValues (invoke): extension-keyboard.spec.ts, extension.spec.ts, git-sidebar.spec.ts, quick-actions.spec.ts, settings.spec.ts
- `extension:commands-changed` — extension.onCommandsChanged (event): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `extension:list-changed` — extension.onListChanged (event): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `extension:get-commands` — extension.getCommands (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `extension:execute-command` — extension.executeCommand (send): quick-actions.spec.ts
- `extension:has-command` — extension.hasCommand (invoke): foundry-floor.spec.ts
- `extension:update-panel-bounds` — extension.updatePanelBounds (invoke): dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, notepad-outline.spec.ts, quick-actions.spec.ts
- `extension:set-theme` — extension.setTheme (send): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `editor:detect` — editor.detect (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `editor:open` — editor.open (invoke): open-in-editor.spec.ts
- `menu:set-panel-checked` — extensionEvents.notifyPanelState (send): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `extension:panel-loaded` — extensionEvents.onExtensionPanelLoaded (event): dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, notepad-outline.spec.ts, quick-actions.spec.ts
- `extension:exit-to-terminal` — extensionEvents.onExtensionExitToTerminal (event): extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts
- `app:get-info` — app.getInfo (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `notifications:create` — notifications.create (invoke): terminal-missing-folder.spec.ts
- `notifications:list` — notifications.list (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `notifications:push` — notifications.onPush (event): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `metrics:system` — metrics.getSystem (invoke): dismiss-surface-on-click.spec.ts, monitor-wall.spec.ts, session-surfaces.spec.ts
- `metrics:processes` — metrics.getProcesses (invoke): monitor-wall.spec.ts, session-surfaces.spec.ts
- `metrics:pids` — metrics.getPids (invoke): monitor-wall.spec.ts, session-surfaces.spec.ts
- `session-records:list` — sessionRecords.list (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `session-records:set-description` — sessionRecords.setDescription (invoke): close-session.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts
- `session-records:set-link` — sessionRecords.setLink (invoke): session-surfaces.spec.ts
- `session-records:transfer` — sessionRecords.transfer (invoke): resume-session.spec.ts
- `session-records:forget` — sessionRecords.forget (invoke): close-session.spec.ts
- `session-records:changed` — sessionRecords.onChanged (event): close-session.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts
- `integrations:status` — integrations.status (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-outline.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `integrations:issue-get` — integrations.getIssue (invoke): session-surfaces.spec.ts
- `integrations:link-get` — integrations.linkGet (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts

</details>

### terminator.foundry IPC: 60 of 60 driven

<details><summary>Driven, and by which specs</summary>

- `foundry:ask-model`: foundry-channels.spec.ts
- `foundry:ask-model-set`: foundry-channels.spec.ts
- `foundry:attention`: extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
- `foundry:factory.metrics`: foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts
- `foundry:feed-dismiss`: foundry-channels.spec.ts
- `foundry:feed-list`: foundry-channels.spec.ts, foundry-floor.spec.ts, foundry-resume.spec.ts
- `foundry:feed-mute`: foundry-channels.spec.ts
- `foundry:feed-unmute`: foundry-channels.spec.ts
- `foundry:inbox.decide`: foundry-channels.spec.ts, foundry-forge.spec.ts, foundry-resume.spec.ts
- `foundry:inbox.list`: extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
- `foundry:issues.mine`: foundry-channels.spec.ts
- `foundry:ledger.query`: foundry-channels.spec.ts, foundry-floor.spec.ts, foundry-intake.spec.ts, foundry-typography.spec.ts
- `foundry:model-set`: foundry-channels.spec.ts
- `foundry:models-list`: foundry-channels.spec.ts
- `foundry:order.budgets`: foundry-channels.spec.ts, foundry-forge.spec.ts
- `foundry:order.cancel`: foundry-channels.spec.ts
- `foundry:order.compile`: foundry-channels.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts
- `foundry:order.converge`: foundry-channels.spec.ts, foundry-intake.spec.ts
- `foundry:order.create`: foundry-channels.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-typography.spec.ts
- `foundry:order.delete`: foundry-channels.spec.ts, foundry-intake.spec.ts
- `foundry:order.hold`: foundry-channels.spec.ts
- `foundry:order.list`: extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
- `foundry:order.mapState`: foundry-channels.spec.ts
- `foundry:order.recipe`: foundry-channels.spec.ts
- `foundry:order.states`: foundry-channels.spec.ts, foundry-forge.spec.ts
- `foundry:order.turn`: foundry-channels.spec.ts
- `foundry:order.writeBack`: foundry-channels.spec.ts
- `foundry:permission-hand-back`: foundry-channels.spec.ts
- `foundry:permission-resolve`: foundry-channels.spec.ts
- `foundry:permissions-list`: foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-resume.spec.ts
- `foundry:rules.decide`: foundry-channels.spec.ts
- `foundry:rules.inForce`: foundry-channels.spec.ts, foundry-floor.spec.ts, foundry-typography.spec.ts
- `foundry:rules.propose`: foundry-channels.spec.ts, foundry-intake.spec.ts
- `foundry:rules.remove`: foundry-channels.spec.ts
- `foundry:run-interrupt`: foundry-channels.spec.ts
- `foundry:run-redirect`: foundry-channels.spec.ts
- `foundry:run-stop`: foundry-channels.spec.ts
- `foundry:run-terminal`: foundry-channels.spec.ts
- `foundry:run-transcript`: foundry-channels.spec.ts, foundry-factory-view.spec.ts
- `foundry:run.activity`: foundry-channels.spec.ts, foundry-factory-view.spec.ts
- `foundry:run.observe`: foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-resume.spec.ts
- `foundry:run.recipes`: foundry-channels.spec.ts, foundry-forge.spec.ts
- `foundry:run.reset`: foundry-channels.spec.ts
- `foundry:run.resume`: foundry-channels.spec.ts
- `foundry:run.start`: foundry-channels.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts
- `foundry:run.stop`: foundry-channels.spec.ts, foundry-resume.spec.ts
- `foundry:run.timeline`: foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts
- `foundry:sensors.list`: extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
- `foundry:sensors.run-now`: foundry-channels.spec.ts
- `foundry:sensors.set`: foundry-channels.spec.ts
- `foundry:session.attach`: foundry-channels.spec.ts, foundry-resume.spec.ts
- `foundry:signals.dismiss`: foundry-channels.spec.ts
- `foundry:signals.list`: extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
- `foundry:signals.promote`: foundry-channels.spec.ts
- `foundry:stalls-list`: foundry-channels.spec.ts, foundry-floor.spec.ts, foundry-resume.spec.ts
- `foundry:ticket.create`: foundry-channels.spec.ts
- `foundry:ticket.offer`: foundry-channels.spec.ts
- `foundry:ui.consume-pending-new-order`: extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
- `foundry:ui.set-view`: foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts
- `foundry:ui.view`: extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts

</details>

### terminator.git-integration IPC: 6 of 56 driven

Not driven by any spec:

- `git:commit`
- `git:commit-output-poll`
- `git:diff-file`
- `git:merge-commit`
- `git:notify`
- `git:pr-status`
- `git:prepare-pr-worktree`
- `git:push`
- `git:resolve-conflict`
- `git:session-clear`
- `git:session-reset`
- `git:stage`
- `git:undo-resolve`
- `git:unstage`
- `github:accessible-repos`
- `github:active-reviews-for-repo`
- `github:clone-repo`
- `github:current-user`
- `github:file-viewed-set`
- `github:files-metrics`
- `github:files-viewed-set`
- `github:list-open-prs`
- `github:pr-comment-reply`
- `github:pr-compare`
- `github:pr-create`
- `github:pr-file-content`
- `github:pr-file-diff`
- `github:pr-inline-comments`
- `github:pr-issue-comment-add`
- `github:pr-issue-comments`
- `github:pr-mark-ready`
- `github:pr-review-detail`
- `github:pr-review-submit`
- `github:pr-update-branch`
- `github:prune-active-reviews`
- `github:remove-active-review`
- `github:review-repos-set`
- `github:save-active-review`
- `github:session-get`
- `github:session-set`
- `github:sessions-for-repo`
- `github:tests-for-block`
- `review-agent:cancel`
- `review-agent:dismiss`
- `review-agent:list`
- `review-agent:open-terminal`
- `review-agent:settings`
- `review-agent:start`
- `window:open-pr-review`
- `window:review-submitted`

<details><summary>Driven, and by which specs</summary>

- `git:conflicts-list`: merge-flow.spec.ts
- `git:session-persist`: merge-flow.spec.ts
- `git:session-restore`: merge-flow.spec.ts
- `git:status`: git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts
- `github:dashboard-search`: extension-smoke.spec.ts
- `github:review-settings`: extension-smoke.spec.ts

</details>

### terminator.notepad IPC: 43 of 43 driven

`tags.list`, `tags.rename` and `tags.delete` are remote-accessible and no view calls them; `notepad-search.spec.ts` calls them as a remote client does and checks the tags on the notes.

<details><summary>Driven, and by which specs</summary>

- `terminator.notepad:comments.create`: notepad-comments.spec.ts, notepad-export.spec.ts
- `terminator.notepad:comments.delete`: notepad-comments.spec.ts
- `terminator.notepad:comments.list`: notepad-comments.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts
- `terminator.notepad:comments.markOrphaned`: notepad-comments.spec.ts
- `terminator.notepad:comments.reply`: notepad-comments.spec.ts
- `terminator.notepad:comments.resolve`: notepad-comments.spec.ts
- `terminator.notepad:comments.update`: notepad-comments.spec.ts
- `terminator.notepad:comments.updateAnchor`: notepad-comments.spec.ts
- `terminator.notepad:db.reinit`: notepad-search.spec.ts
- `terminator.notepad:diagram-comments.create`: notepad-diagrams.spec.ts
- `terminator.notepad:diagram-comments.delete`: notepad-diagrams.spec.ts
- `terminator.notepad:diagram-comments.list`: notepad-diagrams.spec.ts
- `terminator.notepad:diagram-comments.resolve`: notepad-diagrams.spec.ts
- `terminator.notepad:diagrams.archive`: notepad-diagrams.spec.ts
- `terminator.notepad:diagrams.autosave`: notepad-diagrams.spec.ts, notepad-export.spec.ts
- `terminator.notepad:diagrams.create`: notepad-diagrams.spec.ts, notepad-export.spec.ts
- `terminator.notepad:diagrams.get`: notepad-diagrams.spec.ts
- `terminator.notepad:diagrams.hardDelete`: notepad-diagrams.spec.ts
- `terminator.notepad:diagrams.list`: dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, quick-actions.spec.ts
- `terminator.notepad:diagrams.openWindow`: notepad-diagrams.spec.ts
- `terminator.notepad:diagrams.restore`: notepad-diagrams.spec.ts
- `terminator.notepad:export.pickFolder`: notepad-export.spec.ts, notepad-search.spec.ts
- `terminator.notepad:export.run`: notepad-export.spec.ts
- `terminator.notepad:folders.create`: notepad-notes.spec.ts
- `terminator.notepad:folders.delete`: notepad-notes.spec.ts
- `terminator.notepad:folders.list`: dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, quick-actions.spec.ts
- `terminator.notepad:folders.move`: notepad-notes.spec.ts
- `terminator.notepad:folders.rename`: notepad-notes.spec.ts
- `terminator.notepad:import.run`: notepad-search.spec.ts
- `terminator.notepad:notes.archive`: notepad-notes.spec.ts
- `terminator.notepad:notes.autosave`: notepad-comments.spec.ts, notepad-notes.spec.ts
- `terminator.notepad:notes.create`: notepad-comments.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts
- `terminator.notepad:notes.get`: notepad-comments.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts
- `terminator.notepad:notes.hardDelete`: notepad-notes.spec.ts
- `terminator.notepad:notes.list`: dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, quick-actions.spec.ts
- `terminator.notepad:notes.openWindow`: notepad-outline.spec.ts
- `terminator.notepad:notes.reorder`: notepad-notes.spec.ts
- `terminator.notepad:notes.restore`: notepad-notes.spec.ts
- `terminator.notepad:search.query`: notepad-search.spec.ts
- `terminator.notepad:tags.delete`: notepad-search.spec.ts
- `terminator.notepad:tags.list`: notepad-search.spec.ts
- `terminator.notepad:tags.rename`: notepad-search.spec.ts
- `terminator.notepad:ui.consumePendingQuickCreate`: dismiss-surface-on-click.spec.ts, extension-escape-exit.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, quick-actions.spec.ts

</details>

### terminator.remote-control IPC: 4 of 9 driven

Not driven by any spec:

- `remote:caddyfile`
- `remote:disconnect-device`
- `remote:tunnel-reconnect`
- `remote:update-max-subscribers`
- `remote:update-ngrok-token`

<details><summary>Driven, and by which specs</summary>

- `remote:get-settings`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, remote-app.spec.ts
- `remote:port-change`: remote-app.spec.ts
- `remote:toggle`: remote-app.spec.ts
- `remote:update-password`: remote-app.spec.ts

</details>

### terminator.task-vault IPC: 68 of 68 driven

`links:get-for-terminator-target`, `links:remove`, `projects:update-status`, `settings:set-stale-threshold` and `vault:query` are remote-accessible and no view calls them; `task-vault-links.spec.ts` and `task-vault-remote-api.spec.ts` call them as a remote client does and check the effect in the vault's views. `admin:list-tables` was local-only and called by nothing, so it was deleted rather than tested (71f00af). The global capture shortcut (`CommandOrControl+Shift+O`, an `api.globalShortcut`) is pressed at the X server through XTEST in `task-vault-capture.spec.ts`; that test skips on macOS, where synthesising a system-wide key needs Accessibility consent for the runner, and the closest test there opens the same capture overlay from Quick Actions in the same spec.

<details><summary>Driven, and by which specs</summary>

- `task-vault:admin:run-query`: task-vault-data.spec.ts
- `task-vault:admin:table-stats`: task-vault-data.spec.ts
- `task-vault:db.reinit`: task-vault-data.spec.ts
- `task-vault:db.reset`: task-vault-data.spec.ts
- `task-vault:kanban:get-config`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:kanban:list-contexts`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:kanban:list-tasks`: task-vault-board.spec.ts
- `task-vault:kanban:move-task`: task-vault-board.spec.ts
- `task-vault:kanban:save-config`: task-vault-board.spec.ts
- `task-vault:links:create`: task-vault-links.spec.ts
- `task-vault:links:get-for-terminator-target`: task-vault-links.spec.ts
- `task-vault:links:remove`: task-vault-links.spec.ts
- `task-vault:navigate-to-terminal`: task-vault-links.spec.ts
- `task-vault:open-panel`: task-vault-board.spec.ts
- `task-vault:pop-pending-navigation`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:projects:create`: task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts
- `task-vault:projects:delete`: task-vault-projects.spec.ts
- `task-vault:projects:get-tasks`: task-vault-projects.spec.ts
- `task-vault:projects:list`: extension-keyboard.spec.ts, quick-actions.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:projects:rename`: task-vault-projects.spec.ts
- `task-vault:projects:update-area`: task-vault-projects.spec.ts
- `task-vault:projects:update-deadline`: task-vault-projects.spec.ts
- `task-vault:projects:update-status`: task-vault-remote-api.spec.ts
- `task-vault:projects:weekly-review`: task-vault-review.spec.ts
- `task-vault:review:complete`: task-vault-review.spec.ts
- `task-vault:review:export`: task-vault-review.spec.ts
- `task-vault:review:get`: task-vault-review.spec.ts
- `task-vault:review:list`: task-vault-review.spec.ts
- `task-vault:review:log`: task-vault-review.spec.ts
- `task-vault:review:start`: task-vault-review.spec.ts
- `task-vault:settings:set-stale-threshold`: task-vault-remote-api.spec.ts
- `task-vault:ui.consumePendingCapture`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:add-subtask`: task-vault-today.spec.ts
- `task-vault:vault:add-task`: task-vault-board.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:archive-area`: task-vault-projects.spec.ts
- `task-vault:vault:block-task`: task-vault-today.spec.ts
- `task-vault:vault:cancel-task`: task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:capture`: task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts
- `task-vault:vault:clear-recurrence`: task-vault-today.spec.ts
- `task-vault:vault:complete-task`: task-vault-projects.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:create-area`: task-vault-capture.spec.ts, task-vault-projects.spec.ts
- `task-vault:vault:delete-area`: task-vault-projects.spec.ts
- `task-vault:vault:delete-task`: task-vault-capture.spec.ts, task-vault-projects.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:edit-task`: task-vault-capture.spec.ts, task-vault-projects.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:export-json`: task-vault-data.spec.ts
- `task-vault:vault:get-calendar-month`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:get-daily`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:get-inbox`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:get-task-detail`: task-vault-board.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:get-today`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:import-json`: task-vault-data.spec.ts
- `task-vault:vault:list-archive`: task-vault-projects.spec.ts
- `task-vault:vault:list-areas`: extension-keyboard.spec.ts, quick-actions.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:list-someday`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:migrate-task`: task-vault-today.spec.ts
- `task-vault:vault:process-inbox-item`: task-vault-capture.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:query`: task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:rename-area`: task-vault-projects.spec.ts
- `task-vault:vault:reopen-task`: task-vault-today.spec.ts
- `task-vault:vault:reorder-tasks`: task-vault-today.spec.ts
- `task-vault:vault:reset-today-since`: task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:restore-area`: task-vault-projects.spec.ts
- `task-vault:vault:restore-task`: task-vault-projects.spec.ts
- `task-vault:vault:save-task-detail`: task-vault-today.spec.ts
- `task-vault:vault:set-recurrence`: task-vault-today.spec.ts
- `task-vault:vault:someday-to-today`: task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:unblock-task`: task-vault-today.spec.ts
- `task-vault:vault:update-project-status`: task-vault-projects.spec.ts, task-vault-review.spec.ts

</details>

### Extension commands: 3 of 8 driven

Not driven by any spec:

- `terminator.foundry.command.new-order` — New work order…
- `terminator.foundry.command.toggle-view` — Toggle factory view
- `terminator.git-integration.command.commit` — Commit…
- `terminator.git-integration.command.pull` — Pull
- `terminator.git-integration.command.create-pr` — Create PR…

<details><summary>Driven, and by which specs</summary>

- `terminator.git-integration.command.push` — Push: quick-actions.spec.ts
- `terminator.notepad.command.notepad:quick-create` — New note: quick-actions.spec.ts
- `terminator.task-vault.command.task-vault:capture-to-inbox` — Capture to inbox: quick-actions.spec.ts

</details>

### Core Quick Actions: 7 of 28 driven

Not driven by any spec:

- `core.clear`
- `core.close-tab`
- `core.copy-issue-key`
- `core.cycle-recent-next`
- `core.cycle-recent-prev`
- `core.cycle-workspace-next`
- `core.cycle-workspace-prev`
- `core.edit-note`
- `core.link-issue`
- `core.link-issue-branch`
- `core.new-scratch`
- `core.next-waiting`
- `core.next-waiting-top`
- `core.open-home`
- `core.open-issue`
- `core.prev-tab`
- `core.resume`
- `core.split-horizontal`
- `core.toggle-log`
- `core.toggle-overview`
- `core.view-issue`

<details><summary>Driven, and by which specs</summary>

- `core.new-tab`: terminal-missing-folder.spec.ts, terminal.spec.ts
- `core.next-tab`: terminal.spec.ts
- `core.open-settings`: extension.spec.ts, git-sidebar.spec.ts, quick-actions.spec.ts, settings.spec.ts
- `core.split-vertical`: quick-actions.spec.ts, split-panes.spec.ts, terminal-right-edge.spec.ts
- `core.toggle-sidebar`: quick-actions.spec.ts
- `core.switch-workspace` (one per workspace): terminal.spec.ts
- `session:*` (one per session): session-surfaces.spec.ts

</details>

### Extension settings: 0 of 149 driven

Not driven by any spec:

- `terminator.foundry.dataDir` — Where Foundry keeps its records
- `terminator.foundry.autoOpenDraftPr` — Open a draft pull request when work finishes
- `terminator.foundry.autonomy` — Autonomy
- `terminator.foundry.lighterRedTeam` — Lighter red team
- `terminator.foundry.letAutoModeDecide` — Let auto mode decide
- `terminator.foundry.budgets.agents` — Agents running at once
- `terminator.foundry.budgets.wallClockMinutes` — Minutes before an order pauses and asks
- `terminator.foundry.writeBack.summaryComment` — Comment the agreed work order on its source issue
- `terminator.foundry.writeBack.status` — Move the source issue as work starts, opens and merges
- `terminator.foundry.writeBack.prLink` — Attach every pull request to the source issue
- `terminator.foundry.readOnlyTools` — Tools a review may also use, one per line
- `terminator.foundry.criticalPaths` — Critical paths, one glob per line
- `terminator.foundry.untrackedNoticeSeen` — Untracked records notice has been shown
- `terminator.foundry.stallShadowMode` — Record stalls without surfacing them
- `terminator.foundry.view` — Foundry view
- `terminator.git-integration.git.enabled` — Enable Git Integration
- `terminator.git-integration.git.githubToken` — GitHub token
- `terminator.git-integration.git.commit.signOff` — Add sign-off to commits
- `terminator.git-integration.git.maxDisplayedFiles` — Max displayed changed files
- `terminator.git-integration.review.agentModel` — Review agent model
- `terminator.git-integration.review.agentEffort` — Review agent effort
- `terminator.git-integration.review.cloneFolder` — Clone folder for reviews
- `terminator.git-integration.review.agentTimeoutMinutes` — Review agent timeout (minutes)
- `terminator.git-integration.notify.sidebarToggleHint.system` — Sidebar toggle hint → System notification
- `terminator.git-integration.notify.sidebarToggleHint.center` — Sidebar toggle hint → In-app notification center
- `terminator.git-integration.notify.sidebarToggleHint.toast` — Sidebar toggle hint → Toast
- `terminator.git-integration.notify.gitViewOpened.system` — Git view opened → System notification
- `terminator.git-integration.notify.gitViewOpened.center` — Git view opened → In-app notification center
- `terminator.git-integration.notify.gitViewOpened.toast` — Git view opened → Toast
- `terminator.git-integration.notify.commitFailed.system` — Commit failed → System notification
- `terminator.git-integration.notify.commitFailed.center` — Commit failed → In-app notification center
- `terminator.git-integration.notify.commitFailed.toast` — Commit failed → Toast
- `terminator.git-integration.notify.commitPushFailed.system` — Committed but push failed → System notification
- `terminator.git-integration.notify.commitPushFailed.center` — Committed but push failed → In-app notification center
- `terminator.git-integration.notify.commitPushFailed.toast` — Committed but push failed → Toast
- `terminator.git-integration.notify.conflictResolveFailed.system` — Could not resolve conflict → System notification
- `terminator.git-integration.notify.conflictResolveFailed.center` — Could not resolve conflict → In-app notification center
- `terminator.git-integration.notify.conflictResolveFailed.toast` — Could not resolve conflict → Toast
- `terminator.git-integration.notify.conflictUndoFailed.system` — Could not undo conflict resolution → System notification
- `terminator.git-integration.notify.conflictUndoFailed.center` — Could not undo conflict resolution → In-app notification center
- `terminator.git-integration.notify.conflictUndoFailed.toast` — Could not undo conflict resolution → Toast
- `terminator.git-integration.notify.loadConflictsFailed.system` — Could not load conflicts → System notification
- `terminator.git-integration.notify.loadConflictsFailed.center` — Could not load conflicts → In-app notification center
- `terminator.git-integration.notify.loadConflictsFailed.toast` — Could not load conflicts → Toast
- `terminator.git-integration.notify.noConflictsFound.system` — No merge conflicts found → System notification
- `terminator.git-integration.notify.noConflictsFound.center` — No merge conflicts found → In-app notification center
- `terminator.git-integration.notify.noConflictsFound.toast` — No merge conflicts found → Toast
- `terminator.git-integration.notify.openResolverFailed.system` — Could not open conflict resolver → System notification
- `terminator.git-integration.notify.openResolverFailed.center` — Could not open conflict resolver → In-app notification center
- `terminator.git-integration.notify.openResolverFailed.toast` — Could not open conflict resolver → Toast
- `terminator.git-integration.notify.resetFailed.system` — Could not reset merge session → System notification
- `terminator.git-integration.notify.resetFailed.center` — Could not reset merge session → In-app notification center
- `terminator.git-integration.notify.resetFailed.toast` — Could not reset merge session → Toast
- `terminator.git-integration.notify.reloadConflictsFailed.system` — Could not reload conflicts → System notification
- `terminator.git-integration.notify.reloadConflictsFailed.center` — Could not reload conflicts → In-app notification center
- `terminator.git-integration.notify.reloadConflictsFailed.toast` — Could not reload conflicts → Toast
- `terminator.git-integration.notify.startOverFailed.system` — Start over failed → System notification
- `terminator.git-integration.notify.startOverFailed.center` — Start over failed → In-app notification center
- `terminator.git-integration.notify.startOverFailed.toast` — Start over failed → Toast
- `terminator.git-integration.notify.pushSucceeded.system` — Push succeeded → System notification
- `terminator.git-integration.notify.pushSucceeded.center` — Push succeeded → In-app notification center
- `terminator.git-integration.notify.pushSucceeded.toast` — Push succeeded → Toast
- `terminator.git-integration.notify.pushFailed.system` — Push failed → System notification
- `terminator.git-integration.notify.pushFailed.center` — Push failed → In-app notification center
- `terminator.git-integration.notify.pushFailed.toast` — Push failed → Toast
- `terminator.git-integration.notify.pullSucceeded.system` — Pull succeeded → System notification
- `terminator.git-integration.notify.pullSucceeded.center` — Pull succeeded → In-app notification center
- `terminator.git-integration.notify.pullSucceeded.toast` — Pull succeeded → Toast
- `terminator.git-integration.notify.pullFailed.system` — Pull failed → System notification
- `terminator.git-integration.notify.pullFailed.center` — Pull failed → In-app notification center
- `terminator.git-integration.notify.pullFailed.toast` — Pull failed → Toast
- `terminator.notepad.exportPath` — Export folder
- `terminator.notepad.commentExportFormat` — Export comments as
- `terminator.notepad.autosaveMs` — Autosave debounce
- `terminator.notepad.defaultTags` — Default tags for new notes
- `terminator.notepad.editorFontSize` — Editor font size
- `terminator.notepad.db.reinit` — Re-initialise database
- `terminator.notepad.mcpSidecar` — Enable MCP sidecar
- `terminator.notepad.notify.schemaInitFailed.system` — Database schema failed to apply → System notification
- `terminator.notepad.notify.schemaInitFailed.center` — Database schema failed to apply → In-app notification center
- `terminator.notepad.notify.schemaInitFailed.toast` — Database schema failed to apply → Toast
- `terminator.remote-control.maxSubscribers` — Max Concurrent Viewers
- `terminator.remote-control.ngrokAuthToken` — ngrok Auth Token
- `terminator.task-vault.staleThresholdDays` — Stale Project Threshold (days)
- `terminator.task-vault.weeklyReviewDay` — Weekly Review Day
- `terminator.task-vault.contexts` — Contexts
- `terminator.task-vault.dueDateAlertTime` — Due Date Alert Time
- `terminator.task-vault.db.reinit` — Re-initialize
- `terminator.task-vault.db.reset` — Reset (delete all data)
- `terminator.task-vault.notify.schemaInitFailed.system` — Database schema failed to initialize → System notification
- `terminator.task-vault.notify.schemaInitFailed.center` — Database schema failed to initialize → In-app notification center
- `terminator.task-vault.notify.schemaInitFailed.toast` — Database schema failed to initialize → Toast
- `terminator.task-vault.notify.globalShortcutTaken.system` — Global capture shortcut unavailable → System notification
- `terminator.task-vault.notify.globalShortcutTaken.center` — Global capture shortcut unavailable → In-app notification center
- `terminator.task-vault.notify.globalShortcutTaken.toast` — Global capture shortcut unavailable → Toast
- `terminator.task-vault.notify.weeklyReviewReady.system` — Weekly review ready → System notification
- `terminator.task-vault.notify.weeklyReviewReady.center` — Weekly review ready → In-app notification center
- `terminator.task-vault.notify.weeklyReviewReady.toast` — Weekly review ready → Toast
- `terminator.task-vault.notify.taskCompleted.system` — Task completed → System notification
- `terminator.task-vault.notify.taskCompleted.center` — Task completed → In-app notification center
- `terminator.task-vault.notify.taskCompleted.toast` — Task completed → Toast
- `terminator.task-vault.notify.taskMigrated.system` — Task migrated → System notification
- `terminator.task-vault.notify.taskMigrated.center` — Task migrated → In-app notification center
- `terminator.task-vault.notify.taskMigrated.toast` — Task migrated → Toast
- `terminator.task-vault.notify.taskArchived.system` — Task archived (cancelled) → System notification
- `terminator.task-vault.notify.taskArchived.center` — Task archived (cancelled) → In-app notification center
- `terminator.task-vault.notify.taskArchived.toast` — Task archived (cancelled) → Toast
- `terminator.task-vault.notify.taskReopened.system` — Task reopened → System notification
- `terminator.task-vault.notify.taskReopened.center` — Task reopened → In-app notification center
- `terminator.task-vault.notify.taskReopened.toast` — Task reopened → Toast
- `terminator.task-vault.notify.taskBlocked.system` — Task blocked → System notification
- `terminator.task-vault.notify.taskBlocked.center` — Task blocked → In-app notification center
- `terminator.task-vault.notify.taskBlocked.toast` — Task blocked → Toast
- `terminator.task-vault.notify.taskUnblocked.system` — Task unblocked → System notification
- `terminator.task-vault.notify.taskUnblocked.center` — Task unblocked → In-app notification center
- `terminator.task-vault.notify.taskUnblocked.toast` — Task unblocked → Toast
- `terminator.task-vault.notify.taskMovedToBacklog.system` — Task moved to backlog → System notification
- `terminator.task-vault.notify.taskMovedToBacklog.center` — Task moved to backlog → In-app notification center
- `terminator.task-vault.notify.taskMovedToBacklog.toast` — Task moved to backlog → Toast
- `terminator.task-vault.notify.areaArchived.system` — Area archived → System notification
- `terminator.task-vault.notify.areaArchived.center` — Area archived → In-app notification center
- `terminator.task-vault.notify.areaArchived.toast` — Area archived → Toast
- `terminator.task-vault.notify.projectArchived.system` — Project archived → System notification
- `terminator.task-vault.notify.projectArchived.center` — Project archived → In-app notification center
- `terminator.task-vault.notify.projectArchived.toast` — Project archived → Toast
- `terminator.task-vault.notify.dueTaskReminder.system` — Due / overdue task reminder → System notification
- `terminator.task-vault.notify.dueTaskReminder.center` — Due / overdue task reminder → In-app notification center
- `terminator.task-vault.notify.dueTaskReminder.toast` — Due / overdue task reminder → Toast
- `terminator.task-vault.notify.blockedTaskCheckin.system` — Blocked task check-in → System notification
- `terminator.task-vault.notify.blockedTaskCheckin.center` — Blocked task check-in → In-app notification center
- `terminator.task-vault.notify.blockedTaskCheckin.toast` — Blocked task check-in → Toast
- `terminator.task-vault.notify.recurrenceSet.system` — Recurrence set → System notification
- `terminator.task-vault.notify.recurrenceSet.center` — Recurrence set → In-app notification center
- `terminator.task-vault.notify.recurrenceSet.toast` — Recurrence set → Toast
- `terminator.task-vault.notify.recurrenceRemoved.system` — Recurrence removed → System notification
- `terminator.task-vault.notify.recurrenceRemoved.center` — Recurrence removed → In-app notification center
- `terminator.task-vault.notify.recurrenceRemoved.toast` — Recurrence removed → Toast
- `terminator.task-vault.notify.staleTaskBacklogFailed.system` — Stale task: move to backlog failed → System notification
- `terminator.task-vault.notify.staleTaskBacklogFailed.center` — Stale task: move to backlog failed → In-app notification center
- `terminator.task-vault.notify.staleTaskBacklogFailed.toast` — Stale task: move to backlog failed → Toast
- `terminator.task-vault.notify.staleTaskDeleteFailed.system` — Stale task: delete failed → System notification
- `terminator.task-vault.notify.staleTaskDeleteFailed.center` — Stale task: delete failed → In-app notification center
- `terminator.task-vault.notify.staleTaskDeleteFailed.toast` — Stale task: delete failed → Toast
- `terminator.task-vault.notify.staleTaskResetFailed.system` — Stale task: reset failed → System notification
- `terminator.task-vault.notify.staleTaskResetFailed.center` — Stale task: reset failed → In-app notification center
- `terminator.task-vault.notify.staleTaskResetFailed.toast` — Stale task: reset failed → Toast
- `terminator.task-vault.notify.terminalLinkSaveFailed.system` — Terminal link save failed → System notification
- `terminator.task-vault.notify.terminalLinkSaveFailed.center` — Terminal link save failed → In-app notification center
- `terminator.task-vault.notify.terminalLinkSaveFailed.toast` — Terminal link save failed → Toast

### Global settings written by a spec

- `appearance.theme`: extension-themes.spec.ts, merge-flow.spec.ts, quick-actions.spec.ts, settings.spec.ts
- `git.branchExcludePatterns`: branch-exclude-patterns.spec.ts
- `quickActions.custom`: quick-actions.spec.ts
- `quickActions.directUse`: extension.spec.ts, git-sidebar.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, settings.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal.spec.ts
- `quickActions.pins`: quick-actions.spec.ts, session-surfaces.spec.ts
- `quickActions.usage`: quick-actions.spec.ts, session-surfaces.spec.ts
- `terminal.scrollbackLimit`: settings.spec.ts
- `ui.hasSeenWelcome`: close-session.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts

### Channels the app handles that no manifest method or single extension names

Electron internals and core channels outside the bridge manifest; not counted above.

- `IMPORT_SHARED_TEXTURE_RELEASE_RENDERER_TO_MAIN`
- `electron-store-get-data`
- `error`
- `extension:request-exit` (driven: extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts)
- `workspace:active-changed`
