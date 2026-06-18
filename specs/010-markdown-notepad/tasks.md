---
description: 'Task list for Markdown Notepad Extension'
---

# Tasks: Markdown Notepad Extension

**Input**: Design documents from `specs/010-markdown-notepad/`
**Plan**: `specs/010-markdown-notepad/plan.md`
**Spec**: `specs/010-markdown-notepad/spec.md`

**Tests**: TDD is NON-NEGOTIABLE per Constitution Principle VI. Test tasks appear BEFORE their implementation tasks in every phase. Write failing tests first — Red → Green → Refactor.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each milestone increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies with other open tasks)
- **[Story]**: User story label [US1]–[US5] for story phases; none for setup/foundational/polish
- File paths are relative to the repository root

---

## Phase 1: Setup

**Purpose**: Scaffold the extension directory, manifest, and package configuration. No production logic yet — just the skeleton that lets the build and test systems find the extension.

- [x] T001 Create extension directory structure: `extensions/notepad/src/{editor,components,ipc,db,stores}` and `extensions/notepad/tests/{unit/{db,ipc,editor,stores},components}`
- [x] T002 Create `extensions/notepad/manifest.json` with id `terminator.notepad`, version `0.1.0`, main `src/index.js`, minAppVersion `0.1.0`
- [x] T003 [P] Create `extensions/notepad/package.json` with all isolated dependencies: `better-sqlite3 ^12`, `gray-matter ^4`, `@codemirror/state ^6`, `@codemirror/view ^6`, `@codemirror/lang-markdown ^6`, `@codemirror/language ^6`, `@codemirror/commands ^6`, `@codemirror/search ^6`, `lucide-react ^1`, `zustand 4.5.5`, `zod 3.23.8`, `react 18.3.1`, `react-dom 18.3.1`; devDeps: `@types/better-sqlite3 ^7`
- [x] T004 [P] Verify extension isolation: confirm root `package.json` has no new entries from this feature; verify `extensions/notepad/package.json` is self-contained
- [x] T005 Create empty barrel entry files: `extensions/notepad/src/index.ts` (stub `activate` export) and `extensions/notepad/src/renderer.tsx` (stub) to unblock incremental builds

**Checkpoint**: `npm run build:extensions` must succeed (even with stub files) before proceeding.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: SQLite database init, schema, domain types, and base stores. Every user story depends on these. No user story work begins until this phase is complete.

**⚠️ CRITICAL**: Complete and verify this phase before opening any user story tasks.

- [x] T006 Write failing tests for `db.ts` (initDb creates correct tables, WAL pragma set, `hasColumn` migration guard, FTS5 virtual table created) in `extensions/notepad/tests/unit/db/db.spec.ts`
- [x] T007 Write failing tests for `mappers.ts` (pure row→domain mapping for Note, Tag, Comment, SearchResult) in `extensions/notepad/tests/unit/db/mappers.spec.ts`
- [x] T008 Implement `extensions/notepad/src/db/db.ts`: `initDb(userData)` with WAL + foreign_keys pragmas, full schema from `data-model.md` (notes, tags, note_tags, comments, notes_fts FTS5, settings), idempotent `hasColumn`-based migration runner
- [x] T009 [P] Implement `extensions/notepad/src/db/mappers.ts`: pure functions mapping SQLite rows to domain types (Note, Tag, Comment, SearchResult, ExportFrontmatter) with no side effects
- [x] T010 [P] Define shared TypeScript domain types in `extensions/notepad/src/db/types.ts`: `Note`, `Tag`, `NoteTag`, `Comment`, `SearchResult`, `ExportFrontmatter` (matches data-model.md §Domain Types)
- [x] T011a [P] Write failing tests for `notes.store.ts` (list state, selected note, archived filter toggle) in `extensions/notepad/tests/unit/stores/notes.store.spec.ts`
- [x] T011b [P] Implement `extensions/notepad/src/stores/notes.store.ts` (Zustand, no IPC calls — pure state only: `notes[]`, `selectedNoteId`, `archivedVisible`, `setNotes()`, `setSelected()`, `toggleArchivedVisible()` actions)

**Checkpoint**: `npx vitest run extensions/notepad/tests/unit/db` must pass; coverage ≥ 80% for `db.ts`, `mappers.ts`.

---

## Phase 3: User Story 1 — Quick Note Capture (Priority: P1) 🎯 MVP

**Goal**: `Cmd+Shift+N` opens an overlay; user types title/body/tags; `Cmd+Enter` saves; the note appears in the Notes tab immediately. `Esc` cancels. App restart preserves all notes.

**Independent Test**: Press `Cmd+Shift+N` → type "Test note" → `Cmd+Enter` → open Notes tab → confirm note appears. Restart app → confirm note still there.

### Tests for User Story 1

> **Write these FIRST. All must FAIL before any implementation begins.**

- [x] T012 Write failing tests for `notes.ipc.ts`: note create (title derivation from body, "Untitled note" fallback), list (excludes archived by default), autosave (updates `updated_at`, reconciles tags), archive (sets `archived_at`), restore (clears `archived_at`), hard-delete (removes row + FTS row in same transaction), immediate FTS row write on create → `extensions/notepad/tests/unit/ipc/notes.ipc.spec.ts`
- [x] T013 [P] Write failing component tests for `QuickCreateOverlay.tsx`: renders title/body/tag fields, `Cmd+Enter` calls create IPC, `Esc` fires close callback, empty-title fallback label shown → `extensions/notepad/tests/components/QuickCreateOverlay.spec.tsx`
- [x] T014 [P] Write failing component tests for `NoteList.tsx` (basic phase — list display only, no search yet): renders note list, clicking a note sets selected note in store, empty list shows EmptyState → `extensions/notepad/tests/components/NoteList.spec.tsx`
- [x] T015 [P] Write failing tests for `editor.store.ts` (active note id, body draft, dirty flag, save status: idle/saving/saved) → `extensions/notepad/tests/unit/stores/editor.store.spec.ts`

### Implementation for User Story 1

- [x] T016 Implement `extensions/notepad/src/ipc/notes.ipc.ts`: `registerNotesIpcHandlers()` wiring all `terminator.notepad:notes.*` channels from `contracts/ipc-channels.md` (list, get, create, autosave, archive, restore, hardDelete); SQLite CRUD using `getDb()`; FTS5 row maintained in same transaction on every write; title derivation logic; archive/restore/hard-delete; returns `{ data }` or `{ error }` — never throws. NOTE: `tags.*` handlers are registered separately in T047, NOT here.
- [x] T017 [P] Implement `extensions/notepad/src/stores/editor.store.ts`: Zustand store tracking `activeNoteId`, `bodyDraft`, `isDirty`, `saveStatus: 'idle' | 'saving' | 'saved'`; `markDirty()`, `markSaved()` actions
- [x] T018 [P] Implement `extensions/notepad/src/components/QuickCreateOverlay.tsx`: title input (optional), body textarea (plain in M1 — CM6 added in US2), tag chip input with autocomplete from existing tags; `Cmd+Enter` → invoke `terminator.notepad:notes.create` IPC → show success toast → close; `Esc` → close without save; title fallback logic in component
- [x] T019 [P] Implement `extensions/notepad/src/components/EmptyState.tsx` as minimal functional placeholder: shortcut hint text + Import affordance link only; no full visual design yet (full S9 design is T056); `lucide-react` icons; `--tm-*` tokens only
- [x] T020 Implement `extensions/notepad/src/components/NoteList.tsx` (US1 phase — list + selection only): renders list of notes from `notes.store`, handles click → set selected note, shows EmptyState when list is empty, shows "Archived" button at bottom as a placeholder (clicking does nothing in US1 — functional toggle wired in US4/T050)
- [x] T021 Implement `extensions/notepad/src/components/NotepadView.tsx`: 3-pane shell — left (`NoteList`), center (placeholder `<textarea>` for M1 body display — replaced with CM6 in US2), right (empty margin placeholder — filled in US3); `--tm-*` tokens; `lucide-react` icons
- [x] T022 Implement `extensions/notepad/src/index.ts` (full activate): `initDb(app.getPath('userData'))` (1-arg, notepad.db appended internally); register `terminator.notepad:notes.*` IPC handlers; register `CommandOrControl+Shift+N` global shortcut → `api.window.openAuxiliary({ url: '?view=notepad-quickcreate' })`; fallback to `registry.registerKeyboardShortcut` on shortcut rejection with warning toast; register stub settings section; `deactivate` closes DB
- [x] T023 Implement `extensions/notepad/src/renderer.tsx`: `registry.registerGlobalTab({ id:'notepad', label:'Notes', icon: FileText, component: NotepadView, permanent: true })`; handle `?view=notepad-quickcreate` route rendering `QuickCreateOverlay`

**Checkpoint**: US1 independently testable. `npx vitest run extensions/notepad/tests/unit/ipc/notes.ipc.spec.ts extensions/notepad/tests/components` must pass; coverage ≥ 80% for all US1 files.

---

## Phase 4: User Story 2 — Live-Preview Markdown Editing (Priority: P2)

**Goal**: Replace the plain textarea with a CodeMirror 6 editor. Markdown renders in place on non-cursor lines. Cursor line shows raw markdown. Checkboxes are clickable. Tables, images, fenced code render as widgets. Autosave debounce ≤ 800 ms. `Cmd+E` toggles raw mode.

**Independent Test**: Open a note → type `## Heading` → move cursor off line → verify heading renders. Click `- [ ] task` checkbox → verify source changes to `- [x]`. Wait 1 s → close and reopen note → verify body persisted.

### Tests for User Story 2

> **Write these FIRST. All must FAIL before any implementation begins.**

- [x] T024 Write failing tests for `livePreview.ts`: verify `Decoration.mark` emitted for bold/italic/heading ranges on non-cursor lines; verify mark is absent on the cursor line; verify `Decoration.replace` hides `##`/`**` punctuation → `extensions/notepad/tests/unit/editor/livePreview.spec.ts`
- [x] T025 [P] Write failing tests for `markdownExtensions.ts`: checkbox `WidgetType` toggles `[ ]`↔`[x]` in editor state; table widget renders for `|`-delimited rows; fenced code block widget renders → `extensions/notepad/tests/unit/editor/markdownExtensions.spec.ts`
- [x] T026 [P] Write failing component tests for `NoteEditor.tsx` (CM6 host component): mounts CM6 view, calls onChange, calls onAnchorsReady → `extensions/notepad/tests/components/NoteEditor.spec.tsx`

### Implementation for User Story 2

- [x] T027 Implement `extensions/notepad/src/editor/markdownExtensions.ts`: CM6 `WidgetType` subclasses for checkbox toggle (reads/writes CM6 state), table renderer (DOM widget), image renderer (DOM widget), fenced code syntax highlight; compose and export as a single CM6 extension array
- [x] T028 Implement `extensions/notepad/src/editor/livePreview.ts`: CM6 `ViewPlugin` that walks `syntaxTree` and emits `Decoration.mark` (bold/italic/heading/code), `Decoration.replace` (hide punctuation on non-cursor lines); cursor-line reveal: decorations suppressed on lines intersecting the current selection; incremental recomputation via `ViewUpdate.docChanged + selectionSet`
- [x] T029 Implement `extensions/notepad/src/editor/NoteEditor.tsx` (CM6 host): mounts `EditorView` with `[livePreviewPlugin, commentAnchorField, markdown(), defaultKeymap+historyKeymap+searchKeymap+indentWithTab, updateListener]`; exposes `onAnchorsReady` for view reference; handles doc change to sync on note switch
- [x] T030 Update `extensions/notepad/src/components/NotepadView.tsx`: replace placeholder textarea in center pane with `<NoteEditor>` component; wire onChange to markDirty + autosave debounce; load comments on note load; run reanchor + updateAnchor debounce

- [x] T030a Write a performance benchmark in `extensions/notepad/tests/unit/editor/livePreview.perf.spec.ts` (SC-002): generate a synthetic 5,000-line markdown document, call buildDecorations 20 times, assert p95 ≤ 16 ms (passes)

**Checkpoint**: US2 independently testable. `npx vitest run extensions/notepad/tests/unit/editor/livePreview.spec.ts extensions/notepad/tests/unit/editor/markdownExtensions.spec.ts extensions/notepad/tests/components/Editor.spec.tsx` must pass; T030a perf benchmark must pass.

---

## Phase 5: User Story 3 — Margin Comments with Anchoring (Priority: P3)

**Goal**: Select text → floating "Comment" button appears (or `Cmd+Opt+M`) → composer opens → submit → highlighted text + right-margin card. Edit above/around anchor → card tracks. Close/reopen → anchor re-resolves. Deleted anchor → Orphaned section.

**Independent Test**: Select "hello world" in a note → add comment "check this" → type 3 lines above the text → verify highlight moved down → close + reopen app → verify comment still anchored to "hello world" → delete "hello world" from body → reopen → verify comment appears in Orphaned section.

### Tests for User Story 3

> **Write these FIRST. All must FAIL before any implementation begins.**

- [x] T031 Write failing tests for `commentField.ts`: `StateField` initializes empty array; inserting text above anchor shifts `from`/`to` via `field.map(tr.changes)`; deleting anchored text removes collapsed anchor; `setAnchors` effect replaces list → `extensions/notepad/tests/unit/editor/commentField.spec.ts`
- [x] T032 [P] Write failing tests for `comments.ipc.ts`: create top-level comment stores anchor data; reply to top-level succeeds; reply to a reply returns `{ error: 'MAX_DEPTH_EXCEEDED' }`; resolve toggles status; orphan marks status; `updateAnchor` updates offsets; list returns top-level with nested replies → `extensions/notepad/tests/unit/ipc/comments.ipc.spec.ts`
- [x] T033 [P] Write failing component tests for `CommentMargin.tsx`: renders cards for open comments; orphaned card shows 'Anchor lost'; Resolve button calls IPC; Delete button calls IPC → `extensions/notepad/tests/components/CommentMargin.spec.tsx`
- [x] T034 [P] Write failing component tests for `CommentComposer.tsx`: appears when text is selected; body input required; submit calls `comments.create` IPC; cancel closes without save → `extensions/notepad/tests/components/CommentComposer.spec.tsx`
- [x] T035 [P] Write failing tests for `comments.store.ts` (setComments, addComment, removeComment, updateComment, setLoading) → `extensions/notepad/tests/unit/stores/comments.store.spec.ts`

### Implementation for User Story 3

- [x] T036 Implement `extensions/notepad/src/editor/commentField.ts`: `StateField<CommentAnchor[]>` initialized empty; `update()` maps anchor positions through `tr.changes.mapPos` on every transaction; filters collapsed anchors; `setAnchors` StateEffect replaces the list
- [x] T037 Implement `extensions/notepad/src/ipc/comments.ipc.ts`: `registerCommentsIpcHandlers()` for all 8 `terminator.notepad:comments.*` channels; enforce max depth 2 on `comments.reply`; returns `{ data }` or `{ error }` — never throws
- [x] T038 [P] Implement `extensions/notepad/src/stores/comments.store.ts`: Zustand store — `comments[]`, `loading`; `setComments`, `addComment`, `removeComment`, `updateComment`, `setLoading` actions
- [x] T039 Implement `extensions/notepad/src/components/CommentComposer.tsx`: floating popover positioned near the CM6 selection; body `<textarea>` (required); submit → `terminator.notepad:comments.create` IPC with anchor data from CM6 selection `{from, to}`, `quote`, `prefix`, `suffix`; closes on submit or `Esc`
- [x] T040 Implement `extensions/notepad/src/components/CommentMargin.tsx`: right-rail comment cards with resolve/delete/reply/edit affordances; inline edit → `comments.update` IPC; reply form → `comments.reply` IPC; orphaned section with "Anchor lost" label; `lucide-react` icons, `--tm-*` tokens
- [x] T041 Wire comments into `NotepadView.tsx`: load comments + run re-anchoring on note load; call `updateAnchor`/`markOrphaned` IPC debounced 2s; `applyAnchors` to CM6 editor; render `<CommentMargin>` in right pane; register `Cmd+Opt+M` in `index.ts` (broadcasts `terminator.notepad:ui.toggleComments` via `api.ipc.broadcast`)

- [x] T038a Implement `extensions/notepad/src/editor/reanchor.ts`: `reanchorComment(comment, body)` — offset-first verify, then text-quote search fallback (W3C TextQuoteSelector pattern), returns `{status:'ok'|'orphaned', anchor, newFrom?, newTo?}` → tests in `extensions/notepad/tests/unit/editor/reanchor.spec.ts`

**Checkpoint**: US3 independently testable. All comment tests must pass; coverage ≥ 80% for `commentField.ts`, `comments.ipc.ts`, `CommentMargin.tsx`.

---

## Phase 6: User Story 4 — Search and Tag Filtering (Priority: P4)

**Goal**: Search bar in note list returns FTS5-ranked results with highlighted snippets. `tag:infra` filter. Tag sidebar. Inline `#tag` in body parsed on save. Renaming a tag updates all notes.

**Independent Test**: Create 3 notes with different tags and bodies → search for a word → verify ranked results with snippet → type `tag:infra` → verify only tagged notes appear → add `#idea` inline → save → verify tag appears in sidebar.

### Tests for User Story 4

> **Write these FIRST. All must FAIL before any implementation begins.**

- [x] T042 Write failing tests for `search.ipc.ts`: FTS5 query returns BM25-ranked results with snippet; `tag:foo` filter returns only tagged notes; `-tag:bar` excludes; prefix query `auth*` matches; `includeArchived=true` includes archived; malformed query falls back to plain-text (no crash) → `extensions/notepad/tests/unit/ipc/search.ipc.spec.ts`
- [x] T043 [P] Write failing tests for tags IPC (in `notes.ipc.spec.ts`): `tags.list` returns name + noteCount; `tags.rename` updates all `note_tags` rows; `tags.delete` removes associations without deleting notes; inline `#tag` parsing on autosave reconciles tag set → `extensions/notepad/tests/unit/ipc/notes.ipc.spec.ts`
- [x] T044 [P] Write failing tests for `filter.store.ts` (search query state, active tag id, archived toggle) → `extensions/notepad/tests/unit/stores/filter.store.spec.ts`
- [x] T045 [P] Extend `NoteList.spec.tsx`: search bar input triggers `search.query` IPC, results display with snippets, tag sidebar click sets active tag filter, archived section hidden by default, "Include archived" toggle → `extensions/notepad/tests/components/NoteList.spec.tsx`

### Implementation for User Story 4

- [x] T046 Update `extensions/notepad/src/db/db.ts`: ensure FTS5 `notes_fts` virtual table is created in schema (already in schema SQL — verify and add FTS5 insert/delete helpers `insertFts(db, note)` and `deleteFts(db, rowid)` as exported pure functions used by IPC handlers)
- [x] T047 Update `extensions/notepad/src/ipc/notes.ipc.ts`: add `registerTagsIpcHandlers()` exporting a separate registration function for ALL `terminator.notepad:tags.*` channels (`tags.list`, `tags.rename`, `tags.delete`) — these are NOT registered in T016; also add inline `#tag` parsing on `notes.autosave` (regex `/#([a-z0-9_-]+)/gi`, reconcile with `note_tags` join table, create new tags as needed); ensure FTS row tags column refreshed on every note save
- [x] T048 Implement `extensions/notepad/src/ipc/search.ipc.ts`: `registerSearchIpcHandlers()` for `terminator.notepad:search.query`; parse `tag:foo` and `-tag:bar` tokens from query string before passing remainder to FTS5 `MATCH`; build compound `WHERE` with `JOIN note_tags` for tag filters; `AND n.archived_at IS NULL` unless `includeArchived=true`; `ORDER BY bm25(notes_fts)`; wrap malformed query in try/catch with plain-text fallback
- [x] T049 [P] Implement `extensions/notepad/src/stores/filter.store.ts`: Zustand store — `searchQuery`, `activeTagId`, `includeArchived`; `setQuery(q)`, `setTag(id)`, `toggleArchived()` actions
- [x] T050 Update `extensions/notepad/src/components/NoteList.tsx` (US4 additions): add search bar (debounced input → `search.query` IPC or local filter); tag sidebar listing all tags with note counts (click sets `filter.store.activeTagId`); show ranked search results with `<mark>` snippet highlights; "Include archived" toggle (FR-035); "Archived" section in list when archived toggle is on; hard-delete affordance in Archived section: "Permanently Delete" button shows inline confirmation ("This cannot be undone. Delete?") before calling `terminator.notepad:notes.hardDelete` IPC (FR-034); tag rename/delete accessible from sidebar context menu; wire to `filter.store`

**Checkpoint**: US4 independently testable. All search + tag tests must pass; coverage ≥ 80% for `search.ipc.ts` and filter/tag additions.

---

## Phase 7: User Story 5 — Export to Markdown Folder (Priority: P5)

**Goal**: Export dialog → pick folder → choose scope → Export writes `<title-kebab>-<uuid8>.md` with YAML frontmatter + `<slug>.comments.json` sidecar. Re-export is idempotent. Import reads `.md` files, deduplicates by frontmatter `id`.

**Independent Test**: Export 2 notes to a temp folder → verify `.md` files exist with correct frontmatter → modify one note → re-export → verify file updated, not duplicated → verify `.comments.json` exists for a note with comments → import from a different folder → verify no duplication.

### Tests for User Story 5

> **Write these FIRST. All must FAIL before any implementation begins.**

- [x] T051 Write failing tests for `export.ipc.ts`: `toSlug(title, uuid)` produces correct kebab+uuid8 format; export writes YAML frontmatter with all required fields; re-export overwrites by `id` not title; comment sidecar JSON written alongside `.md`; import creates note for new file; import updates note for file whose `id` matches existing; import skips files with missing frontmatter `id` gracefully → `extensions/notepad/tests/unit/ipc/export.ipc.spec.ts`
- [x] T052 [P] Write failing component tests for `ExportDialog.tsx`: folder picker button calls `export.pickFolder` IPC; scope radio (all/note/tag) visible; Export button disabled when no folder selected; progress/success state rendered → `extensions/notepad/tests/components/ExportDialog.spec.tsx`

### Implementation for User Story 5

- [x] T053 Implement `extensions/notepad/src/ipc/export.ipc.ts`: `registerExportIpcHandlers()` for `terminator.notepad:export.pickFolder` (calls `dialog.showOpenDialog`), `export.run` (iterate notes by scope, generate slug via `toSlug()`, write frontmatter via `gray-matter`, write body, write `<slug>.comments.json` sidecar, match existing files by `id` in frontmatter for idempotent overwrite), `import.run` (read folder `.md` files, parse frontmatter via `gray-matter`, upsert by `id`); pure `toSlug(title, uuid)` function exported separately for testability
- [x] T054 [P] Implement `extensions/notepad/src/components/ExportDialog.tsx`: folder path display + picker button; scope selector (All Notes / Current Note / By Tag); comment export format selector (Sidecar / Inline / Both); Export and Import buttons; progress indicator during operation; success/error toast on completion; `lucide-react` icons; `--tm-*` tokens
- [x] T055 Wire `ExportDialog` into `NotepadView.tsx`: toolbar "Export" button opens `ExportDialog` as an in-pane modal; Import affordance also accessible from `EmptyState.tsx` → `extensions/notepad/src/components/NotepadView.tsx` + `extensions/notepad/src/components/EmptyState.tsx`

**Checkpoint**: US5 independently testable. All export tests must pass; coverage ≥ 80% for `export.ipc.ts`.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Finalize empty state, settings, native menu, keyboard shortcuts, ADR, documentation, and enforce lint + coverage gates across all extension files.

- [ ] T056 Polish `extensions/notepad/src/components/EmptyState.tsx`: full first-run design per S9 screen rendering — prominent `Cmd+Shift+N` hint, import folder affordance, `lucide-react` icons (no emoji, no color on icons), `--tm-*` tokens only
- [ ] T057 [P] Complete settings registration in `extensions/notepad/src/index.ts`: all 5 settings from FR-032 — export folder path (string), comment export format (enum: sidecar/inline/both, default sidecar), autosave debounce ms (number, default 800, min 200, max 5000), default new-note tags (string, comma-separated), editor font size (number, default 14); keys namespaced `terminator.notepad.*`
- [ ] T058 [P] Register native menu item in `extensions/notepad/src/index.ts`: `api.nativeMenu.addViewMenuItem({ label: 'New Note', accelerator: 'CmdOrCtrl+Shift+N', action: openQuickCreate })`
- [ ] T059 [P] Register renderer keyboard shortcuts in `extensions/notepad/src/renderer.tsx`: `Cmd+Shift+F` (focus note search bar) and `Cmd+E` (toggle editor mode) — scoped to notepad tab focus only; validate no collision with core or other extensions. NOTE: `Cmd+Opt+M` is registered in T039, do NOT add it here.
- [ ] T060 Write `docs/adr/ADR-015-codemirror6-editor.md`: decision (CM6 as editor engine), motivation (Obsidian-style live preview, comment anchor remapping, official docs verified), alternatives considered (ProseMirror, Lexical, plain textarea), consequences
- [ ] T061 [P] Update `src/renderer/electron.d.ts`: add all 22 `terminator.notepad:*` IPC channel signatures (from `contracts/ipc-channels.md`) to the `ElectronAPI` interface type
- [ ] T062 [P] Update `docs/ARCHITECTURE.md`: add Markdown Notepad extension section describing 3-process split (main SQLite + IPC, renderer CM6 + React, optional MCP sidecar), data flow, FTS5 approach, comment anchor lifecycle
- [ ] T063 Update `README.md`: add Notepad to features list with keyboard shortcuts (`Cmd+Shift+N`, `Cmd+Opt+M`, `Cmd+E`, `Cmd+Shift+F`); add `@codemirror/*` packages to tech stack table; add Notepad entry to bundled extensions table
- [ ] T064 Run `npm run lint` from repo root and fix all lint errors introduced by this feature (unused imports, type errors, missing return types) → zero errors required
- [ ] T065 Run `npx vitest run --coverage` from repo root; verify all thresholds ≥ 80% (statements, branches, functions, lines) for every new file in `extensions/notepad/src/`; fix any file below 80% before marking complete

---

## Dependencies

```
Phase 1 (Setup)
  └── Phase 2 (Foundational: DB + types)
        ├── Phase 3 (US1: Quick Capture) ← MVP deliverable
        │     └── Phase 4 (US2: Live Editor)
        │           └── Phase 5 (US3: Comments) ← depends on CM6 StateField from US2
        ├── Phase 6 (US4: Search & Tags) ← can start after US1 (notes exist to search)
        └── Phase 7 (US5: Export) ← can start after US1 (notes exist to export)

Phase 8 (Polish) ← runs last, after all user stories complete
```

**Parallel opportunities within phases**:

- Phase 3: T013 (QuickCreateOverlay tests), T014 (NoteList tests), T015 (editor.store tests), T017 (editor.store impl), T018 (QuickCreateOverlay impl), T019 (EmptyState), T020 (NoteList impl) can all run in parallel after T012 is written
- Phase 4: T025 (markdownExtensions tests), T026 (Editor tests) can run in parallel with T024 (livePreview tests) once T024 is written; T027 (markdownExtensions impl) and T028 (livePreview impl) can run in parallel
- Phase 6: T043 (tags tests), T044 (filter.store tests), T045 (NoteList tests) can run in parallel with T042 (search tests); T047 (tags impl) and T049 (filter.store impl) can run in parallel with T048 (search impl)
- Phase 7: T052 (ExportDialog tests) can run in parallel with T051 (export.ipc tests); T054 (ExportDialog impl) can run in parallel with T053 (export.ipc impl)
- Phase 8: T057–T063 are all parallel (different files, no shared dependencies)

---

## Implementation Strategy

**MVP**: Complete Phase 1 + Phase 2 + Phase 3 (US1) to ship note create/list/archive with plain textarea and `Cmd+Shift+N`. This alone is independently useful and testable.

**Incremental delivery**:

1. MVP (P1) → US1 alone is a working notepad
2. Add CM6 live editor (P2) → dramatically improves edit experience
3. Add comments (P3) → differentiated feature, requires CM6 from P2
4. Add search + tags (P4) → scales to large vaults
5. Add export/import (P5) → removes lock-in concern
6. Polish → ship as bundled first-party extension

Each milestone exit requires `npx vitest run --coverage` passing all thresholds ≥ 80% and `npm run lint` passing with 0 errors.
