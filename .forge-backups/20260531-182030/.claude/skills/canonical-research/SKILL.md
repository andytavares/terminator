---
name: canonical-research
description: How Claude should source external information. Official first-party documentation comes first; community sources are a last resort and must be flagged. Use whenever you need to look up how a library, framework, language, protocol, or API behaves.
---

# Canonical Research — official docs first

This is the rule, in order:

1. **First-party docs win every time.** For "how do I do X in Y", the vendor's official documentation is the only authoritative source. FastAPI question → fastapi.tiangolo.com. Python stdlib → docs.python.org. AWS S3 → docs.aws.amazon.com. Go stdlib → pkg.go.dev. Kubernetes → kubernetes.io/docs.

2. **The repo itself is the second source.** If the question is about behavior here (not the framework in general), Read the code and Grep the repo before going to the web.

3. **Community sources are a fallback, never the lead.** Blogs, Stack Overflow, Medium, dev.to, Reddit, hackernoon, geeksforgeeks, w3schools — these can confirm or illustrate something the official docs already say. They cannot be the only source for a recommendation.

4. **Cite everything.** For every external claim, include the URL and a one-sentence verbatim quote so the user can verify in one click. For internal claims, cite `file:line`.

5. **When the official docs don't cover it**, say so explicitly. Do not silently fall back to a blog. Tell the user something like: "Official docs don't cover this case; the closest community guidance is [URL]. Want me to use it or escalate?"

## Examples

- "How do I add a route in FastAPI?" → start at fastapi.tiangolo.com/tutorial/, cite the exact page. Do not start at a Medium post even if it appears first in search.
- "How does goroutine scheduling work?" → go.dev/doc, the Go blog (official only), runtime package docs. Not a third-party article.
- "What's our auth pattern for the user service?" → Grep + Read the user service first. Mention any community references only if you're cross-checking against canonical docs.

## What to do when search results are noisy

Apply a domain hint to your search ("site:fastapi.tiangolo.com routing"). If your tooling lets you, restrict to the vendor's docs domain. Always prefer the latest stable version page over a versioned legacy page.

See `references/citation-format.md` for the exact format.
