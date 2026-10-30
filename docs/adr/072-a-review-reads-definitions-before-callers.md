# ADR 072: A review reads definitions before their callers

**Status**: Accepted

**Date**: 2026-09-27

**Supersedes in part**: [ADR-010](010-heuristic-file-ordering-v1.md) (its file ordering; its tier table and chapter grouping stay)

## Context

`buildChapters` put implementation files first, sorted by `layerScore` descending (routes, then components, then hooks … then utils). It put types after them. On a risk-score change, `ReviewDiffPane.tsx` came first and the own file of `computeRiskScore` came third. A reviewer read every call before the function it called. ADR-010 named Tree-sitter as the way out.

## Decision

```mermaid
flowchart LR
  P[PR files + patches] --> S[symbols.ts: tree-sitter per hunk]
  S --> G[defines / references graph]
  G --> T[topological sort, cycles kept together]
  T --> A[applyReadingOrder: chapters and files follow the steps]
```

- `web-tree-sitter` with the prebuilt grammars in `@vscode/tree-sitter-wasm` parses the hunks of each patch in the main process. A file defines the symbols declared in its hunks and the symbol named in each hunk header. It references the identifiers in its added lines.
- File A comes before file B when B references something that A defines. A test comes right after the last file it exercises. Lock and generated files stay last. A language with no grammar keeps its tier position.
- The reason for each file replaces the fixed `whyHere` string: "Uses RiskScore (step 1)", "Calls computeRiskScore (step 2)", "Renders HealthChips (step 5)".
- Chapters keep the grouping of `buildChapters`. `applyReadingOrder` sorts chapters by their earliest step and files by step. A drag-reorder by the reviewer still wins.
- Both packages are esbuild externals. `web-tree-sitter` finds its `.wasm` next to its own module, which bundling would move.

## Consequences

- Ordering is by file, not by hunk. A file is one step even when only one of its hunks is a definition.
- The same parse feeds complexity (branches per function, head against base), moved-block detection and the understandability measure.
- A snippet parse sees only the hunk. A symbol defined outside every hunk of the PR has no step and is shown as not in this PR.
