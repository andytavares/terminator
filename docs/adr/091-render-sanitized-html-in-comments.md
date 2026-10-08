# ADR 091: Render sanitized HTML in comments and PR descriptions

**Status**: Accepted

**Date**: 2026-10-08

**Supersedes**: the "never render raw HTML" part of [ADR-011](011-react-markdown-for-comments.md). `react-markdown` + `remark-gfm` and `RichContent` as the single renderer stand.

Numbered 091 because ADR 089 is taken by order WO-1008-287 on its own branch.

## Context

GitHub bodies routinely carry HTML: `<details>` blocks from bots, `<img>` from
drag-and-drop uploads, `<br>`, `<sub>`, tables written as HTML. `RichContent`
had no raw-HTML handling, so `mdast-util-to-hast` dropped every one of them and
the PR description, conversation comments, review summaries and inline threads
all lost content GitHub itself shows.

## Decision

`RichContent` runs two rehype plugins after `remark-rehype`:

```
markdown ─ remark-gfm ─ remark-rehype ─ rehype-raw ─ rehype-sanitize ─ React
```

- **`rehype-raw@7.0.0`** parses the HTML nodes into real elements, so tags
  nest with the markdown around them.
- **`rehype-sanitize@6.0.0`** with `defaultSchema`, which is GitHub's own
  allowlist. It removes `<script>`, `<iframe>`, `<style>`, every `on*`
  attribute and every URL whose protocol is not `http`, `https`, `mailto`,
  etc. It keeps `className="language-*"` on `<code>`, so highlight.js still
  highlights fenced code.
- `clobberPrefix` is set to `''`. `remark-rehype` already prefixes footnote
  ids with `user-content-`; the schema's default prefix would add a second
  one to the ids but not to the hrefs, and every footnote link would point
  nowhere.

Sanitize runs last, so nothing after it can reintroduce an attribute it
removed. The existing `a` and `code` overrides are unchanged.

Both packages are maintained by the unified collective alongside
`react-markdown`, are the pairing `react-markdown` documents for HTML, and
add no renderer: the output is still React elements, never `innerHTML`.

## Alternatives considered

| Alternative                                 | Why rejected                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `body_html` from the GitHub API             | Every read in `github.ipc.ts` and the drafts would change; still needs sanitizing to render |
| `marked` + `DOMPurify`                      | Second renderer and sanitizer for the same job; ADR-011's XSS reasoning still holds         |
| `rehype-raw` without `rehype-sanitize`      | Runs any script or handler a commenter writes                                               |
| Hand-written tag allowlist in `RichContent` | Reimplements `hast-util-sanitize`, which already encodes GitHub's list                      |

## Consequences

- Every surface that renders through `RichContent` renders HTML, including
  agent notes, findings and the comment composer's preview. They share one
  renderer by design (ADR-011), and the same sanitizer covers them.
- Raw-HTML `id` and `name` attributes are no longer prefixed. A body can set
  an element id inside the extension's view; it cannot override a property
  the page already defines, such as `window.electronAPI`.
- Images in private repositories point at `github.com/user-attachments/…`,
  which needs a signed-in session. The extension view has none, so those
  images show as broken. Public images load.
- `<img>` is capped at the column width and tables scroll inside it
  (`pr-review.css`).
- The Create PR dialog keeps its `marked` preview of the operator's own text.
