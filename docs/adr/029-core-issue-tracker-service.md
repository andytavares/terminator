# ADR-029: One issue-tracker service, owned by core

**Status**: Accepted
**Date**: 2026-08-22
**Feature**: [031-linear-project-integration](../../specs/031-linear-project-integration/spec.md)

## Context

Linear and Jira were reached from three places, and none of them shared anything:

- `extensions/speckit-pilot/src/api/linear.ts` — a `@linear/sdk` client, pinned at **27.0.0**
  while the current release is 91.0.0.
- `extensions/speckit-pilot/src/api/jira.ts` — a `fetch` client calling
  `GET /rest/api/3/search`, which Atlassian documents as _"currently being deprecated and
  removed"_.
- `extensions/git-integration/src/github/pr-review-service.ts` — a regex over pull-request
  bodies, producing a bare issue key because it has no API access at all.

Both credentials lived in a file owned by one extension. Uninstall that extension and the
credential is orphaned; core's own sidebar, settings and project dialogs could not legally touch
any of it, because Constitution II forbids core depending on an extension.

Feature 031 needs an issue attached to a project, rendered in a core panel, and fed to agent
sessions. None of that can be built on an extension-owned client.

## Decision

**A single core-owned service at `src/main/integrations/`, provider-shaped, with Linear and Jira
as two implementations behind one facade.** The renderer reaches it through the channel manifest;
extensions reach it through `api.issues`. No component outside this module holds a tracker
credential or contacts a tracker.

Four consequences of that shape are worth recording, because each had a plausible alternative.

### 1. Core, not an extension

Considered and rejected:

- **Leave the clients in speckit-pilot and have core call its IPC channels.** Fails Constitution
  II's own test: delete the extension directory and core stops working.
- **A new "integrations" extension.** Same violation, one level removed — core's sidebar and
  settings would depend on it.

The direction of the dependency is being _corrected_ here, not added to.

### 2. One issue shape for two trackers

`Issue` is the same type whichever tracker it came from, identified by the pair
**(tracker, key)** rather than by key alone — two trackers can both have a `TAV-42`, and they are
different issues. Anything a tracker does not supply is `null` and never synthesised: Jira has no
equivalent of Linear's suggested `branchName`, so Jira issues report `null` and the caller derives
a branch from key and title instead.

State is normalised to five `IssueStateType` values from each tracker's own vocabulary — Linear's
state types, Jira's **status categories** rather than status names, which every project renames.
The tracker's own label is carried alongside for display.

### 3. ADF → markdown, converted in-house

Jira Cloud REST v3 stores descriptions and comments as Atlassian Document Format, a JSON
document. Linear supplies markdown. FR-014 requires one rendering, and FR-015 requires one
sanitisation story, so one of them has to move.

**Decision: convert ADF to markdown inside the Jira provider**, with a pure mapper covering
exactly the node set FR-014 names — heading, paragraph, bulletList, orderedList, taskList, table,
blockquote, codeBlock, rule, hardBreak, and the text marks strong/em/code/strike/link.

Alternatives considered:

| Alternative                             | Rejected because                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expand=renderedFields` → Jira's HTML   | Two render paths and a second sanitiser. It is what the old code did, and it is why `Ticket.bodyFormat` had to exist as `'markdown' \| 'html'`.      |
| `adf-to-md` (npm)                       | **One maintainer**, last published 2024-11. Constitution IV: a package maintained by a single individual MUST NOT be adopted, regardless of fit.     |
| `@atlaskit/editor-markdown-transformer` | Atlassian-official and actively maintained, but a slice of the Atlaskit editor — an editor's dependency tree in the main process for one conversion. |

**Accepted degradation**: an ADF node outside the mapped set renders as its **text content**, not
as nothing and not as an exception. A `panel` keeps its notice; a `mediaSingle` with nothing
readable in it contributes nothing. This is deliberate and bounded — the alternative is that one
unfamiliar node makes an entire issue unreadable. It is not an open-ended ADF implementation and
must not become one (Constitution VII).

### 4. Policy in the facade, protocol in the provider

Providers are stateless functions over a credential. Everything with memory or a judgement lives
in `issue-service.ts`: a 5-minute TTL cache, single-flight so five surfaces asking for one issue
cost one request, merge-with-failures across trackers, and rate-limit backoff that waits exactly
as long as the tracker asked.

**A failing tracker does not fail the call.** `listMine` and `search` return
`{ issues, failures }` — the operator sees what arrived and is told which tracker is missing and
why. A tracker that is merely _not connected_ is reported in `failures` too, rather than silently
omitted: "Jira is not connected" is precisely the difference between an incomplete list and an
empty one, which FR-032 requires be distinguishable.

Only rate limits are retried. An auth failure will not fix itself, and retrying it spends what is
left of the operator's budget.

### 5. Comments are the only write

The `TrackerProvider` interface exposes `verify`, `listMine`, `search`, `get`, `comment` — and
nothing else. No state transition, no assignment, no field edit. FR-034 and SC-014 say no field
of an issue other than its comments is ever modified.

That rule used to be enforced by nobody having written the method, which is not enforcement.
`tests/unit/integrations/providers/provider.spec.ts` asserts the **shape of the surface**, so a
future `transition()` fails a test rather than shipping. The extension's existing dead
`transitionStatus()` is deleted rather than carried across.

**Linear comment addressing**: Linear documents the shorthand key (`TAV-42`) for `issue(id:)` and
`issueUpdate(id:)`, and **not** for comment creation. The old code passed the key and wrapped the
call in `.catch(() => {})`, so whether it ever worked is unknown. The provider resolves key → UUID
first, which is documented to work in every case, and the silent catch is gone.

## Consequences

**Good.**

- One credential per tracker, stored once, encrypted with `safeStorage`, migrated from the
  extension's file so nobody re-enters what they already gave.
- Core surfaces can finally show issue data at all.
- The Jira client moves to `/search/jql` with `nextPageToken` paging, off an endpoint that is
  being removed on Atlassian's timetable rather than ours.
- `@linear/sdk` is upgraded 27 → 91 once, behind a facade, instead of through two call sites.

**Costs, accepted.**

- An in-house ADF mapper is code we now own. Bounded by FR-014's node list and fully unit-tested.
- A provider-shaped seam for two providers is one indirection more than a single-tracker design
  would need. It exists because this feature genuinely has two trackers, not because a third is
  anticipated (Constitution VII) — no third provider is written.
- Core now carries `@linear/sdk`. `react-markdown` and `remark-gfm` arrive with it for the
  renderer half of the feature.

**Three things the documentation could not settle**, all closed deliberately rather than assumed
— the reasoning is in
[verifications.md](../../specs/031-linear-project-integration/verifications.md):

- Whether Linear accepts an issue's human key when creating a comment. **Designed out** rather
  than answered: we address Linear issues by UUID everywhere, which is documented to work for
  every operation.
- Whether the extension's old, error-swallowing "PR opened" comment ever worked. Unanswerable —
  that code is deleted, and its replacement reports failures.
- Whether Jira's search pages correctly past the first page. Covered by fixtures modelling the
  documented behaviour; accepted on that basis, to be exercised by real Jira users.
