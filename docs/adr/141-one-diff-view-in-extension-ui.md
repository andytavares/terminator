# ADR 141: One diff view in extension-ui

**Status**: Accepted

**Date**: 2026-11-04

## Context

The Git tab drew its diff in `FileDiffView.tsx`, with its own table, split layout and highlighting. The core agent tab shows a file change from an agent as `<pre>{oldText}\n{newText}</pre>` (`AgentView.tsx`). A second renderer would copy the first and drift from it, as the three `relativeTime()` helpers did.

## Decision

`DiffView` in `packages/extension-ui` draws every line diff. It takes data only: `hunks` (each with a `header` and `lines`), an optional `language`, and `layout` (`unified` or `split`). A line has `type` (`add`, `remove` or `context`), `content`, `oldLineNumber` and `newLineNumber`. `linesFromTexts(oldText, newText)` builds the lines from two texts, so the agent tab can draw an ACP diff without a git hunk. The package holds the highlight.js setup (`highlight`, `extensionOf`) and the diff styles, which use `--tm-*` tokens only. `highlight.js` is a dependency of the package at the version the Git extension pins (ADR 097).

`FileDiffView` keeps the loading, the toolbar, the divider drag and the empty states. It passes its hunks to `DiffView`. The Reviews tab keeps `DiffLineRows`, which has comment and selection behaviour that `DiffView` does not.

Only `escapeHtml` or highlight.js output reaches `dangerouslySetInnerHTML`, the same rule as `extensions/git-integration/CLAUDE.md` "Rendering untrusted text".

## Consequences

- A change to how a diff looks is made once and shows in the Git tab and the agent tab.
- `linesFromTexts` builds a full table of line matches, so it suits one file of an agent change, not a very large file. A Myers diff replaces it if that limit is reached.
- The diff class names (`diff-line`, `diff-table`) are shared with the Reviews tab, so a rule in one stylesheet reaches both.
