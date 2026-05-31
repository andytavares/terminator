# Tasks: Extension-First AI-Focused Terminal Emulator (Phase 1)

**Input**: Design documents from `specs/001-extension-first-terminal/`  
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/ ✅

**Tests**: Per the project constitution (Principle IV: TDD is NON-NEGOTIABLE), tests MUST be written before implementation. Write failing tests first — Red → Green → Refactor. Test tasks appear at the start of every user story phase.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US7, maps to spec.md)

---

## Phase 1: Setup (Project Initialization)

**Purpose**: Initialize the Electron + TypeScript + React project with all tooling configured and the directory structure in place. Nothing else can start until this phase is complete.

- [x] T001 Initialize package.json with Electron 30.x, electron-vite, TypeScript 5.x, React 18.x, xterm 5.x, node-pty, zod, electron-store, zustand, vitest, @playwright/test — pin all versions
- [x] T002 Configure tsconfig.json with three references: tsconfig.main.json, tsconfig.renderer.json, tsconfig.shared.json — strict mode enabled in all three
- [x] T003 [P] Configure electron-vite in vite.config.ts (main entry: src/main/index.ts, renderer entry: src/renderer/index.tsx, preload: src/main/preload.ts)
- [x] T004 [P] Configure ESLint with @typescript-eslint and Prettier — add lint and format scripts to package.json
- [x] T005 [P] Configure vitest in vitest.config.ts targeting tests/unit/ and tests/integration/
- [x] T006 [P] Configure Playwright in playwright.config.ts with Electron launch via \_electron.launch() targeting tests/e2e/
- [x] T007 Create full directory structure per plan.md: src/main/{ipc,terminal,extensions,storage}, src/renderer/{components/{sidebar,terminal,settings},stores,hooks}, src/shared/{types,schemas}, tests/{unit,integration,e2e}, docs/adr
- [x] T008 [P] Add npm scripts: dev, build, preview, test, test:watch, test:e2e, test:coverage, lint, format, rebuild (electron-rebuild for node-pty)

**Checkpoint**: `npm run dev` should launch an empty Electron window. `npm test` and `npm run test:e2e` should run (with 0 tests passing).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can begin. Includes all shared schemas, the IPC bridge, Electron bootstrap, and empty Zustand store shells.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T009 Define all shared TypeScript interfaces in src/shared/types/index.ts — Workspace, Project, TerminalSession, SessionStatus, SessionType, Extension, ExtensionStatus, ExtensionManifest, GlobalSettings, WorkspaceSettings per data-model.md
- [x] T010 [P] Implement WorkspaceSchema and ProjectSchema with full validation rules in src/shared/schemas/workspace.schema.ts (name unique constraint documented, folderPath, color regex, tags constraints)
- [x] T011 [P] Implement TerminalSessionSchema in src/shared/schemas/session.schema.ts (SessionStatusSchema, SessionTypeSchema, scrollbackLimit min/max)
- [x] T012 [P] Implement GlobalSettings and WorkspaceSettings Zod schemas in src/shared/schemas/settings.schema.ts (theme enum, scrollbackLimit 1000–100000 range, defaultShell)
- [x] T013 [P] Implement ExtensionManifest Zod schema in src/shared/schemas/extension.schema.ts (id, name, version semver, main, minAppVersion semver range)
- [x] T014 Implement workspace electron-store instance in src/main/storage/workspace-store.ts — typed store for Workspace[] and Project[] with Zod-validated read/write methods; name uniqueness enforced on create/update
- [x] T015 [P] Implement settings electron-store instance in src/main/storage/settings-store.ts — typed store for GlobalSettings and Record<workspaceId, WorkspaceSettings> with default values (theme: dark, scrollbackLimit: 10000)
- [x] T016 Write preload.ts exposing window.electronAPI via contextBridge — namespace all IPC channels: terminal._, workspace._, settings._, extension._, dialog.\* per contracts/ipc-channels.md (includes dialog:open-directory channel needed by folder pickers in renderer)
- [x] T017 Bootstrap src/main/index.ts: create BrowserWindow (contextIsolation: true, nodeIntegration: false, preload: preload.js), register ipcMain handlers (placeholder), handle app quit event
- [x] T018 Bootstrap src/renderer/index.tsx: mount React root into #app with basic App shell component
- [x] T019 [P] Create src/renderer/stores/workspace.store.ts: Zustand store with workspaces[], activeWorkspaceId, activeProjectId state — all actions async (call IPC, then update local state)
- [x] T020 [P] Create src/renderer/stores/session.store.ts: Zustand store with sessions Map<sessionId, TerminalSession metadata> and terminalInstances Map<sessionId, Terminal> — empty structure only
- [x] T021 [P] Create src/renderer/stores/settings.store.ts: Zustand store with globalSettings and workspaceSettings state — empty structure only

**Checkpoint**: Foundation is complete — all schemas compile, IPC bridge is wired, Electron launches with React mounted. User story phases can now begin.

---

## Phase 3: User Story 1 — Workspace Creation and Navigation (Priority: P1) 🎯 MVP

**Goal**: Users can create workspaces with name, folder, color, and tags; view them in a collapsible sidebar with circle-avatar initials when collapsed; right-click to edit or remove; duplicate names are prevented inline.

**Independent Test**: Create a workspace → verify it appears in sidebar with color and tags → collapse sidebar → verify initials avatar shows → right-click → edit name → verify update → remove workspace → verify gone.

### Tests for User Story 1 (TDD — write and verify FAILING before T025)

- [x] T022 Write failing e2e tests in tests/e2e/workspace.spec.ts covering all 7 acceptance scenarios from spec.md US1: create workspace (FR-001), sidebar display (FR-002), collapse/expand with initials avatar (FR-003), right-click context menu (FR-004), edit workspace (FR-005), remove with confirmation (FR-006), duplicate name inline error (FR-001)
- [x] T023 [P] Write failing unit tests in tests/unit/storage/workspace-store.spec.ts: create returns workspace, create rejects duplicate name with DUPLICATE_NAME error, update rejects duplicate name, list returns all workspaces, delete removes workspace and all its projects
- [x] T024 [P] Write failing unit tests in tests/unit/schemas/workspace.schema.spec.ts: valid workspace passes, empty name fails, name over 100 chars fails, invalid hex color fails, more than 20 tags fails

### Implementation for User Story 1

- [x] T025 Implement workspace:list, workspace:create, workspace:update, workspace:delete IPC handlers in src/main/ipc/workspace.ipc.ts — all payloads Zod-validated; workspace:create and workspace:update return DUPLICATE_NAME error when name taken
- [x] T026 Wire workspace IPC handlers into src/main/index.ts ipcMain registration; also register dialog:open-directory handler (calls dialog.showOpenDialog({ properties: ['openDirectory'] }) and returns selected path or cancelled flag) — required by T030's folder picker
- [x] T027 Populate workspace.store.ts Zustand: loadWorkspaces() calls workspace:list on init, createWorkspace() calls workspace:create, updateWorkspace() calls workspace:update, deleteWorkspace() calls workspace:delete, setActiveWorkspace(id) updates activeWorkspaceId
- [x] T028 [P] Implement Sidebar.tsx in src/renderer/components/sidebar/Sidebar.tsx: renders workspace list from workspace.store.ts, collapse/expand toggle button, shows WorkspaceItem components, "Create Workspace" button at bottom
- [x] T029 [P] Implement WorkspaceItem.tsx in src/renderer/components/sidebar/WorkspaceItem.tsx: expanded state (name, color strip, tags chips), collapsed state (circle avatar with workspace name initials in workspace color), right-click context menu with "Edit" and "Remove" actions, onClick sets activeWorkspaceId
- [x] T030 Implement CreateWorkspaceDialog.tsx in src/renderer/components/sidebar/CreateWorkspaceDialog.tsx: name input with inline duplicate-name validation error on blur/submit, folder path picker (calls dialog:open-directory IPC channel which triggers dialog.showOpenDialog({ properties: ['openDirectory'] }) in main — renderer cannot call dialog API directly), color picker (preset palette), tags input; disabled submit while validation error shown
- [x] T031 Implement EditWorkspaceDialog.tsx in src/renderer/components/sidebar/EditWorkspaceDialog.tsx: pre-populated with existing workspace data, same validation as create, only shows DUPLICATE_NAME error if name changed to a taken value
- [x] T032 Wire CreateWorkspaceDialog and EditWorkspaceDialog to workspace.store.ts actions; wire remove to deleteWorkspace() after confirmation dialog
- [x] T033 Implement useKeyboardShortcuts.ts in src/renderer/hooks/useKeyboardShortcuts.ts with Cmd+1–9 (switch to nth workspace by sidebar position) and Cmd++ / Cmd+- (cycle workspaces) using keydown listener scoped to app window focus

**Checkpoint**: User Story 1 fully functional and e2e tests passing independently.

---

## Phase 4: User Story 2 — Project Creation Within a Workspace (Priority: P1)

**Goal**: Users can create named projects within a workspace, see them listed under the workspace in the sidebar, click a project to enter a tabbed terminal view, and open multiple tabs (empty tabs before session wiring in US3).

**Independent Test**: Select workspace → click "Add Project" → name the project → verify it appears in sidebar → click project → verify tabbed view opens → click "+" → verify a new empty tab appears.

### Tests for User Story 2 (TDD — write and verify FAILING before T036)

- [x] T034 Write failing e2e tests in tests/e2e/project.spec.ts covering all 5 acceptance scenarios from spec.md US2: add project prompt (FR-007), project appears in sidebar (FR-008), click project opens tabbed view (FR-009), "+" opens new tab (FR-010), clicking between tabs shows independent content (FR-010)
- [x] T035 [P] Write failing unit tests in tests/unit/storage/workspace-store.spec.ts (project section): create project returns project, create rejects duplicate name within workspace but allows same name in different workspace, list projects for workspace, delete project

### Implementation for User Story 2

- [x] T036 Add project:create, project:list, project:delete IPC handlers to src/main/ipc/workspace.ipc.ts — project:create enforces name uniqueness within workspaceId only; cascade delete not needed in Phase 1 UI but workspace:delete in T025 must cascade
- [x] T037 Add project CRUD methods to src/main/storage/workspace-store.ts
- [x] T038 Add projects state to workspace.store.ts Zustand: projectsByWorkspaceId Map, loadProjects(workspaceId), createProject(), deleteProject(), setActiveProject(id)
- [x] T039 Implement ProjectItem.tsx in src/renderer/components/sidebar/ProjectItem.tsx: project name, click sets activeProjectId, right-click context menu with "Remove" option
- [x] T040 Implement CreateProjectDialog.tsx in src/renderer/components/sidebar/CreateProjectDialog.tsx: name input, duplicate name validation within current workspace, confirm/cancel
- [x] T041 Implement TabBar.tsx in src/renderer/components/terminal/TabBar.tsx: renders tabs from session.store.ts for activeProjectId, "+" button calls useTerminalSession to open new tab (stub in US2 — tab appears but no real terminal yet), empty state when no sessions
- [x] T042 Implement TerminalPane.tsx shell in src/renderer/components/terminal/TerminalPane.tsx: placeholder div with "Open a terminal tab" message when no sessions; full xterm mounting implemented in US3

**Checkpoint**: User Story 2 fully functional; clicking a project shows the tabbed area. US1 + US2 both pass e2e tests.

---

## Phase 5: User Story 3 — Persistent Terminal Sessions Across Navigation (Priority: P1)

**Goal**: Terminal sessions stay alive (PTY + xterm.js buffer) when the user switches projects or workspaces. Returning to a project restores exact scroll position, buffer content, and running process state. Each tab has a real working shell.

**Independent Test**: Open terminal in Project A (run a command) → switch to Project B (open terminal, run different command) → switch back to Project A → verify first terminal still shows original command output and is still running.

### Tests for User Story 3 (TDD — write and verify FAILING before T046)

- [x] T043 Write failing e2e tests in tests/e2e/terminal.spec.ts covering all 4 acceptance scenarios from spec.md US3 plus keyboard scenarios: session continues running in background (FR-012), returning shows current state (FR-013), buffer and scroll preserved on return (FR-013), Cmd+Left/Right cycles tabs, Cmd+T opens new tab; add SC-002 timing assertion: measure elapsed time from workspace-switch click to terminal buffer visible and assert < 500ms using performance.now() in the Playwright test
- [x] T044 [P] Write failing unit tests in tests/unit/terminal/pty-manager.spec.ts: spawn creates PTY and returns sessionId, resize calls pty.resize, write sends data to PTY, kill terminates process and emits exit event
- [x] T045 [P] Write failing integration tests in tests/integration/ipc/terminal.ipc.spec.ts: terminal:create round-trip returns sessionId, terminal:input routes data to correct PTY, terminal:close terminates PTY

### Implementation for User Story 3

- [x] T046 Implement PtyManager class in src/main/terminal/pty-manager.ts: spawn(cwd, shell, sessionId) creates node-pty instance, onData handler pushes output via webContents.send('terminal:output'), resize(sessionId, cols, rows), kill(sessionId) — all sessions stored in Map<sessionId, IPty>
- [x] T047 Implement terminal:create, terminal:close, terminal:input, terminal:resize, terminal:output, terminal:cleanup-orphans IPC handlers in src/main/ipc/terminal.ipc.ts — all request payloads Zod-validated; terminal:create creates PTY via PtyManager using workspace folderPath as cwd
- [x] T048 Wire terminal IPC handlers into src/main/index.ts ipcMain registration
- [x] T049 Implement TerminalSession.tsx in src/renderer/components/terminal/TerminalSession.tsx: initialize xterm Terminal instance with xterm-addon-fit, pipe window.electronAPI.terminal output events to terminal.write(), send keystrokes via window.electronAPI.terminal.input(), call resize on ResizeObserver callback, expose attach(element) and detach() methods
- [x] T050 Populate session.store.ts Zustand: createSession(projectId, type, title) calls terminal:create IPC then stores metadata + Terminal instance in terminalInstances Map, getTerminal(sessionId) returns Terminal instance, sessions Map keyed by projectId for tabbar rendering
- [x] T051 Implement useTerminalSession.ts hook in src/renderer/hooks/useTerminalSession.ts: createSession, closeSession, getSessionsForProject — wraps session.store.ts actions
- [x] T052 Implement TerminalPane.tsx xterm attach/detach in src/renderer/components/terminal/TerminalPane.tsx per ADR-004: when activeSessionId changes, call terminal.detach() on previous containerRef, call terminal.attach(newContainerRef.current) on new session — xterm instance is never destroyed on tab switch, only DOM-detached
- [x] T053 Add Cmd+Left (previous tab), Cmd+Right (next tab), and Cmd+T (new tab) to useKeyboardShortcuts.ts — tab cycle updates activeSessionId in session.store.ts; Cmd+T calls useTerminalSession.createSession for activeProjectId

**Checkpoint**: User Story 3 fully functional. US1 + US2 + US3 all pass e2e tests. Core product value delivered — session persistence works.

---

## Phase 6: User Story 7 — AI Agent Tab Management (Priority: P2)

**Goal**: Users can designate a terminal tab as "agent-driven" when opening it. Agent tabs display a visible badge in the tab strip, distinguishing them from human-driven tabs at a glance. Agent sessions persist identically to human sessions.

**Independent Test**: Open a new tab and mark it as "agent" → verify agent badge appears on the tab → open a second human tab → verify no badge → switch between them → verify both sessions persist independently.

### Tests for User Story 7 (TDD — write and verify FAILING before T055)

- [x] T054 Write failing e2e tests in tests/e2e/terminal.spec.ts (agent badge section) covering US7 acceptance scenarios: agent tab shows badge (FR-035), human tab shows no badge, switching between human and agent tabs preserves both sessions (FR-036), closing agent tab cleans up resources identically to human tab

### Implementation for User Story 7

- [x] T055 [P] Implement NewTabDialog.tsx in src/renderer/components/terminal/NewTabDialog.tsx: shown on Cmd+T, prompts for optional tab title and session type radio (Human / Agent), defaults to Human, confirm creates session via useTerminalSession.createSession with selected type
- [x] T056 Update TabBar.tsx to render an "agent" badge (small label or icon) on tabs where session.type === 'agent' — badge must be visually distinct from tab title
- [x] T057 Add session type to terminal:create IPC request payload in preload.ts and src/main/ipc/terminal.ipc.ts (pass `type: 'human' | 'agent'` through from renderer to PtyManager spawn call metadata); confirm TerminalSession.tsx and session.store.ts store the returned type from the IPC response — this is the concrete wiring that makes FR-036 functional end-to-end

**Checkpoint**: US7 fully functional. Agent and human tabs visually distinct, both persist correctly.

---

## Phase 7: User Story 4 — Terminal Session Cleanup on Close (Priority: P2)

**Goal**: Closing a terminal tab terminates the PTY process and frees all resources within 2 seconds. Quitting the application terminates all open sessions before exit. On next launch after an unclean shutdown, orphaned sessions are cleaned up.

**Independent Test**: Open a terminal running a process → close the tab → verify the process is no longer in the system process list → open the app, open 3 sessions → force-quit → relaunch → verify no orphans remain.

### Tests for User Story 4 (TDD — write and verify FAILING before T059)

- [x] T058 Write failing e2e tests in tests/e2e/terminal.spec.ts (cleanup section) covering US4 acceptance scenarios: close tab terminates PTY (FR-014), resources freed within 2s (SC-003), app quit terminates all sessions (FR-015), relaunch after force-close cleans up orphans (FR-016)
- [x] T059 [P] Expand tests/unit/terminal/pty-manager.spec.ts: killAll() terminates all tracked PTY processes, kill() emits cleanup event, orphan detection returns sessions from previous run

### Implementation for User Story 4

- [x] T060 Implement tab close handler in TabBar.tsx: "×" button on each tab calls window.electronAPI.terminal.close(sessionId), then session.store.ts removes session metadata and Terminal instance from terminalInstances Map, removes tab from UI
- [x] T061 Add killAll() method to PtyManager that iterates all tracked PTY instances and calls kill(); expose via terminal:close-all IPC handler
- [x] T062 Wire app before-quit event in src/main/index.ts: call PtyManager.killAll() and await full cleanup before allowing app to exit (FR-015)
- [x] T063 Implement orphan detection and cleanup in src/main/terminal/pty-manager.ts: on startup, check for a persisted session registry file in app-data; kill any PIDs that are still running from a previous session; implement terminal:cleanup-orphans IPC handler (already declared in T047) to perform this and return cleanedCount; call from renderer on app mount in src/renderer/index.tsx (FR-016). Also handle mid-session PTY process crash: subscribe to node-pty 'exit' event per session; on unexpected exit, emit an IPC notification to the renderer so the tab transitions to a "Process exited (code N)" display state and session status is set to 'closed' with resources freed (resolves U1 edge case)

**Checkpoint**: US4 fully functional. Session cleanup verified by e2e tests.

---

## Phase 8: User Story 5 — Global and Workspace Settings (Priority: P2)

**Goal**: A global settings panel (accessible from main UI) lets users configure theme and terminal behavior. Workspace settings override globals for that workspace. Theme switches immediately app-wide. Scrollback limit applies to new sessions. Extension settings appear in labeled sections.

**Independent Test**: Open global settings → toggle theme from dark to light → verify entire UI switches immediately → open workspace settings for one workspace → set different theme → enter that workspace → verify workspace theme applies → switch to another workspace → verify global theme applies.

### Tests for User Story 5 (TDD — write and verify FAILING before T065)

- [x] T064 Write failing e2e tests in tests/e2e/settings.spec.ts covering all 5 acceptance scenarios from spec.md US5: global settings accessible (FR-019), appearance section with theme toggle (FR-020), theme switches immediately (FR-018/FR-020), workspace settings panel (FR-021), workspace setting overrides global (FR-022), scrollback limit configuration (FR-020a); add SC-007 timing assertion: measure elapsed time from theme toggle click to CSS variable change on document.documentElement and assert < 200ms
- [x] T065 [P] Write failing unit tests in tests/unit/storage/settings-store.spec.ts: getGlobalSettings returns defaults, updateGlobalSettings merges patch, getWorkspaceSettings returns global defaults when no override set, updateWorkspaceSettings stores workspace-scoped override, workspace override takes precedence over global

### Implementation for User Story 5

- [x] T066 Implement settings:get-global, settings:update-global, settings:get-workspace, settings:update-workspace IPC handlers in src/main/ipc/settings.ipc.ts — all payloads Zod-validated; update handlers merge patch over existing settings
- [x] T067 Wire settings IPC handlers into src/main/index.ts ipcMain registration
- [x] T068 Populate settings.store.ts Zustand: loadSettings() fetches global + current workspace settings on init and on workspace switch, updateGlobalTheme(theme) calls settings:update-global, updateWorkspaceTheme(workspaceId, theme) calls settings:update-workspace, resolvedSettings getter merges workspace overrides over global defaults
- [x] T069 Implement CSS custom property theme system in src/renderer/index.tsx: apply data-theme="dark"|"light" attribute to document.documentElement; define --bg-primary, --text-primary, --accent-color etc. CSS variables for both themes in renderer CSS; settings.store.ts resolvedSettings.appearance.theme change triggers attribute update (FR-018: no restart needed)
- [x] T070 Implement SettingsPanel.tsx in src/renderer/components/settings/SettingsPanel.tsx: modal overlay with sidebar nav (Appearance, Terminal, Extensions sections), opened via Cmd+, keyboard shortcut or menu, closes on Escape
- [x] T071 Implement GlobalSettings.tsx in src/renderer/components/settings/GlobalSettings.tsx: Appearance section with dark/light theme radio/toggle wired to settings.store.ts; Terminal section with scrollback limit number input (1000–100000, default 10000) and default shell text input
- [x] T072 Implement WorkspaceSettings.tsx in src/renderer/components/settings/WorkspaceSettings.tsx: header shows workspace name, Appearance override (theme), Terminal override (scrollback limit) — each setting has a "Use global default" checkbox to clear the override
- [x] T073 Add Cmd+, keyboard shortcut in useKeyboardShortcuts.ts to open SettingsPanel
- [x] T074 Wire scrollback limit from resolved settings into xterm Terminal options when creating sessions in TerminalSession.tsx (pass scrollbackLimit to new Terminal({ scrollback: scrollbackLimit })) and propagate to PtyManager via terminal:create IPC payload

**Checkpoint**: US5 fully functional. Theme and settings work globally and per-workspace. e2e tests passing.

---

## Phase 9: User Story 6 — Extension Installation and Integration (Priority: P3)

**Goal**: Users can install extensions from local directories. Extensions integrate via the ExtensionAPI, contributing settings sections, sidebar items, context menu entries, and terminal event subscriptions — without modifying core code. Malformed extensions fail gracefully. Extensions reload on startup and can be disabled without restart.

**Independent Test**: Build a sample extension contributing one settings section and one context menu item → install from local directory → verify settings section appears in settings panel → verify context menu item appears on workspace right-click → disable extension → verify contributions disappear → re-enable → verify they return.

### Tests for User Story 6 (TDD — write and verify FAILING before T076)

- [x] T075 Write failing e2e tests in tests/e2e/extension.spec.ts covering all 5 acceptance scenarios from spec.md US6 using a fixture sample extension: install from local path (FR-025), auto-reload on restart (FR-026), disable removes contributions (FR-027), extension settings appear in panel (FR-023), malformed extension shows error and app remains stable (FR-028)
- [x] T076 [P] Write failing unit tests in tests/unit/extensions/extension-host.spec.ts: load() calls activate() with ExtensionAPI object, activate() error sets extension status to 'error' without crashing host, unload() calls deactivate() and disposes all registrations, invalid manifest rejected with INVALID_MANIFEST error, ExtensionAPI.settings.register() adds section to extension registry

### Implementation for User Story 6

- [x] T077 Implement ExtensionAPI class in src/main/extensions/api.ts: implement settings (register, get), sidebar (registerItem returning Disposable), contextMenu (registerItem returning Disposable), keyboard (register — throws synchronously on reserved shortcut conflict, returns Disposable), terminal (onSessionCreate, onSessionClose with Disposable) namespaces per contracts/extension-api.md (FR-024, FR-034)
- [x] T078 Implement ExtensionHost class in src/main/extensions/extension-host.ts: load(directoryPath) validates manifest with ExtensionManifest Zod schema, require()s entry point, calls activate(api) in try/catch (status → 'error' on throw), stores ExtensionAPI instance per extension; unload(id) calls deactivate() if exported, disposes all Disposables; loadAll() iterates enabled extensions from storage on startup
- [x] T079 Implement extension:install, extension:list, extension:toggle IPC handlers in src/main/ipc/extension.ipc.ts — extension:install calls ExtensionHost.load() and persists to extension store; extension:toggle calls unload/load and updates enabled flag in storage
- [x] T080 Wire extension IPC handlers into src/main/index.ts and call ExtensionHost.loadAll() after app ready
- [x] T081 Add extension settings injection to SettingsPanel.tsx: after loading, query ExtensionAPI registry for contributed settings sections; render each as a labeled collapsible section in the Extensions tab of SettingsPanel (FR-023)
- [x] T082 Add extension sidebar item injection to Sidebar.tsx: subscribe to ExtensionAPI sidebar contributions registry; render contributed SidebarContribution items below workspace list
- [x] T083 Add extension context menu item injection to WorkspaceItem.tsx, ProjectItem.tsx, and TabBar.tsx: merge contributed MenuItemContribution items into respective right-click menus, calling onClick(targetId) with the relevant entity ID
- [x] T084 Add Extensions management section to GlobalSettings.tsx: list installed extensions with name, version, status badge (enabled/disabled/error); "Install from directory" button (triggers native folder picker then extension:install); enable/disable toggle per extension (calls extension:toggle IPC)
- [x] T085 [P] Create fixture sample extension in tests/fixtures/sample-extension/ with manifest.json manifest, main.js that contributes one settings section, one workspace context menu item, and one keyboard shortcut (non-reserved accelerator) — used by e2e tests in T075
- [x] T091 [P] Write failing unit tests for ExtensionAPI keyboard namespace in tests/unit/extensions/extension-host.spec.ts: keyboard.register() with a non-reserved accelerator returns Disposable, keyboard.register() throws synchronously when given a reserved shortcut (e.g., "CmdOrCtrl+T"), disposing the returned Disposable removes the handler (FR-034)

**Checkpoint**: US6 fully functional. Extension system operational. All 7 user stories complete.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation accuracy, performance verification, and cross-cutting quality checks.

- [x] T086 [P] Run full Playwright e2e suite (npm run test:e2e) and verify all acceptance scenarios across workspace.spec.ts, project.spec.ts, terminal.spec.ts, settings.spec.ts, extension.spec.ts pass — fix any regressions
- [x] T087 [P] Run vitest coverage (npm run test:coverage) — identify any uncovered branches in pty-manager.ts, extension-host.ts, workspace-store.ts, and add targeted unit tests to reach meaningful coverage of critical paths
- [x] T088 [P] Verify all four ADRs in docs/adr/ accurately reflect the final implementation — update any section that diverged during development
- [x] T089 [P] Update quickstart.md to reflect final npm scripts, actual setup commands, and extension development workflow with reference to the sample extension in tests/fixtures/
- [x] T090 Run full lint + type check (npm run lint) — resolve all TypeScript errors and ESLint warnings; run npm run format to normalize formatting
- [x] T092 Write SC-008 concurrent session load test in tests/e2e/terminal.spec.ts: spawn 20 terminal sessions across multiple projects, background all but one, then measure UI responsiveness (click latency, tab switch timing) while all 20 are backgrounded — assert no degradation exceeds 500ms (SC-008 validation)
- [x] T093 [P] Write SC-004 startup timing test in tests/e2e/workspace.spec.ts: measure elapsed time from electron app launch to first interactive state (sidebar visible, ready to create workspace) using Playwright \_electron.launch() timestamp vs first UI paint — assert < 3000ms (SC-004 validation)
- [x] T094 [P] Implement Electron application menu in src/main/index.ts: add standard File (Quit), Edit (Cut/Copy/Paste/Select All), View (Toggle Sidebar, Open Settings via Cmd+,), and Window (Close Tab via Cmd+W) menu items — Cmd+W dispatches tab-close to renderer via webContents.send; ensure Cmd+W is consistent with reserved shortcut list in extension-api.md and preload.ts keyboard guard

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user story phases
- **Phase 3 (US1)**: Depends on Phase 2 — can start immediately after Foundational
- **Phase 4 (US2)**: Depends on Phase 3 (projects live inside workspaces; sidebar workspace selection needed)
- **Phase 5 (US3)**: Depends on Phase 4 (terminal tabs live inside projects)
- **Phase 6 (US7)**: Depends on Phase 5 (agent badge is a tab attribute)
- **Phase 7 (US4)**: Depends on Phase 5 (cleanup requires sessions to exist)
- **Phase 8 (US5)**: Depends on Phase 2 (IPC/storage ready); can run in parallel with Phase 5 if staffed
- **Phase 9 (US6)**: Depends on Phase 8 (extension settings render inside settings panel)
- **Phase 10 (Polish)**: Depends on all phases complete

### User Story Dependencies

- **US1 (P1)**: After Phase 2 — no story dependencies
- **US2 (P1)**: After US1 — projects require workspaces
- **US3 (P1)**: After US2 — sessions require projects and tab bar
- **US7 (P2)**: After US3 — agent badge is an attribute of tabs
- **US4 (P2)**: After US3 — cleanup requires real sessions
- **US5 (P2)**: After Phase 2 — can run in parallel with US1–US3 if staffed; fully independent
- **US6 (P3)**: After US5 — extension settings render into settings panel

### Within Each Phase

1. Tests MUST be written first and verified FAILING
2. Schemas/Models before services
3. IPC handlers (main) before Zustand store actions (renderer)
4. Store actions before UI components
5. Components before keyboard wiring
6. Checkpoint validation before advancing to next phase

---

## Parallel Opportunities

### Phase 1 (Setup)

```
Parallel group: T003, T004, T005, T006, T008
Sequential: T001 → T002 → T007
```

### Phase 2 (Foundational)

```
Parallel group: T010, T011, T012, T013 (all schemas, different files)
Sequential after T009: T014 → T016 → T017
Parallel after T015: T019, T020, T021 (all stores, different files)
```

### Phase 3 (US1)

```
Parallel group: T023, T024 (unit tests, different files)
Parallel group: T028, T029 (Sidebar and WorkspaceItem, different files)
Sequential: T022 → T025 → T026 → T027 → T030 → T031 → T032 → T033
```

### Phase 5 (US3) — most parallelizable

```
Parallel group: T044, T045 (unit and integration tests)
Parallel: T046, T049 (PtyManager in main, TerminalSession in renderer — different processes)
Sequential: T047 → T048 → T050 → T051 → T052 → T053
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3 Only — Core Product)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 (workspace navigation)
4. Complete Phase 4: US2 (project creation)
5. Complete Phase 5: US3 (persistent terminal sessions)
6. **STOP and VALIDATE**: Run e2e tests, verify session persistence works, demo to stakeholders
7. The core product is usable at this point

### Incremental Delivery (Full Phase 1 Scope)

After MVP:

- Add US7 (agent tabs) — 4 tasks, fast win
- Add US4 (session cleanup) — 6 tasks, important for resource management
- Add US5 (settings) — parallel with cleanup if staffed
- Add US6 (extensions) — largest phase, unlocks ecosystem

### Parallel Team Strategy

With 2+ developers after Phase 2:

- **Developer A**: US1 → US2 → US3 (core UX flow)
- **Developer B**: US5 (settings) — fully independent of US1–US3

US7 and US4 can follow US3 in parallel after the core flow is complete.

---

## Notes

- [P] tasks operate on different files with no shared dependencies — safe to parallelize
- [USN] label traces each task to its spec user story for acceptance test mapping
- TDD: verify tests FAIL before implementing — a passing test before implementation means the test is wrong
- Commit after each task or logical group; each checkpoint is a stable, demonstrable increment
- xterm.js Terminal instances are NEVER destroyed on tab switch — see ADR-004 and T052
- node-pty runs in main process only — see ADR-001 and T046
- All IPC payloads validated with Zod at both ends — do not skip validation to "speed up" development
