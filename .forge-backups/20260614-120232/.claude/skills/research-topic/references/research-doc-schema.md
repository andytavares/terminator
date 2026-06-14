# Research Document Schema

Every `research.md` produced by the `research-topic` skill must contain the following sections, in this order. Sections marked **optional** may be omitted only if genuinely not applicable.

---

## Required Sections

### 1. Header block

```
# Research: <topic title>

**Date:** YYYY-MM-DD
**Requested by:** <git config user.name, or "unknown">
**Codebase context:** <one paragraph summarising what Phase 2 found>
```

### 2. Problem Statement

One paragraph. What question is being answered and why it matters. Written for a reader who has not seen the original request.

### 3. Scope

Two sub-lists:

- **In scope:** bullet points of what this research covers
- **Out of scope:** bullet points of what was explicitly excluded, with a one-phrase reason for each

### 4. Codebase Context

Bullet list of Phase 2 findings, each with a `file:line` citation. If Phase 2 found nothing, write: "No existing codebase evidence for this topic."

### 5. Options Considered

One sub-section per option (2–4 options). Each sub-section must contain:

```
### Option N: <name>

**Summary:** one sentence.

**Official source:**
Source: <Title> — <URL>
Quote: "<verbatim sentence from the source>"

**Feasibility:** Low / Medium / High — one sentence justification grounded in the codebase scan.

**Complexity to adopt:** Low / Medium / High — rough estimate with a one-sentence rationale.

**Risks:** bulleted list (security, maintenance, lock-in, breaking changes).

**Codebase fit:** yes / partial / no — one sentence explaining alignment or conflict with patterns found in Phase 2.
```

### 6. Comparison Table

| Criterion             | Option 1 | Option 2 | Option N |
| --------------------- | -------- | -------- | -------- |
| Official docs quality |          |          |          |
| Feasibility           |          |          |          |
| Complexity to adopt   |          |          |          |
| Codebase fit          |          |          |          |
| Key risk              |          |          |          |

### 7. Recommendation

One option, clearly named. Two to four sentences: what to pick, why, and what the main trade-off being accepted is. Must reference at least one finding from the Codebase Context section.

---

## Optional Sections

### 8. Open Questions _(optional)_

Bulleted list of questions this research could not resolve. Each is a candidate for `/forge.clarify`. Only include if genuine gaps exist.

### 9. Next Steps _(optional)_

Suggested follow-on commands, e.g.:

- `/forge.tasks NNN — decompose into implementation tasks`
- `/forge.clarify NNN — resolve the open questions above`
