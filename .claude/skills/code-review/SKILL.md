---
name: code-review
description: Structured code-review pass for a diff or change set. Use before any change is reported complete, and on demand via /review.
---

# Code review

Runs the `code-reviewer` subagent. Code review at Google is as much about **knowledge transfer and
keeping the codebase readable over time** as it is about catching bugs — see the
`code-review-philosophy` and `style-guides-as-scaling-tools` concepts. Sections produced:

1. **Change size** — is this small enough to review well? Flag oversized diffs (roughly >400 lines of
   non-generated, non-mechanical change) and suggest splitting. Large changes get rubber-stamped;
   small changes get real review.
2. **Diff summary** — plain-language description of what changed.
3. **Readability** — would a teammate unfamiliar with this code understand it? Names say intent,
   the change is written for the *reader*, complexity is justified. This is a first-class concern,
   not a nicety.
4. **Convention check** — does it match patterns in this repo? Cite files.
5. **Test coverage** — every behavioral change has at least one test; list them. (Quality of those
   tests is the `test-quality-review` skill's job.)
6. **Security** — injection, auth, secret handling, deserialization, SSRF.
7. **Performance** — N+1, unbounded loops, hot-path allocations, sync I/O in async code.
8. **Correctness** — edges, off-by-one, nil/null, error paths.
9. **Docs** — flag stale markdown via the doc index.
10. **Verdict** — Approve / Approve with comments / Request changes (with specific items).

## Review norms (the Google way)

- **Be decisive and fast.** Review latency blocks the author; a prompt review with comments beats a
  perfect review that arrives a day later. Prefer "Approve with comments" (trusting the author to
  address nits) over another round-trip when nothing is blocking.
- **One thorough reviewer** who understands the code beats three distracted ones.
- **Separate blocking issues from nits.** Mark non-blocking suggestions clearly so the author knows
  what actually gates the merge.

No vague comments. Each issue cites file:line and a concrete fix. See `references/review-rubric.md`.
