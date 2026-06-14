---
name: research-topic
description: Use when given a free-form topic or idea to investigate for feasibility, options comparison, or technology selection. Scans the codebase for existing related patterns, fetches official documentation for candidate options, and produces a structured research document with feasibility analysis, options comparison, and a recommendation. Do NOT use for implementation planning — use task-decomposition for that. Trigger verbs: "research", "investigate", "survey", "what does the official documentation say about", "compare options for".
---

# Research Topic

Produce a structured research document on the given topic. Follow the five phases below in order.

**Sourcing rule (non-negotiable):** Apply the `canonical-research` skill for all external lookups. Official vendor documentation is the only authoritative source for external claims. Every external claim must include `Source: <Title> — <URL>` and `Quote: "<verbatim>"`. Every codebase claim must include a `file:line` citation. See `.claude/skills/canonical-research/SKILL.md` for the full protocol.

---

## Phase 1 — Topic Intake

Parse the input into:

- **Primary question:** What is being investigated and why?
- **Constraints:** Any stated preferences, existing dependencies, or non-negotiables from the user.
- **Domain:** Infrastructure, library choice, architecture, developer workflow, etc.

If the topic is ambiguous or too broad to research in one pass, note the most likely interpretation and flag the assumption explicitly in the output document's Scope section. Do not stop — research the most likely interpretation.

---

## Phase 2 — Codebase Scan

Before touching the web, scan the repo for existing implementations or evidence relevant to the topic.

1. Extract 2–4 keywords from the topic.
2. Run ripgrep for each keyword across the repo.
3. Read any files that appear relevant.
4. Call the `find-reuse` skill if the topic implies adding a new capability.

Record every hit as `file:line`. The purpose is to establish:

- What does the codebase already do in this space?
- What constraints does it impose (languages, frameworks, patterns)?
- Are there any half-finished attempts that provide context?

If nothing relevant is found, write "No existing codebase evidence" and continue.

---

## Phase 3 — Option Enumeration

Identify 2–4 concrete candidate options (e.g. different libraries, architectural patterns, or approaches).

For each option:

1. Use WebFetch to retrieve the official documentation from the vendor or governing standards body.
2. Apply the `canonical-research` sourcing hierarchy: first-party docs win.
3. If official docs do not cover a candidate, say so explicitly — do not silently fall back to a community source.
4. Record the `Source:` and `Quote:` citation.

Aim for options that are genuinely distinct — not variants of the same approach with minor differences.

---

## Phase 4 — Analysis

For each option, assess:

| Dimension                   | What to evaluate                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| **Feasibility**             | Can this work given the codebase's languages, dependencies, and conventions? Low / Medium / High |
| **Complexity**              | Rough implementation effort. Low / Medium / High                                                 |
| **Official-docs alignment** | Does the vendor recommend this approach for this use case?                                       |
| **Codebase fit**            | Does it align with patterns found in Phase 2? yes / partial / no                                 |
| **Key risk**                | Security, maintenance burden, lock-in, or breaking change                                        |

---

## Phase 5 — Document Assembly

Assemble the output using the schema in `references/research-doc-schema.md`.

Rules:

- Every external claim: `Source: <Title> — <URL>` + `Quote: "<verbatim>"` on the next line.
- Every codebase claim: `file:line` citation inline.
- Recommendation section must name exactly one option and reference at least one finding from Phase 2.
- Open Questions section lists anything this research could not resolve — each is a candidate for `/forge.clarify`.
- Next Steps section may suggest follow-on commands (e.g. `/forge.tasks NNN`).

Write the assembled document to the path specified by the calling command (default: `.forge/NNN-slug/research.md`).
