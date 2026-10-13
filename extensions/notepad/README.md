# Notepad Extension

Markdown notepad with live preview, margin comments, tags, and full-text search.

## Features

- **Markdown editor** — CodeMirror 6 editor with live preview
- **Live-preview constructs** — headings, bold/italic/strikethrough, inline and fenced code, links, images, blockquotes, horizontal rules, task checkboxes, mermaid diagrams, GFM tables, and GitHub alerts (`> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`). Tables and alerts fall back to raw markdown while the caret is inside them, so they stay editable — click any table cell to put the caret in that cell
- **Outline** — the open note's headings in the right rail above the comments, nested by level; clicking one scrolls the editor to that heading. Shares the rail evenly with the comments, sized by the rail rather than by content. Present in the docked panel and in a pop-out note window, and toggled from the toolbar. ATX headings only, matching what the live preview renders, and headings inside fenced code are excluded (`src/editor/outline.ts`)
- **Markdown / Live toggle** — the toolbar button (and the same button in a pop-out note window) switches between the rendered live preview and the raw markdown source. This is independent of Read mode, which controls editability
- **Enter keeps block markers with their text** — pressing Enter at the start of a heading pushes the whole heading down instead of stranding its `#` on the line above
- **One note, one body** — a note open in both the docked panel and a pop-out window stays in sync; each surface adopts saves made by the other
- **Margin comments** — anchored, threaded comments (max depth 2) that re-map as the document changes; comments that fail to re-anchor are marked orphaned
- **Tags** — tag notes, rename or delete tags globally, filter the note list by tag
- **Full-text search** — FTS5 + BM25 ranking across notes, with `tag:` / `-tag:` query tokens
- **Diagrams** — diagram notes with their own comments and tags
- **Export / Import** — export notes to a folder (`.md`), with comments as sidecar/inline/both; import `.md` files, matching existing notes by frontmatter `id`

## Settings

Under **Settings → Extensions → Notepad**:

| Key                                      | Type   | Default                        | What it does                                                         |
| ---------------------------------------- | ------ | ------------------------------ | -------------------------------------------------------------------- |
| `terminator.notepad.exportPath`          | folder | `~/Documents/Terminator Notes` | The folder Export starts on                                          |
| `terminator.notepad.commentExportFormat` | enum   | `sidecar`                      | How Export writes comments: `sidecar`, `inline` or `both`            |
| `terminator.notepad.autosaveMs`          | number | `800`                          | How long typing must pause before a note is saved, in ms (100–10000) |
| `terminator.notepad.defaultTags`         | string | `''`                           | Comma-separated tags a quick-created note starts with                |
| `terminator.notepad.editorFontSize`      | number | `14`                           | The editor's text size in px (8–32)                                  |
| `terminator.notepad.db.reinit`           | action |                                | Re-applies the schema without deleting data                          |

A view reads the values with `extension.getSettingsValues()` and again on `extension.onSettingsChanged`, so a change applies at once (`src/stores/settings.store.ts`). Bounds and defaults live in `src/notepad-settings.ts`. Diagrams keep their own 1.2 s save delay: a scene is written whole.

## Storage

Notes, tags, comments, diagrams, and settings are stored in the shared SQLite database (`app.sqlite`) via the injected `ExtensionDB`. Note, tag, and comment IDs are UUIDs assigned at creation and stable across restarts. The schema is created with `CREATE TABLE IF NOT EXISTS` on every launch, so a launch never alters data that is already there. Search matches with `LIKE`, which ignores case for ASCII letters only. Notes from the previous PGlite database are imported once on the first start after the upgrade.

See also: `specs/010-markdown-notepad/contracts/ipc-channels.md` for the full IPC surface.
