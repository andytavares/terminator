# Tasks: Git & GitHub Integration Extension

**Input**: Design documents from `specs/002-git-github-integration/`
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/ ✅

**Tests**: Per the project constitution (Principle IV: TDD is NON-NEGOTIABLE), failing tests are written BEFORE implementation. Red → Green → Refactor for every task. Test tasks appear immediately before the implementation task they exercise.

**Organization**: Tasks are grouped by user story for independent implementation and testing. Each phase delivers a working, independently testable slice of functionality.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: User story this task belongs to: [US1] [US2] [US3] [US4]
- **[SCAFFOLD]**: Belongs to the scaffolding CLI deliverable
- **[DOC]**: Documentation/cross-cutting task

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create all directory structures, manifests, and shared Zod schemas that every later phase depends on.

- [x] T001 Create extensions/git-integration/ directory structure: src/git/, src/github/, src/components/, src/stores/, tests/unit/, tests/integration/
- [x] T002 Create extensions/git-integration/manifest.json with id "terminator.git-integration", version "0.1.0", main "src/index.ts", minAppVersion "0.1.0"
- [x] T003 [P] Create src/shared/schemas/git.schema.ts — Zod schemas for GitFileStatus, GitStatus, FileDiff, DiffHunk, DiffLine, CommitPayload, PullRequest, PrCreatePayload (from data-model.md)
- [x] T004 [P] Create src/shared/schemas/shell.schema.ts — Zod schemas for ShellExecOptions (command enum 'git'|'gh', args, cwd, timeoutMs) and ShellResult (exitCode, stdout, stderr, timedOut)
- [x] T005 [P] Create scripts/ directory (mkdir only; create-extension.js is fully implemented in T069)
- [x] T006 Add "create-extension": "node scripts/create-extension.js" to package.json scripts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure shared by all user stories — IPC bridge, fs watcher, ExtensionAPI additions, extension entry point skeleton. No user story work starts until this phase is complete.

**⚠️ CRITICAL**: All user story phases (3–6) depend on this phase being complete.

- [x] T007 Write failing unit tests for ShellExecOptions Zod schema: valid commands pass, invalid command rejected, CWD type validated, timeoutMs clamped — in tests/unit/schemas/shell.schema.spec.ts
- [x] T008 Implement src/shared/schemas/shell.schema.ts Zod schemas to pass T007
- [x] T009 [P] Write failing unit tests for GitStatus/GitFileStatus Zod schema: all FileStatus variants, truncated flag, hasConflicts — in tests/unit/schemas/git.schema.spec.ts
- [x] T010 [P] Implement src/shared/schemas/git.schema.ts Zod schemas to pass T009
- [x] T011 Extend ExtensionAPI interface in src/main/extensions/api.ts: add sidebar.registerPanel(slot, panel), topBar.registerMenuItem(item), shell.exec(options), notifications.showToast(type, message), fs.watch(handler), nativeMenu.addViewMenuItem(item) — types and stubs only; add PanelSlot, PanelContribution, TopBarMenuContribution, NativeMenuItemContribution, FsChangeEvent supporting types
- [x] T012 [P] Extend SettingDefinition in src/main/extensions/api.ts with optional workspaceScoped boolean field
- [x] T013 Write failing integration test for shell:exec IPC handler: valid git command succeeds, non-allowlisted command returns COMMAND_NOT_ALLOWED, CWD outside workspace returns CWD_OUT_OF_SCOPE — in tests/integration/ipc/shell.ipc.spec.ts
- [x] T014 Create src/main/ipc/shell.ipc.ts: handle shell:exec channel using child_process.execFile (shell:false), command allowlist ['git','gh'], CWD scope enforcement via path.relative(), env sanitization, timeout kill — validated by Zod shell.schema.ts
- [x] T015 Register shell:exec IPC handler in src/main/index.ts and expose window.electronAPI.shell.exec via src/main/preload.ts
- [x] T016 Write failing unit tests for FsWatcherService: watch() attaches fs.watch, error triggers polling fallback, stop() removes watcher and clears interval — in tests/unit/fs/fs-watcher.spec.ts
- [x] T017 Create src/main/fs/fs-watcher.ts: FsWatcherService with fs.watch primary, setInterval polling fallback on error, push fs:changed events via webContents.send, idempotent watchStart/watchStop; constructor accepts intervalMs parameter (default 3000) so T066 can pass git.sidebar.refreshIntervalMs
- [x] T018 [P] Register fs:watch-start, fs:watch-stop IPC handlers in src/main/index.ts; expose window.electronAPI.fs.watchStart, watchStop, onChanged in src/main/preload.ts
- [x] T019 [P] Extend src/renderer/electron.d.ts with all new IPC channel types: git.status, git.diffFile, git.stage, git.unstage, git.commit, git.prStatus, git.prCreate, shell.exec, fs.watchStart, fs.watchStop, fs.onChanged
- [x] T020 Create extensions/git-integration/src/index.ts skeleton: export activate(api) and deactivate(), empty disposables array, imports for all component and service modules (stubs)
- [x] T021 [P] Create extensions/git-integration/src/stores/git.store.ts Zustand store skeleton: status (GitStatus | null), selectedFile (string | null), diffCache (Map), isLoading, actions: setStatus, setSelectedFile, setDiff, setLoading

---

## Phase 3: User Story 1 — Toggle the Git Changes Sidebar (Priority: P1) 🎯 MVP

**Goal**: Developer opens a git repo project, toggles the right sidebar on, and sees all changed files with status indicators updated in real time.

**Independent Test**: Open a git repository project → enable git sidebar from View menu → verify sidebar appears listing changed files with correct status icons → modify a file → verify sidebar refreshes within the configured interval → toggle sidebar off → verify it collapses.

- [x] T022 [US1] Write failing unit tests for parseStatus(): porcelain v1 lines parsed to GitFileStatus[], renamed files (R), untracked (??), conflict (UU), binary flag, file cap enforcement (> maxDisplayedFiles → truncated:true) — in extensions/git-integration/tests/unit/git-parser.spec.ts
- [x] T023 [US1] Implement extensions/git-integration/src/git/git-parser.ts: parseStatus(stdout: string, maxFiles: number) pure function covering all FileStatus variants from git status --porcelain=v1 -z format
- [x] T024 [P] [US1] Write failing integration test for git:status IPC handler: returns GitStatus for git repo path, returns error for non-repo path — in tests/integration/ipc/git.ipc.spec.ts
- [x] T025 [US1] Extend src/main/git/git-service.ts with getStatus(path, maxFiles): runs git status --porcelain=v1 -z via execFile, parses with parseStatus, returns GitStatus with branch (git branch --show-current)
- [x] T026 [US1] Implement git:status IPC handler in src/main/ipc/git.ipc.ts: validate request with Zod, call git-service.getStatus(), return GitStatus or {error}
- [x] T027 [US1] Register git:status IPC handler in src/main/index.ts and expose window.electronAPI.git.status in src/main/preload.ts
- [x] T028 [US1] Implement api.fs.watch in src/main/extensions/api.ts: register FsWatcherService listener for extension, push fs:changed events to renderer, wire fs:watch-start on first registration, return Disposable that removes listener and calls fs:watch-stop when last listener is removed
- [x] T029 [P] [US1] Implement api.sidebar.registerPanel in src/main/extensions/api.ts: maintain PanelSlot → PanelContribution registry, enforce one-panel-per-slot-per-extension, return Disposable that removes panel from registry
- [x] T030 [US1] Create extensions/git-integration/src/components/GitSidebarPanel.tsx: React component rendering GitFileStatus[] from git.store; file rows with status badge (M/A/D/R/?/U), loading spinner, empty-state message ("No changes"), truncation banner when status.truncated, "not a git repository" message when status is null
- [x] T031 [US1] Wire status refresh in extensions/git-integration/src/index.ts: in activate(), call api.fs.watch() → debounced getStatus() → git.store.setStatus(); also trigger initial getStatus() on activate
- [x] T032 [US1] Register GitSidebarPanel in extensions/git-integration/src/index.ts: api.sidebar.registerPanel('right-sidebar', { id:'git-changes', title:'Git Changes', component:GitSidebarPanel, defaultVisible }); add api.sidebar.registerItem toggle; add api.keyboard.register shortcut (CmdOrCtrl+Shift+G) to toggle panel visibility
- [x] T033 [US1] Write e2e test in tests/e2e/git-sidebar.spec.ts: launch app with git repo project, toggle sidebar on, assert file list appears within 2000ms (SC-001 timing assertion), modify a file, assert sidebar refreshes within default interval, toggle sidebar off, assert sidebar collapses

---

## Phase 4: User Story 2 — Stage Files and Commit (Priority: P2)

**Goal**: Developer opens the git view, clicks a file to see its diff, selects files to stage, writes a commit message, and commits — all without leaving the app.

**Independent Test**: Open git view → click a changed file → verify diff renders with add/remove highlighting → check individual files to stage → verify Staged section updates → enter commit message → click Commit → verify committed files disappear from list and success toast appears.

- [x] T034 [US2] Write failing unit tests for parseDiff(): hunk header regex, add/remove/context line types, oldLineNumber/newLineNumber, binary detection ("Binary files ... differ"), truncation when output > 500KB — in extensions/git-integration/tests/unit/git-parser.spec.ts
- [x] T035 [US2] Implement parseDiff(stdout: string) in extensions/git-integration/src/git/git-parser.ts: pure function returning FileDiff with hunks, lines, isBinary, truncated
- [x] T036 [P] [US2] Write failing integration tests for git:diff-file IPC handler: staged vs unstaged flag, binary file response, non-existent path returns error — in tests/integration/ipc/git.ipc.spec.ts
- [x] T037 [US2] Extend src/main/git/git-service.ts with getDiff(repoRoot, path, staged): runs git diff [--cached] --unified=3 -- <path> via execFile, detects binary, truncates at 500KB, returns FileDiff; implement git:diff-file IPC handler in src/main/ipc/git.ipc.ts
- [x] T038 [US2] Register git:diff-file handler in src/main/index.ts; expose window.electronAPI.git.diffFile in src/main/preload.ts
- [x] T039 [P] [US2] Write failing integration tests for git:stage and git:unstage: stage adds file to index, unstage removes it, empty paths array returns error — in tests/integration/ipc/git.ipc.spec.ts
- [x] T040 [US2] Implement getStage/getUnstage in src/main/git/git-service.ts (git add / git restore --staged) and git:stage + git:unstage IPC handlers in src/main/ipc/git.ipc.ts
- [x] T041 [US2] Register git:stage and git:unstage handlers in src/main/index.ts; expose in src/main/preload.ts
- [x] T042 [P] [US2] Write failing integration tests for git:commit: NOTHING_TO_COMMIT when nothing staged, EMPTY_MESSAGE when message empty, successful commit returns commitHash — in tests/integration/ipc/git.ipc.spec.ts
- [x] T043 [US2] Implement getCommit in src/main/git/git-service.ts (git commit -m [--signoff]) and git:commit IPC handler in src/main/ipc/git.ipc.ts with NOTHING_TO_COMMIT / EMPTY_MESSAGE validation
- [x] T044 [US2] Register git:commit handler in src/main/index.ts; expose window.electronAPI.git.commit in src/main/preload.ts
- [x] T045 [P] [US2] Implement api.topBar.registerMenuItem in src/main/extensions/api.ts: maintain TopBar item registry in globalRegistry, enforce unique IDs per extension, return Disposable
- [x] T046 [US2] Create extensions/git-integration/src/components/FileDiffView.tsx: renders FileDiff; hunk headers; add lines (green, +), remove lines (red, −), context lines; old/new line numbers in gutter; binary-file message; truncation notice; stale indicator (when file modified while diff shown)
- [x] T047 [P] [US2] Create extensions/git-integration/src/components/StagingArea.tsx: Staged/Unstaged file groups; individual checkbox per file (calls git.stage/unstage); Stage All / Unstage All buttons; file row click → loads diff into git.store.selectedFile; conflict-indicator (blocks staging); truncation banner when git.store.status.truncated is true (FR-009a applies to git view as well as sidebar)
- [x] T048 [US2] Create extensions/git-integration/src/components/GitView.tsx: hosts StagingArea + FileDiffView side-by-side; commit message textarea; Commit button (disabled + tooltip when 0 files staged or message empty); post-commit refresh; error toast on failure
- [x] T049 [US2] Register GitView in extensions/git-integration/src/index.ts via api.topBar.registerMenuItem({ id:'git-view', label:'Git', onClick:openGitView })
- [x] T050 [US2] Write e2e test in tests/e2e/git-view.spec.ts: click file → diff renders; check file → staged section updates; enter commit message → Commit → files gone; empty message → Commit blocked

---

## Phase 5: User Story 3 — Open a Pull Request via gh CLI (Priority: P3)

**Goal**: Developer on a feature branch clicks "Open Pull Request", reviews the pre-filled dialog, toggles Draft if desired, and creates a PR — receiving the PR URL in-app.

**Independent Test**: On a branch with commits ahead of main, click "Open Pull Request" in the git view → verify dialog appears with branch name as title and commit summary as body → create PR (or draft) → verify PR URL appears as toast with browser-open option.

- [x] T051 [US3] Write failing unit tests for gh-service.ts: checkAuth() resolves true on exit 0, rejects on non-zero; getPrForBranch() returns PullRequest on success, null on "no pull requests found", rejects on other errors; createPr() returns PullRequest including isDraft field — in extensions/git-integration/tests/unit/gh-service.spec.ts
- [x] T052 [US3] Implement extensions/git-integration/src/github/gh-service.ts: checkAuth (api.shell.exec gh auth status), getPrForBranch (gh pr view --json url,state,number,title,isDraft,baseRefName,headRefName), createPr (gh pr create --title --body --base [--draft])
- [x] T053 [P] [US3] Write failing integration tests for git:pr-status: returns PullRequest when PR exists, returns {pr:null} when none, returns GH_NOT_FOUND when gh binary missing — in tests/integration/ipc/git.ipc.spec.ts
- [x] T054 [US3] Implement git:pr-status IPC handler in src/main/ipc/git.ipc.ts: run gh pr view via shell:exec, parse JSON response, handle GH_NOT_FOUND/GH_NOT_AUTHENTICATED/no-PR cases
- [x] T055 [US3] Register git:pr-status in src/main/index.ts; expose window.electronAPI.git.prStatus in src/main/preload.ts
- [x] T056 [P] [US3] Write failing integration tests for git:pr-create: creates PR with correct title/body/base/draft, returns PR_ALREADY_EXISTS when duplicate, NO_REMOTE when no upstream — in tests/integration/ipc/git.ipc.spec.ts
- [x] T057 [US3] Implement git:pr-create IPC handler in src/main/ipc/git.ipc.ts: check existing PR first (PR_ALREADY_EXISTS), check remote (NO_REMOTE), run gh pr create, return PullRequest with url
- [x] T058 [US3] Register git:pr-create in src/main/index.ts; expose window.electronAPI.git.prCreate in src/main/preload.ts
- [x] T059 [US3] Create extensions/git-integration/src/components/PrDialog.tsx: title field (pre-filled from branch name), body textarea (pre-filled from last 5 commit messages via git log), base branch selector (defaults to default branch), Draft toggle (default off, maps to isDraft), Create PR button; existing-PR-detected banner with link; gh-not-found error state with install link
- [x] T060 [US3] Wire PR flow in extensions/git-integration/src/components/GitView.tsx: "Open Pull Request" button calls prStatus check, opens PrDialog on no-existing-PR, on success calls api.notifications.showToast('success', isDraft ? `Draft PR created: ${url}` : `PR created: ${url}`) and opens URL in browser via Electron shell.openExternal (FR-020: toast MUST indicate draft status)
- [x] T061 [US3] Write e2e test in tests/e2e/git-pr.spec.ts: stub gh CLI to return success; click "Open Pull Request"; verify dialog with pre-filled fields; submit; verify toast with PR URL

---

## Phase 6: User Story 4 — Configure via Settings (Priority: P4)

**Goal**: Developer can customize all git integration behaviours globally and per-workspace, with workspace settings taking precedence without a restart.

**Independent Test**: Set git.sidebar.defaultOpen=true globally → open git repo project → verify sidebar opens automatically. Then set git.enabled=false in workspace settings → reopen project → verify no git UI appears.

- [x] T062 [US4] Write failing unit tests for workspace settings precedence: api.settings.get() returns workspace value when workspaceScoped=true and workspace override exists, falls back to global otherwise — in tests/unit/extensions/api.spec.ts
- [x] T063 [US4] Implement workspace settings precedence in src/main/extensions/api.ts: settings.get() resolves workspace-level value from the active workspace's settings store when SettingDefinition.workspaceScoped is true, otherwise returns global value
- [x] T064 [US4] Register full git integration settings schema in extensions/git-integration/src/index.ts: api.settings.register() with all 6 keys from data-model.md (git.enabled, git.sidebar.defaultOpen, git.sidebar.refreshIntervalMs, git.ghCliPath, git.commit.signOff, git.maxDisplayedFiles) with correct workspaceScoped flags
- [x] T065 [P] [US4] Implement git.enabled gate in extensions/git-integration/src/index.ts: check api.settings.get('git.enabled') in activate(); if false, skip all panel/shortcut registrations and return early
- [x] T066 [P] [US4] Wire remaining settings in extensions/git-integration/src/index.ts: defaultVisible from git.sidebar.defaultOpen; polling interval from git.sidebar.refreshIntervalMs passed to api.fs.watch options; signOff from git.commit.signOff passed to commit call; maxDisplayedFiles passed to getStatus
- [x] T067 [US4] Write e2e test in tests/e2e/git-settings.spec.ts: set git.enabled=false in workspace settings, open project, assert no git sidebar item and no "Git" top-bar button appear

---

## Phase 7: Extension Scaffolding CLI

**Goal**: `npm run create-extension -- <name>` generates a working extension directory in under 2 seconds with a hello-world demonstrating all v1.1.0 API surfaces.

**Independent Test**: Run `npm run create-extension -- hello-world` → verify extensions/hello-world/manifest.json and src/index.ts are created with correct content → run `npm run dev` → verify hello-world extension activates without errors.

- [x] T068 [SCAFFOLD] Write failing unit tests for scripts/create-extension.js: valid kebab-case name accepted, invalid names rejected (numbers-first, uppercase, too-short), --id validation (reverse-domain format), output directory collision returns exit code 2, generated manifest.json content correct, generated src/index.ts contains all expected API surface stubs — in tests/unit/scripts/create-extension.spec.js
- [x] T069 [SCAFFOLD] Implement scripts/create-extension.js in full (T068 tests must pass): argument parser (process.argv, --id / --dir / --help), name validation (/^[a-z][a-z0-9-]{2,49}$/), id validation, directory collision check (exit 2); AND file generation: generateManifest(name, id) and generateIndex(name, id) pure functions; writeExtension(dir, manifest, index) with fs.mkdirSync + fs.writeFileSync. Note: T069 replaces the split T069+T070 — implement both concerns together so T068 tests can go green in one pass.
- [x] T071 [SCAFFOLD] Write the embedded hello-world src/index.ts template in generateIndex(): activate() registers settings section (1 boolean, 1 string), sidebar item (onClick → showToast), keyboard shortcut (CmdOrCtrl+Shift+H → showToast), terminal.onSessionCreate listener; deactivate() disposes all; commented-out TODO stubs for: sidebar.registerPanel, topBar.registerMenuItem, shell.exec, fs.watch; compiles correctly against ExtensionAPI types
- [x] T072 [SCAFFOLD] Write integration test for scripts/create-extension.js: spawn process with test name, verify exit 0, verify generated files exist and parse as valid JSON/TypeScript, verify exit 2 on directory collision — in tests/integration/scripts/create-extension.spec.js

---

## Addendum: Remediation Tasks (from /speckit-analyze)

**Dependency placement**: T080–T086 belong in Phase 2 (Foundational). T087 belongs in Phase 1. T088 belongs in US1 (Phase 3). T089 belongs in the Final Phase. Insert before their respective phases when sequencing work.

- [x] T080 Write failing unit test for api.notifications.showToast in tests/unit/extensions/api.spec.ts: calling showToast sends an IPC message that renderer receives and routes to useToastStore.addToast() with correct type and message
- [x] T081 Implement api.notifications.showToast in src/main/extensions/api.ts: invoke webContents.send('extension:toast', { type, message }) from main process; register 'extension:toast' listener in renderer (src/renderer/index.tsx or App.tsx) that calls useToastStore.addToast() — wire in preload.ts if needed (FR-026)
- [x] T082 Write failing unit test for api.shell.exec in tests/unit/extensions/api.spec.ts: calling api.shell.exec({ command:'git', args:['status'], cwd }) invokes execFile with correct args, returns ShellResult; non-allowlisted command rejects with COMMAND_NOT_ALLOWED
- [x] T083 Implement api.shell.exec in src/main/extensions/api.ts: since extensions run in the main process, invoke the shell execution logic directly (reuse the validated execFile logic from shell.ipc.ts, extracted to a shared src/main/shell/shell-executor.ts service) — do NOT go through IPC round-trip (FR-024)
- [x] T084 Extend src/main/extensions/extension-host.ts to auto-load all subdirectories of extensions/ at startup: scan for manifest.json (confirm correct filename vs legacy extension.json); load each valid manifest; call activate() via createExtensionAPI() — resolves FR-004 bundled extension loading (C3)
- [x] T085 Inspect src/main/extensions/extension-host.ts for expected manifest filename: if it reads extension.json, update to read manifest.json and update any existing extensions/ fixtures; if it already reads manifest.json, confirm and close H3 (add a comment noting the filename is intentional)
- [x] T086 Resolve extension entry point format in src/main/extensions/extension-host.ts: if it uses require() (CommonJS), either (a) add a compile step for TypeScript extensions, or (b) update the scaffold CLI (T069) and EXTENSION-DEVELOPMENT.md to use CommonJS module.exports instead of TypeScript exports — document the decision in a new ADR (ADR-008) (H4)
- [x] T087 Write failing unit test for api.nativeMenu.addViewMenuItem in tests/unit/extensions/api.spec.ts: item appears in the Electron Menu View submenu after registration; Disposable.dispose() removes it
- [x] T088 Implement api.nativeMenu.addViewMenuItem in src/main/extensions/api.ts: use Electron Menu.getApplicationMenu() to locate the View submenu, append a new MenuItem with the label/accelerator/click handler, rebuild the application menu; Disposable removes the item and rebuilds menu (FR-030)
- [x] T089 Register git sidebar toggle in native View menu in extensions/git-integration/src/index.ts: api.nativeMenu.addViewMenuItem({ id:'git-sidebar-toggle', label:'Toggle Git Sidebar', accelerator:'CmdOrCtrl+Shift+G', onClick: toggleSidebar }) alongside the keyboard shortcut in T032 (FR-008 fully resolved)
- [x] T090 [P] Write e2e test for SC-008 startup delay: launch app twice — once with git.enabled=true, once with git.enabled=false; assert startup time difference is < 100ms (measurable threshold for "no measurable delay")

---

## Phase 8: Documentation (Cross-Cutting)

**Purpose**: All documentation ships in the same delivery as the code it describes (Constitution Principle VI).

- [x] T073 [P] [DOC] Update docs/ARCHITECTURE.md: add FsWatcherService to process model section; add shell:exec sandboxed bridge to IPC section; add panel registry and topBar registry to extension system section
- [x] T074 [P] [DOC] Update README.md: add "Git Integration" bullet to features list; add gh CLI to prerequisites table; add "create-extension" to npm scripts table; link to docs/EXTENSION-DEVELOPMENT.md
- [x] T075 [P] [DOC] Verify docs/adr/005-native-fswatcher-over-chokidar.md, 006-sandboxed-shell-exec-for-extensions.md, 007-bundled-first-extension-distribution.md are complete and accurately reflect final implementation choices

---

## Final Phase: Polish & Cross-Cutting Concerns

- [x] T076 Run full test suite (npm test) and resolve any failures before marking feature complete
- [x] T077 [P] Verify SC-004 (clean install/uninstall): enable git integration, disable via Settings → Extensions, verify no residual sidebar panel, top-bar item, keyboard shortcut, or IPC handler remains registered
- [x] T078 [P] Verify SC-007 (human-readable errors): manually trigger each error state (gh not found, non-git-repo, empty commit, commit nothing staged) and confirm toast messages are readable with no raw error codes or stack traces
- [x] T079 Cross-reference all implemented IPC channels against specs/002-git-github-integration/contracts/ipc-channels-git.md; confirm every channel in the contract has a matching handler and a matching electron.d.ts entry

---

## Dependencies (Story Completion Order)

```
Phase 1 (Setup)
  └── Phase 2 (Foundational)
        ├── Phase 3 (US1 — Sidebar) ← MVP; can be shipped independently
        │     └── Phase 4 (US2 — Stage/Commit) ← depends on sidebar store + git-parser foundation
        │           └── Phase 5 (US3 — Pull Request) ← depends on git view + commit flow
        ├── Phase 6 (US4 — Settings) ← parallel to US1; settings gate needed before US1 ships
        ├── Phase 7 (Scaffold CLI) ← fully independent; parallelizable from Phase 2 onward
        └── Phase 8 (Documentation) ← parallel to all; must complete before PR merge
```

## Parallel Execution by Story

**After Phase 2 completes**, these workstreams can run in parallel:

| Stream A (Core flow)         | Stream B (Settings)      | Stream C (Scaffold)      | Stream D (Docs)  |
| ---------------------------- | ------------------------ | ------------------------ | ---------------- |
| US1 Sidebar (T022–T033)      | US4 Settings (T062–T067) | Scaffold CLI (T068–T072) | Docs (T073–T075) |
| US2 Stage/Commit (T034–T050) | —                        | —                        | —                |
| US3 Pull Request (T051–T061) | —                        | —                        | —                |

## Implementation Strategy

**MVP**: Complete Phase 1 + Phase 2 + Phase 3 (US1 — sidebar). This gives a shippable feature: live git status sidebar, keyboard toggle, auto-refresh. The full commit/PR flow is layered on top.

**Suggested delivery order**:

1. Phase 1 + 2 (all of setup + foundational)
2. Phase 7 (scaffold CLI — simple, no UI, great for onboarding a second developer)
3. Phase 3 (US1 — sidebar MVP)
4. Phase 6 (US4 — settings gate, required for production readiness of US1)
5. Phase 4 (US2 — stage/commit)
6. Phase 5 (US3 — PR)
7. Phase 8 + Final (docs + polish)
