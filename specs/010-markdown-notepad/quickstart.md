# Quickstart: Markdown Notepad Extension Development

**Feature**: `specs/010-markdown-notepad`  
**Date**: 2026-06-18

---

## Prerequisites

- Node.js 20+ and npm 10+ (matching project root `.nvmrc` / `engines`)
- Terminator repo cloned and root dependencies installed: `npm install`

---

## Extension Setup

```bash
# 1. Create extension directory
mkdir -p extensions/notepad/src/{editor,components,ipc,db,stores}
mkdir -p extensions/notepad/tests/{unit/{db,ipc,editor,stores},components}

# 2. Create manifest
cat > extensions/notepad/manifest.json << 'EOF'
{
  "id": "terminator.notepad",
  "name": "Notepad",
  "version": "0.1.0",
  "description": "Markdown notepad with live preview, margin comments, tags, and full-text search.",
  "main": "src/index.js",
  "minAppVersion": "0.1.0"
}
EOF

# 3. Create extension package.json (all deps isolated here — never root package.json)
# See specs/010-markdown-notepad/plan.md §Technical Context for exact version constraints
```

---

## Running in Development

```bash
# Start the full app in dev mode (picks up all extensions automatically)
npm run dev

# The Notepad extension loads alongside all other extensions.
# Open the "Notes" global tab or press Cmd+Shift+N to test.
```

---

## Running Tests

```bash
# All tests (root vitest.config.ts picks up extensions/notepad/tests/**)
npx vitest run

# With coverage (required before any PR — 80% gate)
npx vitest run --coverage

# Watch mode during development
npx vitest --watch extensions/notepad
```

---

## Building Extensions

```bash
# After changing TypeScript source in extensions/notepad/src/
npm run build:extensions

# Never edit extensions/notepad/src/index.js directly — it is a build artifact.
```

---

## Lint

```bash
npm run lint

# Must pass with 0 errors before any commit.
```

---

## Key Files Reference

| File                                                   | Purpose                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `extensions/notepad/src/index.ts`                      | Main process entry: activate(api), DB init, IPC registration, global hotkey |
| `extensions/notepad/src/renderer.tsx`                  | Renderer entry: global tab, quick-create route, keyboard shortcuts          |
| `extensions/notepad/src/db/db.ts`                      | SQLite init, schema, migrations                                             |
| `extensions/notepad/src/editor/livePreview.ts`         | CM6 live-preview ViewPlugin + decorations                                   |
| `extensions/notepad/src/editor/commentField.ts`        | CM6 StateField for comment anchor RangeSet                                  |
| `specs/010-markdown-notepad/plan.md`                   | Implementation plan (this feature)                                          |
| `specs/010-markdown-notepad/data-model.md`             | SQLite schema + TypeScript domain types                                     |
| `specs/010-markdown-notepad/contracts/ipc-channels.md` | All IPC channel contracts                                                   |
| `docs/adr/ADR-015-codemirror6-editor.md`               | ADR for CM6 editor engine choice (write during M2)                          |

---

## Milestone Development Order

Follow the milestones defined in `plan.md` strictly:

1. **M1** — Scaffold + plain textarea + SQLite + `Cmd+Shift+N` overlay → notes survive restart
2. **M2** — Replace textarea with CM6 live-preview editor
3. **M3** — Comments (anchor, margin, threads, orphan)
4. **M4** — FTS5 search + tag management
5. **M5** — Export/import
6. **M6** — Polish, empty state, settings, ADR, docs, lint/coverage gate

Each milestone must pass `npx vitest run --coverage` with all thresholds ≥ 80% before moving to the next.

---

## Isolation Test

Before considering the extension complete, verify isolation:

```bash
# Remove the notepad extension directory temporarily and confirm the app builds
mv extensions/notepad /tmp/notepad-backup
npm run build
# Should succeed with 0 errors. Restore after check.
mv /tmp/notepad-backup extensions/notepad
```
