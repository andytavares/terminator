# Research: Unified Pull Request Review

**Branch**: `003-pr-review` | **Date**: 2026-05-07

---

## 1. Markdown Rendering for Comment Bodies

**Decision**: `react-markdown@9` + `remark-gfm@4`

**Rationale**:
The project already uses React 18 throughout the renderer. `react-markdown` is the canonical React-native markdown renderer — it renders to React elements (no `innerHTML` injection), making it safe for untrusted GitHub comment content. `remark-gfm` adds GitHub Flavored Markdown support (tables, strikethrough, task lists, autolinks) matching what GitHub itself renders.

- `react-markdown`: 13k+ GitHub stars, maintained by the [unified collective](https://github.com/unifiedjs/collective) (7+ active maintainers), actively released, no CVEs. Official docs: https://github.com/remarkjs/react-markdown
- `remark-gfm`: 2k+ stars, same unified collective, peer of `react-markdown`. Official docs: https://github.com/remarkjs/remark-gfm

`highlight.js` is already installed for diff syntax highlighting; it can be reused inside code blocks via `react-syntax-highlighter` or the existing `hljs.highlight()` call wrapped in a custom `code` component for `react-markdown`.

**Alternatives considered**:
- `marked` + `dangerouslySetInnerHTML`: Rejected — XSS risk from raw HTML injection without a sanitizer. Constitution §I (official docs) and safe-by-default preference favor react-markdown's element-tree approach.
- `@uiw/react-md-editor`: Overkill (includes an editor); we only need rendering here.
- Hand-rolled markdown: Rejected — brittle, unscoped, against §III (minimalism).

---

## 2. GitHub API Access Pattern

**Decision**: All GitHub PR review operations via `gh api` subcommands, executed through the existing `execShell` / `github:*` IPC channel (same pattern as `git:pr-status` and `git:pr-create`).

**Rationale**:
The project already has a sandboxed shell executor (`src/main/shell/shell-executor.ts`) that allows only `git` and `gh` commands (Constitution §VI — source integrity via official GitHub CLI). Adding a direct HTTPS fetch from the renderer would introduce a new dependency surface (node-fetch or Electron's `net` module), bypass the sandbox, and create a second auth mechanism. The `gh` CLI handles OAuth token refresh, pagination, and API versioning automatically.

All `gh api` calls use the `--jq` or `--template` flag for structured JSON output, parsed with `JSON.parse` after `exitCode` check. Rate-limit errors are detected by `gh` exit code 1 + stderr containing `API rate limit exceeded`.

Official `gh api` reference: https://cli.github.com/manual/gh_api

**Alternatives considered**:
- Octokit REST SDK (`@octokit/rest`): Would require managing OAuth tokens in the renderer — the existing auth is opaque behind `gh`. Adds a dependency with its own release cadence. Rejected.
- GitHub GraphQL API directly: More efficient for batching but requires managing auth tokens and adds complexity. Deferred to v2 if performance profiling shows `gh api` is the bottleneck.

---

## 3. File Dependency Ordering (v1)

**Decision**: Heuristic ordering based on filename patterns, with no call-graph construction in v1.

**Rationale**:
True caller→callee ordering requires a per-language symbol extraction step (Tree-sitter or LSP `references` calls). Building this correctly for all languages in scope (TypeScript, Python, Go, Rust, etc.) is a multi-week effort and is not required for the spec's success criteria. The spec explicitly allows graceful degradation (FR-015). The heuristic captures the most valuable aspect — separating interfaces from implementations and tests from source — which covers ~80% of the ordering benefit documented in the PRD research.

Heuristic ordering rules (applied within each chapter):
1. **Tier 0** — Type/interface files: `*.types.ts`, `*.interface.ts`, `*.d.ts`, `types.ts`, `interfaces.ts`, `index.ts`
2. **Tier 1** — Source files: everything else, sorted by (additions + deletions) descending
3. **Tier 2** — Test/spec files: `*.spec.*`, `*.test.*`, `__tests__/**`
4. **Tier 3** — Mechanical: `package-lock.json`, `yarn.lock`, `*.lock`, `*.generated.*`, files with only whitespace changes

Chapter grouping: files are grouped by the first path segment that differs between files (usually top-level directory). If all files share the same directory, grouping falls back to the four tiers above as separate chapters.

See ADR-010 for the full rationale and the v2 path to Tree-sitter.

**Alternatives considered**:
- Tree-sitter (WASM build): Correct but adds ~2 MB of WASM per language, requires an async init path, and the v1 timeline does not allow for correctness validation across languages. Deferred to v2.
- LSP `textDocument/references`: Would reuse existing language servers but requires a running LSP connection per language, which the app does not currently manage. Deferred.

---

## 4. Review Session Persistence

**Decision**: `electron-store@8.2` (already installed), new key `pr-review-sessions`.

**Rationale**:
`electron-store` already handles settings persistence. Adding a new top-level key avoids any new dependency and keeps all persistent state in one place. The store is synchronous by design (good for auto-save on every viewed-state change) and survives app restarts. Key schema: `"${repoRoot}:::${prNumber}:::${headSHA}"` → `ReviewSession` object (see data-model.md).

The SHA component of the key means a force-push naturally invalidates line-level position state while the per-file viewed record can be migrated forward (files whose SHA-keyed entry matches the new head are re-used).

**Alternatives considered**:
- SQLite via `better-sqlite3`: Appropriate for relational data; overkill for a flat key→session map. Adds a native module dependency. Rejected.
- In-memory Zustand only: Would lose state on app quit without explicit save. Rejected per clarification Q1 (auto-save on every action).

---

## 5. Risk Score Computation

**Decision**: Four of six metrics computed from available `git`/`gh` data; two (`complexityDelta`, `patchCoverage`) deferred to "?" in v1.

**Available metrics (v1)**:
- `changeSize`: `additions + deletions` from `gh pr view --json files`
- `churn90d`: `git log --oneline --since="90 days ago" -- <file>` line count, executed per-file via `github:file-churn` IPC
- `blastRadius`: grep for `import.*<relative-path>` across repo using `git grep` (sandboxed via `git` command in shell executor)
- `testFilePresent`: check existence of adjacent `*.spec.*` / `*.test.*` via `fs.existsSync`

**Deferred metrics (v1 → "?")**:
- `complexityDelta`: Requires AST parsing (Tree-sitter). Deferred per ADR-010.
- `patchCoverage`: Requires CI lcov/cobertura artifact. Deferred; the chip shows "?" unless a coverage file is found at a conventional path (`coverage/lcov.info`).

Composite score formula (v1 — 4 active metrics renormalised to 100%):
```
score = (changeSize_normalised × 0.333)
      + (churn90d_normalised × 0.25)
      + (blastRadius_normalised × 0.25)
      + (testFileMissing ? 0.167 : 0)
```
Normalisation: `min-max` within the current PR's file set. High-risk threshold: score > 0.60. Medium: 0.30–0.60.

See `risk-score.spec.ts` for the full test table.
