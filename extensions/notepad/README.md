# Notepad Extension

Markdown notepad with live preview, margin comments, tags and full-text search.

## Features

- **Markdown editor** — a CodeMirror 6 editor with live preview
- **Live-preview constructs** — headings, bold/italic/strikethrough, inline and fenced code, links, images, blockquotes, horizontal rules, task checkboxes, mermaid diagrams, GFM tables and GitHub alerts (`> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`). Tables and alerts fall back to raw markdown while the caret is inside them, so they stay editable. Click a table cell to put the caret in that cell
- **Outline** — the open note's headings in the right rail above the comments, nested by level. Click a heading to scroll the editor to it. The outline shares the rail evenly with the comments, sized by the rail rather than by content. It appears in the docked panel and in a pop-out note window, and you toggle it from the toolbar. It lists ATX headings only, matching what the live preview renders, and excludes headings inside fenced code (`src/editor/outline.ts`)
- **Live / Source / Read** — one segmented control in the toolbar picks how the note shows. **Live** edits the rendered preview, **Source** edits the raw markdown, and **Read** renders it read-only. Read always renders, so choosing it from Source switches the preview back on. A pop-out note window offers Live and Source. Beside the control, icon toggles show and hide the outline and the comments. Export is at the foot of the note list
- **Enter keeps block markers with their text** — pressing Enter at the start of a heading pushes the whole heading down. It does not leave the `#` alone on the line above
- **One note, one body** — a note open in both the docked panel and a pop-out window stays in sync. Each surface adopts the saves that the other makes
- **Margin comments** — anchored, threaded comments (maximum depth 2) that re-map as the document changes. Comments that fail to re-anchor are marked orphaned
- **Tags** — tag notes, rename or delete tags globally and filter the note list by tag
- **Full-text search** — substring match across note titles and bodies (newest first, any letter case), with `tag:` and `-tag:` query tokens
- **Diagrams** — diagram notes with their own comments and tags
- **Export / Import** — export notes to a folder (`.md`), with comments as sidecar, inline or both. Import `.md` files, which match existing notes by frontmatter `id`

## Why the editor behaves as it does

The code comments point to this reasoning (`src/editor/livePreview.ts`, `src/components/NotepadView.tsx`, `src/components/QuickCreateOverlay.tsx`).

- **Fenced code stays raw while it is being typed.** With the caret on the opening fence line, the user is still typing the ` ``` ` and its language, so nothing renders. Otherwise the line would collapse mid-keystroke. A fence with no body yet is a block under construction and also stays raw, so it appears only when there is something to show. With the caret in the body, the code is styled but both fences stay visible, so the language stays readable and clickable.
- **Fences, tables and alerts are not gated on `focused`.** That flag flips only on a focus-change event. A stale `false` made a half-typed fence disappear. It also kept a table rendered with the caret inside it, so the caret had nowhere to land and mouse and keyboard could not edit the table.
- **Some tables are not drawn as a block.** A table inside a quote carries `> ` on its later lines, which `parseTable` rejects, so it stays raw markdown instead of throwing inside the state field. A table inside a list item does not start at the start of its line. A block widget can replace only whole lines (a mismatch would take the whole editor down), so the editor replaces that table inline.
- **Focus is tracked with `EditorView.focusChangeEffect`.** CodeMirror reports a focus change from inside an update, where a plugin cannot dispatch ("Calls to EditorView.update are not allowed while an update is in progress"). A plugin that tried crashed, so the caret line never showed its raw markdown. [`focusChangeEffect`](https://codemirror.net/docs/ref/#view.EditorView^focusChangeEffect) turns the change into a state effect instead. A preview switched on in an editor that already has focus sees no change, so a small plugin seeds it.
- **Cmd+Alt+M and Cmd+Shift+F are handled in the view, not with `globalShortcut`.** They fire only while Terminator is focused and the view is mounted. The Cmd+Alt+M chord matches the `CommandOrControl+Alt+M` accelerator that it replaced. Keep them in sync so the binding that users know does not move silently. The code matches the keys on `e.code`: on macOS, Option+M types the dead key `µ`, so `e.key === 'm'` never fires while Alt is held.
- **Quick create and search are modal shells.** The design system's `ModalShell` (a native `<dialog>`, [ADR 110](../../docs/adr/110-modal-surfaces-use-the-native-dialog-element.md)) gives each shell Escape, focus, the backdrop's outside press and a place in the open-surface count that the double-Escape "leave the extension" gesture reads ([ADR 026](../../docs/adr/026-double-escape-extension-exit.md)). Without that count, the host saw no open modal. The text-field guard protected focus in the composer, but not focus on a button, so two Escapes closed Notepad and took the draft with it. Escape is the dialog's own close request, so a CodeMirror that stops the key's propagation does not keep the dialog from closing.

## Settings

Under **Settings → Extensions → Notepad**:

| Key                                      | Type   | Default                        | What it does                                                         |
| ---------------------------------------- | ------ | ------------------------------ | -------------------------------------------------------------------- |
| `terminator.notepad.exportPath`          | folder | `~/Documents/Terminator Notes` | The folder Export starts on                                          |
| `terminator.notepad.commentExportFormat` | enum   | `sidecar`                      | How Export writes comments: `sidecar`, `inline` or `both`            |
| `terminator.notepad.autosaveMs`          | number | `800`                          | How long typing must pause before a note is saved, in ms (100–10000) |
| `terminator.notepad.defaultTags`         | string | `''`                           | Comma-separated tags a quick-created note starts with                |
| `terminator.notepad.editorFontSize`      | number | `14`                           | The editor's text size in px (8–32)                                  |
| `terminator.notepad.db.reinit`           | action |                                | Applies the schema again without deleting data                       |

A view reads the values with `extension.getSettingsValues()` and again on `extension.onSettingsChanged`, so a change applies at once (`src/stores/settings.store.ts`). `src/notepad-settings.ts` holds the bounds and defaults. Diagrams keep their own 1.2 s save delay, because the extension writes a scene whole.

## Storage

The extension stores notes, tags, comments, diagrams and settings in the shared SQLite database (`app.sqlite`) through the injected `ExtensionDB`. Note, tag and comment IDs are UUIDs assigned at creation and stable across restarts. The schema is created with `CREATE TABLE IF NOT EXISTS` on every launch, so a launch never alters data that is already there. Search applies the tag filters in SQL and matches the text in JavaScript, so case folds for every script (`é` matches `É`). FTS5 was tried and rejected: its `trigram` tokenizer finds no match for a query under 3 characters, and its word tokenizer cannot match inside a word.

See also: [`specs/010-markdown-notepad/contracts/ipc-channels.md`](https://github.com/andytavares/terminator/blob/8e1f355937df5328fc4e8fc52f5d1e794e949a6b/specs/010-markdown-notepad/contracts/ipc-channels.md) for the full IPC surface. `specs/` is no longer in the repository; the link opens the last version.
