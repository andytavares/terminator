---
name: deprecation-plan
description: Use when retiring an API, module, flag, endpoint, or dependency. Scaffolds a deprecation the way Google treats it — as an engineering project with an owner, a migration path, milestones, and a removal date — not a comment that says "deprecated" and rots forever.
---

# Deprecation Plan

A deprecation is the managed removal of something that still has users. The Google discipline: a
deprecation is **owned, milestoned, and tooled** — you provide the migration path and drive it to
zero, rather than marking something deprecated and hoping callers leave on their own. A deprecation
with no owner and no end date is just a lie in a comment.

See the `deprecation-as-engineering-discipline` and `large-scale-changes` concepts in the wiki.

## When to use

Use when something with existing callers must go away. If nothing depends on it yet, just delete it —
no deprecation needed.

## How

1. **Decide: advisory or compulsory?**
   - *Advisory* — "prefer the new thing, old thing still works indefinitely." Cheap, but it will not
     reach zero on its own. Only choose this if you genuinely don't need the old form gone.
   - *Compulsory* — "the old thing will be removed by date X." This is the real deprecation; the rest
     of the steps assume this.

2. **Assign an owner.** A deprecation without a named owner does not finish. Record who drives it.

3. **Provide the replacement first.** The new path must exist and be at least as good before you ask
   anyone to move. Document the before → after migration in one place.

4. **Find the callers.** Delegate to the `change-impact-analyst` subagent (or run `rg` + the
   `ast-search` skill). You need the real count and the owners of each call site — that is the work
   the deprecation has to grind down.

5. **Mark and warn.** Add the language-appropriate deprecation marker (`@deprecated`, `Deprecated`
   attribute, runtime warning, lint rule) pointing at the replacement. Prefer a signal that shows up
   at *build or write time* (shift left) over one that only fires at runtime.

6. **Milestone the removal.** Set concrete dates: warn-by, migrate-by, remove-by. Migrate callers
   yourself via the `large-scale-change` skill (expand → migrate → contract) rather than waiting on
   each team.

7. **Tombstone, then remove.** When callers hit zero, make the old path fail loudly for a grace
   period (tombstone), then delete it and prove zero references remain.

8. **Record the artifact.** Write the plan to `.forge/deprecations/NNN-slug.md` (next integer N,
   zero-padded to 3). Capture: what, why, owner, replacement, caller count, milestones, status.

## Output

The `.forge/deprecations/NNN-slug.md` file plus a summary: scope, owner, caller count, the three
dates, and the next concrete action. If the contract change is risky, also run `trade-off-record`.

## Related

- `large-scale-change` — the mechanism for migrating the callers.
- `change-impact-analyst` — finds and sizes the caller set.
- `trade-off-record` — records the decision to remove and what it costs consumers.
