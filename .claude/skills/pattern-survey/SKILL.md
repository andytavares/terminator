---
name: pattern-survey
description: Identify how a concern (auth, logging, error handling, retries, validation, caching, etc.) is implemented across the codebase. Find every implementation, cluster by approach, identify the dominant pattern and the outliers, and recommend convergence. Use for questions like "how do we do X across the app?"
---

# Pattern survey

Given a topic (e.g. "JWT verification", "structured logging", "retry with backoff"), produce a map of how the codebase actually does it today.

## Procedure

1. **Define the search.** Extract 2-4 keywords from the topic. Include framework-specific terms.
   - "JWT verification" → `jwt`, `verify`, `parse`, `validate`, `claim`
   - "Retry with backoff" → `retry`, `backoff`, `exponential`, `attempts`

2. **Cast a wide net.** ripgrep with context, language-aware:
   ```
   rg -i -t go -C 2 '<keyword>' --files-with-matches
   ```

3. **Read each hit.** Don't trust filenames — read enough of each match to understand which approach it is. Capture: file path, function/method, library used, key parameters.

4. **Cluster.** Group implementations by approach (same library + same flags + same flow = same cluster). Name each cluster.

5. **Count.** How many call sites per cluster? Which cluster is the newest? Oldest? Most tested?

6. **Identify the canonical reference.** What does the official documentation of the library/framework recommend? Cite the exact docs page.

7. **Report.**

## Report shape

```
Topic: <topic>

Clusters found:
  Cluster A — <name> (N call sites, newest)
    Library:     <library + version>
    Lives at:    <file paths>
    Pattern:     <one-paragraph description>
    Tests:       <count, with paths>
    Matches official docs: yes/no — <citation if no>

  Cluster B — <name> (M call sites, oldest)
    ... same shape

Recommendation: <converge on A | extend A to absorb B's edge cases | keep separate because reason>

Risks of converging: <list>
```

## Anti-pattern flags

Flag a cluster as a problem if any of the following are true:
- It re-implements something the framework already provides natively.
- It skips a check the official docs say is required (e.g. JWT `iss` validation).
- It uses a deprecated API of the library it depends on.
- It silently catches errors that other clusters propagate.

See `references/pattern-cluster-shapes.md`.
