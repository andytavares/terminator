# Tasks: Webview-Isolated Extension System

**Input**: Design documents from `specs/013-webview-extension-system/`
**Branch**: `eextension`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

**Organization**: Grouped by user story. Each phase is independently testable.
**TDD**: Write failing tests before implementation. Run `npm run lint && npx vitest run --coverage` after each phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: User story — US1–US5 from spec.md
- Exact file paths in every description

---

## Phase 1: Setup (Shared Build Infrastructure)

**Purpose**: Build system wiring. Must complete before any other work.

- [x] T001 Add `webview` preload entry to `electron.vite.config.ts` (`preload.build.rollupOptions.input.webview`)
- [x] T002a Write spec `src/main/preload-webview.spec.ts` — verify it exposes the same top-level namespace keys as `preload.ts` (terminal, workspace, project, git, settings, dialog, extension, keyboard, shell, fs, extensionEvents, app, extensionBridge, notification, notifications, db, metrics, logger); assert `contextBridge.exposeInMainWorld` is called with `'electronAPI'`
- [x] T002 Create `src/main/preload-webview.ts` — identical `window.electronAPI` surface to `src/main/preload.ts`, compiled to `dist-electron/preload/webview.js`

**Checkpoint**: `npm run build` succeeds. Two preload files in `dist-electron/preload/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, schema, and the `ExtensionViewHost` that ALL user stories require. No user story work begins until this phase is complete.

**⚠️ CRITICAL**: US1, US2, US3, US5 are all blocked until this phase is done.

- [x] T003 Write spec `src/shared/schemas/extension.spec.ts` — add tests for `ExtensionContributesSchema` (valid/invalid contributes, optional fields, unknown keys silently ignored)
- [x] T004 Add `ExtensionContributesSchema` and `contributes` field to `src/shared/schemas/extension.schema.ts` — schema for globalTab, workspaceTab, projectTab, sidebarPanel, windowViews, commands
- [x] T005 [P] Add `ExtensionContributes` interface and `contributes?: ExtensionContributes` to `Extension` in `src/shared/types/index.ts`
- [x] T005b Write spec `src/renderer/extensions/icon-from-name.spec.ts` — test each curated name maps to the correct lucide component, unknown names return `Puzzle`, case sensitivity
- [x] T005c [P] Create `src/renderer/extensions/icon-from-name.ts` — `iconFromName(name: string): ReactNode` maps curated icon name strings to lucide-react elements; add `wifi` → `Wifi` and `check` → `Check` to the curated set; fallback to `Puzzle`; update data-model.md curated list with wifi and check
- [x] T006 Write spec `src/main/extensions/extension-view-host.spec.ts` — mock `BrowserWindow`+`WebContentsView`, test `createView`, `destroyView`, `reloadView`, `handleBoundsUpdate` (setVisible/setBounds calls), `broadcastToAll`, `broadcastToExtension`
- [x] T007 Create `src/main/extensions/extension-view-host.ts` — `ExtensionViewHost` class managing `Map<string, WebContentsView[]>` (keyed by extensionId); methods: `createView(ext, viewParam)`, `destroyAllViews(id)`, `reloadAllViews(id)`, `handleBoundsUpdate(id, viewParam, bounds, visible, dpr)`, `broadcastToAll(channel, data)`, `broadcastToExtension(id, channel, data)`
- [x] T007b [P] Add `workspace:get-active` ipcMain handler to `src/main/ipc/workspace.ipc.ts` — returns `{ workspaceId: string | null, projectId: string | null, repoRoot: string | null }`; update `workspace.ipc.spec.ts`
- [x] T008 [P] Update `src/main/extensions/extension-host.ts` — parse `contributes` from manifest in `load()`, store on `ExtensionRecord`, return in `listExtensions()`; update existing `extension-host.spec.ts`

**Checkpoint**: `npm run lint && npx vitest run --coverage` — all pass, ≥ 80% on new files.

---

## Phase 3: US1 + US2 + US5 — Install From Any Location, Manifest Contributions, Reload Without Rebuild (Priority: P1)

**Goal**: Core app wired to load extensions as `WebContentsView` instances from manifest declarations. Any extension on any filesystem path can be installed and its UI surfaces appear without a core rebuild. Reload picks up fresh files within 5s.

**Independent Test**: Build a minimal extension (manifest + `dist/index.html` + `dist/main.cjs`) in `/tmp/test-ext-minimal`. Install via Settings → Extensions. Verify a tab appears. Click Reload after editing the HTML file. Tab content updates.

- [x] T009 Write spec `src/renderer/components/ExtensionPanelPortal.spec.tsx` — test `ResizeObserver` callback fires `extension:update-panel-bounds` IPC, `onExtensionPanelLoaded` dismisses spinner, `isActive=false` sends `visible: false`
- [x] T010 Create `src/renderer/components/ExtensionPanelPortal.tsx` — placeholder `<div>` with `ResizeObserver` reporting bounds to main via `window.electronAPI`; `loading` state dismissed by `onExtensionPanelLoaded`; renders spinner overlay while loading
- [x] T011 [P] Update `src/main/index.ts` — init `ExtensionViewHost` after window creation; add `ipcMain.handle('extension:update-panel-bounds')` → `viewHost.handleBoundsUpdate()`; add `ipcMain.on('workspace:active-changed')` → `viewHost.broadcastToAll('workspace:changed', data)`; pass `viewHost.broadcastToAll` to `registerExtensionHandlers`
- [x] T012 [P] Update `src/main/ipc/extension.ipc.ts` — accept `broadcast` param; after successful `extension:reload` call `broadcast('extension:renderer-reload', { id })` and `viewHost.reloadView(id)`; update existing `extension.ipc.spec.ts`
- [x] T013 Update `src/main/preload.ts` — add `extensionEvents.onExtensionPanelLoaded(handler: (id: string) => void): () => void` and `extensionEvents.onExtensionRendererReload(handler: (id: string) => void): () => void`; update preload spec
- [x] T014 [P] Update `src/renderer/electron.d.ts` — add type signatures for `extensionEvents.onExtensionPanelLoaded` and `extensionEvents.onExtensionRendererReload`
- [x] T015 Update `ext://` protocol handler in `src/main/index.ts` — add `'Cache-Control': 'no-store'` and `'Pragma': 'no-cache'` headers to every `ext://` response via `new Response(body, { headers: { ... } })`
- [x] T016 Write spec additions for `src/renderer/extensions/loader.spec.ts` — cover manifest-driven `ExtensionPanelPortal` registration for globalTab, workspaceTab, projectTab, sidebarPanel, windowViews; verify old `dynamicLoader` path is gone
- [x] T017 Rewrite `src/renderer/extensions/loader.ts` — remove `dynamicLoader` and `window.__terminatorRegistry` global; add `registerWebviewExtension(ext)` that reads `ext.contributes` and calls `registry.*` with `<ExtensionPanelPortal>` components; keep `import.meta.glob` path for un-migrated extensions (no `contributes` field); add `workspace:active-changed` send on workspace/project change

**Checkpoint**: Minimal extension from `/tmp` installs and shows tab. Reload updates content. Litmus test passes. `npm run lint && npx vitest run --coverage` — all thresholds ≥ 80%.

---

## Phase 4: US3 — Existing Extensions Work From Any Location (Priority: P1)

**Goal**: All 5 bundled extensions migrated to the webview model. Each passes the litmus test: move to `/tmp`, install, verify full functionality, reload after edit.

**Independent Test (per extension)**: Copy to `/tmp/test-ext-NAME`, remove from `extensions/`, verify app starts clean, install from `/tmp`, all features work, reload works.

### Extension: notepad

- [x] T018 Write renderer spec `extensions/notepad/src/renderer/App.spec.tsx` — test `?view=main` renders NotepadView, overlay command is wired via `extensionBridge.on('ext:command:notepad:quick-create')`
- [x] T019 Update `extensions/notepad/manifest.json` — add `"renderer": "dist/index.html"` and `"contributes": { "globalTab": { "label": "Notes", "icon": "file", "view": "main" }, "windowViews": [...], "commands": [{ "id": "notepad:quick-create", "shortcut": "CmdOrCtrl+Shift+N" }] }`
- [x] T020 Create `extensions/notepad/src/renderer/App.tsx` — reads `?view=` param, routes to `<NotepadView>`, `<NoteWindowView>`, or `<DiagramWindowView>`; QuickCreate modal triggered by `extensionBridge.on('ext:command:notepad:quick-create')`
- [x] T021 Create `extensions/notepad/src/renderer/main.tsx` and `extensions/notepad/index.html` — Vite entry point
- [x] T022 Add `build:renderer` script to `extensions/notepad/package.json`; verify `npm run build:renderer` produces `dist/index.html`
- [x] T023 Delete `extensions/notepad/src/renderer.tsx` (old bundled renderer — blocked until T022 verified)

### Extension: git-integration

- [x] T024 [P] Write renderer spec `extensions/git-integration/src/renderer/App.spec.tsx` — test view routing for sidebar/project/code-reviews/pr-review; test repoRoot from URL params
- [x] T025 [P] Update `extensions/git-integration/manifest.json` — add `"renderer": "dist/index.html"` and `"contributes": { "sidebarPanel": { "label": "Git Changes", "view": "sidebar" }, "projectTab": { "label": "Git", "view": "project" }, "workspaceTab": { "label": "Code Reviews", "icon": "git-pull-request", "view": "code-reviews" }, "windowViews": [{ "id": "pr-review", "view": "pr-review" }], "commands": [{ "id": "git:toggle-panel", "shortcut": "CmdOrCtrl+Shift+G" }] }`
- [x] T026 [P] Create `extensions/git-integration/src/renderer/App.tsx` — reads `?view=` and `?repoRoot=` params; routes to GitChangesPanel / GitProjectTab / CodeReviewsTab / PRReviewView; uses `window.electronAPI.extensionBridge.on('workspace:changed')` to update repoRoot
- [x] T027 Create `extensions/git-integration/src/renderer/main.tsx` and `extensions/git-integration/index.html`
- [x] T028 Add `build:renderer` to `extensions/git-integration/package.json`; verify build
- [x] T029 Delete `extensions/git-integration/src/renderer.tsx`

### Extension: remote-control

- [x] T030 [P] Write renderer spec `extensions/remote-control/src/renderer/App.spec.tsx` — test `RemoteControlSettings` renders, icon updates on `remote:status` event
- [x] T031 [P] Update `extensions/remote-control/manifest.json` — add `"renderer": "dist/index.html"` and `"contributes": { "globalTab": { "label": "Remote Control", "icon": "globe", "view": "main" } }`
- [x] T032 [P] Create `extensions/remote-control/src/renderer/App.tsx` — renders `<RemoteControlSettings>`; listens to `window.electronAPI.extensionBridge.on('remote:status')` and updates icon display state internally
- [x] T033 Create `extensions/remote-control/src/renderer/main.tsx` and `extensions/remote-control/index.html`
- [x] T034 Add `build:renderer` to `extensions/remote-control/package.json`; verify build
- [x] T035 Delete `extensions/remote-control/src/renderer.tsx`

### Extension: speckit-pilot

- [x] T036 [P] Write renderer spec `extensions/speckit-pilot/src/renderer/App.spec.tsx` — test SpecKitPilotView renders
- [x] T037 [P] Update `extensions/speckit-pilot/manifest.json` — add `"renderer": "dist/index.html"` and `"contributes": { "projectTab": { "label": "SpecKit", "view": "main" } }`
- [x] T038 [P] Create `extensions/speckit-pilot/src/renderer/App.tsx` — renders `<SpecKitPilotView>`
- [x] T039 Create `extensions/speckit-pilot/src/renderer/main.tsx` and `extensions/speckit-pilot/index.html`
- [x] T040 Add `build:renderer` to `extensions/speckit-pilot/package.json`; verify build
- [x] T041 Delete `extensions/speckit-pilot/src/renderer.tsx`

### Extension: task-vault

- [x] T042 [P] Write renderer spec `extensions/task-vault/src/renderer/App.spec.tsx` — test globalTab view renders, sidebar panel view renders, CaptureModal opens on `ext:command:task-vault:capture-to-inbox`, badge updates on `task-vault:push:index-updated`
- [x] T043 [P] Update `extensions/task-vault/manifest.json` — add `"renderer": "dist/index.html"` and `"contributes": { "globalTab": { "label": "Task Vault", "icon": "zap", "view": "main" }, "sidebarPanel": { "label": "Vault Calendar", "defaultOpen": false, "view": "calendar" }, "commands": [{ "id": "task-vault:capture-to-inbox", "label": "Capture to Inbox", "shortcut": "CmdOrCtrl+Shift+I" }] }`
- [x] T044 [P] Create `extensions/task-vault/src/renderer/App.tsx` — routes `?view=main` to `<TaskVaultView>`, `?view=calendar` to `<CalendarDrawer>`; CaptureModal shown internally on `ext:command:task-vault:capture-to-inbox`; badge count updated by listening to `task-vault:push:index-updated` and calling `extensionBridge.invoke('task-vault:vault:get-inbox')` then using `extensionBridge.emit` to propagate badge
- [x] T045 Create `extensions/task-vault/src/renderer/main.tsx` and `extensions/task-vault/index.html`
- [x] T046 Add `build:renderer` to `extensions/task-vault/package.json`; verify build
- [x] T047 Delete `extensions/task-vault/src/renderer.tsx`

### Cleanup: remove legacy bundled renderer glob

- [x] T048 Remove `import.meta.glob` bundled path from `src/renderer/extensions/loader.ts` once all 5 extensions are verified migrated (T023, T029, T035, T041, T047 all complete)

**Checkpoint**: All 5 extensions pass litmus test independently. `npm run build:extensions` succeeds. `npm run lint && npx vitest run --coverage` — all thresholds ≥ 80%.

---

## Phase 5: US4 — Type-Safe Extension SDK (Priority: P2)

**Goal**: `packages/extension-sdk/` provides TypeScript types for the full extension API surface so third-party developers get autocomplete and compile-time safety.

**Independent Test**: Create a new TypeScript project outside the repo that only imports from `@terminator/extension-sdk`. Verify it compiles without errors when using any documented API method.

- [x] T049 Create `packages/extension-sdk/package.json` — `name: "@terminator/extension-sdk"`, `version: "1.0.0"`, `types: "types/index.d.ts"`, no runtime dependencies
- [x] T050 [P] Create `packages/extension-sdk/types/api.d.ts` — export `ExtensionAPI` interface copied from `src/main/extensions/api.ts` (main-process side)
- [x] T051 [P] Create `packages/extension-sdk/types/renderer.d.ts` — export `ElectronAPI` interface copied from `src/renderer/electron.d.ts` (webview renderer side, `window.electronAPI`)
- [x] T052 [P] Create `packages/extension-sdk/types/index.d.ts` — re-export `ExtensionAPI`, `ElectronAPI`; export `ICON_NAMES` constant (string union of all 20 curated icon names from data-model.md)
- [x] T053 Create `packages/extension-sdk/README.md` — getting started, build setup, manifest reference, link to `quickstart.md`
- [x] T054 Verify SDK compiles: run `npx tsc --noEmit` from `packages/extension-sdk/` with a minimal `tsconfig.json`

**Checkpoint**: An external TypeScript file that writes `activate(api: ExtensionAPI)` and calls `api.workspace.list()` compiles without errors against the SDK types.

---

## Phase 6: Documentation

**Purpose**: Constitution requires docs ship with the code. Feature is not complete until all docs are accurate.

- [x] T055 Rewrite `docs/EXTENSION-DEVELOPMENT.md` — architecture overview (WebContentsView isolation), getting started with SDK, manifest format (link contracts/manifest.md), main process API, renderer API (link contracts/webview-api.md), build setup, install+reload workflow, migration guide from v1 (renderer.tsx + registry imports → webview model)
- [x] T056 [P] Update `specs/001-extension-first-terminal/contracts/extension-api.md` — bump to v2.0.0; add webview renderer API section; document new IPC channels (`extension:update-panel-bounds`, `extension:panel-loaded`, `extension:renderer-reload`, `workspace:get-active`, `workspace:active-changed`, `workspace:changed`)
- [x] T057 [P] Update `specs/001-extension-first-terminal/contracts/ipc-channels.md` — add the 6 new channels from data-model.md
- [x] T058 [P] Update `docs/ARCHITECTURE.md` — add "Extension System" section: `ExtensionViewHost`, `WebContentsView` isolation model, `ext://` protocol, webview preload bridge, `ExtensionPanelPortal` layout coordination
- [x] T059 Create `docs/adr/022-webview-isolated-extension-renderer.md` — decision: `WebContentsView`; context: dual React instance problem, Vite build-time glob coupling, update propagation failures; consequences: full isolation, any framework/version, no rebuild; alternatives rejected: `<webview>` (Electron 42 explicitly discourages), `BrowserView` (deprecated since Electron 29)
- [x] T060 [P] Update `README.md` — update extension system section to describe install-from-anywhere model; update tech stack table if new packages added; remove any mention of "extensions must be inside the app repository"
- [x] T061 [P] Update wiki: `terminator.md` — mark extension system revamp done, describe new architecture
- [x] T062 [P] Update wiki: `terminator-extension-system.md` — rewrite to reflect WebContentsView model; remove old registry/import pattern; add SDK package, manifest contributes, webview isolation

---

## Final Verification

- [ ] T063 Run full litmus test for each extension (see plan.md Verification section) — all 5 pass
- [x] T064 `npm run format` — zero issues
- [x] T065 `npm run lint` — zero errors
- [x] T066 `npx vitest run --coverage` — all thresholds ≥ 80%, no file at 0%
- [x] T067 `npm run build:extensions` — succeeds
- [ ] T068 `/google-review` — address all BLOCKERs before commit

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Requires Phase 1 complete — BLOCKS all user story phases
- **Phase 3 (US1+US2+US5)**: Requires Phase 2 — this is the core renderer wiring
- **Phase 4 (US3 migrations)**: Requires Phase 3 — extensions need the new loader path to work
- **Phase 5 (US4 SDK)**: Requires Phase 2 (types must be stable) — can run in parallel with Phase 4
- **Phase 6 (Docs)**: Requires Phases 3+4 complete so docs describe actual behavior
- **Final Verification**: Requires all phases complete

### Within Phase 4 — Extension Migration Order

Migrations are independent of each other. Recommended order (simplest first to validate the approach):

1. `speckit-pilot` (smallest — single projectTab, minimal dependencies)
2. `remote-control` (small — single globalTab with status events)
3. `notepad` (medium — globalTab + windowViews + overlay→command migration)
4. `git-integration` (medium — 4 surfaces + workspace context)
5. `task-vault` (most complex — globalTab + sidebarPanel + badge + command + overlay)

### Parallel Opportunities

**Phase 2**: T003 → T004+T005 (schema then types), T006 → T007 (spec then impl), T008 is independent

**Phase 3**: T009 → T010, then T011+T012+T013+T014+T015 in parallel (different files), T016 → T017

**Phase 4**: All extension migrations can run in parallel once Phase 3 is done. Each extension's tasks are independent.

**Phase 5**: All SDK file creation tasks (T050–T052) are parallel.

**Phase 6**: T056–T062 can all run in parallel.

---

## Parallel Example: Phase 4, Extension Migrations

Once Phase 3 is verified working:

```text
# All 5 extension migrations can proceed simultaneously
Task A: notepad — T018-T023
Task B: git-integration — T024-T029
Task C: remote-control — T030-T035
Task D: speckit-pilot — T036-T041
Task E: task-vault — T042-T047
```

Each migration is a self-contained unit: update manifest → create new renderer → verify build → delete old renderer.

---

## Implementation Strategy

### MVP (User Stories 1 + 2 only)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: Foundational (T003–T008)
3. Complete Phase 3: US1+US2+US5 core wiring (T009–T017)
4. **STOP and VALIDATE**: Build minimal extension in `/tmp`, install, verify tab appears, reload works
5. Ship if needed — existing extensions still work via the `import.meta.glob` transitional path

### Full Delivery

1. MVP above
2. Phase 4: Migrate all 5 extensions (US3) — can run in parallel per extension
3. Phase 5: SDK package (US4) — can run in parallel with Phase 4
4. Phase 6: Documentation
5. Final Verification

---

## Notes

- **Badge updates** in task-vault: in the webview model, badge count must be managed within the webview renderer itself. The webview tracks inbox count by calling `extensionBridge.invoke('task-vault:vault:get-inbox')` and updates the UI badge state locally. There is no registry badge API available from within the webview.
- **Overlays (CaptureModal, QuickCreateOverlay)**: These are now implemented as modals inside the webview renderer, triggered by `ext:command:*` events. The core app has no overlay injection mechanism in the new model.
- **Icon updates (remote-control)**: In the old model, the renderer updated the registry icon dynamically. In the new model, the webview receives `remote:status` events and updates its own UI state internally — no registry icon mutation.
- **CmdOrCtrl+R** (task-vault weekly review): Currently a `registerKeyboardShortcut`. In the new model, move this to `contributes.commands` so the core registers it as an accelerator that fires `ext:command:task-vault:open-review`.
