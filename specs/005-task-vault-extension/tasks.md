# Tasks: Task Vault Extension

**Input**: Design documents from `/specs/005-task-vault-extension/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: TDD is NON-NEGOTIABLE (Constitution Principle VI). Test tasks precede every implementation task. Write the failing test first — Red → Green → Refactor.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no unresolved dependencies)
- **[Story]**: Which user story (US1–US7 from spec.md)
- Exact file paths are required in every task description

---

## Phase 1: Setup

**Purpose**: Create the extension scaffold, package files, and build wiring.

- [ ] T001 Create extension directory `extensions/task-vault/` with subdirectories: `src/ipc/`, `src/vault/`, `src/mcp/tools/`, `src/ics/`, `src/schemas/`, `src/stores/`, `src/components/`, `tests/vault/`, `tests/mcp/tools/`, `tests/ics/`
- [ ] T002 Create `extensions/task-vault/package.json` with all dependencies pinned: `@modelcontextprotocol/sdk`, `chokidar ^3.6.0`, `gray-matter ^4.0.3`, `node-ical ^0.20.0`, `zod 3.23.8`, `zustand 4.5.5`, `react 18.3.1`, `react-dom 18.3.1`, `electron-store 8.2.0`
- [ ] T003 [P] Create `extensions/task-vault/manifest.json` with extension metadata: `id: "task-vault"`, `name`, `version: "0.1.0"`, `main: "src/index.ts"`, `renderer: "src/renderer.tsx"`
- [ ] T004 [P] Create `extensions/task-vault/tsconfig.json` extending root tsconfig; add `extensions/task-vault` to root `tsconfig.json` references
- [ ] T005 Wire `extensions/task-vault` into `scripts/build-extensions.js` so `npm run build:extensions` compiles this extension

**Checkpoint**: `npm run build:extensions` runs without error (extension compiles to `extensions/task-vault/src/index.js`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extension API v1.2.0 additions, domain types, and Zod schemas. ALL user stories depend on this phase.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

### Extension API v1.2.0

- [ ] T006 Write failing tests in `tests/extensions/api-v1.2.0.test.ts` covering: `registerGlobalTab` registers and disposes, `globalShortcut.register` registers and disposes, `workspace.list()` returns WorkspaceSnapshot[], `workspace.onDelete` fires on workspace removal
- [ ] T007 Add `GlobalTabContribution` interface and `'global-tab'` to `PanelSlot` union in `src/main/extensions/api.ts`; add `sidebar.registerGlobalTab(tab: GlobalTabContribution): Disposable` to `ExtensionAPI` interface
- [ ] T008 Add `globalShortcut` namespace to `ExtensionAPI` interface in `src/main/extensions/api.ts`; implement using Electron `globalShortcut.register/unregister` (import from `electron`); call `globalShortcut.unregisterAll` for extension's shortcuts on dispose
- [ ] T009 Add `workspace` namespace to `ExtensionAPI` interface in `src/main/extensions/api.ts`: `list()`, `listProjects(workspaceId)`, `onDelete(handler)`, `onProjectDelete(handler)`; implement by reading from `useWorkspaceStore` and subscribing to store delete events
- [ ] T010 Add `GlobalTabRegistration` type and `registerGlobalTab(tab): () => void` method to `src/renderer/extensions/registry.ts`; add `globalTabs: Map<string, GlobalTabRegistration>` and `activeGlobalTabId: string | null` to registry store
- [ ] T011 Update `src/renderer/App.tsx`: render registered global tabs button in `WorkspaceRail` area; when a global tab is active, render its component in `main-content` replacing the workspace view; switching workspace deactivates global tab
- [ ] T012 Add task-vault IPC channel types to `src/renderer/electron.d.ts` (all channels from `contracts/ipc-channels.md`)
- [ ] T013 Write ADR `docs/adr/005-extension-api-v1.2.0.md`: decision=additive API additions for global-tab, globalShortcut, workspace; motivation=task-vault requirements FR-027/FR-003/FR-029; alternatives=using existing sidebar.registerItem (rejected: cannot produce permanent tab)
- [ ] T014 [P] Write ADR `docs/adr/006-mcp-stdio-sidecar.md`: decision=bundled stdio script; motivation=MCP client spawning model; alternatives=in-process HTTP, compiled binary
- [ ] T015 [P] Write ADR `docs/adr/007-line-based-task-ids.md`: decision=filepath:line, session-scoped; motivation=no file mutation, clean markdown; alternatives=content-hash, UUID anchors

### Domain Types and Schemas

- [ ] T016 [P] Create `extensions/task-vault/src/vault/types.ts` with all domain interfaces from `data-model.md`: `Task`, `TaskStatus`, `DailyLog`, `Event`, `Note`, `InboxItem`, `Project`, `ProjectStatus`, `Area`, `VaultIndex`, `IndexedTask`, `IndexedProject`, `TerminatorLink`, `CalendarEvent`, `IcsFeedCache`
- [ ] T017 [P] Create `extensions/task-vault/src/schemas/vault.schema.ts` with Zod schemas for all IPC request/response payloads from `contracts/ipc-channels.md`
- [ ] T018 [P] Create `extensions/task-vault/src/schemas/project.schema.ts` with Zod schema for project YAML frontmatter (fields: `type`, `status`, `deadline`, `area`, `created`, `terminator-links`)
- [ ] T019 [P] Create `extensions/task-vault/src/schemas/mcp.schema.ts` with Zod schemas for all 8 MCP tool input shapes

**Checkpoint**: `npm run build:extensions` passes; API v1.2.0 tests pass; extension API additions do not break existing extensions

---

## Phase 3: User Story 1 — Daily Log Front Door (Priority: P1) 🎯 MVP

**Goal**: User opens extension and sees today's daily log with tasks/events/notes; can complete and migrate tasks; sidebar shows inbox count, projects, areas.

**Independent Test**: Open extension → daily log loads with today's date → check off a task → task shows `[x]` → migrate a task to tomorrow → tomorrow's file contains the migrated task.

### Tests for US1 (Write FIRST — must fail before implementation)

- [ ] T020 [P] [US1] Write failing unit tests for `extensions/task-vault/tests/vault/parser.test.ts`: parse `- [ ]`, `- [x]`, `- [>]`, `- [-]`, `- [/]` markers; parse inline tags (`+project`, `@context`, `#area`, `due:YYYY-MM-DD`, `key:value`); parse `o HH:MM text` events; parse `* text` notes; parse YAML frontmatter; empty file; malformed frontmatter (should not throw)
- [ ] T021 [P] [US1] Write failing unit tests for `extensions/task-vault/tests/vault/writer.test.ts`: complete-task mutates `[ ]` → `[x]` with date; migrate-task mutates `[ ]` → `[>]` and copies to target; add-task appends under correct heading; atomic write (temp+rename) is used; stale ID returns error
- [ ] T022 [P] [US1] Write failing unit tests for `extensions/task-vault/tests/vault/indexer.test.ts`: build index from vault directory; index contains all open tasks; inbox count correct; archive excluded; index written to `.todo/index.json`; index is rebuilt after file change
- [ ] T023 [US1] Write failing integration tests for `extensions/task-vault/tests/vault/watcher.test.ts`: watcher detects new file in vault; watcher detects file change; watcher triggers index rebuild; watcher debounces rapid changes (200ms)

### Implementation for US1

- [ ] T024 [P] [US1] Implement `extensions/task-vault/src/vault/parser.ts`: pure function `parseFile(content: string, filePath: string): { tasks: Task[]; events: Event[]; notes: Note[] }`; parse all task markers per spec; parse inline metadata tags; parse YAML frontmatter for project files using `gray-matter`
- [ ] T025 [P] [US1] Implement `extensions/task-vault/src/vault/writer.ts`: `writeFileAtomic(filePath, content)` using write-to-temp + `fs.promises.rename`; `completeTask(filePath, line, date)` mutates marker in file; `migrateTask(filePath, line, targetDate)` mutates marker and copies to target day file; `addTask(filePath, text, section?)` appends under heading; all functions validate task ID freshness before writing
- [ ] T026 [US1] Implement `extensions/task-vault/src/vault/indexer.ts` (depends on T024): `buildIndex(vaultPath)` walks `daily/`, `inbox.md`, `projects/`, `areas/` (excludes `archive/`); writes `VaultIndex` to `.todo/index.json`; `readIndex(vaultPath)` reads and validates; `getTaskById(index, id)` resolves `filepath:line` to `IndexedTask | null`
- [ ] T027 [US1] Implement `extensions/task-vault/src/vault/watcher.ts`: use `chokidar.watch(vaultPath, { ignored: /archive/ })`; on change: debounce 200ms, call `buildIndex`, emit `task-vault:push:index-updated` to all renderer windows; on any file change: emit `task-vault:push:file-changed-externally` if change source is external (not from writer.ts)
- [ ] T028 [US1] Implement `extensions/task-vault/src/ipc/vault.ipc.ts`: handlers for `task-vault:vault:capture`, `task-vault:vault:get-today`, `task-vault:vault:get-daily`, `task-vault:vault:add-task`, `task-vault:vault:complete-task`, `task-vault:vault:migrate-task`; validate all payloads with Zod schemas from `vault.schema.ts`; return `{ error: 'STALE_ID' }` when task ID no longer valid
- [ ] T029 [US1] Create `extensions/task-vault/src/index.ts` `activate()`: register settings (vault path, capture hotkey, stale threshold, review day/time, ICS config); register all IPC handlers from `vault.ipc.ts`; start watcher; create `.todo/` directory if absent; auto-create `inbox.md` and `daily/` if vault path is set. `deactivate()`: dispose all disposables, close watcher
- [ ] T030 [US1] Implement `extensions/task-vault/src/stores/vault.store.ts`: Zustand store with: `vaultPath`, `todayLog: DailyLog | null`, `inboxCount: number`, `activeView: 'daily' | 'inbox' | 'projects' | 'areas' | 'archive' | 'review'`; actions: `loadToday()`, `setView()`, `refreshInboxCount()`
- [ ] T031 [P] [US1] Implement `extensions/task-vault/src/components/VaultSidebar.tsx`: nav items (Today, Inbox with count badge, Projects, Areas, Archive, Weekly Review); clicking item sets `vault.store.activeView`
- [ ] T032 [US1] Implement `extensions/task-vault/src/components/DailyLog.tsx`: renders `DailyLog` entity (tasks by section, events, notes); complete button on each open task calls `task-vault:vault:complete-task`; migrate button on each open task prompts for target date then calls `task-vault:vault:migrate-task`; shows strikethrough on done tasks; shows `[>]` forward pointer with target date
- [ ] T033 [US1] Implement `extensions/task-vault/src/components/TaskVaultView.tsx`: root layout with `VaultSidebar` on left + main content area routed by `vault.store.activeView`; subscribes to `task-vault:push:index-updated` and `task-vault:push:file-changed-externally` (shows toast for external changes)
- [ ] T034 [US1] Implement `extensions/task-vault/src/renderer.tsx`: call `registry.registerGlobalTab({ id: 'task-vault', label: 'Task Vault', component: TaskVaultView, permanent: true })`; call `registry.registerSidebarPanel('right-sidebar', { id: 'vault-linked', component: LinkedVaultPanel })` (LinkedVaultPanel stubbed for now)

**Checkpoint**: Extension loads → Task Vault tab appears in sidebar → daily log displays → complete/migrate tasks work → index rebuilds on external file edit with toast

---

## Phase 4: User Story 2 — Quick Capture From Anywhere (Priority: P2)

**Goal**: OS-level global hotkey opens floating capture overlay from any app; Enter saves to inbox.md in <300ms; ⌘Enter files to suggested destination.

**Independent Test**: App running in background → press hotkey → overlay appears → type text → Enter → verify text in inbox.md.

### Tests for US2

- [ ] T035 [P] [US2] Write failing unit tests for quick capture in `extensions/task-vault/tests/vault/capture.test.ts`: empty text rejected; whitespace-only text rejected; text with `+project` tag detected; text with `@context` tag detected; text with `#area` tag detected; destination suggestion logic (area match → suggest area file)
- [ ] T036 [P] [US2] Write failing integration tests for `extensions/task-vault/tests/ipc/capture.ipc.test.ts`: `task-vault:vault:capture` with valid text appends to inbox.md; `task-vault:vault:capture` with empty text returns error; IPC validates payload with Zod

### Implementation for US2

- [ ] T037 [US2] Wire capture window to `globalShortcut` handler from T008 in `extensions/task-vault/src/index.ts`: implement `openCaptureOverlay()` — creates/shows a frameless, always-on-top `BrowserWindow` loading the renderer at `?view=capture`; window closes itself after capture or Esc via IPC; `openCaptureOverlay` is passed as the handler to `api.globalShortcut.register` in T038 (T008 prerequisite: globalShortcut API must be wired in api.ts first)
- [ ] T038 [US2] Add capture hotkey registration to `extensions/task-vault/src/index.ts` `activate()`: `api.globalShortcut.register(captureHotkey, () => openCaptureOverlay())`; `openCaptureOverlay()` creates/shows a frameless BrowserWindow loading the renderer with `?view=capture` query
- [ ] T039 [US2] Implement tag suggestion logic in `extensions/task-vault/src/vault/parser.ts` (additive): `suggestDestination(text, index): { tags, destination }` — detect `+project`, `@context`, `#area` in text; match against existing vault files in index
- [ ] T040 [US2] Implement `extensions/task-vault/src/components/QuickCaptureOverlay.tsx`: single text input focused on mount; detects tags inline and shows suggestion badges (non-blocking); Enter → calls `task-vault:vault:capture` and closes; ⌘Enter → calls `task-vault:vault:capture` with suggested destination; Esc → closes; overlay **appears** within 300ms of hotkey press (SC-001)

**Checkpoint**: From any app → hotkey → overlay appears → type text + Enter → inbox.md updated → overlay dismissed

---

## Phase 5: User Story 3 — MCP Tool Surface (Priority: P2)

**Goal**: 8 MCP tools callable by any MCP client (Claude Code, Cursor, Claude Desktop) via stdio. Every vault operation available as a tool call.

**Independent Test**: `node extensions/task-vault/src/mcp/server.js` → MCP client connects → call `capture("test")` → verify inbox.md updated → call `query({status:"open"})` → verify test item returned.

### Tests for US3

- [ ] T041 [P] [US3] Write failing unit tests for `extensions/task-vault/tests/mcp/tools/capture.test.ts`: valid text captured; empty text returns error; hint tags written to file
- [ ] T042 [P] [US3] Write failing unit tests for `extensions/task-vault/tests/mcp/tools/complete-task.test.ts`: valid ID completes task; stale ID returns STALE_ID error; done marker + date written correctly
- [ ] T043 [P] [US3] Write failing unit tests for `extensions/task-vault/tests/mcp/tools/migrate-task.test.ts`: valid migration writes `[>]` + creates target day file; stale ID returns error
- [ ] T044 [P] [US3] Write failing unit tests for `extensions/task-vault/tests/mcp/tools/query.test.ts`: filter by status; filter by context; filter by project; filter by area; filter by due-before; combined filters; empty result
- [ ] T045 [P] [US3] Write failing unit tests for `extensions/task-vault/tests/mcp/tools/list-projects.test.ts`: returns active projects; filters by status; staleness flag correct; next action count correct
- [ ] T046 [P] [US3] Write failing unit tests for `extensions/task-vault/tests/mcp/tools/weekly-review.test.ts`: returns inbox items; returns active projects; returns stale projects; returns last week completed tasks

### Implementation for US3

- [ ] T047 [P] [US3] Implement `extensions/task-vault/src/mcp/tools/capture.ts`: validate input with `mcp.schema.ts`; call `writer.addTask('inbox.md', text, ...tags)`; rebuild index; return new task ID
- [ ] T048 [P] [US3] Implement `extensions/task-vault/src/mcp/tools/today.ts`: read today's daily log via `parser.parseFile`; auto-create if absent; return structured `DailyLog`
- [ ] T049 [P] [US3] Implement `extensions/task-vault/src/mcp/tools/add-task.ts`: validate filePath within vault; call `writer.addTask`; rebuild index; return new ID
- [ ] T050 [P] [US3] Implement `extensions/task-vault/src/mcp/tools/complete-task.ts`: resolve task ID from index; validate staleness; call `writer.completeTask`; rebuild index; return success
- [ ] T051 [P] [US3] Implement `extensions/task-vault/src/mcp/tools/migrate-task.ts`: resolve task; call `writer.migrateTask`; rebuild index; return new task ID in target file
- [ ] T052 [P] [US3] Implement `extensions/task-vault/src/mcp/tools/query.ts`: load index; apply filters (status, context, project, area, dueBefore, filePattern); return matching `IndexedTask[]`
- [ ] T053 [P] [US3] Implement `extensions/task-vault/src/mcp/tools/list-projects.ts`: load index; filter by status; apply staleness calculation; return `IndexedProject[]`
- [ ] T054 [P] [US3] Implement `extensions/task-vault/src/mcp/tools/weekly-review.ts`: assemble full review payload — inbox items, active/stale/someday projects, prior week completed tasks, last review date from daily log
- [ ] T055 [US3] Implement `extensions/task-vault/src/mcp/server.ts`: create MCP stdio server using `@modelcontextprotocol/sdk`; register all 8 tools; read `TASK_VAULT_PATH` from env; handle `SIGINT`/`SIGTERM` for clean shutdown; export entry point runnable via `node server.js`
- [ ] T056 [US3] Document MCP server invocation in `extensions/task-vault/README.md`: path to `server.js`, env vars (`TASK_VAULT_PATH`), example Claude Code / Cursor config snippets; reference `quickstart.md`

### FR-025: Per-Tool MCP Auto-Execute Toggle

- [ ] T107 [P] [US3] Write failing unit tests for `extensions/task-vault/tests/mcp/tools/auto-execute.test.ts`: toggle=off for a tool returns suggestion object without writing vault file; toggle=on writes immediately; payload with `confirmed: true` bypasses toggle regardless of setting; all 5 write tools (`capture`, `add_task`, `complete_task`, `migrate_task`, `process_inbox_item`) respect toggle; defaults all false
- [ ] T108 [P] [US3] Create `extensions/task-vault/src/mcp/auto-execute.ts`: export `getAutoExecuteSetting(toolName: string, vaultPath: string): Promise<boolean>` (reads from electron-store settings); export `makeSuggestion(toolName: string, description: string): MCPToolResult` — returns structured text describing the proposed action without executing it; gate is bypassed when `input.confirmed === true`
- [ ] T109 [US3] Wrap all 5 write-capable MCP tools with auto-execute gate (depends T107, T108): in `capture.ts`, `add-task.ts`, `complete-task.ts`, `migrate-task.ts` — check `getAutoExecuteSetting(toolName, TASK_VAULT_PATH)` before file write; if false and `confirmed !== true`, return `makeSuggestion(...)` with proposed action description; if true (setting or confirmed flag), execute and return result as normal
- [ ] T110 [US3] Add per-tool auto-execute toggle settings registration in `extensions/task-vault/src/index.ts` `activate()`: register `mcpAutoExecute.capture`, `mcpAutoExecute.add_task`, `mcpAutoExecute.complete_task`, `mcpAutoExecute.migrate_task`, `mcpAutoExecute.process_inbox_item` each as boolean settings defaulting to `false`; add `mcpAutoExecute` object to settings Zod schema in `extensions/task-vault/src/schemas/vault.schema.ts`

**Checkpoint**: `node .../server.js` starts; MCP client connects; all 8 tools respond correctly; stale IDs return proper errors; write tools with toggle=off return suggestion without writing; toggle=on writes immediately

---

## Phase 6: User Story 4 — Projects Browser With Stale Detection (Priority: P3)

**Goal**: Projects browser lists all active projects; stale projects (no next action OR N-day inactivity) flagged red; three resolution actions available.

**Independent Test**: Create project with no "Next action" tasks → open browser → project shows stale badge → click "Move to Someday" → project's frontmatter status changes to `someday` → project disappears from active list.

### Tests for US4

- [ ] T057 [P] [US4] Write failing unit tests for `extensions/task-vault/tests/vault/stale.test.ts`: project with no next actions is stale; project with open next action is not stale; project not modified in >N days is stale regardless of next actions; threshold is configurable; mtime read from filesystem
- [ ] T058 [P] [US4] Write failing unit tests for `extensions/task-vault/tests/ipc/projects.ipc.test.ts`: `task-vault:projects:list` returns only active projects by default; filter by status; staleness flag matches stale.ts output; `task-vault:vault:update-project-status` writes correct frontmatter

### Implementation for US4

- [ ] T059 [US4] Implement `extensions/task-vault/src/vault/stale.ts`: `isProjectStale(project: Project, thresholdDays: number): boolean` — returns true if `project.nextActions.length === 0` OR `(Date.now() - project.lastModified.getTime()) > thresholdDays * 86400000`
- [ ] T060 [US4] Implement `extensions/task-vault/src/ipc/projects.ipc.ts`: handlers for `task-vault:projects:list` and `task-vault:vault:update-project-status`; `list` reads index and applies staleness via `stale.ts`; `update-project-status` rewrites project frontmatter field atomically via `writer.ts`
- [ ] T061 [US4] Register `projects.ipc.ts` handlers in `extensions/task-vault/src/index.ts` `activate()`
- [ ] T062 [US4] Implement `extensions/task-vault/src/components/ProjectsBrowser.tsx`: list of project cards; each card shows name, deadline, area, open/done task counts, next action text; stale cards have red border + `no next action` or `inactive N days` badge; three action buttons on stale cards: "Add next action" (opens project file at Next action section), "Move to Someday" (calls `update-project-status`), "Archive" (calls `update-project-status` + moves file to archive/)

**Checkpoint**: Projects browser renders; stale detection correct; all three resolution actions update the project file and refresh the browser

---

## Phase 7: User Story 5 — Inbox Processing (Priority: P3)

**Goal**: Sequential GTD clarify flow for each inbox item; agent suggests destination; item removed from inbox and filed to destination on confirmation.

**Independent Test**: Add 3 items to inbox.md → open inbox processing → complete clarify flow for one item → item gone from inbox.md → item appears in destination file.

### Tests for US5

- [ ] T063 [P] [US5] Write failing unit tests for `extensions/task-vault/tests/ipc/inbox.ipc.test.ts`: `task-vault:vault:process-inbox-item` with `action:'file'` removes from inbox and appends to destination; `action:'trash'` removes from inbox only; `action:'do-now'` marks with in-progress marker; `action:'someday'` files to someday list; stale ID returns error
- [ ] T064 [P] [US5] Write failing component tests for `extensions/task-vault/tests/components/InboxProcessor.test.tsx`: renders first inbox item; Q1 (actionable?) buttons visible; selecting "No, trash" removes item without further questions; selecting "Yes" shows Q2 (2-minute rule); selecting "Do now" marks item; selecting "No, file" shows Q3 (destination); agent suggestion highlighted; filing removes item from list

### Implementation for US5

- [ ] T065 [US5] Add `task-vault:vault:process-inbox-item` handler to `extensions/task-vault/src/ipc/vault.ipc.ts`: validate payload; call appropriate writer operations; rebuild index after each action
- [ ] T066 [US5] Implement `extensions/task-vault/src/components/InboxProcessor.tsx`: renders inbox items one at a time; GTD clarify flow in order — Q1: actionable? (Yes / No reference / No trash / Incubate) → Q2: less than 2 min? (Do now / No file) → Q3: destination picker (existing project, new project, area, Someday, with agent suggestion highlighted); calls `task-vault:vault:process-inbox-item` on confirm; advances to next item; shows progress (N of M)

**Checkpoint**: InboxProcessor renders; full clarify flow works; items correctly filed or trashed; inbox.md updated after each action

---

## Phase 8: User Story 7 — Link Vault Items to Terminator Projects/Workspaces (Priority: P3)

**Goal**: Vault tasks/projects linkable to Terminator workspaces/projects via inline syntax OR UI picker; linked items show in Terminator project sidebar panel; links survive renames (UUID stored).

**Independent Test**: Link a vault task to a Terminator project → open that project in Terminator → vault task appears in sidebar panel → click task reference → vault extension opens and scrolls to task.

### Tests for US7

- [ ] T067 [P] [US7] Write failing unit tests for `extensions/task-vault/tests/ipc/links.ipc.test.ts`: `task-vault:links:create` writes UUID to task metadata; `task-vault:links:remove` removes UUID from task metadata; `task-vault:links:get-for-terminator-target` returns all tasks linked to a UUID; broken link (workspace deleted) included with `isBroken: true`
- [ ] T068 [P] [US7] Write failing unit tests for inline link syntax parsing in `extensions/task-vault/tests/vault/parser.test.ts` (additive): `terminator:<uuid>` in task text parsed into `terminatorLinks[]`; multiple UUIDs parsed; non-UUID terminator: references return error gracefully
- [ ] T069 [P] [US7] Write failing component tests for `extensions/task-vault/tests/components/LinkedVaultPanel.test.tsx`: renders task list for linked target UUID; shows open/done/migrated status; clicking task navigates vault to that item; broken link shows badge; empty state when no links

### Implementation for US7

- [ ] T070 [US7] Implement `workspace` namespace in `src/main/extensions/api.ts` (T009 prerequisite): `workspace.list()` reads from `useWorkspaceStore.getState().workspaces`; `workspace.listProjects(id)` reads from `projectsByWorkspaceId`; `onDelete` subscribes to store; `onProjectDelete` subscribes to store
- [ ] T071 [US7] Add `terminator:<uuid>` parsing to `extensions/task-vault/src/vault/parser.ts`: extract UUIDs from task text matching `terminator:[0-9a-f-]{36}`; store in `task.terminatorLinks[]`; write UUIDs back as `terminator:<uuid>` in task text on link creation
- [ ] T072 [US7] Implement `extensions/task-vault/src/ipc/links.ipc.ts`: handlers for `task-vault:links:create`, `task-vault:links:remove`, `task-vault:links:get-for-terminator-target`; `create` calls `writer.ts` to append UUID to task text or project frontmatter; `get-for-terminator-target` scans index for matching UUIDs; flag broken links using `api.workspace.list()` to check UUID existence
- [x] T073 [US7] Register links IPC handlers and `api.workspace.onDelete` / `api.workspace.onProjectDelete` callbacks in `extensions/task-vault/src/index.ts`; on delete: mark linked tasks with broken-link flag in index (does not modify vault files)
- [x] T074 [US7] Implement `extensions/task-vault/src/components/LinkPicker.tsx`: fetches workspaces and projects via `api.workspace.list()` / `api.workspace.listProjects()`; search-filtered list; selecting item calls `task-vault:links:create`; shows UUID stored, display name resolved from API
- [x] T075 [US7] Implement `extensions/task-vault/src/components/LinkedVaultPanel.tsx`: sidebar panel shown in Terminator project/workspace context; calls `task-vault:links:get-for-terminator-target` with current Terminator project/workspace UUID (received as prop via `repoRoot` or a new extension event); renders task list with status badges; clicking task sends IPC to focus vault extension on that task; broken links show warning badge
- [x] T076 [US7] Add "Link to Terminator…" context menu item to vault task rows in `DailyLog.tsx` and `ProjectsBrowser.tsx`: opens `LinkPicker` modal; also parse `terminator:<uuid>` inline syntax in parser and render as navigable link chip in task text
- [x] T077 [US7] Wire `LinkedVaultPanel` registration in `extensions/task-vault/src/renderer.tsx`; ensure it receives the Terminator project/workspace UUID from registry context

**Checkpoint**: Link picker shows workspace/project list → select → UUID written to vault file → LinkedVaultPanel in Terminator project shows linked tasks → rename workspace → links still resolve → delete workspace → broken-link badge appears

---

## Phase 9: User Story 6 — Weekly Review Wizard (Priority: P4)

**Goal**: 6-step guided weekly review; agent pre-loads each step with vault state; ICS calendar events shown from background-polled feed; non-blocking nudge reminder on configured day.

**Independent Test**: Launch weekly review → Step 3 lists all active projects automatically → archive a stale project → it disappears → complete all 6 steps → completion record in today's daily log.

### Tests for US6

- [x] T078 [P] [US6] Write failing unit tests for `extensions/task-vault/tests/ics/parser.test.ts`: parse VCALENDAR string into `CalendarEvent[]`; all-day event detected; recurring events expanded for 14-day window; empty feed returns []; malformed feed returns [] without throwing
- [x] T079 [P] [US6] Write failing unit tests for `extensions/task-vault/tests/ics/fetcher.test.ts`: HTTP URL fetch returns events; local file path reads events; failed HTTP fetch returns cached events with `fetchError`; no cache + failed fetch returns empty with `isFeedConfigured: false`; cache written to `.todo/ics-cache.json`
- [x] T080 [P] [US6] Write failing unit tests for `extensions/task-vault/tests/ipc/projects.ipc.test.ts` (additive): `task-vault:projects:weekly-review` returns inbox items; returns active and stale projects; returns someday projects; returns prior week completed tasks; returns null lastReviewDate when no review recorded
- [x] T081 [P] [US6] Write failing component tests for `extensions/task-vault/tests/components/WeeklyReview.test.tsx`: renders 6-step stepper; step 3 shows all active projects; archiving stale project removes it from list; completing all steps writes completion to daily log; nudge fires at configured day/time

### Implementation for US6 — ICS

- [x] T082 [P] [US6] Implement `extensions/task-vault/src/ics/parser.ts`: pure function `parseIcs(icsString: string, windowStart: Date, windowEnd: Date): CalendarEvent[]`; use `node-ical` to parse; expand recurring events within window; handle timezone offsets
- [x] T083 [P] [US6] Implement `extensions/task-vault/src/ics/fetcher.ts`: `fetchFeed(url: string, cachePath: string): Promise<IcsFeedCache>`; HTTP URL → `fetch()`; local file path → `fs.promises.readFile`; on success: write cache; on failure: read cache + set `fetchError`; export `startPolling(feedUrls, cachePath, intervalMs)` using `setInterval`; `stopPolling()` clears interval
- [x] T084 [US6] Implement `extensions/task-vault/src/ipc/ics.ipc.ts`: handler for `task-vault:ics:get-events`; reads `ics-cache.json`; returns events for ±7 day window; sets `isStale` if cache age > 2× interval; sets `isFeedConfigured` based on settings
- [x] T085 [US6] Wire ICS polling into `extensions/task-vault/src/index.ts` `activate()`: read feed URLs and interval from settings; call `fetcher.startPolling()`; `deactivate()` calls `fetcher.stopPolling()`

### Implementation for US6 — Weekly Review IPC and Nudge

- [x] T086 [US6] Add `task-vault:projects:weekly-review` handler to `extensions/task-vault/src/ipc/projects.ipc.ts`: assemble full payload — inbox items, active projects (with staleness), stale projects, someday projects, prior 7-day completed tasks (scan daily/ files), last review date (scan daily/ notes for review completion marker)
- [x] T087 [US6] Add weekly review nudge to `extensions/task-vault/src/index.ts`: on `activate()`, check if today is the configured review day and no review completed in last 7 days; if so, call `api.notifications.showToast('info', 'Weekly review is ready — ⌘R to start')` and schedule re-check daily via `setInterval(24h)`

### Implementation for US6 — Wizard Components

- [x] T088 [P] [US6] Implement `extensions/task-vault/src/components/WeeklyReviewStep1GetClear.tsx`: shows loose inbox items not yet captured; "File to inbox" button for each; marks step complete when all items addressed
- [x] T089 [P] [US6] Implement `extensions/task-vault/src/components/WeeklyReviewStep2Inbox.tsx`: renders `InboxProcessor` in review context; step complete when inbox is empty or user explicitly skips
- [x] T090 [US6] Implement `extensions/task-vault/src/components/WeeklyReviewStep3Projects.tsx`: lists all active projects from weekly-review payload; each non-stale project shows Keep/Edit buttons; each stale project shows Add next action/Someday/Archive buttons; calls `update-project-status` IPC for actions; list updates on each action
- [x] T091 [P] [US6] Implement `extensions/task-vault/src/components/WeeklyReviewStep4Calendar.tsx`: calls `task-vault:ics:get-events`; shows events grouped by day for last 7 and next 7 days; shows last-refreshed timestamp; shows staleness warning if `isStale`; shows "Add ICS feed" prompt if `isFeedConfigured: false`
- [x] T092 [P] [US6] Implement `extensions/task-vault/src/components/WeeklyReviewStep5Someday.tsx`: lists someday projects from payload; each has "Promote to active" and "Archive" buttons; calls `update-project-status` IPC
- [x] T093 [P] [US6] Implement `extensions/task-vault/src/components/WeeklyReviewStep6Reflect.tsx`: three free-form text areas (what worked, what didn't, what to try); "Finish review" button writes completion record to today's daily log via `task-vault:vault:add-task`
- [x] T094 [US6] Implement `extensions/task-vault/src/components/WeeklyReview.tsx`: 6-step wizard shell with step indicator; renders step components; keyboard nav (⌘← / ⌘→); Save draft (persists progress to `.todo/review-draft.json`); wraps `TaskVaultView` router entry for `activeView === 'review'`
- [x] T095 [US6] Wire weekly review keyboard shortcut: register `CmdOrCtrl+R` in `index.ts` (using `api.keyboard.register`) to set `vault.store.activeView` to `'review'`

**Checkpoint**: Weekly review wizard opens → all 6 steps load with pre-populated data → ICS events visible → archive stale project → completion record written to daily log → nudge appears on configured day

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, ADR finalization, lint, coverage gate.

- [x] T096 Update `README.md`: add Task Vault to features list; add `@modelcontextprotocol/sdk`, `chokidar`, `gray-matter`, `node-ical` to tech stack table with community health links; add MCP setup to scripts table
- [x] T097 [P] Update `docs/ARCHITECTURE.md`: document task-vault extension architecture; document Extension API v1.2.0 additions; document MCP sidecar pattern
- [x] T098 [P] Update `specs/001-extension-first-terminal/contracts/extension-api.md`: append v1.2.0 section from `specs/005-task-vault-extension/contracts/extension-api-v1.2.0.md`
- [x] T099 [P] Update `specs/001-extension-first-terminal/contracts/ipc-channels.md`: append all `task-vault:` channels from `specs/005-task-vault-extension/contracts/ipc-channels.md`
- [x] T100 [P] Update `docs/EXTENSION-DEVELOPMENT.md`: document `registerGlobalTab`, `globalShortcut`, `workspace` API additions with usage examples
- [x] T101 [P] Update `specs/001-extension-first-terminal/quickstart.md` and `docs/CONTRIBUTING.md`: add MCP server setup step; add task-vault extension build step
- [x] T102 Verify ADRs 005, 006, 007 are complete and in `docs/adr/`
- [x] T103 Run `npm run lint` — fix all errors to 0
- [x] T104 Run `npx vitest run --coverage` — verify all coverage thresholds ≥ 80% for every new file; fix any file at 0% (hard blocker per constitution)
- [x] T105 Run `npm run build:extensions` — verify task-vault compiles cleanly with no TypeScript errors
- [x] T106 Manual smoke test per `quickstart.md`: configure vault path → open daily log → quick capture → MCP server connects → weekly review wizard completes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — blocks ALL user stories
- **US1 Daily Log (Phase 3)**: Depends on Foundational — vault core; blocks US2, US3, US4, US5, US6, US7 (all need parser/writer/indexer)
- **US2 Quick Capture (Phase 4)**: Depends on US1 (parser, writer, capture IPC)
- **US3 MCP (Phase 5)**: Depends on US1 (parser, writer, indexer); can run in parallel with US2
- **US4 Projects Browser (Phase 6)**: Depends on US1 (indexer, projects IPC); can run in parallel with US2/US3
- **US5 Inbox Processing (Phase 7)**: Depends on US1 (process-inbox IPC, InboxProcessor); can run in parallel with US2/US3/US4
- **US7 Linking (Phase 8)**: Depends on US1 (parser, writer) and Foundational (workspace API); can run in parallel with US2–US5
- **US6 Weekly Review (Phase 9)**: Depends on US1, US4, US5 (uses Projects Browser + InboxProcessor inside wizard)
- **Polish (Phase 10)**: Depends on all stories complete

### User Story Dependencies

| Story    | Depends On                         | Can Parallelize With |
| -------- | ---------------------------------- | -------------------- |
| US1 (P1) | Foundational                       | —                    |
| US2 (P2) | US1                                | US3, US4, US5, US7   |
| US3 (P2) | US1                                | US2, US4, US5, US7   |
| US4 (P3) | US1                                | US2, US3, US5, US7   |
| US5 (P3) | US1                                | US2, US3, US4, US7   |
| US7 (P3) | US1 + Foundational (workspace API) | US2, US3, US4, US5   |
| US6 (P4) | US1, US4, US5                      | —                    |

### Within Each Story

1. Tests MUST be written and FAIL before implementation (TDD)
2. Types/schemas before implementation
3. Pure vault functions (parser, writer) before IPC handlers
4. IPC handlers before React components
5. Components before renderer registration

---

## Parallel Opportunities

### After Foundational (Phase 2) — launch all together

```
Task: "Implement vault/parser.ts (T024)"
Task: "Implement vault/types.ts (T016)"  [already done in foundational]
Task: "Write parser tests (T020)"
Task: "Write writer tests (T021)"
Task: "Write indexer tests (T022)"
```

### After US1 — MCP tools can all run in parallel (Phase 5)

```
Task: "capture tool (T047)"
Task: "today tool (T048)"
Task: "add-task tool (T049)"
Task: "complete-task tool (T050)"
Task: "migrate-task tool (T051)"
Task: "query tool (T052)"
Task: "list-projects tool (T053)"
Task: "weekly-review tool (T054)"
```

### Phase 9 wizard step components — all parallel after IPC is done

```
Task: "WeeklyReviewStep1GetClear.tsx (T088)"
Task: "WeeklyReviewStep2Inbox.tsx (T089)"
Task: "WeeklyReviewStep4Calendar.tsx (T091)"
Task: "WeeklyReviewStep5Someday.tsx (T092)"
Task: "WeeklyReviewStep6Reflect.tsx (T093)"
```

---

## Implementation Strategy

### MVP First (US1 Only — Daily Log)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (Extension API v1.2.0 + types + schemas)
3. Complete Phase 3: US1 — Daily log renders, complete/migrate work, index rebuilds
4. **STOP AND VALIDATE**: Open extension → daily log shows → complete/migrate tasks → external edit shows toast
5. Ship as internal MVP

### Incremental Delivery

1. Setup + Foundational → Extension API ready, types defined
2. US1 → Daily log MVP (core daily workflow)
3. US2 + US3 (parallel) → Quick capture + MCP tools (agent-native)
4. US4 + US5 + US7 (parallel) → Projects browser + inbox + linking
5. US6 → Weekly review wizard (agent-assisted)
6. Polish → Docs, coverage, lint

### Parallel Team Strategy

After Phase 2:

- Developer A: US1 (Daily log — blocking path)
- Developer B: US3 (MCP tools — can prototype against vault files directly)
- Developer C: US2 (Quick capture — needs globalShortcut API from foundational)
- After US1 lands: US4, US5, US7 can all start independently

---

## Notes

- `[P]` = different files, no unresolved deps — safe to run in parallel
- Task IDs are stable for this task list; map 1:1 to commit checkpoints
- Every test file MUST exist and FAIL before the production file it tests
- Run `npx vitest run --coverage` after each phase, not just at the end
- External file changes must trigger toast (FR-026) — test this manually in US1 checkpoint
- Archive directory intentionally excluded from VaultIndex for performance
- MCP server `TASK_VAULT_PATH` must be validated at startup; exit with error if not set or path non-existent
