# ADR-029: One issue-tracker service, owned by core

**Status**: Accepted
**Date**: 2026-08-22
**Feature**: [031-linear-project-integration](https://github.com/andytavares/terminator/blob/8e1f355937df5328fc4e8fc52f5d1e794e949a6b/specs/031-linear-project-integration/spec.md)

## Context

Linear and Jira were reached from three places, and none of them shared anything:

- `extensions/speckit-pilot/src/api/linear.ts` — a `@linear/sdk` client, pinned at **27.0.0**
  while the current release is 91.0.0.
- `extensions/speckit-pilot/src/api/jira.ts` — a `fetch` client that calls
  `GET /rest/api/3/search`, which Atlassian documents as _"currently being deprecated and
  removed"_.
- `extensions/git-integration/src/github/pr-review-service.ts` — a regex over pull-request
  bodies. It produces a bare issue key because it has no API access at all.

One extension owned the file that held both credentials. If a user uninstalled that extension, the
credential was orphaned. Core's own sidebar, settings and project dialogs could not legally touch
any of it, because Constitution II forbids core from depending on an extension.

Feature 031 needs an issue attached to a project, rendered in a core panel, and fed to agent
sessions. None of that can be built on an extension-owned client.

## Decision

**A single core-owned service at `src/main/integrations/`, provider-shaped, with Linear and Jira
as two implementations behind one facade.** The renderer reaches it through the channel manifest.
Extensions reach it through `api.issues`. No component outside this module holds a tracker
credential or contacts a tracker.

Each of the five consequences of that shape had a plausible alternative, so each is recorded here.

### 1. Core, not an extension

Considered and rejected:

- **Leave the clients in speckit-pilot and have core call its IPC channels.** Fails Constitution
  II's own test: delete the extension directory and core stops working.
- **A new "integrations" extension.** Same violation, one level removed. Core's sidebar and
  settings would depend on it.

This decision _corrects_ the direction of the dependency. It does not add to it.

### 2. One issue shape for two trackers

`Issue` is the same type whichever tracker it came from. The pair
**(tracker, key)** identifies it, not the key alone: two trackers can both have a `TAV-42`, and they are
different issues. Anything a tracker does not supply is `null` and never synthesised. Jira has no
equivalent of Linear's suggested `branchName`, so Jira issues report `null` and the caller derives
a branch from key and title instead.

State is normalised to five `IssueStateType` values from each tracker's own vocabulary: Linear's
state types, and for Jira the **status categories**, not the status names, which every project renames.
The tracker's own label travels alongside for display.

### 3. ADF → markdown, converted in-house

Jira Cloud REST v3 stores descriptions and comments as Atlassian Document Format, a JSON
document. Linear supplies markdown. FR-014 requires one rendering, and FR-015 requires one
sanitisation story, so one of them has to move.

**Decision: convert ADF to markdown inside the Jira provider**, with a pure mapper that covers
exactly the node set FR-014 names: heading, paragraph, bulletList, orderedList, taskList, table,
blockquote, codeBlock, rule, hardBreak, and the text marks strong/em/code/strike/link.

Alternatives considered:

| Alternative                             | Rejected because                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expand=renderedFields` → Jira's HTML   | Two render paths and a second sanitiser. It is what the old code did, and it is why `Ticket.bodyFormat` had to exist as `'markdown' \| 'html'`.      |
| `adf-to-md` (npm)                       | **One maintainer**, last published 2024-11. Constitution IV: a package maintained by a single individual MUST NOT be adopted, regardless of fit.     |
| `@atlaskit/editor-markdown-transformer` | Atlassian-official and actively maintained, but a slice of the Atlaskit editor — an editor's dependency tree in the main process for one conversion. |

**Accepted degradation**: an ADF node outside the mapped set renders as its **text content**. It
does not render as nothing, and it does not throw an exception. A `panel` keeps its notice. A `mediaSingle` with nothing
readable in it contributes nothing. This is deliberate and bounded. Without it, one
unfamiliar node makes an entire issue unreadable. The mapper is not an open-ended ADF implementation and
must not become one (Constitution VII).

### 4. Policy in the facade, protocol in the provider

Providers are stateless functions over a credential. `issue-service.ts` holds everything that has memory or needs a judgement:
a 5-minute TTL cache, single-flight (so five surfaces that ask for one issue
cost one request), merge-with-failures across trackers, and rate-limit backoff that waits exactly
as long as the tracker asked.

**A failing tracker does not fail the call.** `listMine` and `search` return
`{ issues, failures }`. The operator sees what arrived and learns which tracker is missing and
why. `failures` also reports a tracker that is merely _not connected_, and does not silently
omit it. "Jira is not connected" is precisely the difference between an incomplete list and an
empty one, and FR-032 requires that the two be distinguishable.

Only rate limits are retried. An auth failure will not fix itself, and a retry spends what is
left of the operator's budget.

### 5. Comments are the only write

The `TrackerProvider` interface exposes `verify`, `listMine`, `search`, `get`, `comment`, and
nothing else. It has no state transition, no assignment, and no field edit. FR-034 and SC-014 say that the app never modifies any
field of an issue other than its comments.

Previously, nobody had written the method, and that was the only enforcement. That is not enforcement.
`tests/unit/integrations/providers/provider.spec.ts` asserts the **shape of the surface**, so a
future `transition()` fails a test and does not ship. The team deletes the extension's existing dead
`transitionStatus()` and does not carry it across.

**Linear comment addressing**: Linear documents the shorthand key (`TAV-42`) for `issue(id:)` and
`issueUpdate(id:)`, and **not** for comment creation. The old code passed the key and wrapped the
call in `.catch(() => {})`, so nobody knows whether it ever worked. The provider resolves key → UUID
first, which is documented to work in every case, and the silent catch is gone.

## Consequences

**Good.**

- One credential per tracker, stored once, encrypted with `safeStorage`, and migrated from the
  extension's file, so nobody re-enters what they already gave.
- Core surfaces can finally show issue data at all.
- The Jira client moves to `/search/jql` with `nextPageToken` paging. It leaves an endpoint that Atlassian is
  removing on Atlassian's timetable, not ours.
- `@linear/sdk` is upgraded 27 → 91 once, behind a facade, and not through two call sites.

**Costs, accepted.**

- We now own an in-house ADF mapper. FR-014's node list bounds it, and unit tests cover it fully.
- A provider-shaped seam for two providers is one indirection more than a single-tracker design
  would need. It exists because this feature genuinely has two trackers, not because the team
  anticipates a third (Constitution VII). The team writes no third provider.
- Core now carries `@linear/sdk`. `react-markdown` and `remark-gfm` arrive with it for the
  renderer half of the feature.

**Three things the documentation could not settle.** The team closed each deliberately and did not assume
an answer. The reasoning is in
[verifications.md](https://github.com/andytavares/terminator/blob/8e1f355937df5328fc4e8fc52f5d1e794e949a6b/specs/031-linear-project-integration/verifications.md):

- Whether Linear accepts an issue's human key when creating a comment. The team **designed this out** and did not
  answer it: we address Linear issues by UUID everywhere, which is documented to work for
  every operation.
- Whether the extension's old, error-swallowing "PR opened" comment ever worked. Unanswerable.
  The team deleted that code, and its replacement reports failures.
- Whether Jira's search pages correctly past the first page. Fixtures that model the
  documented behaviour cover it. The team accepted that basis, and real Jira users will exercise it.
