# Feature Specification: Webview-Isolated Extension System

**Feature Branch**: `eextension`
**Created**: 2026-06-24
**Status**: Draft

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Third-Party Developer Installs Extension From Any Location (Priority: P1)

A developer builds an extension for their internal tooling. They package it as a folder anywhere on their filesystem (e.g., `~/projects/my-work-extension`). They open Terminator, go to Settings → Extensions → Install Extension, select that folder, and the extension immediately appears in the UI — tabs, panels, and all functionality working — without the developer needing to modify or rebuild the core application.

**Why this priority**: This is the foundational contract that makes Terminator extensible. Without it, every extension requires a core app build, which is unsustainable for third-party developers.

**Independent Test**: Can be fully tested by building a minimal extension (manifest + HTML file + Node.js entry) outside the repo, installing it via the UI, and confirming its tab appears and IPC calls succeed.

**Acceptance Scenarios**:

1. **Given** a valid extension directory anywhere on disk, **When** the user installs it via the extension dialog, **Then** the extension's declared UI surfaces appear in the app within 3 seconds, with no app rebuild required.
2. **Given** an installed external extension, **When** the developer updates any file in the extension directory and clicks "Reload" in Settings, **Then** the extension's UI reflects the updated content within 5 seconds, with no app rebuild.
3. **Given** an external extension that uses React 19 while the core app uses React 18, **When** the extension is installed and opened, **Then** it renders correctly without any hook or runtime errors.
4. **Given** an invalid or missing manifest, **When** the user attempts to install, **Then** a clear error message is displayed and the extension is not added.

---

### User Story 2 — Extension Developer Declares UI Surfaces in Manifest (Priority: P1)

An extension developer specifies what UI surfaces their extension occupies (a global tab, a sidebar panel, a project tab) purely in `manifest.json`, without writing any code that imports or modifies core application internals.

**Why this priority**: The manifest-driven model is what eliminates the core-rebuild requirement and enables true isolation. It is architecturally foundational.

**Independent Test**: Can be tested by inspecting whether an extension with only a `manifest.json` and static HTML (no Node.js main) registers its declared UI surfaces correctly.

**Acceptance Scenarios**:

1. **Given** a manifest declaring `contributes.globalTab`, **When** the extension is installed and enabled, **Then** a tab with the declared label and icon appears in the sidebar rail without any code running in the core renderer's JS context.
2. **Given** a manifest declaring `contributes.sidebarPanel`, **When** the extension is installed, **Then** a collapsible panel with the declared label appears in the right sidebar.
3. **Given** a manifest declaring `contributes.commands` with a keyboard shortcut, **When** the extension is installed, **Then** the shortcut is registered and fires an event that the extension's UI receives.
4. **Given** a manifest with an unknown `contributes` key, **When** the extension is installed, **Then** the unknown key is silently ignored and all known contributions load normally.

---

### User Story 3 — Existing Extensions Work When Moved Out of the App Repository (Priority: P1)

All five existing bundled extensions (notepad, git-integration, task-vault, speckit-pilot, remote-control) can be physically moved to any directory on disk, installed via the extension dialog, and function identically to their current behavior — including database access, IPC handlers, React UI, keyboard shortcuts, and window views.

**Why this priority**: This is the litmus test. If existing extensions cannot pass it, the architecture is not complete.

**Independent Test**: Copy `extensions/notepad` to `/tmp/notepad-test`, delete it from the repo, rebuild, install from `/tmp/notepad-test`. All note creation, search, and editor functionality must work.

**Acceptance Scenarios**:

1. **Given** the notepad extension installed from outside the repo, **When** a user creates and saves a note, **Then** the note persists and is retrievable across app restarts.
2. **Given** the git-integration extension installed from outside the repo, **When** a user opens a git-tracked project, **Then** the Git Changes sidebar panel shows the correct diff and the Code Reviews tab loads PR data.
3. **Given** any migrated extension, **When** the user updates its files and reloads via Settings, **Then** the updated UI and behavior appear immediately without a core app rebuild.

---

### User Story 4 — Extension Developer Gets Type-Safe SDK (Priority: P2)

A third-party developer installs `@terminator/extension-sdk` from npm (or a local path) and gets full TypeScript types for the extension API (main process side) and the renderer API (webview side), enabling autocomplete and compile-time validation in their development environment.

**Why this priority**: Type safety dramatically reduces the learning curve and eliminates entire classes of integration bugs. It makes Terminator extensible by developers who have never seen the core source.

**Independent Test**: A new TypeScript extension project that only imports from `@terminator/extension-sdk` should compile without errors when using any documented API surface.

**Acceptance Scenarios**:

1. **Given** an extension developer adds `@terminator/extension-sdk` as a dev dependency, **When** they write `activate(api: ExtensionAPI)`, **Then** their editor provides full autocomplete for all `api.*` methods.
2. **Given** a webview renderer file that imports types from the SDK, **When** the developer calls `window.electronAPI.workspace.list()`, **Then** the return type is correctly inferred.
3. **Given** an extension using an API method that does not exist, **When** the developer compiles, **Then** a TypeScript error is produced before any code runs.

---

### User Story 5 — Extension Updates Take Effect Without Rebuilding the App (Priority: P2)

An extension developer makes a change to their extension's UI or logic, and that change is visible to the end user after a single "Reload" action in the extension settings — never requiring a new build or distribution of the core application.

**Why this priority**: This is the developer experience guarantee. Without it, the extension model is not commercially viable for third-party developers.

**Independent Test**: Modify any file in an installed extension's `dist/` folder, click Reload, confirm the change appears in the UI.

**Acceptance Scenarios**:

1. **Given** an installed and running extension, **When** the developer edits and rebuilds the extension's renderer, then clicks "Reload" in Settings, **Then** the webview shows the updated UI within 5 seconds.
2. **Given** an installed extension with a Node.js main entry, **When** the developer updates the compiled main entry and clicks "Reload", **Then** the updated IPC handlers are active for subsequent calls.
3. **Given** no "Reload" action taken, **When** the developer updates extension files, **Then** the running extension is unaffected (updates are intentional, not automatic).

---

### Edge Cases

- What happens while an extension webview is still loading? A spinner with the extension's name is displayed as an overlay until the webview signals it has finished rendering; the core app remains fully interactive during this time.
- What happens when an extension's HTML file references assets that do not exist? The webview shows a broken asset but does not crash the core app.
- What happens when the extension's Node.js main throws during `activate()`? The extension is marked as `error` status in the registry; the UI shows an error state for that extension's surfaces.
- What happens when two installed extensions declare the same command shortcut? The second registration wins; the first is silently overridden (consistent with current behavior).
- What happens when an extension's directory is deleted after installation? On next app launch, the extension is marked `error` and an error toast is shown; the rest of the app loads normally.
- What happens when the user installs the same extension ID twice? The second install is rejected with a `DUPLICATE_ID` error surfaced as a toast.
- What happens when an extension webview crashes (OOM, script error)? The webview shows an error page; the core app and other extensions are unaffected.

---

## Requirements _(mandatory)_

### Functional Requirements

**Core Architecture**

- **FR-001**: The system MUST render all external extension UIs in isolated browser contexts (webviews) so that extension code cannot directly access or modify the core application's runtime state.
- **FR-002**: The system MUST serve extension assets (HTML, JS, CSS, images) via a sandboxed protocol that enforces path containment — no extension can access files outside its own registered directory.
- **FR-003**: The system MUST load extension Node.js main entries at runtime using the extension's directory path without requiring any changes to the core application's build.
- **FR-004**: The system MUST clear the Node.js module cache for an extension's main entry when the extension is reloaded, ensuring updated code runs on next activation.
- **FR-005**: Extension webviews MUST receive fresh assets on every load (no client-side caching of extension files), so that extension updates are immediately visible after a reload.

**Manifest & Contribution Model**

- **FR-006**: An extension MUST declare all of its UI surface contributions in `manifest.json` under a `contributes` key, without executing any code in the core renderer's JS context.
- **FR-007**: The system MUST support the following declared contribution types: `globalTab`, `workspaceTab`, `projectTab`, `sidebarPanel`, `windowViews`, and `commands`.
- **FR-008**: Each contribution surface MUST support an optional `view` parameter that is appended to the webview URL so a single HTML entry point can serve multiple extension surfaces.
- **FR-009**: The manifest schema MUST be validated at install time; extensions with invalid manifests MUST be rejected with a descriptive error message.
- **FR-010**: The manifest MUST support a `commands` contribution that declares keyboard shortcuts; the core MUST register these shortcuts and fire IPC events to the extension's webview when triggered.

**Extension API & Communication**

- **FR-011**: Extension webviews MUST have access to the complete `window.electronAPI` surface — identical to the core renderer — delivered via a dedicated webview preload script. Access restrictions are enforced by the main-process IPC handlers themselves, not by a restricted preload. No separate "extension preload" with a reduced API surface is maintained.
- **FR-012**: The system MUST pass the current active workspace ID, project ID, and repo root path to the extension webview as URL parameters on every surface render.
- **FR-013**: The system MUST broadcast a `workspace:changed` event to all active extension webviews whenever the active workspace or project changes in the core app.
- **FR-014**: Extensions MUST be able to query the current active workspace context on demand via an IPC call, for cases where URL params are stale.
- **FR-015**: The extension main process API (`activate(api)`) MUST be unchanged from v1 — all existing `api.*` namespaces continue to work without modification.
- **FR-025**: The webview preload API (`window.electronAPI`) MUST be stable within a major app version. Breaking changes (removal or rename of existing methods) MUST NOT occur within a major version and MUST be announced via changelog with a major version bump. Extensions use `minAppVersion` in their manifest to declare the minimum compatible app version. The SDK documentation MUST note which app version each API method was introduced in.

**Reload & Lifecycle**

- **FR-016**: When an extension is reloaded via Settings, the system MUST: (1) deactivate and clear the Node.js module for the main entry, (2) re-activate the main entry with fresh code, AND (3) signal the core renderer to remount the extension's webviews so they fetch fresh assets.
- **FR-017**: The system MUST support enabling and disabling extensions; disabled extensions MUST have their webviews unmounted and their IPC handlers removed.
- **FR-018**: On app startup, all previously installed and enabled extensions MUST be activated (main process), their UI surfaces registered (renderer), and their webviews pre-created and kept alive for the duration of the app session. Webviews are not destroyed when the user navigates away from an extension's surface.

**SDK & Developer Experience**

- **FR-019**: A standalone npm package (`@terminator/extension-sdk`) MUST provide TypeScript type definitions for the full extension main-process API and the webview renderer API.
- **FR-020**: The SDK MUST export a curated list of supported icon names that developers can use in their manifest `contributes` declarations.
- **FR-021**: Documentation MUST describe a complete build setup (manifest, folder structure, build output format) that enables a developer with no knowledge of the core app's internals to build, install, and run a working extension.

**Migration & Backward Compatibility**

- **FR-022**: All existing bundled extensions (notepad, git-integration, task-vault, speckit-pilot, remote-control) MUST be migrated to the new manifest-driven webview model and MUST pass the litmus test (installable from outside the repo).
- **FR-023**: The remote-control extension has a `globalTab` renderer surface and MUST be migrated to the new webview model alongside the other four extensions. Its main-process IPC handlers are unchanged; only the renderer path changes.
- **FR-024**: During the migration period, the core app MAY continue to support bundled (glob-compiled) extensions via a transitional loader path, provided external/migrated extensions follow the new model.

### Key Entities

- **Extension**: A directory on disk containing a `manifest.json`, an optional Node.js main entry, an optional HTML renderer entry, and any static assets. Identified by a reverse-domain `id` (e.g., `com.acme.my-tool`).
- **Manifest**: A JSON file declaring the extension's identity, version compatibility, entry points, and UI surface contributions.
- **Contribution**: A declared UI surface in the manifest — one of: `globalTab`, `workspaceTab`, `projectTab`, `sidebarPanel`, `windowViews[]`, `commands[]`.
- **Extension Webview**: An isolated browser context that renders the extension's HTML entry point and communicates with the main process via the webview preload's `window.electronAPI`.
- **Webview Preload**: A compiled JS file injected into every extension webview that bridges `window.electronAPI` calls to the main process via Electron's context bridge.
- **Extension Registry** (core): The core app's internal store of registered UI surfaces. In the new model, external extensions do not call into this directly — the core populates it from manifest contributions.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Any existing bundled extension can be physically moved out of the app repository and installed from an arbitrary filesystem path, with 100% of its features working correctly, verified by the litmus test procedure.
- **SC-002**: An extension update (changed files in the extension directory) is visible to the user within 5 seconds of clicking "Reload" in Settings, with no core app rebuild step.
- **SC-003**: An extension that uses any version of React (including React 19) with hooks produces zero runtime hook errors when installed and opened alongside the core app (which uses React 18).
- **SC-004**: A developer with no prior knowledge of the Terminator core codebase can build, install, and run a working extension using only the SDK documentation and `@terminator/extension-sdk` types — achievable in under 2 hours.
- **SC-005**: The core application test suite maintains ≥ 80% coverage across all thresholds after all infrastructure and migration changes are complete.
- **SC-006**: Installing a new third-party extension does not require restarting the application; the extension is functional immediately after the install dialog closes.
- **SC-007**: A crashed or misbehaving extension webview does not affect the core application or any other installed extension (isolated failure).

---

## Clarifications

### Session 2026-06-24

- Q: Should extension webviews receive the full `window.electronAPI` surface or a restricted subset? → A: Full access — webviews receive the complete `window.electronAPI` surface identical to the core renderer; main-process IPC handlers remain the enforcement layer (e.g., `shell:exec` is already restricted to `git`/`gh` commands by the handler).
- Q: When are extension webviews created and destroyed relative to user navigation? → A: Eager + persistent — all installed extension webviews are created at app startup and kept alive for the duration of the app session. No cold-start delay; memory cost is the accepted tradeoff.
- Q: What should users see while an extension webview is initializing? → A: A spinner with the extension name, overlaid on the webview area until the webview signals it has finished loading.
- Q: How should webview preload API compatibility be managed as the app evolves? → A: `minAppVersion` contract + no-breaking-changes policy — the preload API is stable within a major version; breaking changes require a major version bump and changelog notice. Extensions declare `minAppVersion` to pin compatibility.

---

## Assumptions

- Extension webviews are eager and persistent: all enabled extension webviews are created at app startup and kept alive. Each webview consumes approximately 80–150 MB of RAM as a separate renderer process. This is a conscious performance tradeoff in exchange for zero cold-start delay when switching between extension surfaces.
- Extensions are trusted by the user at install time. The `ext://` protocol enforces path containment (extensions cannot read files outside their own directory), but extension code runs with the same privilege level as any Electron renderer.
- The `main` entry in an extension manifest must be a CommonJS module (`.cjs` or compiled to CJS). ESM main entries are out of scope for this iteration.
- The extension's build tooling is the developer's responsibility. The SDK provides types and documentation but not a scaffolding CLI in this iteration.
- The `@terminator/extension-sdk` package will initially be distributed for local installation (e.g., via `npm install /path/to/sdk`) rather than published to the public npm registry. Public publishing is a follow-on task.
- All existing bundled extensions currently use the `api.db` (PGlite) for persistence; this API is unchanged and continues to work from within extension webviews via IPC.
- The workspace context passed via URL parameters is the context at the time the webview is mounted. Live updates come via the `workspace:changed` broadcast event. Extensions that need guaranteed-fresh context call `workspace:get-active` via IPC.
- Overlay components (e.g., the Notepad QuickCreate modal) that previously rendered inside the core renderer's React tree must be re-implemented as modals within the extension's own webview. The core app provides no overlay injection mechanism in the new model.
