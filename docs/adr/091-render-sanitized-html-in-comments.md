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
- **`rehype-sanitize@6.0.0`** with `defaultSchema`, which "follows GitHub
  style sanitation". Only the tags and attributes on that list survive, so
  `<script>` and `<iframe>` are dropped, every `on*` attribute is removed, and
  `href` and `src` keep only `http`, `https`, `mailto`, `irc`, `ircs` and
  `xmpp`. It keeps `className="language-*"` on `<code>`, so highlight.js still
  highlights fenced code.
- The schema's `clobberPrefix` stays `user-content-`, so a body's
  `<img name="createElement">` or `id="activeElement"` cannot shadow a
  `document` property. `remark-rehype` gets `clobberPrefix: ''` so footnote
  ids are prefixed once, by the sanitizer, not twice.
- The `a` override rewrites an in-page `#x` href to `#user-content-x`, as
  GitHub's own page script does, so footnotes and anchors reach their target.
  Every other non-http(s) href (relative, `mailto:`) has its click cancelled:
  extension views have no `will-navigate` guard, so following it would
  replace the view.

Sanitize runs last, so nothing after it can reintroduce an attribute it
removed. The `code` override is unchanged.

`react-markdown`'s security section names `rehype-sanitize` as the safety net
for `rehype-raw`, and its changelog orders them `rehypeRaw` then
`rehypeSanitize`, as this change does. Neither package adds a renderer: the
output is still React elements, never `innerHTML`.

## Dependency health

Required by Constitution IV for each new dependency.

- **Official docs:** [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize),
  [rehype-raw](https://github.com/rehypejs/rehype-raw),
  [react-markdown security](https://github.com/remarkjs/react-markdown#security).
- **Community:** both live in the `rehypejs` organisation, part of the unified
  collective that also maintains `react-markdown` and `remark-gfm` (already
  in use). Maintainer count and last-release date: [UNVERIFIED], not measured
  for this record.
- **Pinned exactly** (`7.0.0`, `6.0.0`), no caret.

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
- Every `id` and `name` in a body, from HTML or footnotes, carries the
  `user-content-` prefix in the DOM.
- Images in private repositories point at `github.com/user-attachments/…`,
  which needs a signed-in session. The extension view has none, so those
  images show as broken. Public images load.
- `<img>` is capped at the column width and tables scroll inside it
  (`pr-review.css`).
- The Create PR dialog keeps its `marked` preview of the operator's own text.
