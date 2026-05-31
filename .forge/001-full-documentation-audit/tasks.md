# Tasks — 001-full-documentation-audit

<!-- find-reuse: all changes are docs-only or fixture-rename; no existing implementations conflict -->

---

## T-001 — Rename sample-extension fixture to manifest.json

**Description:** The test fixture at `tests/fixtures/sample-extension/` contains a file named `extension.json`. The ExtensionHost reads `manifest.json` (per ADR-008), so the e2e test that passes this directory to `host.load()` currently relies on a stale filename. Rename the fixture file so the fixture matches the runtime contract before any doc changes reference the correct name.

**Acceptance criteria:**

- `tests/fixtures/sample-extension/manifest.json` exists with the same content as the old `extension.json`.
- `tests/fixtures/sample-extension/extension.json` no longer exists.
- `npm test` passes with no new failures.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** yes
**Touches documented module:** no

---

## T-002 — Fix manifest filename references in specs/001 docs

**Description:** Three spec-level documents (`quickstart.md`, `data-model.md`, and any inline code blocks) still reference `extension.json` as the extension manifest filename despite ADR-008 renaming it to `manifest.json`. Update every occurrence in these files.

**Acceptance criteria:**

- Searching the `specs/001-extension-first-terminal/` tree for the string `extension.json` returns zero results.
- All code blocks and prose in `quickstart.md` and `data-model.md` that previously said `extension.json` now say `manifest.json`.

**Depends on:** T-001
**Tags:** `docs-only`
**Touches tested package:** no
**Touches documented module:** no

---

## T-003 — Update quickstart.md extension dev example and command table

**Description:** The "Developing an Extension (local)" section in `quickstart.md` demonstrates raw CommonJS (`module.exports`) as the primary workflow. Extensions are now TypeScript-first with a scaffold CLI. Additionally, the Common Commands table omits `npm run build:extensions`, and the ADR reference only cites ADRs 001–004. All three issues must be fixed.

**Acceptance criteria:**

- The primary extension development example in `quickstart.md` uses the `npm run create-extension` scaffold workflow, not raw-JS `module.exports`.
- The Common Commands table includes a row for `npm run build:extensions`.
- The ADR reference in `quickstart.md` mentions ADRs 001–014, not just 001–004.

**Depends on:** T-002
**Tags:** `docs-only`
**Touches tested package:** no
**Touches documented module:** no

---

## T-004 — Add File System Channels section to ipc-channels.md

**Description:** The master IPC contract (`specs/001-extension-first-terminal/contracts/ipc-channels.md`) has no section for the `fs:*` namespace despite `fs:watch-start`, `fs:watch-stop`, `fs:read-file`, and the push event `fs:changed` all being live in the codebase. Add a dedicated "File System Channels" section following the existing format (channel name, direction, request/response payload shapes).

**Acceptance criteria:**

- `ipc-channels.md` contains a "File System Channels" (or equivalent) section heading.
- The section documents `fs:watch-start`, `fs:watch-stop`, `fs:read-file`, and `fs:changed` with correct payload shapes matching the handler code in `src/main/ipc/fs.ipc.ts`.
- Searching `ipc-channels.md` for `fs:watch-start`, `fs:watch-stop`, `fs:read-file`, and `fs:changed` each returns at least one hit.

**Depends on:** (none)
**Tags:** `docs-only`
**Touches tested package:** no
**Touches documented module:** no

---

## T-005 — Add five missing IPC channel entries to ipc-channels.md

**Description:** Five channels exposed in `src/main/preload.ts` have no corresponding entry in the master contract: `workspace:reorder`, `project:rename`, `project:reorder`, `git:create-branch`, and `fs:read-file` (the last already covered by T-004's new FS section). Each missing entry must be added under its correct namespace section with payload shapes derived from the actual IPC handler code.

**Acceptance criteria:**

- Searching `ipc-channels.md` for `workspace:reorder`, `project:rename`, `project:reorder`, and `git:create-branch` each returns a documented entry.
- Each new entry specifies direction (renderer→main or main→renderer), request payload, and response payload matching the handler implementation.
- `fs:read-file` appears in the File System Channels section added by T-004.

**Depends on:** T-004
**Tags:** `docs-only`
**Touches tested package:** no
**Touches documented module:** no

---

## T-006 — Upgrade extension-api.md to v1.2.0

**Description:** The extension API contract (`specs/001-extension-first-terminal/contracts/extension-api.md`) is frozen at v1.0.0. Two subsequent MINOR versions (v1.1.0 and v1.2.0) have shipped with new namespaces. The version header, `ExtensionAPI` interface block, and a new Version History section all need to be updated to reflect the current API surface as defined in `src/main/extensions/api.ts`.

**Acceptance criteria:**

- The version header in `extension-api.md` reads `1.2.0`.
- The `ExtensionAPI` interface block documents every namespace present in the `ExtensionAPI` interface in `src/main/extensions/api.ts`, including all v1.1.0 additions (`sidebar.registerPanel`, `topBar`, `shell`, `notifications.showToast`, `nativeMenu`, `fs`, `ipc`) and all v1.2.0 additions (`sidebar.registerGlobalTab`, `globalShortcut`, `workspace`, `window`, `notifications.createNotification`).
- A "Version History" section exists listing what was added in each version (v1.0.0, v1.1.0, v1.2.0).

**Depends on:** (none)
**Tags:** `docs-only`
**Touches tested package:** no
**Touches documented module:** no

---

## T-007 — Fix README.md tech stack, scripts table, and project structure

**Description:** The README has four distinct inaccuracies: (1) the tech stack table lists `xterm-addon-canvas`, which is not installed; (2) `npm run lint` is described as "ESLint + TypeScript type check" when it only runs ESLint; (3) the Available Scripts table is missing `typecheck`, `create-extension`, and `format:check`; (4) the `specs/` block in the project structure omits directories 006 and 007; (5) the `extensions/` block omits the `foundry` extension.

**Acceptance criteria:**

- The README tech stack terminal row does not mention `xterm-addon-canvas`; only `xterm` and `xterm-addon-fit` appear.
- The Available Scripts table describes `npm run lint` as ESLint-only and includes separate rows for `npm run typecheck`, `npm run create-extension`, and `npm run format:check`.
- The project structure `specs/` block lists directories 001 through 007.
- The `extensions/` directory block lists `foundry/` alongside the three existing extensions.

**Depends on:** (none)
**Tags:** `docs-only`
**Touches tested package:** no
**Touches documented module:** no

---

## T-008 — Fix README.md extension import example and ADR table

**Description:** The "Developing an Extension" code block in the README imports types directly from `src/main/extensions/api`, which violates the constraint that extensions must not import from `src/main/`. Additionally, the Key Design Decisions table only lists ADR-001 through ADR-004; ADRs 005–014 exist and should be linked.

**Acceptance criteria:**

- The README "Developing an Extension" code block no longer imports from `../../src/main/extensions/api`; it matches the pattern shown in `docs/EXTENSION-DEVELOPMENT.md`.
- The Key Design Decisions table contains entries for ADR-005 through ADR-014, each with a description and link to its file in `docs/adr/`.

**Depends on:** T-007
**Tags:** `docs-only`
**Touches tested package:** no
**Touches documented module:** no

---

## T-009 — Fix ARCHITECTURE.md inaccuracies

**Description:** Three inaccuracies exist in `docs/ARCHITECTURE.md`: (1) the `fs:*` channel namespace row omits `fs:read-file`; (2) the extension build pipeline section references `scripts/build-extensions.js` when the actual file is `build-extensions.cjs`; (3) the extension loading sequence diagram does not include v1.2.0 API methods (`api.globalShortcut.register()`, `api.workspace.list()`, `api.window.openAuxiliary()`).

**Acceptance criteria:**

- The `fs:*` row in the IPC namespace table in `ARCHITECTURE.md` mentions `fs:read-file`.
- All references to `scripts/build-extensions.js` in `ARCHITECTURE.md` are replaced with `scripts/build-extensions.cjs`.
- The extension loading sequence diagram includes at least one v1.2.0 API method call.

**Depends on:** (none)
**Tags:** `docs-only`
**Touches tested package:** no
**Touches documented module:** no

---

## T-010 — Fix CONTRIBUTING.md lint description and PR checklist

**Description:** `docs/CONTRIBUTING.md` has three issues: (1) the lint command is described as "ESLint + TypeScript type check" when it only runs ESLint; (2) the IPC contract documentation pointer does not clearly state which file is the master contract; (3) a PR checklist item about IPC channel documentation is duplicated.

**Acceptance criteria:**

- The lint step in `CONTRIBUTING.md` is described as "ESLint (zero errors required)" with a separate line for `npm run typecheck`.
- The IPC documentation requirement explicitly names `specs/001-extension-first-terminal/contracts/ipc-channels.md` as the master contract.
- The PR checklist contains the IPC channel documentation item exactly once (no duplicate).

**Depends on:** (none)
**Tags:** `docs-only`
**Touches tested package:** no
**Touches documented module:** no

---

## T-011 — Update scaffold to v1.2.0 stubs and update EXTENSION-DEVELOPMENT.md

**Description:** `scripts/create-extension.cjs` currently generates v1.1.0 API stubs only. Update the scaffold to also include commented-out v1.2.0 stubs (`api.globalShortcut`, `api.workspace`, `api.window`, `api.sidebar.registerGlobalTab`), bump the `// API version:` comment in the generated template to `v1.2.0`, and update `docs/EXTENSION-DEVELOPMENT.md` line 541 to say "all v1.2.0 API surfaces" to match. The git-integration tab count claim was verified as accurate (two `registerProjectTab` calls) and requires no change.

**Acceptance criteria:**

- `scripts/create-extension.cjs` generates a `src/index.js` template whose `// API version:` comment reads `v1.2.0`.
- The generated template includes commented-out stubs for `api.globalShortcut.register()`, `api.workspace.list()`, `api.window.openAuxiliary()`, and `api.sidebar.registerGlobalTab()`.
- `docs/EXTENSION-DEVELOPMENT.md` Scaffolding CLI Reference section describes the generated scaffold as demonstrating v1.2.0 API surfaces.

**Depends on:** (none)
**Tags:** `production-code`
**Touches tested package:** no
**Touches documented module:** no

---

## T-012 — Create extensions/foundry/README.md

**Description:** The `extensions/foundry/` directory ships a first-party extension but has no `README.md`, unlike the other three extensions (`git-integration`, `speckit-pilot`, `task-vault`). Create a README that describes the extension's name, purpose, current development status (not yet feature-complete), and a reference to the spec directory.

**Acceptance criteria:**

- `extensions/foundry/README.md` exists.
- The file contains the extension's name and description (matching values in `extensions/foundry/manifest.json`).
- The file notes that the extension is in development and links to `specs/007-foundry-agent-harness/`.

**Depends on:** (none)
**Tags:** `docs-only`
**Touches tested package:** no
**Touches documented module:** no
