# Feature Specification: Markdown Notepad Extension

**Feature Branch**: `010-markdown-notepad`  
**Created**: 2026-06-18  
**Status**: Draft  
**Input**: User description: "A first-party Terminator extension that adds a markdown notepad with Obsidian-style live editing, Google-Docs-style margin comments, tagging, and full-text search. Notes are stored in SQLite and can be exported to a folder of .md files. A note can be created from anywhere in the app with Cmd+Shift+N."

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Quick Note Capture (Priority: P1)

A developer is working mid-task in the terminal and wants to capture a fleeting thought without losing focus. They press `Cmd+Shift+N` from anywhere in the app (even when Terminator is backgrounded), a compact overlay appears, they type a title and/or body, and press `Cmd+Enter` to save. The note is immediately available in the main notepad view. Pressing `Esc` cancels without saving.

**Why this priority**: This is the core value proposition — removing friction from note capture. Without it, users will keep a separate app open. Every other feature builds on having notes in the system.

**Independent Test**: Can be fully tested by pressing `Cmd+Shift+N`, typing content, pressing `Cmd+Enter`, then opening the Notepad tab and verifying the note appears. Delivers immediate capture value without any other features.

**Acceptance Scenarios**:

1. **Given** Terminator is in the foreground, **When** the user presses `Cmd+Shift+N`, **Then** a frameless centered overlay appears within 500 ms containing a title field, a body area, and a tag input.
2. **Given** the overlay is open with content, **When** the user presses `Cmd+Enter`, **Then** the note is saved to SQLite, the overlay closes, a "Note saved" toast appears, and the note is immediately visible in the main notepad view.
3. **Given** the overlay is open, **When** the user presses `Esc`, **Then** the overlay closes without saving and no note is created.
4. **Given** the note body is not empty but the title field is empty, **When** the user saves, **Then** the title is derived from the first heading or first line of the body; if the body is also empty, the title becomes "Untitled note".
5. **Given** the `Cmd+Shift+N` global shortcut is claimed by another OS-level app, **When** Terminator launches, **Then** a warning toast is shown and the shortcut falls back to an in-app binding active when Terminator is focused.

---

### User Story 2 — Live-Preview Markdown Editing (Priority: P2)

A user opens the Notepad tab, selects a note (or creates one), and edits it in the center pane. Markdown syntax renders in place as they type: headings scale up, `**bold**` shows bold text with the `**` hidden, `- [ ]` becomes a clickable checkbox, fenced code blocks show with syntax highlighting, and tables render as grids. The line the cursor is on always reveals the raw markdown so the user can edit the markup directly. The note autosaves to SQLite within 800 ms of the user stopping. No save button is needed.

**Why this priority**: Live preview is the editing experience that makes the notepad feel like a first-class tool rather than a plain textarea. It is the feature users will judge most viscerally after the first capture.

**Independent Test**: Can be tested by opening any note, typing `## Heading`, moving the cursor off the line, and verifying it renders as a heading. Typing `- [ ] task` and clicking the checkbox verifies interactivity. Waiting 1 s and reopening the note verifies autosave.

**Acceptance Scenarios**:

1. **Given** the editor contains `## My Heading` and the cursor is on a different line, **When** the view is rendered, **Then** the `##` marker is hidden and "My Heading" appears at heading size.
2. **Given** the cursor moves onto the heading line, **When** the cursor arrives, **Then** the raw `## My Heading` markdown is revealed for editing.
3. **Given** the note contains `- [ ] buy milk`, **When** the user clicks the checkbox widget, **Then** it changes to `- [x] buy milk` in the source and the checkbox appears checked.
4. **Given** the user stops typing for 800 ms, **When** the debounce fires, **Then** the note body is persisted to SQLite and a "Saved" indicator is shown.
5. **Given** a note is open and the user presses `Cmd+E`, **When** the key fires, **Then** the editor toggles between live-preview mode and raw source mode.

---

### User Story 3 — Margin Comments with Anchoring (Priority: P3)

A user selects a span of text in the editor, a "Comment" button appears near the selection (or they press `Cmd+Opt+M`). They type a comment and submit it. A highlighted mark appears on the anchored text; a card appears in the right margin aligned to that text. As the user edits the note around the comment — adding lines above, rewriting nearby sentences — the highlight and card follow the anchored text automatically. When the note is closed and reopened, the comment still anchors to the same text. If the anchored text has been deleted, the comment moves to an "Orphaned comments" section rather than disappearing.

**Why this priority**: This is the most complex feature and the one most likely to drive retention for writing-heavy use cases. It is P3 because the product is viable without it, but it is strongly differentiated.

**Independent Test**: Can be tested by selecting text, adding a comment, editing lines above the selection, and verifying the highlight moves with the text. Closing and reopening the note verifies durable anchoring. Deleting the anchored text verifies orphan handling.

**Acceptance Scenarios**:

1. **Given** text is selected in the editor, **When** the user clicks the floating "Comment" button or presses `Cmd+Opt+M`, **Then** a comment composer popover appears anchored to the selection.
2. **Given** a comment is submitted, **When** the note view renders, **Then** the anchored text is highlighted and a margin card appears vertically aligned to the anchored line.
3. **Given** a comment exists and the user inserts three lines above the anchored text, **When** the insertion is made, **Then** the highlight and margin card have moved down to stay aligned with the original anchored text.
4. **Given** a note with comments is closed and reopened, **When** the note loads, **Then** each comment re-anchors: first by saved offset (if the text at that offset matches the saved quote), then by text-quote search.
5. **Given** the anchored text has been deleted before reopening, **When** the note loads, **Then** the comment appears in a collapsed "Orphaned comments" section in the margin — it is not silently deleted.
6. **Given** a comment card in the margin, **When** the user clicks it, **Then** the editor scrolls to and briefly flashes the anchored text highlight.

---

### User Story 4 — Search and Tag Filtering (Priority: P4)

A user has accumulated many notes. They open the search field and type a term; ranked results appear instantly with matched snippets highlighted. They refine using `tag:infra` to filter by tag, or click a tag in the sidebar. Tags can be added to notes via the chip input in the editor or by typing `#tag` inline in the body — inline tags are parsed on save and kept in sync with the relational tag set.

**Why this priority**: Findability becomes critical as the note count grows. Without search, the notepad does not scale beyond ~20 notes. P4 because P1–P3 must work first.

**Independent Test**: Can be tested by creating 5 notes with different tags and body text, then searching for a term that appears in 2 of them, verifying the ranked results, and filtering by a tag to get a subset.

**Acceptance Scenarios**:

1. **Given** notes exist with varying content, **When** the user types a search term, **Then** results appear ranked by relevance (BM25) with the matched snippet highlighted.
2. **Given** the search box contains `tag:infra`, **When** the query runs, **Then** only notes tagged `infra` appear regardless of body text match.
3. **Given** a note body contains `#infra` inline, **When** the note is saved, **Then** the `infra` tag is added to the note's relational tag set and appears in the tag sidebar.
4. **Given** a tag is renamed via the tag management UI, **When** the rename completes, **Then** the new name appears on all previously tagged notes.

---

### User Story 5 — Export to Markdown Folder (Priority: P5)

A user wants a portable backup of their notes. They open the Export dialog, choose a folder (or accept the default `~/Documents/Terminator Notes`), select scope (all notes / selected note / by tag), and click Export. Each note writes as `<slug>.md` with YAML frontmatter. Comments export to a sidecar `<slug>.comments.json`. Re-exporting the same folder is idempotent — notes are matched by frontmatter `id` and overwritten, not duplicated.

**Why this priority**: Export is the escape hatch that makes the notepad trustworthy. Users who distrust lock-in need it; without it, some will not adopt at all. P5 because it requires the full data model to exist first.

**Independent Test**: Can be tested by exporting two notes to a temp folder, verifying `.md` files exist with frontmatter, changing one note's body, re-exporting, verifying the file was updated (not duplicated), and verifying a `comments.json` sidecar for a note with comments.

**Acceptance Scenarios**:

1. **Given** the Export dialog is open, **When** the user clicks "Export All", **Then** each note writes to `<folder>/<slug>.md` with YAML frontmatter containing `id`, `title`, `tags`, `created`, `updated`.
2. **Given** a note has been exported and then modified, **When** the user exports again to the same folder, **Then** the existing `.md` file is overwritten (matched by `id` in frontmatter), not duplicated.
3. **Given** a note has comments, **When** the note is exported, **Then** a companion `<slug>.comments.json` sidecar is written alongside the `.md` file.
4. **Given** a folder of `.md` files with valid frontmatter, **When** the user triggers Import, **Then** each file becomes a note; files whose frontmatter `id` already exists in the database are updated rather than duplicated.

---

### Edge Cases

- What happens when `Cmd+Shift+N` is pressed while the quick-create overlay is already open? The overlay gains focus; a second overlay is not spawned.
- What happens when the note body is empty at autosave time? An empty note is valid and saved normally; title defaults apply on first save.
- What happens when a comment anchor text occurs multiple times in the note? The `prefix`/`suffix` fields disambiguate; if ambiguous after re-anchoring, the comment is marked orphaned.
- What happens when the export folder path is not writable? The export dialog shows an error; no partial write is left on disk.
- What happens when a note's title changes between exports? The slug is re-derived from the new title + same UUID, producing a new filename. The old filename is left on disk (not cleaned up automatically). Re-export is idempotent for existing slugs but does not delete renamed slugs.
- What happens when FTS5 search receives a malformed boolean query? The query is treated as a plain-text search; no crash or unhandled error.
- What happens when a note title derived from the body is a duplicate of an existing note title? Duplicates are allowed — notes are keyed by UUID, not title.
- What happens when a user deletes a note? The note is archived (hidden from the main list and excluded from search). It is not permanently removed. An Archived section in the UI allows the user to restore it or permanently delete it with a confirmation step.
- What happens when the user searches and there are matching archived notes? Archived notes are excluded from results by default. An "Include archived" toggle surfaces them when enabled.
- What happens when the editor contains a very large note (5,000+ lines)? Decoration recomputation is incremental (viewport + changed ranges only); the editor remains responsive.

---

## Requirements _(mandatory)_

### Functional Requirements

**Quick Create**

- **FR-001**: The system MUST register a global keyboard shortcut `Cmd+Shift+N` (CommandOrControl+Shift+N) that opens the quick-create overlay even when Terminator is backgrounded or minimized.
- **FR-002**: If the OS rejects the global shortcut, the system MUST show a warning toast and register an equivalent in-app shortcut as a fallback.
- **FR-003**: The quick-create overlay MUST contain a title field (optional), a markdown body area with live-preview, and a tag chip input with autocomplete from existing tags.
- **FR-004**: Pressing `Cmd+Enter` in the overlay MUST save the note and close the overlay with a "Note saved" toast. Pressing `Esc` MUST cancel without saving.
- **FR-005**: When the title is empty, the system MUST derive a title from the first heading or first non-empty line of the body, falling back to "Untitled note".
- **FR-006**: A saved note MUST be immediately queryable in the main view and the full-text search index (written in the same database transaction).

**Live-Preview Editor**

- **FR-007**: The editor MUST render markdown syntax in place with syntax tokens hidden on non-cursor lines. Rendered elements MUST include: H1–H6, bold, italic, strikethrough, inline code, links (URL hidden until cursor enters), images (widget), unordered/ordered lists, checkboxes (clickable), blockquotes, horizontal rules, fenced code blocks (syntax-highlighted), and tables (rendered widget).
- **FR-008**: The line(s) intersecting the current cursor selection MUST display raw markdown punctuation; all other lines MUST hide punctuation (Obsidian Live Preview behavior).
- **FR-009**: Clicking a `- [ ]` checkbox widget MUST toggle the source between `- [ ]` and `- [x]`.
- **FR-010**: The editor MUST support: undo/redo, find/replace within a note (`Cmd+F`), auto-continuation of lists and checkboxes on `Enter`, smart indent, and `Tab`/`Shift+Tab` list nesting.
- **FR-011**: The note MUST autosave to the database on a debounced interval of ≤ 800 ms after the user stops typing, and also on editor blur or window close.
- **FR-012**: A "Saved" / "Saving…" indicator MUST be shown in the editor chrome. No explicit save button is required.
- **FR-013**: Pressing `Cmd+E` MUST toggle between live-preview mode and raw source mode.
- **FR-014**: The editor MUST use only `--tm-*` design tokens: `--tm-font-mono` for code, `--tm-font-ui` for rendered prose.

**Comments**

- **FR-015**: Selecting text in the editor MUST surface a floating "Comment" button near the selection. Pressing `Cmd+Opt+M` MUST open the comment composer for the current selection.
- **FR-016**: On comment submit, the anchor MUST be stored as `{ start_offset, end_offset, quote, prefix, suffix }`, the anchored text MUST be highlighted in the editor, and a card MUST appear in the right margin vertically aligned to the anchored line.
- **FR-017**: On every editor transaction, comment anchor ranges MUST be remapped via `ChangeSet.mapPos` so highlights and cards follow the text as the user edits.
- **FR-018**: On note load, anchors MUST resolve by saved offset first; if `body.slice(start, end) !== quote`, the system MUST re-locate by text-quote search (using `prefix`/`suffix` for disambiguation). Comments that cannot be re-located MUST be placed in a collapsed "Orphaned comments" section — never silently deleted.
- **FR-019**: Comments MUST support flat-threaded replies (max depth 2): a top-level comment can have replies, but replies cannot themselves be replied to. The margin renders top-level comment cards with indented reply cards below each. Comments MUST also support resolve/unresolve, author + timestamp display, and edit/delete of the current user's own comments.
- **FR-020**: Clicking a margin card MUST scroll to and briefly flash its anchor; clicking an anchor MUST highlight its card. Resolved, active, and orphaned comments MUST be visually distinct.

**Tagging**

- **FR-021**: Tags MUST be addable via the tag chip input in the editor and via inline `#tag` tokens in the body. On save, inline `#tag` tokens MUST be parsed and reconciled with the relational tag set.
- **FR-022**: Renaming a tag MUST update it on all associated notes. Deleting a tag MUST remove the tag association without deleting the notes.
- **FR-023**: A tag sidebar MUST list all tags with note counts; clicking a tag MUST filter the note list to notes with that tag.

**Search**

- **FR-024**: Free-text search MUST run against a full-text index over note title, body, and tag names, ranked by relevance. The system MUST support prefix queries, phrase queries, and boolean operators.
- **FR-025**: A `tag:foo` token in the search box MUST filter results to notes tagged `foo`, combinable with free-text terms. A `-tag:foo` token MUST exclude tagged notes.
- **FR-026**: Search results MUST show title, a matched snippet with the search term highlighted, tags, and updated date. Selecting a result MUST open the note.

**Export & Import**

- **FR-027**: Exporting MUST write notes as `<slug>.md` where slug is `<title-kebab-case>-<first-8-chars-of-uuid>` (e.g., `auth-retry-notes-a1b2c3d4.md`). The slug is derived at export time from the current title and the note's UUID. Files include YAML frontmatter (`id`, `title`, `tags`, `created`, `updated`). Scope MUST be selectable: all notes, current note, or by tag.
- **FR-028**: Comments MUST export to a companion `<slug>.comments.json` sidecar file. The `.md` prose MUST remain clean and Obsidian-compatible.
- **FR-029**: Re-exporting to the same folder MUST overwrite existing files matched by `id` in frontmatter; no duplicate files may be created.
- **FR-030**: Importing from a folder MUST create a note per `.md` file; if a file's frontmatter `id` already exists in the database, the note MUST be updated, not duplicated.
- **FR-031**: The export folder path MUST be configurable in extension settings, defaulting to `~/Documents/Terminator Notes`.

**Note Lifecycle**

- **FR-033**: The "Delete" action on a note MUST archive it (set `archived_at` timestamp) rather than permanently remove it. The note MUST disappear from the main note list and be excluded from search results by default.
- **FR-034**: An "Archived" section in the note list MUST display all archived notes. Users MUST be able to restore an archived note (clear `archived_at`) or permanently delete it from this section (with a confirmation dialog before hard-delete).
- **FR-035**: Search MUST exclude archived notes by default. An "Include archived" toggle in the search UI MUST extend results to include archived notes when enabled.

**Settings**

- **FR-032**: The extension MUST register a settings section under label "Notepad" exposing: export folder path, comment export format (sidecar / inline / both), autosave debounce interval, default new-note tags, and editor font size.

### Key Entities

- **Note**: The primary content unit. Has a UUID, title, raw markdown body, creation timestamp, update timestamp, and an optional archive timestamp. When `archived_at` is set the note is in the Archived state: hidden from the main list and excluded from search by default. Restoring clears `archived_at`; permanent deletion removes the row.
- **Tag**: A named label. Has a UUID and unique name. Many-to-many relationship with notes via a join table.
- **Comment**: A text annotation anchored to a range within a note. Has a UUID, parent note, optional parent comment ID (for flat threading — max depth 2; `parent_id` is null for top-level comments and non-null for replies), body text, author, status (open / resolved / orphaned), anchor data (start offset, end offset, quote, prefix, suffix), and timestamps. Only top-level comments carry anchor data; replies inherit the parent's anchor.
- **Full-Text Index**: A virtual index over note title, body, and tag names used for ranked free-text search. Maintained in the same transaction as note writes.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can press `Cmd+Shift+N`, type a note, and have it saved in under 2 seconds of total user effort.
- **SC-002**: Markdown live-preview updates appear within 16 ms (p95) on a note of 5,000 lines.
- **SC-003**: Comment re-anchoring succeeds in 95% or more of cases across a normal edit session. Zero comments are silently lost — orphaned comments are always surfaced in the UI.
- **SC-004**: Free-text search returns ranked results in under 50 ms (p95) across a vault of 1,000 notes.
- **SC-005**: Exporting 1,000 notes completes in under 5 seconds. Re-exporting the same vault to the same folder produces no duplicate files.
- **SC-006**: A note created via the quick-create overlay is immediately visible in the main notepad view and search results without a manual refresh.
- **SC-007**: Users can round-trip a note (export to `.md`, import back) without data loss in title, body, or tags.

---

## Clarifications

### Session 2026-06-18

- Q: How is the export filename slug derived — title+UUID suffix, UUID only, or title only? → A: Option A — slug is `<title-kebab-case>-<first-8-chars-of-uuid>` (e.g., `auth-retry-notes-a1b2c3d4.md`). Stable across title changes, collision-proof, and old files are overwritten cleanly on re-export.
- Q: What is the comment threading depth — flat (top-level + one reply level), two-level, or arbitrary? → A: Option A — flat threading, max depth 2. A comment can have replies but replies cannot be replied to. Renders as: top-level card → indented reply cards below it.
- Q: What is the note deletion UX flow — archive-first, direct hard-delete, or separate archive/delete actions? → A: Option A — "Delete" archives the note (removes from the main list); a dedicated Archived section lets users restore or permanently delete. Archived notes are excluded from search by default but visible with an "Include archived" filter toggle.

---

## Assumptions

- The extension targets the Terminator desktop Electron app only; mobile and web-SPA parity are out of scope for v1.
- `ExtensionAPI` v1.3.0 is available and provides all required surfaces: `globalShortcut`, `ipc`, `settings`, `window.openAuxiliary`, `nativeMenu`, and `notifications`. No changes to Terminator core are required.
- `better-sqlite3` and `gray-matter` are available as extension dependencies following the same pattern as the Task Vault extension.
- Comments are single-user; there is no real-time collaboration or multi-author model in v1.
- `[[wiki-links]]` and a graph view are explicitly deferred to a future version. The data model leaves room for them but v1 does not build them.
- Cloud sync is out of scope; export-to-folder + the user's own git/Dropbox is the accepted sync story.
- Note deletion defaults to soft-delete (archive via `archived_at`) to avoid accidental data loss. Hard-delete is available as a secondary action.
- Comment export defaults to sidecar JSON (`<slug>.comments.json`); inline HTML comment markers are an opt-in setting.
- `Cmd+Shift+N` does not collide with any reserved core accelerator or currently bundled extension shortcut (verified in research doc §4).
- The MCP stdio sidecar is optional and out of scope for the initial milestone deliverable (M6 polish phase).
- Autosave debounce defaults to 800 ms idle. This is configurable in settings.
