# Notepad Extension

Markdown notepad with live preview, margin comments, tags, and full-text search.

## Features

- **Markdown editor** — CodeMirror 6 editor with live preview
- **Margin comments** — anchored, threaded comments (max depth 2) that re-map as the document changes; comments that fail to re-anchor are marked orphaned
- **Tags** — tag notes, rename or delete tags globally, filter the note list by tag
- **Full-text search** — FTS5 + BM25 ranking across notes, with `tag:` / `-tag:` query tokens
- **Diagrams** — diagram notes with their own comments and tags
- **Export / Import** — export notes to a folder (`.md`), with comments as sidecar/inline/both; import `.md` files, matching existing notes by frontmatter `id`

## Storage

Notes, tags, comments, diagrams, and settings are stored in the shared PGlite (PostgreSQL-compatible) database via the injected `ExtensionDB`. Note, tag, and comment IDs are UUIDs assigned at creation and stable across restarts.

See also: `specs/010-markdown-notepad/contracts/ipc-channels.md` for the full IPC surface.
