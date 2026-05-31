---
name: find-reuse
description: Use BEFORE writing any new function, helper, class, module, or utility. Searches the codebase for existing implementations and returns ranked candidates. MUST BE USED whenever the task involves adding new code.
---

# Find reuse

Before introducing new code, this skill returns up to 5 existing candidates that solve the same or adjacent problem. It runs two complementary passes: a text pass (ripgrep) and a structural pass (ast-search).

## How

1. Extract the verb-noun pair from the proposed function (e.g. "parse url", "format date", "retry request").

2. **Text pass** — Run:

   ```
   rg -i --type-add 'all:*' -t all "<verb>.*<noun>|<noun>.*<verb>" --files-with-matches | head -50
   ```

   Record the matching `file:line` set.

3. **Structural pass** — Run the `ast-search` skill with:

   - The verb-noun term
   - The `file:line` set from the text pass (for deduplication)

   The ast-search skill reads `ast_search_tool` from `.claude/stack.json`. If `ast_search_tool` is `null`, skip this step and note it in the output.

4. **Merge results** — Combine text-pass and structural-pass matches, deduplicate by `file:line`, and remove false positives (comments, string literals that aren't implementations).

5. For each merged candidate: read the function signature, doc comment, and call sites.

6. Rank by: same domain > adjacent domain, same language > cross-language, well-tested > poorly-tested, recently-modified > stale.

7. Return:
   - Top 5 candidates with `path:line`, signature, one-line summary, test count, and which pass found it (text / structural / both).
   - Recommendation: **reuse** / **extend** / **new** (with justification).

## When to propose new code

Only if every top candidate has a documented reason it cannot be reused or extended (e.g. "different invariants", "deprecated", "lives in a package this layer cannot depend on"). Vague reasons ("it's not quite right") are not acceptable.

See also: `references/reuse-anti-patterns.md`.
