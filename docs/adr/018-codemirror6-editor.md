# ADR-018: CodeMirror 6 as the Notepad Editor Engine

**Status**: Accepted  
**Date**: 2026-06-18  
**Deciders**: Andrew Tavares

---

## Context

The Markdown Notepad extension requires an editor that supports:

- Obsidian-style live preview (hide raw markdown syntax on non-cursor lines)
- Comment anchor remapping (track character positions through document mutations)
- Checkbox toggle widgets within the markdown flow
- Keyboard shortcuts and search integration
- No DOM dependency for unit testing of core decoration logic

---

## Decision

Use **CodeMirror 6** (`@codemirror/*`) as the editor engine.

---

## Motivation

1. **Live preview via decorations**: CM6's `Decoration.mark` and `Decoration.replace` on a `ViewPlugin` allow per-line cursor-aware syntax hiding with ~100 lines of pure TypeScript. A test can cover it without a DOM.
2. **Comment anchor remapping**: `StateField<CommentAnchor[]>` with `tr.changes.mapPos()` gives exact, transaction-aware position tracking. It needs no polling or diffing.
3. **Official docs verified**: The CM6 API is stable (1.x) and actively maintained. Large codebases use it in production (Replit, Obsidian, Linear).
4. **Testable core logic**: `buildDecorations(state, selection)` is a pure function that Vitest can call without jsdom. Only the `ViewPlugin` wrapper needs `/* v8 ignore */`.

---

## Alternatives Considered

| Option                 | Rejected reason                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **ProseMirror**        | Lower-level, requires schema definition; comment anchor mapping would need custom plugins; steeper learning curve |
| **Lexical** (Meta)     | Less mature CM6 ecosystem; no equivalent of `StateField.map(tr.changes)` for positional tracking                  |
| **plain `<textarea>`** | No decoration, no cursor-aware preview, no programmatic position mapping                                          |

---

## Consequences

- **Positive**: Decorations are incremental and O(viewport), not O(document). The performance benchmark (T030a) confirms p95 ≤ 16 ms on 5,000-line documents.
- **Positive**: `extensions/notepad/package.json` namespaces all `@codemirror/*` packages. The root bundle is unaffected.
- **Negative**: CM6's WidgetType subclasses require a DOM, so tests cannot cover them without jsdom. `/* v8 ignore */` covers them.
- **Negative**: FTS5 `bm25()` cannot be used in ORDER BY when the FTS table is joined. The fix is to use `rank` via a subquery.
