# ADR-091: Sanitised HTML in PR Descriptions and Comments (Supersedes ADR-011)

**Status**: Accepted
**Date**: 2026-10-08
**Supersedes**: ADR-011 (`react-markdown` + `remark-gfm` for comment body rendering)

## Decision

`RichContent.tsx` parses HTML embedded in markdown with `rehype-raw@7` and then runs `rehype-sanitize@6` with its default schema, the one derived from GitHub's own sanitiser, with `style` added to `strip`. `remark-rehype` runs with `clobberPrefix: ''` so the sanitiser is the only thing that prefixes ids.

```
markdown ─ remark-gfm ─ remark-rehype ─ rehype-raw ─ rehype-sanitize ─ React elements
                                         (HTML → hast)  (allowlist)      (a / code overrides)
```

## Context

ADR-011 chose `react-markdown` because it never writes untrusted text through `innerHTML`. With no rehype plugin, though, react-markdown shows raw HTML as literal text. GitHub PR bodies and comments use HTML all the time (`<details>` for logs, `<br>` in tables, `<sub>`, `<img>` with a width), so the review screen showed tag soup where GitHub shows a disclosure or a line break.

## Why this keeps ADR-011's safety

- Output is still React elements; nothing new reaches `innerHTML`.
- `rehype-sanitize` runs last, after the only untrusted step (`rehype-raw`). Elements outside the allowlist are unwrapped, keeping only their text (`<iframe>`). `<script>` and `<style>` are removed together with their contents, so neither code nor CSS shows up as text. `on*` attributes are never allowed, and `href`/`src` are limited to safe protocols, so `javascript:` URLs go.
- The `a` override still sends only `http:`/`https:` links to `shell.openExternal`, and that now covers HTML `<a>` as well as markdown links. A relative or protocol-relative href (`./x`, `//host/x`) is stopped on click: extension views have no navigation guard, so following it would replace the review screen itself.
- Until the two plugins have loaded (see Consequences), the body renders with `skipHtml`, so raw HTML is dropped, never shown as text or as elements.

## Why every id and name is prefixed

An `id` or `name` in the page becomes a property of `document` or `window`, and it can replace a real one: `<img name="createElement">` makes `document.createElement` the image, not the function, and breaks any code that calls it. So the sanitiser keeps its default `clobberPrefix`, `user-content-`, and every `id` and `name` from a body comes out as `user-content-…`, as on GitHub.

`remark-rehype` would add the same prefix to footnote ids itself, giving `user-content-user-content-fn-1` once the sanitiser has run. Its own prefix is turned off instead, and the `a` override rewrites in-page hrefs (`#fn-1`, or `#notes` in raw HTML) to `#user-content-…` so they still reach their target. An href that already carries the prefix, as one copied from GitHub does, is left alone.

## Alternatives considered

| Alternative                          | Why rejected                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Keep showing HTML as text            | The defect this replaces.                                                                             |
| `skipHtml` (as core `IssueMarkdown`) | Removes the tags but loses the content's structure (`<details>` turns into flat text).                |
| DOMPurify + `innerHTML`              | Leaves the react-markdown pipeline, so the `a` and `code` overrides would have to be rebuilt by hand. |

## Consequences

- Two new pinned dependencies in `extensions/git-integration/package.json`, from the same unified collective as `react-markdown`.
- `rehype-raw` brings an HTML parser (parse5) of about 170 kB, which would push the review UI's single chunk (1,184 kB) past its 1,200 kB budget in `vite.renderer.config.ts`. `RichContent` imports both plugins dynamically on first render, so they build into their own chunk; the first body to render shows without its HTML for the moment the chunk takes to load from disk.
- Allowed `<img src>` fetches from its host, just as markdown `![](…)` already did. There is no content-security policy on the extension view; adding one is a separate decision.
- Core `IssueMarkdown.tsx` keeps `skipHtml`, and `PrDialog`'s `marked` preview is unchanged. Both are out of scope here.
