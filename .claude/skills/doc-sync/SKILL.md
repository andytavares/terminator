---
name: doc-sync
description: Keeps repository markdown documentation aligned with the code. Use after any code change that touches a path referenced in .claude/doc-index.json, when the user runs /docs-sync, or when the doc-keeper subagent is invoked.
---

# Doc sync

The doc index (`.claude/doc-index.json`) lists every markdown file with:

- summary
- owners
- referenced code paths
- last verified commit
- staleness score

Docs are code: version-controlled, reviewed, owned, and kept fresh — see the `docs-as-code`,
`docs-freshness`, and `documentation-types` concepts.

## Rules

1. Never invent docs. If a code change is user-facing and no doc covers it, surface the gap; don't auto-generate prose.
2. Update only what the code change actually invalidates. Cosmetic edits to unrelated paragraphs are out of scope.
3. Every factual claim in a doc must trace to a checked-in file. When you update, cite the source file:line in the PR commentary.
4. Preserve voice, tone, and headings.
5. **Respect the doc type.** Reference, conceptual/design, tutorial, and landing pages have different
   audiences and jobs — don't blur them (e.g. don't grow a reference page into a tutorial). Keep each
   doc doing the one job it's for.
6. **One canonical source per fact.** If you find the same fact documented in two places, flag the
   duplication rather than updating both — duplicated docs drift apart and rot. Recommend a single
   source of truth and links to it.
7. The `doc-keeper` subagent owns this work; do not run it inline in a regular implementation session.

See also: `references/doc-index-schema.md`.
