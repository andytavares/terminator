---
name: find-reuse
description: Use BEFORE writing any new function, helper, class, module, or utility. Searches the codebase for existing implementations and returns ranked candidates. MUST BE USED whenever the task involves adding new code.
---

# Find reuse

Before introducing new code, this skill returns up to 5 existing candidates that solve the same or adjacent problem.

## How

1. Extract the verb-noun pair from the proposed function (e.g. "parse url", "format date", "retry request").
2. Run:
   ```
   rg -i --type-add 'all:*' -t all "<verb>.*<noun>|<noun>.*<verb>" --files-with-matches | head -50
   ```
3. For each match: read the function signature, doc comment, and call sites.
4. Rank by: same domain > adjacent domain, same language > cross-language, well-tested > poorly-tested, recently-modified > stale.
5. Return:
   - Top 5 candidates with `path:line`, signature, one-line summary, test count.
   - Recommendation: **reuse** / **extend** / **new** (with justification).

## When to propose new code

Only if every top candidate has a documented reason it cannot be reused or extended (e.g. "different invariants", "deprecated", "lives in a package this layer cannot depend on"). Vague reasons ("it's not quite right") are not acceptable.

See also: `references/reuse-anti-patterns.md`.
