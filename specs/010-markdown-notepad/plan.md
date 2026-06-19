# Implementation Plan: Markdown Notepad Extension

**Branch**: `010-markdown-notepad` | **Date**: 2026-06-18 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/010-markdown-notepad/spec.md`

---

## Summary

Build `terminator.notepad` — a first-party Terminator extension that adds a markdown notepad with Obsidian-style live-preview editing (CodeMirror 6), Google-Docs-style margin comments with durable text-quote anchoring, SQLite-backed storage with FTS5 full-text search, tag management, and folder export to plain `.md` files. The extension follows the Task Vault extension as a structural template: `better-sqlite3` for SQLite, namespaced IPC handlers, a global tab registered via `registry.registerGlobalTab`, a quick-create overlay window, and all dependencies isolated to the extension's own `package.json`.

---

## Technical Context

**Language/Version**: TypeScript 5.x (same as project root), React 18.3  
**Primary Dependencies**: `better-sqlite3` ^12, `gray-matter` ^4, `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/search`, `lucide-react` ^1, `zustand` 4.5.5, `zod` 3.23.8  
**Storage**: SQLite (WAL mode, `journal_mode=WAL`, `foreign_keys=ON`) via `better-sqlite3`; FTS5 virtual table for full-text search  
**Testing**: Vitest (node environment for IPC/DB; jsdom environment for React components); picked up by root `vitest.config.ts` pattern `extensions/*/tests/**/*.spec.{ts,tsx}`  
**Target Platform**: macOS desktop Electron app (Terminator); Electron main process owns SQLite and IPC; renderer process owns CM6 editor and all React UI  
**Performance Goals**: Live-preview decoration update ≤ 16 ms p95 on 5,000-line note; FTS5 search ≤ 50 ms p95 across 1,000 notes; export of 1,000 notes ≤ 5 s  
**Constraints**: Extension isolation — zero imports from `src/main/*` or `src/renderer/*`; all deps in `extensions/notepad/package.json` only; `--tm-*` CSS tokens exclusively; `lucide-react` icons only; 80% coverage gate enforced  
**Scale/Scope**: Single-user vault; 1,000+ notes, 5,000+ lines per note; no multi-user or cloud

---

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

| Principle                        | Status      | Notes                                                                                                                                                                                                       |
| -------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I — Source Integrity             | ✅ Pass     | CM6, SQLite FTS5, ExtensionAPI all verified against official docs in research.md                                                                                                                            |
| II — Extension Isolation         | ✅ Pass     | All code in `extensions/notepad/`; deps in extension `package.json`; IPC channels namespaced `terminator.notepad:*`; core builds/runs without this extension                                                |
| IV — Dependency Stewardship      | ✅ Pass     | `@codemirror/*` maintained by Marijn Haverbeke + CM team (very active); `better-sqlite3` multi-maintainer, established; `gray-matter` multi-maintainer; `zustand`/`zod`/`lucide-react` already project deps |
| V — Readability & Minimalism     | ✅ Pass     | Each CM6 extension is a single-purpose file; IPC handlers follow task-vault structure exactly                                                                                                               |
| VI — TDD (NON-NEGOTIABLE)        | ✅ Pass     | Tests written before each production file; 80% coverage gate enforced per `vitest.config.ts`                                                                                                                |
| VII — SOLID / YAGNI              | ✅ Pass     | Wiki-links, graph view, cloud sync explicitly deferred; MCP sidecar deferred to M6                                                                                                                          |
| VIII — Documentation First-Class | ✅ Pass     | IPC channels documented in `contracts/ipc-channels.md` and `src/renderer/electron.d.ts` update; README updated on completion                                                                                |
| IX — ADRs                        | ✅ Required | ADR-015: CM6 as editor engine (see `docs/adr/ADR-015-codemirror6-editor.md`)                                                                                                                                |
| X — Code Cleanliness             | ✅ Pass     | Lint must pass 0 errors; no dead exports; compiled `index.js` gitignored                                                                                                                                    |
| XI — Functional Purity           | ✅ Pass     | DB mappers are pure; CM6 decorations are pure `ViewPlugin` functions; side effects isolated to IPC handlers and `db.ts`                                                                                     |
| XII — Icons (NON-NEGOTIABLE)     | ✅ Pass     | All icons via `lucide-react`; flat, no inline color, CSS-controlled size                                                                                                                                    |

**No constitution violations. No complexity tracking entries required.**

---

## Project Structure

### Documentation (this feature)

```text
specs/010-markdown-notepad/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   └── ipc-channels.md  ← Phase 1 output
└── tasks.md             ← Phase 2 output (/speckit-tasks)
```

### Source Code

```text
extensions/notepad/
├── manifest.json
├── package.json
└── src/
    ├── index.ts                    # Main: activate(api), DB, global hotkey, settings, IPC
    ├── renderer.tsx                # Renderer: global tab + quick-create route + keyboard shortcuts
    ├── editor/
    │   ├── livePreview.ts          # CM6 ViewPlugin + Decoration.mark/replace/widget (Obsidian-style)
    │   ├── commentField.ts         # StateField<RangeSet> for comment anchor ranges + ChangeSet mapping
    │   └── markdownExtensions.ts  # Checkboxes, tables, images, fenced-code syntax highlight widgets
    ├── components/
    │   ├── NotepadView.tsx         # 3-pane shell: NoteList | Editor | CommentsMargin
    │   ├── NoteList.tsx            # Note list, search bar, tag sidebar, archived section
    │   ├── Editor.tsx              # CM6 host + autosave debounce + Saved indicator
    │   ├── CommentsMargin.tsx      # Right-rail comment cards (active / resolved / orphaned)
    │   ├── CommentComposer.tsx     # Floating selection popover + reply composer
    │   ├── QuickCreateOverlay.tsx  # Overlay window body (title + body + tags + Cmd+Enter)
    │   ├── ExportDialog.tsx        # Export scope picker + folder path + options
    │   └── EmptyState.tsx          # First-run zero-notes screen with Cmd+Shift+N hint
    ├── ipc/
    │   ├── notes.ipc.ts            # Note CRUD, list, autosave, archive/restore/hard-delete
    │   ├── comments.ipc.ts         # Comment CRUD, reply, resolve, orphan resolution
    │   ├── search.ipc.ts           # FTS5 ranked search + tag filter queries
    │   └── export.ipc.ts           # Export/import, folder picker, slug generation
    ├── db/
    │   ├── db.ts                   # initDb(userData), WAL, schema, idempotent migrations
    │   └── mappers.ts              # Row → domain type mapping (pure functions)
    └── stores/
        ├── notes.store.ts          # Zustand: note list, selected note, archive filter
        ├── editor.store.ts         # Zustand: active note body, dirty state, save status
        ├── comments.store.ts       # Zustand: comments for active note, anchor map
        └── filter.store.ts         # Zustand: search query, active tag filter, archived toggle

extensions/notepad/tests/
├── unit/
│   ├── db/
│   │   ├── db.spec.ts              # initDb, schema creation, WAL pragma, migrations
│   │   └── mappers.spec.ts         # Row ↔ domain mapping pure functions
│   ├── ipc/
│   │   ├── notes.ipc.spec.ts       # CRUD, autosave, archive/restore, title derivation
│   │   ├── comments.ipc.spec.ts    # Comment lifecycle, thread depth enforcement, orphan
│   │   ├── search.ipc.spec.ts      # FTS5 queries, tag filter, boolean operators
│   │   └── export.ipc.spec.ts      # Slug generation, export idempotency, frontmatter
│   ├── editor/
│   │   ├── livePreview.spec.ts     # Decoration correctness for each markdown element
│   │   ├── commentField.spec.ts    # StateField anchor remapping via ChangeSet
│   │   └── markdownExtensions.spec.ts
│   └── stores/
│       ├── notes.store.spec.ts
│       ├── editor.store.spec.ts
│       ├── comments.store.spec.ts
│       └── filter.store.spec.ts
└── components/
    ├── NoteList.spec.tsx
    ├── Editor.spec.tsx
    ├── CommentsMargin.spec.tsx
    ├── CommentComposer.spec.tsx
    ├── QuickCreateOverlay.spec.tsx
    ├── ExportDialog.spec.tsx
    └── EmptyState.spec.tsx
```

---

## Milestones

| Milestone              | Scope                                                                                                                                                           | Exit Criteria                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **M1 — Skeleton**      | Scaffold extension directory, manifest, `package.json`, global tab registered, SQLite `notes` table, plain `<textarea>` editor, `Cmd+Shift+N` overlay, autosave | Create/list/read/archive a note; survives app restart; coverage ≥ 80%            |
| **M2 — Live Editor**   | CM6 + `livePreview.ts` + `markdownExtensions.ts`; cursor-line reveal; checkboxes, tables, images, fenced code                                                   | All markdown elements render in place; raw editable on cursor line; perf ≤ 16 ms |
| **M3 — Comments**      | `commentField.ts`, `CommentsMargin.tsx`, `CommentComposer.tsx`; live + durable anchoring; threads (flat, depth 2); resolve; orphan section                      | Comment survives surrounding edits and app reopen; orphan displayed not dropped  |
| **M4 — Search & Tags** | FTS5 virtual table + triggers; `search.ipc.ts`; `NoteList.tsx` search bar + tag sidebar; inline `#tag` parsing                                                  | Ranked search + tag filter + `tag:foo` token return correct results              |
| **M5 — Export/Import** | `export.ipc.ts`; `ExportDialog.tsx`; slug generation; frontmatter; sidecar comments JSON; idempotent re-export; minimal import                                  | Round-trip 1,000 notes without dupes; re-export stable                           |
| **M6 — Polish**        | `EmptyState.tsx`; settings panel; native menu item; toasts; archived notes UX; perf pass; ADR-015; docs update                                                  | Lint 0 errors, coverage ≥ 80% across all files, README updated, ADR written      |

---

## Complexity Tracking

> No constitution violations requiring justification.

---

## Key Technical Decisions

### CM6 Extension Set

The editor needs these CM6 packages (all from the `@codemirror` org, actively maintained):

| Package                     | Role                                                      |
| --------------------------- | --------------------------------------------------------- |
| `@codemirror/state`         | `EditorState`, `StateField`, `RangeSet`, `ChangeSet`      |
| `@codemirror/view`          | `EditorView`, `ViewPlugin`, `Decoration`, `DecorationSet` |
| `@codemirror/lang-markdown` | Markdown grammar + `syntaxTree`                           |
| `@codemirror/language`      | `syntaxTree()` helper, `LanguageDescription`              |
| `@codemirror/commands`      | Standard keymap (undo/redo/indent)                        |
| `@codemirror/search`        | Find/replace within a note (`Cmd+F`)                      |

### Comment Anchor Lifecycle

```
Create  → capture CM6 {from,to}; snapshot quote/prefix/suffix (32 chars each side)
Live    → StateField.update() calls field.map(tr.changes) on every transaction
Persist → debounced write-back of remapped {start,end} after 2 s idle (separate from note autosave)
Reopen  → try offset: body.slice(start,end) === quote?
            ✓ → use offset
            ✗ → search quote in body, disambiguate by prefix/suffix
              found → use new offset, update DB
              not found → status='orphaned', show in Orphaned section
```

Only top-level comments carry anchor data. Replies (`parent_id IS NOT NULL`) inherit the parent's anchor display.

### Slug Generation (Export)

```typescript
function toSlug(title: string, uuid: string): string {
  const kebab = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${kebab}-${uuid.slice(0, 8)}`
}
// "Auth Retry Notes" + "a1b2c3d4-..." → "auth-retry-notes-a1b2c3d4.md"
```

If title is empty, slug uses `"untitled-note-{uuid8}"`. The slug is derived at export time; renaming a note between exports leaves the old file on disk (by design — documented in edge cases).

### FTS5 Maintenance

`notes_fts` is a contentless FTS5 table (`content=''`). The IPC handler for every note insert/update/delete writes the matching `notes_fts` row in the **same transaction**:

```sql
-- On insert/update:
INSERT OR REPLACE INTO notes_fts(rowid, title, body, tags)
  VALUES (notes.rowid, ?, ?, ?)
-- On delete:
INSERT INTO notes_fts(notes_fts, rowid) VALUES('delete', ?)
```

Search query: `SELECT n.*, snippet(notes_fts, ...) FROM notes_fts JOIN notes ON notes.rowid = notes_fts.rowid WHERE notes_fts MATCH ? AND n.archived_at IS NULL ORDER BY bm25(notes_fts)`.

### Archive vs Delete

- `DELETE` action → sets `archived_at = now()` on the note row. IPC handler: `terminator.notepad:notes.archive`.
- `RESTORE` action → clears `archived_at`. IPC handler: `terminator.notepad:notes.restore`.
- `HARD DELETE` → actual `DELETE FROM notes` after confirmation. IPC handler: `terminator.notepad:notes.hardDelete`.
- All note list and search queries filter `WHERE archived_at IS NULL` by default. Search adds `AND archived_at IS NULL` unless the "Include archived" toggle is set.
