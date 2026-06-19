# Research: Markdown Notepad Extension

**Date**: 2026-06-18  
**Feature**: `specs/010-markdown-notepad`  
**Sources**: Official documentation only (Constitution Principle I)

---

## Decision 1: Editor Engine — CodeMirror 6

**Decision**: Use CodeMirror 6 (`@codemirror/*` packages) as the editor engine for the live-preview markdown editor.

**Rationale**: Obsidian's Live Preview is implemented with CM6 decorations and is the direct UX model for this feature. CM6's `Decoration.mark`, `Decoration.replace`, and `Decoration.widget` APIs produce exactly the in-place rendering required. Critically, CM6's `StateField` + `RangeSet` + `ChangeSet.mapPos` is the same machinery the spec requires for live comment anchor remapping — a single engine solves both the editor and the comments problem. Markdown source remains the single source of truth throughout.

**Alternatives considered**:

- ProseMirror / Milkdown: Forces a separate rich-text document model; markdown round-tripping is imperfect; no native offset remapping for comment anchors.
- Lexical (Meta): Weaker markdown-source fidelity; smaller ecosystem for markdown plugins.
- Plain textarea: Insufficient — no syntax-aware decorations or position mapping.

**Official source**: [CodeMirror 6 Reference Manual](https://codemirror.net/docs/ref/) | [Decoration example](https://codemirror.net/examples/decoration/)

---

## Decision 2: CM6 Package Set

**Decision**: Use exactly these `@codemirror` packages (all under active maintenance by Marijn Haverbeke + contributors):

| Package                     | Version constraint | Purpose                                                                 |
| --------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `@codemirror/state`         | `^6`               | `EditorState`, `StateField`, `RangeSet`, `ChangeSet`                    |
| `@codemirror/view`          | `^6`               | `EditorView`, `ViewPlugin`, `Decoration`, `DecorationSet`, `WidgetType` |
| `@codemirror/lang-markdown` | `^6`               | Markdown grammar, `syntaxTree` integration                              |
| `@codemirror/language`      | `^6`               | `syntaxTree()`, `LanguageDescription`, `highlightingFor`                |
| `@codemirror/commands`      | `^6`               | Standard key bindings (undo/redo/indent/list-continuation)              |
| `@codemirror/search`        | `^6`               | Find/replace within note (`Cmd+F`) panel                                |

All packages are part of the official CM6 release published at [codemirror.net](https://codemirror.net) and maintained by the same team. Community health: multiple active maintainers, GitHub org `codemirror`, MIT licensed.

**Official source**: [CodeMirror 6 packages](https://codemirror.net/docs/ref/)

---

## Decision 3: Comment Anchoring — W3C TextQuoteSelector Pattern

**Decision**: Comment anchors are stored as `{ start_offset, end_offset, quote, prefix, suffix }`. In-session remapping uses CM6 `ChangeSet.mapPos`. Durable re-anchoring on note load uses offset-first then text-quote search.

**Rationale**: CM6's `ChangeSet` provides exact position mapping after every document mutation — this solves live anchoring without any custom implementation. The W3C Web Annotation TextQuoteSelector pattern (used by Hypothesis, Medium) solves durable anchoring across sessions. The combination gives correct behavior in both cases. Explicitly choosing orphan surfacing over silent loss aligns with the spec's requirement of 0% silent loss.

**Alternatives considered**:

- Offset only: Works in-session via CM6, but fragile across external edits and re-imports.
- Google Docs opaque anchor IDs: Proprietary; not reproducible; known to break on programmatic edits.
- Full diff-match-patch re-anchoring: More complex, similar success rate to text-quote for the use case.

**Official source**: [W3C Web Annotation Data Model — TextQuoteSelector](https://www.w3.org/TR/annotation-model/#text-quote-selector) | [CM6 ChangeSet docs](https://codemirror.net/docs/ref/#state.ChangeSet)

---

## Decision 4: Full-Text Search — SQLite FTS5 with BM25

**Decision**: Use SQLite FTS5 `USING fts5(title, body, tags, content='', tokenize='unicode61')` with `bm25()` ranking. A contentless table is used; the IPC handlers maintain FTS rows in the same transaction as note writes.

**Rationale**: FTS5 is SQLite's built-in full-text search engine with no external dependency. BM25 ranking is natively available via `bm25(notes_fts)`. The contentless approach (`content=''`) means we own the FTS row lifecycle, which pairs naturally with the IPC handler architecture. `unicode61` tokenizer handles Unicode text correctly.

**Alternatives considered**:

- External search library (Lunr, Flexsearch): Extra dependency, requires index serialization, no native SQL join.
- FTS4: Older; FTS5 is the recommended successor per SQLite docs.
- Contentful FTS5: Stores content twice; unnecessary for a notes app where content is already in `notes.body`.

**Official source**: [SQLite FTS5 Extension](https://sqlite.org/fts5.html)

---

## Decision 5: Storage — SQLite WAL via better-sqlite3

**Decision**: `better-sqlite3` in WAL mode, same as Task Vault. Database file at `path.join(app.getPath('userData'), 'notepad.db')`. Idempotent `hasColumn`-style migration runner.

**Rationale**: Already proven in this codebase (Task Vault). `better-sqlite3` uses synchronous SQLite access in the main process, which aligns with Electron's architecture (no async SQLite driver needed). WAL mode provides better concurrent read performance. The `hasColumn` migration pattern is already implemented and battle-tested.

**Official source**: [better-sqlite3 docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

---

## Decision 6: Export Format — YAML Frontmatter + Sidecar JSON

**Decision**: Notes export as `<title-kebab-case>-<uuid8>.md` with YAML frontmatter parsed/written by `gray-matter`. Comments export to `<slug>.comments.json`. The `.md` prose body stays clean.

**Rationale**: `gray-matter` is already a dependency in Task Vault (`gray-matter ^4.0.3`). YAML frontmatter is the Obsidian-compatible standard. Sidecar JSON for comments keeps the `.md` body clean and portable. The UUID-suffixed slug guarantees collision-free, stable filenames across title changes.

**Official source**: [gray-matter README](https://github.com/jonschlinkert/gray-matter)

---

## Decision 7: ExtensionAPI Surface Used

All API surfaces required by the spec exist in ExtensionAPI v1.3.0 (verified against `docs/EXTENSION-DEVELOPMENT.md`):

| Need                        | API call                                                                                | Precedent                            |
| --------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------ |
| Global `Cmd+Shift+N`        | `api.globalShortcut.register('CommandOrControl+Shift+N', fn)`                           | Task Vault `Cmd+Shift+Space`         |
| Quick-create overlay window | `api.window.openAuxiliary({ url: '?view=notepad-quickcreate' })`                        | Task Vault capture modal             |
| Global tab                  | `registry.registerGlobalTab({ id:'notepad', label:'Notes', component })`                | Task Vault `task-vault` tab          |
| Namespaced IPC              | `api.ipc.registerHandler('terminator.notepad:notes.list', fn)`                          | Task Vault `terminator.task-vault:*` |
| Settings                    | `api.settings.register({ label:'Notepad', properties:{...} })`                          | Task Vault settings                  |
| Toasts                      | `api.notifications.showToast('success', 'Note saved')`                                  | Task Vault                           |
| Native menu                 | `api.nativeMenu.addViewMenuItem({ label:'New Note', accelerator:'CmdOrCtrl+Shift+N' })` | git-integration                      |

`Cmd+Shift+N` confirmed free of reserved-shortcut and bundled-extension collisions (see `01-research-findings.md §4`).

---

## Resolved Unknowns

All items that were marked NEEDS CLARIFICATION in the Technical Context are resolved:

| Unknown                                | Resolution                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| CM6 exact package set                  | Defined in Decision 2 above                                                       |
| FTS5 contentless insert/delete pattern | Defined in Decision 4 + plan.md §FTS5 Maintenance                                 |
| Comment anchor remapping API           | `ChangeSet.mapPos` / `field.map(tr.changes)` — Decision 3                         |
| `api.window.openAuxiliary` signature   | Confirmed via Extension Development docs — Decision 7                             |
| Gray-matter version                    | `^4.0.3` already in task-vault; reuse — Decision 6                                |
| Archive vs delete                      | Clarified in spec: soft-delete archive, Archived section, Include archived toggle |
| Comment thread depth                   | Clarified in spec: flat, max depth 2                                              |
| Export slug                            | Clarified in spec: `<title-kebab>-<uuid8>.md`                                     |
