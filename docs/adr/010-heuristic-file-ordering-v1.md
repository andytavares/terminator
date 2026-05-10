# ADR-010: Heuristic File Ordering for v1 (defer Tree-sitter/LSP to v2)

**Date**: 2026-05-07
**Status**: Accepted
**Branch**: `003-pr-review`

## Decision

For v1, file ordering within chapters uses a static filename-pattern heuristic (four tiers: types/interfaces → source → tests → mechanical), with no call-graph construction. Tree-sitter or LSP-based topological ordering is explicitly deferred to v2.

## Motivation

The spec (FR-015) explicitly requires graceful degradation to heuristic ordering when a call graph cannot be built. The PRD acknowledges that building a correct cross-language call graph is a separate, week-long prototyping effort. The primary value of ordering — separating type definitions from implementations and tests from source — is achievable with the heuristic alone. Research cited in the PRD (Bagirov 2023/2026) shows that even a simple non-alphabetical ordering reduces missed defects; the exact caller→callee precision matters less than the broad structure.

## Heuristic Tiers (applied within each chapter)

| Tier | Pattern                                                                           | Rationale                           |
| ---- | --------------------------------------------------------------------------------- | ----------------------------------- |
| 0    | `*.types.ts`, `*.interface.ts`, `*.d.ts`, `types.ts`, `interfaces.ts`, `index.ts` | Contract/type files read first      |
| 1    | All other source files, sorted by (additions+deletions) desc                      | Most-changed files near top         |
| 2    | `*.spec.*`, `*.test.*`, `__tests__/**`                                            | Tests read after the code they test |
| 3    | `package-lock.json`, `*.lock`, `*.generated.*`, whitespace-only diffs             | Skimmable noise; auto-collapsed     |

## Chapter Grouping

Files are grouped by their first differing path segment (e.g., `src/auth`, `src/models`). If all files share one directory, the four tiers become four chapters.

## v1 Complexity Detection: Keyword-Count Cyclomatic Approximation (FR-021)

FR-021 requires inline complexity-hotspot annotations. Since Tree-sitter/LSP is deferred, v1 computes **cyclomatic complexity delta** from the diff using keyword counting — a well-established approximation used by tools such as `complexity-report` and ESLint's `complexity` rule.

### Decision-point keywords counted

`if` · `else if` · `for` · `while` · `do` · `switch` · `case` · `catch` · `&&` · `||` · `??` · `? ` (ternary)

### Per-hunk formula

```
complexityAdded   = count of keywords in `+` lines of this hunk
complexityRemoved = count of keywords in `-` lines of this hunk
hunkDelta         = complexityAdded - complexityRemoved
```

### Per-file formula

```
complexityDelta = sum(hunkDelta) across all hunks in the file's diff
```

A positive value means this PR added net cyclomatic complexity to this file.

### Hotspot threshold

A hunk is annotated as a hotspot when `hunkDelta >= 5`. Annotation text:
`"Complexity hotspot — this block adds N decision points (cyclomatic delta +N)."`

### v2 upgrade path

Replace `detectComplexityHotspots()` with a Tree-sitter-backed implementation that computes actual per-function cyclomatic complexity and reports the specific function name. The function signature and annotation rendering stay identical; no UI changes required.

## Consequences

- Reviewers may occasionally encounter a file before something it depends on (especially in circular dependency or monorepo scenarios). The "why this file is here" label and drag-and-drop reorder (FR-015b) mitigate this.
- The `buildChapters()` function is a pure function with no I/O, making it trivially testable (see `chapter-builder.spec.ts`).
- v2 upgrade path: Replace `buildChapters()` with a Tree-sitter–backed implementation. The interface (`PrChangedFile[]` → `Chapter[]`) stays identical; no UI changes required.
