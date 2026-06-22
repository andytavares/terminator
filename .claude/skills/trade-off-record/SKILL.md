---
name: trade-off-record
description: Use before a non-trivial or hard-to-reverse design decision — choosing a dependency, an architecture, a data format, a public API shape. Captures a lightweight ADR the Google way: there are no best practices, only trade-offs, so name the alternatives, the costs, and the time/scale horizon explicitly.
---

# Trade-off Record

Software engineering decisions are trade-offs over time and scale, not searches for a single right
answer. This skill forces the trade-off into the open and records it so the *reasoning* survives, not
just the outcome. It is a deliberately small ADR (Architecture Decision Record) — enough to make the
decision honest, not a committee document.

See the `always-be-deciding`, `software-engineering-vs-programming`, and `hyrum-s-law` concepts in
the wiki.

## When to use

Use when a decision is **hard to reverse** or **will be depended on** (a public API, a stored format,
a dependency you'll inherit forever, an architectural boundary). Skip it for reversible, local
choices — recording those is just ceremony.

## How

1. **State the decision as a question.** "Should we X or Y?" — concrete, not "think about data."

2. **Name the real alternatives** — including "do nothing." Each alternative is a separate option,
   not a strawman. If you can only think of one option, you haven't found the trade-off yet.

3. **For each alternative, name the trade-off explicitly:**
   - What it costs *now* (effort, complexity, dependency weight).
   - What it costs *later* (maintenance, lock-in, the cost of being wrong).
   - Who/what becomes coupled to it (Hyrum's Law: observable behavior becomes a contract).

4. **State the time and scale horizon.** A choice for a throwaway script and a choice for a 10-year
   load-bearing service are different decisions even with the same options. Say which one this is —
   this is the `software-engineering-vs-programming` distinction.

5. **State reversibility.** Is this a one-way door or a two-way door? One-way doors deserve more
   scrutiny; two-way doors should be decided fast and revisited (`always-be-deciding`).

6. **Decide, and say why** — in terms of the trade-offs above, not vibes. Note what would make you
   revisit it (the falsifiable condition).

7. **Record the artifact.** Write to `.forge/decisions/NNN-slug.md` (next integer N, zero-padded to
   3). Frontmatter: date, status (`accepted`/`superseded`), reversibility.

## Output

The `.forge/decisions/NNN-slug.md` file and a one-paragraph summary of the decision and the single
most important trade-off behind it.

## Note

This is not a substitute for research. For an unfamiliar problem space, run the `research-topic`
skill first; this skill records the *decision*, that one gathers the *options*.
