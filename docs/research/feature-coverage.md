# Feature coverage of the e2e suite

What the Playwright suite (`tests/e2e/*.spec.ts`) drives in the real app, measured rather than read off the specs. Every spec ran with an IPC trace (`tests/e2e/ipc-trace.ts`) that records each channel a renderer invoked or sent and each event main pushed. That trace is joined with what the running app offers once every bundled extension is active (`tests/e2e/tools/feature-inventory.spec.ts`): every IPC channel main handles, every extension command, every extension setting.

**Driven is not asserted.** A feature counts as driven when some spec caused its IPC. A spec that opens a view drives every channel the view loads with, whether or not it checks the result. The lists below say where a feature is never even reached. They do not say which reached features are tested well.

## Run

2026-10-12, Linux (xvfb), Node 24.21.0, Electron 44.7.0, on `claude/brave-newton-5ssiux` at f2b31e0 merged with the core coverage work, one full run, `--workers=4`, Playwright's Chromium present:

```bash
npm run build
E2E_IPC_TRACE=<dir> xvfb-run -a npx playwright test --workers=4
FEATURE_INVENTORY=<inventory.json> E2E_TOOLS=1 npx playwright test tests/e2e/tools/feature-inventory.spec.ts
node scripts/feature-coverage.mjs <inventory.json> <dir>
```

- 388 passed, 2 failed, 6 skipped (396 tests). Every section below is this one run.
- The 2 failures pass alone (`--workers=1`, 10 passed): `session-surfaces.spec.ts:89` and `task-vault-capture.spec.ts:143` (its global capture shortcut is system-wide, and four apps on one X display contend for it). Their traces up to the failure are counted.
- The 6 skipped are `issue-trackers.spec.ts`, which skips on Linux: Playwright's Electron loader appends `--password-store=basic`, so the OS credential store it needs is absent. `integrations.spec.ts` drives the same channels here against `tests/e2e/jira-stub.ts`, letting Electron store the credential with its plain-text backend (`safeStorage.setUsePlainTextEncryption`) where Linux has no keychain.
- Fixed in this work and passing: `extension.spec.ts:52` (it raced the reload its toggle causes) and `sidebar-sorting.spec.ts:69` (Chromium on X11 synthesizes a button-less mousemove at the real pointer, which Xvfb parks inside the window, whenever a view under it changes; `launchApp` now moves the window off the pointer on Linux).

## Findings

- **Every core channel, command, core Quick Action and extension setting is driven:** core IPC 114 of 114 (113 plus `workspace.setActive`, added by this work), commands 8 of 8, core Quick Actions 28 of 28, extension settings 149 of 149. The core specs: `core-quick-actions`, `core-ipc`, `app-menu`, `integrations`, `extension-lifecycle` (a fixture extension, `tests/e2e/fixtures/extensions/probe`, installed from a folder), `extension-commands` and `extension-settings`. Each asserts what the operator sees, or what reached the OS or the tracker.
- **Extension settings** are each written from their own settings page (action settings by their button, counted by the channel it runs) and read back after a restart, from main and from the page. Effects asserted: Git Integration switched off (no commands, its page stays), Foundry's budgets, critical paths and write-backs on a new order, Foundry's view, Notepad's default tags, Remote Control's viewer limit, and notification rows off and back on.
- **Settings no code reads**, so there is no effect to assert: `terminator.notepad.exportPath`, `commentExportFormat`, `autosaveMs`, `editorFontSize`, `mcpSidecar`; `terminator.git-integration.git.commit.signOff`, `git.maxDisplayedFiles`; `terminator.task-vault.staleThresholdDays`. Each appears only in its settings declaration. Foundry's `readOnlyTools` and `criticalPaths` ask for one entry per line, but the settings page draws a single-line input.
- **Settings read whose effect is not asserted:** the review agent's model, effort and timeout, the GitHub token and clone folder, ngrok's token, Foundry's autonomy, red team, auto-mode, draft-PR, stall and records-folder settings, and Task Vault's review day, alert time and contexts.
- **Defects found and fixed by the core work**, each with a failing test first: Next waiting and the tab state glyphs read a stored `agentState` nothing updates; Edit session note from Quick Actions closed itself; selecting a tab revived an exited terminal's status; `workspace.getActive` always answered nulls; Commit… and Create PR… did nothing before the Git tab had opened; Git Integration switched off hid its own switch; a settings page registered after Settings opened never showed; an installed extension was listed twice.
- **Git Integration: 57 of 57**, since `git-commit-flow`, `merge-flow-resolve`, `pr-review-diff`, `pr-review-queue`, `review-agent` and `review-dashboard`, against real local repositories with a bare `origin` and a stub GitHub at the gh CLI (`tests/e2e/github-stub.ts`). The 57th is `git:ui.consume-pending-request`, added by this work.
- **Task Vault: 68 of 68, Notepad: 43 of 43**, since the 13 `task-vault-*` and `notepad-*` specs. Driving them found ten bugs, each fixed with a failing test first: the GTD clarify flow skipped every other inbox item, a kanban lane's dot colour was never saved, a write in the SQL console did not refresh the vault, dragging a note to reorder never saved, search ignored case only for ASCII, Ctrl+Shift+F did nothing on Linux and Windows, typing near a comment orphaned it, renaming a diagram left the list stale, the export's comment formats wrote no comments, and live preview left raw whatever the first parse of a long note did not reach.
- **Foundry: 60 of 60** is real but shallow: `foundry-channels.spec.ts` invokes every Foundry channel on purpose, so a full count says the channels answer, not that Foundry's flows are exercised.
- **Remote Control: 9 of 9**, since `remote-control.spec.ts` (2026-10-13; this table's run predates it, and the five rows it adds come from that spec's own trace, `E2E_IPC_TRACE=<dir> npx playwright test tests/e2e/remote-control.spec.ts tests/e2e/remote-app.spec.ts --workers=1`, 7 passed). Each channel is driven from the Remote Control view, and its effect read in the real remote renderer (`src/renderer-remote`) in Chromium against the real server: the account token opens the public address of a stand-in ngrok (`tests/e2e/fixtures/ngrok-bin/ngrok`), Reconnect restores a dropped one while a phone stays connected, a phone over the viewer limit is turned away, Disconnect ends a phone's connection, and Copy Caddyfile names the address the remote renderer is served from. The same spec checks the remote renderer itself can drive none of the nine: each is local-only, so its bridge answers "channel not remote-accessible". Driving them found four bugs, each fixed with a failing test first: nothing called `remote:tunnel-reconnect` and a dropped tunnel's notice was overwritten at once by the next status broadcast; a phone turned away by the viewer limit, or disconnected from the view, was told nothing and looked connected; the view kept counting against the old viewer limit until it was reopened; and ngrok was looked up in the Homebrew folders before the person's own PATH.

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
| Core IPC (window.electronAPI)   | 114    | 114   | 100%  |
| terminator.foundry IPC          | 60     | 60    | 100%  |
| terminator.git-integration IPC  | 57     | 57    | 100%  |
| terminator.notepad IPC          | 43     | 43    | 100%  |
| terminator.remote-control IPC   | 9      | 9     | 100%  |
| terminator.task-vault IPC       | 68     | 68    | 100%  |
| Commands (Quick Actions, menus) | 8      | 8     | 100%  |
| Core Quick Actions              | 28     | 28    | 100%  |
| Extension settings              | 149    | 149   | 100%  |

### Core IPC: 114 of 114 driven

<details><summary>Driven, and by which specs</summary>

- `terminal:create` — terminal.create (invoke): app-menu.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `terminal:close` — terminal.close (invoke): app-menu.spec.ts, close-session.spec.ts, core-quick-actions.spec.ts, session-home.spec.ts, split-panes.spec.ts, terminal.spec.ts
- `terminal:attach` — terminal.attach (invoke): app-menu.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `terminal:list-sessions` — terminal.listSessions (invoke): core-ipc.spec.ts, task-vault-links.spec.ts
- `terminal:input` — terminal.input (send): core-ipc.spec.ts, core-quick-actions.spec.ts, monitor-wall.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, session-surfaces.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts
- `terminal:resize` — terminal.resize (send): app-menu.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `terminal:acknowledge` — terminal.acknowledge (send): app-menu.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `terminal:output` — terminal.onOutput (event): app-menu.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `terminal:close-all` — terminal.closeAll (invoke): core-ipc.spec.ts
- `terminal:cleanup-orphans` — terminal.cleanupOrphans (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `terminal:process-exit` — terminal.onProcessExit (event): app-menu.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, foundry-intake.spec.ts, resume-session.spec.ts, session-home.spec.ts, split-panes.spec.ts, terminal.spec.ts
- `workspace:list` — workspace.list (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `workspace:create` — workspace.create (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `workspace:update` — workspace.update (invoke): workspace.spec.ts
- `workspace:delete` — workspace.delete (invoke): workspace.spec.ts
- `workspace:reorder` — workspace.reorder (invoke): sidebar-sorting.spec.ts
- `workspace:get-active` — workspace.getActive (invoke): core-ipc.spec.ts
- `workspace:active-changed` — workspace.setActive (send): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `project:list` — project.list (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `project:create` — project.create (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `project:delete` — project.delete (invoke): core-ipc.spec.ts
- `project:update-branch` — project.updateBranch (invoke): branch-name.spec.ts
- `project:rename` — project.rename (invoke): core-ipc.spec.ts
- `project:reorder` — project.reorder (invoke): sidebar-sorting.spec.ts
- `workspace:project-added` — project.onAdded (event): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `workspace:project-removed` — project.onRemoved (event): core-ipc.spec.ts, foundry-intake.spec.ts
- `git:is-repo` — git.isRepo (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `git:current-branch` — git.currentBranch (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `git:change-stats` — git.changeStats (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `git:list-branches` — git.listBranches (invoke): branch-exclude-patterns.spec.ts, branch-name.spec.ts, core-ipc.spec.ts, extension-commands.spec.ts, git-commit-flow.spec.ts
- `git:fetch` — git.fetch (invoke): core-ipc.spec.ts
- `git:checkout` — git.checkout (invoke): core-ipc.spec.ts
- `git:create-branch` — git.createBranch (invoke): core-ipc.spec.ts
- `git:suggest-worktree-path` — git.suggestWorktreePath (invoke): branch-name.spec.ts, pr-review-queue.spec.ts
- `git:create-worktree` — git.createWorktree (invoke): branch-name.spec.ts
- `git:remove-worktree` — git.removeWorktree (invoke): core-ipc.spec.ts
- `git:list-worktrees` — git.listWorktrees (invoke): branch-name.spec.ts, core-ipc.spec.ts
- `settings:get-global` — settings.getGlobal (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `settings:update-global` — settings.updateGlobal (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-search.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `settings:get-workspace` — settings.getWorkspace (invoke): app-menu.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `settings:update-workspace` — settings.updateWorkspace (invoke): settings.spec.ts
- `dialog:open-directory` — dialog.openDirectory (invoke): core-ipc.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts
- `extension:list` — extension.list (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `extension:install` — extension.install (invoke): extension-lifecycle.spec.ts
- `extension:toggle` — extension.toggle (invoke): extension.spec.ts
- `extension:uninstall` — extension.uninstall (invoke): extension-lifecycle.spec.ts
- `extension:reload` — extension.reload (invoke): extension-lifecycle.spec.ts
- `extension:get-settings-schemas` — extension.getSettingsSchemas (invoke): extension-lifecycle.spec.ts, extension-settings.spec.ts, extension.spec.ts, git-sidebar.spec.ts, notepad-search.spec.ts, settings.spec.ts, task-vault-data.spec.ts
- `extension:get-settings-values` — extension.getSettingsValues (invoke): extension-commands.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension.spec.ts, git-sidebar.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-notes.spec.ts, notepad-search.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, settings.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-today.spec.ts
- `extension:update-setting` — extension.updateSetting (invoke): extension-settings.spec.ts, review-dashboard.spec.ts
- `extension:commands-changed` — extension.onCommandsChanged (event): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `extension:list-changed` — extension.onListChanged (event): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `extension:get-commands` — extension.getCommands (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `extension:execute-command` — extension.executeCommand (send): extension-commands.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, git-commit-flow.spec.ts, quick-actions.spec.ts, task-vault-capture.spec.ts
- `extension:run-command` — extension.runCommand (invoke): extension-lifecycle.spec.ts
- `extension:has-command` — extension.hasCommand (invoke): foundry-floor.spec.ts
- `extension:update-panel-bounds` — extension.updatePanelBounds (invoke): app-menu.spec.ts, core-ipc.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, quick-actions.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-surfaces.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `extension:set-bottom-inset` — extension.setBottomInset (send): core-quick-actions.spec.ts, extension-lifecycle.spec.ts
- `extension:set-left-inset` — extension.setLeftInset (send): core-ipc.spec.ts, extension-settings.spec.ts
- `extension:set-theme` — extension.setTheme (send): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `shell:exec` — shell.exec (invoke): core-ipc.spec.ts, git-commit-flow.spec.ts
- `shell:open-path` — shell.openPath (invoke): core-ipc.spec.ts
- `shell:open-external` — shell.openExternal (invoke): core-ipc.spec.ts, core-quick-actions.spec.ts
- `editor:detect` — editor.detect (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `editor:open` — editor.open (invoke): open-in-editor.spec.ts
- `fs:watch-start` — fs.watchStart (invoke): core-ipc.spec.ts
- `fs:watch-stop` — fs.watchStop (invoke): core-ipc.spec.ts
- `fs:changed` — fs.onChanged (event): core-ipc.spec.ts
- `fs:read-file` — fs.readFile (invoke): core-ipc.spec.ts, extension-commands.spec.ts, git-commit-flow.spec.ts
- `extension:toggle-panel` — extensionEvents.onTogglePanel (event): app-menu.spec.ts
- `extension:select-project-tab` — extensionEvents.onSelectProjectTab (event): extension-lifecycle.spec.ts
- `menu:open-settings` — extensionEvents.onMenuOpenSettings (event): app-menu.spec.ts
- `menu:open-home` — extensionEvents.onMenuOpenHome (event): app-menu.spec.ts
- `menu:toggle-sidebar` — extensionEvents.onMenuToggleSidebar (event): app-menu.spec.ts
- `menu:close-tab` — extensionEvents.onMenuCloseTab (event): app-menu.spec.ts
- `menu:open-about` — extensionEvents.onMenuOpenAbout (event): app-menu.spec.ts
- `menu:set-panel-checked` — extensionEvents.notifyPanelState (send): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `extension:panel-loaded` — extensionEvents.onExtensionPanelLoaded (event): app-menu.spec.ts, core-ipc.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, quick-actions.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-surfaces.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `extension:renderer-reload` — extensionEvents.onExtensionRendererReload (event): extension-lifecycle.spec.ts
- `extension:exit-to-terminal` — extensionEvents.onExtensionExitToTerminal (event): extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts
- `quick-actions:open` — quickActions.onOpen (event): core-ipc.spec.ts, quick-actions.spec.ts
- `app:get-info` — app.getInfo (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `notifications:create` — notifications.create (invoke): core-ipc.spec.ts, core-quick-actions.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, foundry-intake.spec.ts, notepad-search.spec.ts, task-vault-data.spec.ts, task-vault-projects.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts
- `notifications:list` — notifications.list (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `notifications:dismiss` — notifications.dismiss (invoke): core-ipc.spec.ts
- `notifications:trigger-action` — notifications.triggerAction (invoke): core-ipc.spec.ts
- `notifications:push` — notifications.onPush (event): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `db:health` — db.health (invoke): app-menu.spec.ts
- `metrics:system` — metrics.getSystem (invoke): core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, monitor-wall.spec.ts, session-surfaces.spec.ts
- `metrics:processes` — metrics.getProcesses (invoke): core-quick-actions.spec.ts, monitor-wall.spec.ts, session-surfaces.spec.ts
- `metrics:pids` — metrics.getPids (invoke): core-quick-actions.spec.ts, monitor-wall.spec.ts, session-surfaces.spec.ts
- `log:write` — logger.write (send): extension-lifecycle.spec.ts
- `session-records:list` — sessionRecords.list (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `session-records:set-description` — sessionRecords.setDescription (invoke): close-session.spec.ts, core-quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts
- `session-records:set-link` — sessionRecords.setLink (invoke): core-quick-actions.spec.ts, session-surfaces.spec.ts
- `session-records:transfer` — sessionRecords.transfer (invoke): resume-session.spec.ts
- `session-records:forget` — sessionRecords.forget (invoke): close-session.spec.ts
- `session-records:changed` — sessionRecords.onChanged (event): close-session.spec.ts, core-quick-actions.spec.ts, resume-session.spec.ts, session-home.spec.ts, session-surfaces.spec.ts
- `integrations:status` — integrations.status (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, dismiss-surface-on-click.spec.ts, extension-commands.spec.ts, extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, extension.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, remote-app.spec.ts, resume-session.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts, workspace.spec.ts
- `integrations:connect` — integrations.connect (invoke): core-quick-actions.spec.ts, integrations.spec.ts
- `integrations:disconnect` — integrations.disconnect (invoke): integrations.spec.ts
- `integrations:set-mine` — integrations.setMine (invoke): integrations.spec.ts
- `integrations:issue-list-mine` — integrations.listMine (invoke): core-quick-actions.spec.ts, integrations.spec.ts
- `integrations:issue-search` — integrations.search (invoke): core-quick-actions.spec.ts, integrations.spec.ts
- `integrations:issue-get` — integrations.getIssue (invoke): core-quick-actions.spec.ts, integrations.spec.ts, session-surfaces.spec.ts
- `integrations:issue-comment` — integrations.comment (invoke): integrations.spec.ts
- `integrations:link-set` — integrations.linkSet (invoke): core-quick-actions.spec.ts, integrations.spec.ts
- `integrations:link-get` — integrations.linkGet (invoke): app-menu.spec.ts, branch-exclude-patterns.spec.ts, branch-name.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, open-in-editor.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-alignment.spec.ts, sidebar-branch-first.spec.ts, sidebar-sorting.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts
- `integrations:link-clear` — integrations.linkClear (invoke): integrations.spec.ts
- `integrations:context-preview` — integrations.contextPreview (invoke): core-quick-actions.spec.ts, integrations.spec.ts
- `integrations:set-inject-context` — integrations.setInjectContext (invoke): integrations.spec.ts
- `integrations:status-changed` — integrations.onStatusChanged (event): core-quick-actions.spec.ts, integrations.spec.ts
- `integrations:link-changed` — integrations.onLinkChanged (event): core-quick-actions.spec.ts, integrations.spec.ts
- `integrations:context-injected` — integrations.onContextInjected (event): integrations.spec.ts

</details>

### terminator.foundry IPC: 60 of 60 driven

<details><summary>Driven, and by which specs</summary>

- `foundry:ask-model`: foundry-channels.spec.ts
- `foundry:ask-model-set`: foundry-channels.spec.ts
- `foundry:attention`: extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
- `foundry:factory.metrics`: extension-commands.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts
- `foundry:feed-dismiss`: foundry-channels.spec.ts
- `foundry:feed-list`: foundry-channels.spec.ts, foundry-floor.spec.ts, foundry-resume.spec.ts
- `foundry:feed-mute`: foundry-channels.spec.ts
- `foundry:feed-unmute`: foundry-channels.spec.ts
- `foundry:inbox.decide`: foundry-channels.spec.ts, foundry-forge.spec.ts, foundry-resume.spec.ts
- `foundry:inbox.list`: extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
- `foundry:issues.mine`: foundry-channels.spec.ts
- `foundry:ledger.query`: foundry-channels.spec.ts, foundry-floor.spec.ts, foundry-intake.spec.ts, foundry-typography.spec.ts
- `foundry:model-set`: foundry-channels.spec.ts
- `foundry:models-list`: foundry-channels.spec.ts
- `foundry:order.budgets`: foundry-channels.spec.ts, foundry-forge.spec.ts
- `foundry:order.cancel`: foundry-channels.spec.ts
- `foundry:order.compile`: foundry-channels.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts
- `foundry:order.converge`: foundry-channels.spec.ts, foundry-intake.spec.ts
- `foundry:order.create`: extension-settings.spec.ts, foundry-channels.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-typography.spec.ts
- `foundry:order.delete`: foundry-channels.spec.ts, foundry-intake.spec.ts
- `foundry:order.hold`: foundry-channels.spec.ts
- `foundry:order.list`: extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
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
- `foundry:run.timeline`: foundry-channels.spec.ts, foundry-factory-view.spec.ts
- `foundry:sensors.list`: extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
- `foundry:sensors.run-now`: foundry-channels.spec.ts
- `foundry:sensors.set`: foundry-channels.spec.ts
- `foundry:session.attach`: foundry-channels.spec.ts, foundry-resume.spec.ts
- `foundry:signals.dismiss`: foundry-channels.spec.ts
- `foundry:signals.list`: extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
- `foundry:signals.promote`: foundry-channels.spec.ts
- `foundry:stalls-list`: foundry-channels.spec.ts, foundry-floor.spec.ts, foundry-resume.spec.ts
- `foundry:ticket.create`: foundry-channels.spec.ts
- `foundry:ticket.offer`: foundry-channels.spec.ts
- `foundry:ui.consume-pending-new-order`: extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts
- `foundry:ui.set-view`: foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts
- `foundry:ui.view`: extension-commands.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, foundry-channels.spec.ts, foundry-factory-view.spec.ts, foundry-floor.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, foundry-resume.spec.ts, foundry-typography.spec.ts

</details>

### terminator.git-integration IPC: 57 of 57 driven

<details><summary>Driven, and by which specs</summary>

- `git:commit`: git-commit-flow.spec.ts
- `git:commit-output-poll`: git-commit-flow.spec.ts
- `git:conflicts-list`: merge-flow-resolve.spec.ts, merge-flow.spec.ts, pr-review-queue.spec.ts
- `git:diff-file`: git-commit-flow.spec.ts
- `git:merge-commit`: merge-flow-resolve.spec.ts, pr-review-queue.spec.ts
- `git:notify`: merge-flow-resolve.spec.ts
- `git:pr-status`: git-commit-flow.spec.ts
- `git:prepare-pr-worktree`: pr-review-queue.spec.ts
- `git:push`: git-commit-flow.spec.ts
- `git:resolve-conflict`: merge-flow-resolve.spec.ts, pr-review-queue.spec.ts
- `git:session-clear`: merge-flow-resolve.spec.ts, pr-review-queue.spec.ts
- `git:session-persist`: merge-flow-resolve.spec.ts, merge-flow.spec.ts, pr-review-queue.spec.ts
- `git:session-reset`: merge-flow-resolve.spec.ts
- `git:session-restore`: merge-flow-resolve.spec.ts, merge-flow.spec.ts, pr-review-queue.spec.ts
- `git:stage`: git-commit-flow.spec.ts
- `git:status`: extension-commands.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts
- `git:ui.consume-pending-request`: extension-commands.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts
- `git:undo-resolve`: merge-flow-resolve.spec.ts
- `git:unstage`: git-commit-flow.spec.ts
- `github:accessible-repos`: review-dashboard.spec.ts
- `github:active-reviews-for-repo`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts
- `github:clone-repo`: review-dashboard.spec.ts
- `github:current-user`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts
- `github:dashboard-search`: extension-smoke.spec.ts, review-dashboard.spec.ts
- `github:file-viewed-set`: pr-review-diff.spec.ts
- `github:files-metrics`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts
- `github:files-viewed-set`: pr-review-diff.spec.ts, pr-review-queue.spec.ts
- `github:list-open-prs`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts
- `github:pr-comment-reply`: pr-review-diff.spec.ts
- `github:pr-compare`: pr-review-diff.spec.ts
- `github:pr-create`: git-commit-flow.spec.ts
- `github:pr-file-content`: pr-review-diff.spec.ts
- `github:pr-file-diff`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts
- `github:pr-inline-comments`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts
- `github:pr-issue-comment-add`: pr-review-queue.spec.ts
- `github:pr-issue-comments`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts
- `github:pr-mark-ready`: pr-review-queue.spec.ts
- `github:pr-review-detail`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts
- `github:pr-review-submit`: pr-review-diff.spec.ts, pr-review-queue.spec.ts
- `github:pr-update-branch`: pr-review-queue.spec.ts
- `github:prune-active-reviews`: pr-review-queue.spec.ts
- `github:remove-active-review`: pr-review-queue.spec.ts
- `github:review-repos-set`: review-dashboard.spec.ts
- `github:review-settings`: extension-smoke.spec.ts, review-dashboard.spec.ts
- `github:save-active-review`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts
- `github:session-get`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts
- `github:session-set`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts
- `github:sessions-for-repo`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts
- `github:tests-for-block`: pr-review-diff.spec.ts
- `review-agent:cancel`: review-agent.spec.ts
- `review-agent:dismiss`: review-agent.spec.ts
- `review-agent:list`: pr-review-diff.spec.ts, pr-review-queue.spec.ts, review-agent.spec.ts, review-dashboard.spec.ts
- `review-agent:open-terminal`: review-agent.spec.ts
- `review-agent:settings`: review-agent.spec.ts
- `review-agent:start`: review-agent.spec.ts
- `window:open-pr-review`: pr-review-queue.spec.ts, review-dashboard.spec.ts
- `window:review-submitted`: pr-review-queue.spec.ts

</details>

### terminator.notepad IPC: 43 of 43 driven

<details><summary>Driven, and by which specs</summary>

- `terminator.notepad:comments.create`: notepad-comments.spec.ts, notepad-export.spec.ts
- `terminator.notepad:comments.delete`: notepad-comments.spec.ts
- `terminator.notepad:comments.list`: notepad-comments.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts
- `terminator.notepad:comments.markOrphaned`: notepad-comments.spec.ts
- `terminator.notepad:comments.reply`: notepad-comments.spec.ts
- `terminator.notepad:comments.resolve`: notepad-comments.spec.ts
- `terminator.notepad:comments.update`: notepad-comments.spec.ts
- `terminator.notepad:comments.updateAnchor`: notepad-comments.spec.ts
- `terminator.notepad:db.reinit`: extension-settings.spec.ts, notepad-search.spec.ts
- `terminator.notepad:diagram-comments.create`: notepad-diagrams.spec.ts
- `terminator.notepad:diagram-comments.delete`: notepad-diagrams.spec.ts
- `terminator.notepad:diagram-comments.list`: notepad-diagrams.spec.ts
- `terminator.notepad:diagram-comments.resolve`: notepad-diagrams.spec.ts
- `terminator.notepad:diagrams.archive`: notepad-diagrams.spec.ts
- `terminator.notepad:diagrams.autosave`: notepad-diagrams.spec.ts, notepad-export.spec.ts
- `terminator.notepad:diagrams.create`: notepad-diagrams.spec.ts, notepad-export.spec.ts
- `terminator.notepad:diagrams.get`: notepad-diagrams.spec.ts
- `terminator.notepad:diagrams.hardDelete`: notepad-diagrams.spec.ts
- `terminator.notepad:diagrams.list`: core-ipc.spec.ts, extension-escape-exit.spec.ts, extension-keyboard.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, quick-actions.spec.ts
- `terminator.notepad:diagrams.openWindow`: notepad-diagrams.spec.ts
- `terminator.notepad:diagrams.restore`: notepad-diagrams.spec.ts
- `terminator.notepad:export.pickFolder`: notepad-export.spec.ts, notepad-search.spec.ts
- `terminator.notepad:export.run`: notepad-export.spec.ts
- `terminator.notepad:folders.create`: notepad-notes.spec.ts
- `terminator.notepad:folders.delete`: notepad-notes.spec.ts
- `terminator.notepad:folders.list`: core-ipc.spec.ts, extension-escape-exit.spec.ts, extension-keyboard.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, quick-actions.spec.ts
- `terminator.notepad:folders.move`: notepad-notes.spec.ts
- `terminator.notepad:folders.rename`: notepad-notes.spec.ts
- `terminator.notepad:import.run`: notepad-search.spec.ts
- `terminator.notepad:notes.archive`: notepad-notes.spec.ts
- `terminator.notepad:notes.autosave`: notepad-comments.spec.ts, notepad-notes.spec.ts
- `terminator.notepad:notes.create`: notepad-comments.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts
- `terminator.notepad:notes.get`: notepad-comments.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts
- `terminator.notepad:notes.hardDelete`: notepad-notes.spec.ts
- `terminator.notepad:notes.list`: core-ipc.spec.ts, extension-escape-exit.spec.ts, extension-keyboard.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, quick-actions.spec.ts
- `terminator.notepad:notes.openWindow`: notepad-outline.spec.ts
- `terminator.notepad:notes.reorder`: notepad-notes.spec.ts
- `terminator.notepad:notes.restore`: notepad-notes.spec.ts
- `terminator.notepad:search.query`: notepad-search.spec.ts
- `terminator.notepad:tags.delete`: notepad-search.spec.ts
- `terminator.notepad:tags.list`: notepad-search.spec.ts
- `terminator.notepad:tags.rename`: notepad-search.spec.ts
- `terminator.notepad:ui.consumePendingQuickCreate`: core-ipc.spec.ts, extension-escape-exit.spec.ts, extension-keyboard.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, notepad-comments.spec.ts, notepad-diagrams.spec.ts, notepad-export.spec.ts, notepad-notes.spec.ts, notepad-outline.spec.ts, notepad-search.spec.ts, quick-actions.spec.ts

</details>

### terminator.remote-control IPC: 9 of 9 driven

All nine are local-only: `remote-control.spec.ts` also invokes each from the remote renderer's bridge and gets "channel not remote-accessible" for every one.

<details><summary>Driven, and by which specs</summary>

- `remote:caddyfile`: remote-control.spec.ts
- `remote:disconnect-device`: remote-control.spec.ts
- `remote:get-settings`: extension-keyboard.spec.ts, extension-settings.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, remote-app.spec.ts, remote-control.spec.ts
- `remote:port-change`: remote-app.spec.ts, remote-control.spec.ts
- `remote:toggle`: remote-app.spec.ts, remote-control.spec.ts
- `remote:tunnel-reconnect`: remote-control.spec.ts
- `remote:update-max-subscribers`: remote-control.spec.ts
- `remote:update-ngrok-token`: remote-control.spec.ts
- `remote:update-password`: remote-app.spec.ts, remote-control.spec.ts

</details>

### terminator.task-vault IPC: 68 of 68 driven

`links:get-for-terminator-target`, `links:remove`, `projects:update-status`, `settings:set-stale-threshold` and `vault:query` are remote-accessible and no view calls them; `task-vault-links.spec.ts` and `task-vault-remote-api.spec.ts` call them as a remote client does and check the effect in the vault's views. `admin:list-tables` was local-only and called by nothing, so it was deleted rather than tested (71f00af). The global capture shortcut (`CommandOrControl+Shift+O`, an `api.globalShortcut`) is pressed at the X server through XTEST in `task-vault-capture.spec.ts`; that test skips on macOS, where synthesising a system-wide key needs Accessibility consent for the runner, so CI runs it in the E2E (Linux, X11) job under xvfb. On macOS the closest test opens the same capture overlay from Quick Actions in the same spec.

<details><summary>Driven, and by which specs</summary>

- `task-vault:admin:run-query`: task-vault-data.spec.ts
- `task-vault:admin:table-stats`: task-vault-data.spec.ts
- `task-vault:db.reinit`: extension-settings.spec.ts, task-vault-data.spec.ts
- `task-vault:db.reset`: extension-settings.spec.ts, task-vault-data.spec.ts
- `task-vault:kanban:get-config`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:kanban:list-contexts`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:kanban:list-tasks`: task-vault-board.spec.ts
- `task-vault:kanban:move-task`: task-vault-board.spec.ts
- `task-vault:kanban:save-config`: task-vault-board.spec.ts
- `task-vault:links:create`: task-vault-links.spec.ts
- `task-vault:links:get-for-terminator-target`: task-vault-links.spec.ts
- `task-vault:links:remove`: task-vault-links.spec.ts
- `task-vault:navigate-to-terminal`: task-vault-links.spec.ts
- `task-vault:open-panel`: task-vault-board.spec.ts
- `task-vault:pop-pending-navigation`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:projects:create`: task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts
- `task-vault:projects:delete`: task-vault-projects.spec.ts
- `task-vault:projects:get-tasks`: task-vault-projects.spec.ts
- `task-vault:projects:list`: extension-keyboard.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
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
- `task-vault:ui.consumePendingCapture`: app-menu.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
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
- `task-vault:vault:get-calendar-month`: app-menu.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:get-daily`: app-menu.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:get-inbox`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:get-task-detail`: task-vault-board.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:get-today`: app-menu.spec.ts, extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:import-json`: task-vault-data.spec.ts
- `task-vault:vault:list-archive`: task-vault-projects.spec.ts
- `task-vault:vault:list-areas`: extension-keyboard.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-today.spec.ts
- `task-vault:vault:list-someday`: extension-keyboard.spec.ts, extension-smoke.spec.ts, extension-themes.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-board.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, task-vault-links.spec.ts, task-vault-projects.spec.ts, task-vault-remote-api.spec.ts, task-vault-review.spec.ts, task-vault-today.spec.ts
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

### Extension commands: 8 of 8 driven

<details><summary>Driven, and by which specs</summary>

- `terminator.foundry.command.new-order` — New work order…: extension-commands.spec.ts
- `terminator.foundry.command.toggle-view` — Toggle factory view: extension-commands.spec.ts
- `terminator.git-integration.command.commit` — Commit…: extension-commands.spec.ts, git-commit-flow.spec.ts
- `terminator.git-integration.command.push` — Push: quick-actions.spec.ts
- `terminator.git-integration.command.pull` — Pull: extension-commands.spec.ts, git-commit-flow.spec.ts
- `terminator.git-integration.command.create-pr` — Create PR…: extension-commands.spec.ts, git-commit-flow.spec.ts
- `terminator.notepad.command.notepad:quick-create` — New note: extension-settings.spec.ts, quick-actions.spec.ts
- `terminator.task-vault.command.task-vault:capture-to-inbox` — Capture to inbox: quick-actions.spec.ts, task-vault-capture.spec.ts

</details>

### Core Quick Actions: 28 of 28 driven

<details><summary>Driven, and by which specs</summary>

- `core.clear`: core-quick-actions.spec.ts
- `core.close-tab`: app-menu.spec.ts, core-quick-actions.spec.ts
- `core.copy-issue-key`: core-quick-actions.spec.ts
- `core.cycle-recent-next`: core-quick-actions.spec.ts
- `core.cycle-recent-prev`: core-quick-actions.spec.ts
- `core.cycle-workspace-next`: core-quick-actions.spec.ts
- `core.cycle-workspace-prev`: core-quick-actions.spec.ts
- `core.edit-note`: core-quick-actions.spec.ts
- `core.link-issue`: core-quick-actions.spec.ts
- `core.link-issue-branch`: core-quick-actions.spec.ts, integrations.spec.ts
- `core.new-scratch`: core-quick-actions.spec.ts
- `core.new-tab`: app-menu.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, integrations.spec.ts, terminal-missing-folder.spec.ts, terminal.spec.ts
- `core.next-tab`: terminal.spec.ts
- `core.next-waiting`: core-quick-actions.spec.ts
- `core.next-waiting-top`: core-quick-actions.spec.ts
- `core.open-home`: app-menu.spec.ts, core-quick-actions.spec.ts
- `core.open-issue`: core-quick-actions.spec.ts
- `core.open-settings`: app-menu.spec.ts, core-quick-actions.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, notepad-search.spec.ts, quick-actions.spec.ts, settings.spec.ts, task-vault-data.spec.ts
- `core.prev-tab`: core-quick-actions.spec.ts
- `core.resume`: core-quick-actions.spec.ts
- `core.split-horizontal`: core-quick-actions.spec.ts
- `core.split-vertical`: quick-actions.spec.ts, split-panes.spec.ts, terminal-right-edge.spec.ts
- `core.toggle-log`: core-quick-actions.spec.ts, extension-lifecycle.spec.ts
- `core.toggle-overview`: core-quick-actions.spec.ts
- `core.toggle-sidebar`: app-menu.spec.ts, quick-actions.spec.ts
- `core.view-issue`: core-quick-actions.spec.ts, integrations.spec.ts
- `core.switch-workspace` (one per workspace): terminal.spec.ts
- `session:*` (one per session): session-surfaces.spec.ts

</details>

### Extension settings: 149 of 149 driven

<details><summary>Driven, and by which specs</summary>

- `terminator.foundry.dataDir` — Where Foundry keeps its records: extension-settings.spec.ts
- `terminator.foundry.autoOpenDraftPr` — Open a draft pull request when work finishes: extension-settings.spec.ts
- `terminator.foundry.autonomy` — Autonomy: extension-settings.spec.ts
- `terminator.foundry.lighterRedTeam` — Lighter red team: extension-settings.spec.ts
- `terminator.foundry.letAutoModeDecide` — Let auto mode decide: extension-settings.spec.ts
- `terminator.foundry.budgets.agents` — Agents running at once: extension-settings.spec.ts
- `terminator.foundry.budgets.wallClockMinutes` — Minutes before an order pauses and asks: extension-settings.spec.ts
- `terminator.foundry.writeBack.summaryComment` — Comment the agreed work order on its source issue: extension-settings.spec.ts
- `terminator.foundry.writeBack.status` — Move the source issue as work starts, opens and merges: extension-settings.spec.ts
- `terminator.foundry.writeBack.prLink` — Attach every pull request to the source issue: extension-settings.spec.ts
- `terminator.foundry.readOnlyTools` — Tools a review may also use, one per line: extension-settings.spec.ts
- `terminator.foundry.criticalPaths` — Critical paths, one glob per line: extension-settings.spec.ts
- `terminator.foundry.untrackedNoticeSeen` — Untracked records notice has been shown: extension-settings.spec.ts
- `terminator.foundry.stallShadowMode` — Record stalls without surfacing them: extension-settings.spec.ts
- `terminator.foundry.view` — Foundry view: extension-settings.spec.ts
- `terminator.git-integration.git.enabled` — Enable Git Integration: extension-settings.spec.ts
- `terminator.git-integration.git.githubToken` — GitHub token: extension-settings.spec.ts
- `terminator.git-integration.git.commit.signOff` — Add sign-off to commits: extension-settings.spec.ts
- `terminator.git-integration.git.maxDisplayedFiles` — Max displayed changed files: extension-settings.spec.ts
- `terminator.git-integration.review.agentModel` — Review agent model: extension-settings.spec.ts
- `terminator.git-integration.review.agentEffort` — Review agent effort: extension-settings.spec.ts
- `terminator.git-integration.review.cloneFolder` — Clone folder for reviews: extension-settings.spec.ts, review-dashboard.spec.ts
- `terminator.git-integration.review.agentTimeoutMinutes` — Review agent timeout (minutes): extension-settings.spec.ts
- `terminator.git-integration.notify.sidebarToggleHint.system` — Sidebar toggle hint → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.sidebarToggleHint.center` — Sidebar toggle hint → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.sidebarToggleHint.toast` — Sidebar toggle hint → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.gitViewOpened.system` — Git view opened → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.gitViewOpened.center` — Git view opened → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.gitViewOpened.toast` — Git view opened → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.commitFailed.system` — Commit failed → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.commitFailed.center` — Commit failed → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.commitFailed.toast` — Commit failed → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.commitPushFailed.system` — Committed but push failed → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.commitPushFailed.center` — Committed but push failed → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.commitPushFailed.toast` — Committed but push failed → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.conflictResolveFailed.system` — Could not resolve conflict → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.conflictResolveFailed.center` — Could not resolve conflict → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.conflictResolveFailed.toast` — Could not resolve conflict → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.conflictUndoFailed.system` — Could not undo conflict resolution → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.conflictUndoFailed.center` — Could not undo conflict resolution → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.conflictUndoFailed.toast` — Could not undo conflict resolution → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.loadConflictsFailed.system` — Could not load conflicts → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.loadConflictsFailed.center` — Could not load conflicts → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.loadConflictsFailed.toast` — Could not load conflicts → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.noConflictsFound.system` — No merge conflicts found → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.noConflictsFound.center` — No merge conflicts found → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.noConflictsFound.toast` — No merge conflicts found → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.openResolverFailed.system` — Could not open conflict resolver → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.openResolverFailed.center` — Could not open conflict resolver → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.openResolverFailed.toast` — Could not open conflict resolver → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.resetFailed.system` — Could not reset merge session → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.resetFailed.center` — Could not reset merge session → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.resetFailed.toast` — Could not reset merge session → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.reloadConflictsFailed.system` — Could not reload conflicts → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.reloadConflictsFailed.center` — Could not reload conflicts → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.reloadConflictsFailed.toast` — Could not reload conflicts → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.startOverFailed.system` — Start over failed → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.startOverFailed.center` — Start over failed → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.startOverFailed.toast` — Start over failed → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.pushSucceeded.system` — Push succeeded → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.pushSucceeded.center` — Push succeeded → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.pushSucceeded.toast` — Push succeeded → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.pushFailed.system` — Push failed → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.pushFailed.center` — Push failed → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.pushFailed.toast` — Push failed → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.pullSucceeded.system` — Pull succeeded → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.pullSucceeded.center` — Pull succeeded → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.pullSucceeded.toast` — Pull succeeded → Toast: extension-settings.spec.ts
- `terminator.git-integration.notify.pullFailed.system` — Pull failed → System notification: extension-settings.spec.ts
- `terminator.git-integration.notify.pullFailed.center` — Pull failed → In-app notification center: extension-settings.spec.ts
- `terminator.git-integration.notify.pullFailed.toast` — Pull failed → Toast: extension-settings.spec.ts
- `terminator.notepad.exportPath` — Export folder: extension-settings.spec.ts
- `terminator.notepad.commentExportFormat` — Export comments as: extension-settings.spec.ts
- `terminator.notepad.autosaveMs` — Autosave debounce: extension-settings.spec.ts
- `terminator.notepad.defaultTags` — Default tags for new notes: extension-settings.spec.ts
- `terminator.notepad.editorFontSize` — Editor font size: extension-settings.spec.ts
- `terminator.notepad.db.reinit` — Re-initialise database: extension-settings.spec.ts, notepad-search.spec.ts
- `terminator.notepad.mcpSidecar` — Enable MCP sidecar: extension-settings.spec.ts
- `terminator.notepad.notify.schemaInitFailed.system` — Database schema failed to apply → System notification: extension-settings.spec.ts
- `terminator.notepad.notify.schemaInitFailed.center` — Database schema failed to apply → In-app notification center: extension-settings.spec.ts
- `terminator.notepad.notify.schemaInitFailed.toast` — Database schema failed to apply → Toast: extension-settings.spec.ts
- `terminator.remote-control.maxSubscribers` — Max Concurrent Viewers: extension-settings.spec.ts
- `terminator.remote-control.ngrokAuthToken` — ngrok Auth Token: extension-settings.spec.ts
- `terminator.task-vault.staleThresholdDays` — Stale Project Threshold (days): extension-settings.spec.ts
- `terminator.task-vault.weeklyReviewDay` — Weekly Review Day: extension-settings.spec.ts
- `terminator.task-vault.contexts` — Contexts: extension-settings.spec.ts
- `terminator.task-vault.dueDateAlertTime` — Due Date Alert Time: extension-settings.spec.ts
- `terminator.task-vault.db.reinit` — Re-initialize: extension-settings.spec.ts, task-vault-data.spec.ts
- `terminator.task-vault.db.reset` — Reset (delete all data): extension-settings.spec.ts, task-vault-data.spec.ts
- `terminator.task-vault.notify.schemaInitFailed.system` — Database schema failed to initialize → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.schemaInitFailed.center` — Database schema failed to initialize → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.schemaInitFailed.toast` — Database schema failed to initialize → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.globalShortcutTaken.system` — Global capture shortcut unavailable → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.globalShortcutTaken.center` — Global capture shortcut unavailable → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.globalShortcutTaken.toast` — Global capture shortcut unavailable → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.weeklyReviewReady.system` — Weekly review ready → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.weeklyReviewReady.center` — Weekly review ready → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.weeklyReviewReady.toast` — Weekly review ready → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.taskCompleted.system` — Task completed → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.taskCompleted.center` — Task completed → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.taskCompleted.toast` — Task completed → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.taskMigrated.system` — Task migrated → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.taskMigrated.center` — Task migrated → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.taskMigrated.toast` — Task migrated → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.taskArchived.system` — Task archived (cancelled) → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.taskArchived.center` — Task archived (cancelled) → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.taskArchived.toast` — Task archived (cancelled) → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.taskReopened.system` — Task reopened → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.taskReopened.center` — Task reopened → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.taskReopened.toast` — Task reopened → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.taskBlocked.system` — Task blocked → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.taskBlocked.center` — Task blocked → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.taskBlocked.toast` — Task blocked → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.taskUnblocked.system` — Task unblocked → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.taskUnblocked.center` — Task unblocked → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.taskUnblocked.toast` — Task unblocked → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.taskMovedToBacklog.system` — Task moved to backlog → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.taskMovedToBacklog.center` — Task moved to backlog → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.taskMovedToBacklog.toast` — Task moved to backlog → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.areaArchived.system` — Area archived → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.areaArchived.center` — Area archived → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.areaArchived.toast` — Area archived → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.projectArchived.system` — Project archived → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.projectArchived.center` — Project archived → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.projectArchived.toast` — Project archived → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.dueTaskReminder.system` — Due / overdue task reminder → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.dueTaskReminder.center` — Due / overdue task reminder → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.dueTaskReminder.toast` — Due / overdue task reminder → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.blockedTaskCheckin.system` — Blocked task check-in → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.blockedTaskCheckin.center` — Blocked task check-in → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.blockedTaskCheckin.toast` — Blocked task check-in → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.recurrenceSet.system` — Recurrence set → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.recurrenceSet.center` — Recurrence set → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.recurrenceSet.toast` — Recurrence set → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.recurrenceRemoved.system` — Recurrence removed → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.recurrenceRemoved.center` — Recurrence removed → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.recurrenceRemoved.toast` — Recurrence removed → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.staleTaskBacklogFailed.system` — Stale task: move to backlog failed → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.staleTaskBacklogFailed.center` — Stale task: move to backlog failed → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.staleTaskBacklogFailed.toast` — Stale task: move to backlog failed → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.staleTaskDeleteFailed.system` — Stale task: delete failed → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.staleTaskDeleteFailed.center` — Stale task: delete failed → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.staleTaskDeleteFailed.toast` — Stale task: delete failed → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.staleTaskResetFailed.system` — Stale task: reset failed → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.staleTaskResetFailed.center` — Stale task: reset failed → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.staleTaskResetFailed.toast` — Stale task: reset failed → Toast: extension-settings.spec.ts
- `terminator.task-vault.notify.terminalLinkSaveFailed.system` — Terminal link save failed → System notification: extension-settings.spec.ts
- `terminator.task-vault.notify.terminalLinkSaveFailed.center` — Terminal link save failed → In-app notification center: extension-settings.spec.ts
- `terminator.task-vault.notify.terminalLinkSaveFailed.toast` — Terminal link save failed → Toast: extension-settings.spec.ts

</details>

### Global settings written by a spec

- `appearance.theme`: extension-themes.spec.ts, merge-flow.spec.ts, quick-actions.spec.ts, settings.spec.ts
- `git.branchExcludePatterns`: branch-exclude-patterns.spec.ts
- `quickActions.custom`: quick-actions.spec.ts
- `quickActions.directUse`: app-menu.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, extension.spec.ts, git-commit-flow.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, notepad-search.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, settings.spec.ts, split-panes.spec.ts, task-vault-capture.spec.ts, task-vault-data.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal.spec.ts
- `quickActions.pins`: app-menu.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, git-commit-flow.spec.ts, integrations.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-capture.spec.ts
- `quickActions.usage`: app-menu.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, git-commit-flow.spec.ts, integrations.spec.ts, quick-actions.spec.ts, session-surfaces.spec.ts, task-vault-capture.spec.ts
- `terminal.scrollbackLimit`: settings.spec.ts
- `ui.hasSeenWelcome`: app-menu.spec.ts, close-session.spec.ts, core-ipc.spec.ts, core-quick-actions.spec.ts, extension-commands.spec.ts, extension-lifecycle.spec.ts, extension-settings.spec.ts, foundry-forge.spec.ts, foundry-intake.spec.ts, git-commit-flow.spec.ts, git-integration-smoke.spec.ts, git-sidebar.spec.ts, integrations.spec.ts, issue-trackers.spec.ts, merge-flow-resolve.spec.ts, merge-flow.spec.ts, monitor-wall.spec.ts, pr-review-diff.spec.ts, pr-review-queue.spec.ts, project.spec.ts, quick-actions.spec.ts, resume-session.spec.ts, review-agent.spec.ts, session-home.spec.ts, session-surfaces.spec.ts, settings.spec.ts, sidebar-branch-first.spec.ts, split-panes.spec.ts, task-vault-links.spec.ts, terminal-missing-folder.spec.ts, terminal-right-edge.spec.ts, terminal-scroll.spec.ts, terminal.spec.ts

### Channels the app handles that no manifest method or single extension names

Electron internals and core channels outside the bridge manifest; not counted above.

- `IMPORT_SHARED_TEXTURE_RELEASE_RENDERER_TO_MAIN`
- `electron-store-get-data`
- `error`
- `extension:request-exit` (driven: extension-escape-exit.spec.ts, extension-escape.spec.ts, extension-keyboard.spec.ts)
