---
name: code-review
description: Structured code-review pass for a diff or change set. Use before any change is reported complete, and on demand via /review.
---

# Code review

Runs the `code-reviewer` subagent. Sections produced:

1. **Diff summary** — plain-language description of what changed.
2. **Convention check** — does it match patterns in this repo? Cite files.
3. **Test coverage** — every behavioral change has at least one test; list them.
4. **Security** — injection, auth, secret handling, deserialization, SSRF.
5. **Performance** — N+1, unbounded loops, hot-path allocations, sync I/O in async code.
6. **Correctness** — edges, off-by-one, nil/null, error paths.
7. **Docs** — flag stale markdown via the doc index.
8. **Verdict** — Approve / Request changes (with specific items).

No vague comments. Each issue cites file:line and a concrete fix. See `references/review-rubric.md`.
