# ADR-091: Sanitised HTML in PR Descriptions and Comments (Supersedes ADR-011)

**Status**: Accepted
**Date**: 2026-10-08
**Supersedes**: ADR-011 (`react-markdown` + `remark-gfm` for comment body rendering)

## Decision

`RichContent.tsx` parses HTML embedded in markdown with `rehype-raw@7` and then runs `rehype-sanitize@6` with its default schema, the one derived from GitHub's own sanitiser, changed in two places: `clobberPrefix` is `''`, and `style` joins `script` in `strip`.

```
markdown ─ remark-gfm ─ remark-rehype ─ rehype-raw ─ rehype-sanitize ─ React elements
                                         (HTML → hast)  (allowlist)      (a / code overrides)
```

## Context

ADR-011 chose `react-markdown` because it never writes untrusted text through `innerHTML`. With no rehype plugin, though, react-markdown shows raw HTML as literal text. GitHub PR bodies and comments use HTML all the time (`<details>` for logs, `<br>` in tables, `<sub>`, `<img>` with a width), so the review screen showed tag soup where GitHub shows a disclosure or a line break.

## Why this keeps ADR-011's safety

- Output is still React elements; nothing new reaches `innerHTML`.
- `rehype-sanitize` runs last, after the only untrusted step (`rehype-raw`), which is what its docs require. Elements outside the allowlist are unwrapped, keeping only their text (`<iframe>`). `<script>` and `<style>` are removed together with their contents, so neither code nor CSS shows up as text. `on*` attributes are never allowed, and `href`/`src` are limited to safe protocols, so `javascript:` URLs go.
- The `a` override still sends only `http:`/`https:` links to `shell.openExternal`, and that now covers HTML `<a>` as well as markdown links.

## Why `clobberPrefix: ''`

`remark-rehype` already prefixes footnote ids and hrefs with `user-content-`. Leaving the sanitiser's default prefix on adds a second `user-content-` to the ids but not to the hrefs, so in-page footnote links break. The cost is that ids and names written in raw HTML are not prefixed, so a body can put an element with an `id` or `name` of its choosing into the extension view (DOM clobbering). It can only shadow a global that isn't already defined, and the sanitiser has already removed every way to run script.

## Alternatives considered

| Alternative                          | Why rejected                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Keep showing HTML as text            | The defect this replaces.                                                                             |
| `skipHtml` (as core `IssueMarkdown`) | Removes the tags but loses the content's structure (`<details>` turns into flat text).                |
| DOMPurify + `innerHTML`              | Leaves the react-markdown pipeline, so the `a` and `code` overrides would have to be rebuilt by hand. |

## Consequences

- Two new pinned dependencies in `extensions/git-integration/package.json`, from the same unified collective as `react-markdown`.
- Allowed `<img src>` fetches from its host, just as markdown `![](…)` already did. There is no content-security policy on the extension view; adding one is a separate decision.
- Core `IssueMarkdown.tsx` keeps `skipHtml`, and `PrDialog`'s `marked` preview is unchanged. Both are out of scope here.
