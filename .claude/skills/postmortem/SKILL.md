---
name: postmortem
description: Use after something went wrong — a regression shipped, a fix broke a test, a hook blocked repeatedly, an agent ran in circles, a deploy failed. Scaffolds a blameless postmortem the Google way: find the systemic root cause and the fix, never the person to blame.
---

# Blameless Postmortem

When something fails, the useful question is "what about the system let this happen?" — not "who did
it?" A blameless postmortem documents the failure, traces it to a *systemic* root cause, and produces
concrete fixes so it can't recur. Blame produces silence and hidden mistakes; blamelessness produces
the honest information you need to actually fix things.

See the `blameless-postmortem` and `psychological-safety` concepts in the wiki.

## When to use

Use after any failure worth not repeating: a shipped bug, a broken build that wasn't caught, a fix
that caused a new failure, a repeated hook block or a wasted agent loop, a flaky test that bit you.
Small failures get short postmortems — the discipline matters more than the length.

## How

1. **Write the timeline.** What happened, in order, with timestamps/commits where available. Stick to
   observable facts. No motives, no names-as-causes ("the edit on `auth.go` at commit abc1234", not
   "Andrew broke auth").

2. **State the impact.** What broke, who/what was affected, how it was detected, how long it lasted.

3. **Find the root cause — keep asking "why."** Drive past the proximate cause to the systemic one.
   "The test failed" → why → "the mock didn't match prod" → why → "we interaction-tested instead of
   using a fake" → root: *a testing-pattern gap, not a careless edit.* The root cause should almost
   never be "a person was careless"; if it is, ask why the system allowed carelessness to ship.

4. **Separate triggers from causes.** The trigger is what set it off; the cause is why the system was
   vulnerable. Fix the cause.

5. **Write action items.** Each is concrete, owned, and verifiable — ideally something that makes the
   whole *class* of failure impossible (a test, a lint rule, a hook, a doc). Prefer fixes that shift
   the check left (`shifting-left`). A postmortem with no action items is just a story.

6. **Capture the learning.** If the lesson is durable and project-wide, propose adding it to the
   project constitution (`/forge-constitution`) or to memory. If it's a recurring tooling gap,
   consider whether a hook or skill should enforce it.

7. **Record the artifact.** Write to `.forge/postmortems/NNN-slug.md` (next integer N, zero-padded to
   3). Frontmatter: date, severity, status (`open`/`resolved`).

## Output

The `.forge/postmortems/NNN-slug.md` file and a summary: the systemic root cause in one sentence, and
the action items with owners. Surface the proposed durable learning for the user to accept or decline.

## Tone rule

The document never assigns blame to a person. If a draft sentence names someone as the cause, rewrite
it to name the system gap. This is non-negotiable — it's what makes the information trustworthy.
