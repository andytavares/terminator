# ADR-011: `react-markdown` + `remark-gfm` for Comment Body Rendering

**Date**: 2026-05-07
**Status**: Accepted
**Branch**: `003-pr-review`

## Decision

Use `react-markdown@9` and `remark-gfm@4` to render all comment bodies and the PR description. No other markdown renderer is introduced.

## Motivation

1. **Safe by default.** `react-markdown` renders to React elements — it never calls `innerHTML` or `dangerouslySetInnerHTML` on untrusted input. GitHub comment bodies are user-generated; XSS risk from raw HTML injection is real.

2. **GFM support.** `remark-gfm` adds tables, strikethrough, task lists, and autolinks — the same extensions GitHub itself renders. Without it, GitHub-flavoured comments would render incorrectly.

3. **Active, well-maintained ecosystem.** Both packages are maintained by the [unified collective](https://github.com/unifiedjs/collective), a governance body with 7+ active maintainers. Multiple CVE scans (Snyk, npm audit) show no known vulnerabilities. `react-markdown` has 13k+ GitHub stars; `remark-gfm` has 2k+ stars.

4. **Composable with existing `highlight.js`.** A custom `code` component in `RichContent.tsx` passes fenced code blocks to the already-installed `highlight.js` for syntax highlighting — no new syntax-highlighting dependency needed.

## Alternatives Considered

| Alternative                          | Why Rejected                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `marked` + `dangerouslySetInnerHTML` | XSS risk without a dedicated sanitizer; adds `dompurify` dependency                    |
| Hand-rolled subset parser            | Brittle; violates Constitution §III (minimalism — don't reinvent well-solved problems) |
| `@uiw/react-md-editor`               | Includes a full editor; overkill for render-only use case                              |

## Consequences

- Two new pinned dependencies added: `react-markdown@9.0.x` and `remark-gfm@4.0.x`.
- Both are ESM-only in their latest versions; `electron-vite` (Vite-based) handles ESM correctly.
- `RichContent.tsx` is the single shared renderer component — all comment display goes through it, ensuring consistency.
- If the unified ecosystem changes major versions, upgrading `react-markdown` and `remark-gfm` together is the only migration needed (they are designed to be co-versioned).
