# Core Extension API addition: issue state transitions

**Feature**: `037-foundry-software-factory` | **Date**: 2026-09-06 | **Target version**: ExtensionAPI v2.3.0 | **ADR**: 041

This is the one change to core that this feature requires, and the only one. It is recorded in the plan's Complexity Tracking and needs an ADR because it supersedes a decision taken in feature 031.

## Why it is needed

FR-059 requires a work order to move its source issue's workflow state when work starts, when a draft pull request opens, and when it merges. That is not possible today:

- `src/main/integrations/providers/provider.ts:47` — `TrackerProvider` is `verify / listMine / search / get / comment`.
- `src/main/integrations/issue-service.ts:42` — `IssueService` mirrors it.
- `src/main/extensions/api.ts:332` — states the restriction in terms: _"There is deliberately no way to create or edit an issue, or to change any field of one: `comment` is the only write, and FR-034 says so."_

An extension cannot satisfy FR-059 by working around this. Holding a tracker credential inside an extension is forbidden by Constitution II and is the exact thing `ExtensionAPI.issues` exists to prevent.

## Why it does not break extension isolation

The capability added is generic. Core gains "an extension may move an issue's state"; it does not gain any knowledge of Foundry. No `foundry:*` name appears in `src/`. Deleting `extensions/foundry/` leaves core building and running, which is Principle II's own test.

## Scope: Linear only

Operator decision, 2026-09-06: **workflow-move write-back is built for Linear and for nothing else.** Jira remains connected, readable and commentable and gains nothing here.

That is expressed by making the two provider methods **optional**. Linear implements them; Jira omits them; `IssueService` exposes `supportsTransitions(tracker)` so a caller can find out _before_ it needs to know, which is what FR-059a requires — an order that cannot move its issue says so when it is agreed, not when the write fails.

The alternative shapes were both worse. Required methods that throw `not supported` on Jira give an interface that claims a capability half its implementations lack, discoverable only by calling and catching. Building the Jira path anyway means a provider path, a resolution rule and a test suite for a tracker nobody here uses. The optional shape makes adding Jira later additive rather than breaking.

## Why it is intent-based and not `setState(stateId)`

Two independent reasons, and the first stands even though only one provider implements it.

**FR-060 gives the operator the mapping.** "In review" is not a fact about a tracker; it is a decision about which of their states means that. A `setState(stateId)` signature pushes that resolution onto every caller, so every caller re-implements it. An intent keeps it in one place. True with one tracker as much as with two.

**And this is a published interface.** `ExtensionAPI` is in the risk grader's P0 set for a reason. Baking Linear's model into it would make it permanently unimplementable for a tracker the application already ships, because the two do not share a model:

**Linear** sets the target state directly. `issueUpdate(id, input: { stateId })` changes it, and workflow states carry a `type`; Linear's agent guidance queries states filtered by `type` — `team(id) { states(filter: { type: { eq: "started" } }) }` — rather than matching names. _(Linear developer documentation: GraphQL API, agent best practices.)_

**Jira** cannot set a status at all. `GET /rest/api/3/issue/{issueIdOrKey}/transitions` returns only the transitions available _from the issue's current status_, and `POST` to the same endpoint performs one. The documentation is explicit that a requested transition which does not exist or cannot be performed yields an empty list. _(Jira Cloud platform REST API v3, issues API group.)_

So `setState(stateId)` could never be implemented for Jira, and matching on state name is wrong for both — Linear's own guidance says use `type`, and Jira workflows are renamed freely. The Jira detail is recorded here not because it is being built, but because it is the evidence that the signature must not be Linear-shaped.

## The addition

### `TrackerProvider` (`src/main/integrations/providers/provider.ts`)

```typescript
/** The workflow positions this tracker can be asked to move an issue to. */
type TransitionIntent = 'started' | 'in_review' | 'done'

interface TrackerStateOption {
  /** Provider-native identifier: a Linear state id, or a Jira transition id. */
  readonly id: string
  readonly name: string
  /** Which intent this option satisfies, as the provider understands it. */
  readonly intent: TransitionIntent | null
  /** False when the tracker will not accept it from the issue's current status. */
  readonly available: boolean
}

interface TrackerProvider {
  // …existing: verify, listMine, search, get, comment

  /**
   * What this issue can be moved to, right now. Optional: a provider that
   * cannot move an issue omits both of these, and callers ask
   * `IssueService.supportsTransitions` rather than calling and catching.
   *
   * Per-issue rather than per-project because a tracker's answer may depend on
   * the issue's current status. Linear's does not, and returns the team's
   * states with `available: true` throughout.
   */
  states?(cred: StoredCredential, key: string): Promise<TrackerStateOption[]>

  /**
   * Move the issue. Resolves the intent against `states()` and applies it.
   * Rejects when no available option satisfies the intent — the caller decides
   * whether that matters.
   */
  transition?(cred: StoredCredential, key: string, intent: TransitionIntent): Promise<void>
}
```

**Implemented by**: `linear.provider.ts`. **Omitted by**: `jira.provider.ts`, which is unchanged by this feature.

**Linear implementation**: `states()` reads the issue's team states and maps Linear's `type` — `unstarted`/`backlog` → null, `started` → `started`, `completed` → `done` — with `in_review` matched against a `started` state whose name the operator has mapped, since Linear has no distinct review type. `transition()` calls `issueUpdate` with the resolved `stateId`.

**Jira**: not implemented. The shape above is what a future Jira implementation would satisfy — `states()` a direct read of the transitions endpoint, `available` true for whatever it returns and false by omission; `transition()` posting the resolved transition id — recorded so that adding it later is a filled-in optional method rather than a redesign.

### `IssueService` (`src/main/integrations/issue-service.ts`)

Three methods, wrapped in the existing credential resolution and rate-limit retry:

```typescript
states(tracker: TrackerId, key: string): Promise<TrackerStateOption[]>
transition(tracker: TrackerId, key: string, intent: TransitionIntent): Promise<void>
/** Whether this tracker can be asked to move an issue at all. Synchronous: it is a provider fact. */
supportsTransitions(tracker: TrackerId): boolean
```

`states()` participates in the existing TTL cache; `transition()` invalidates the cached issue on success, since its state has just changed. Both reject with a distinguishable `unsupported` error when the provider omits the method — but the intended path is that callers ask `supportsTransitions` first and never provoke it.

### `ExtensionAPI.issues` (`src/main/extensions/api.ts`)

```typescript
issues: {
  // …existing: connections, listMine, search, get, comment, linkFor, onLinkChange

  /** What this issue can be moved to. Per-issue: a tracker's answer may depend on current status. */
  states(tracker: TrackerId, key: string): Promise<TrackerStateOption[]>

  /** Move it. Rejects when no available option satisfies the intent. */
  transition(tracker: TrackerId, key: string, intent: TransitionIntent): Promise<void>

  /** Whether this tracker supports being moved at all. Ask before you need to know. */
  supportsTransitions(tracker: TrackerId): boolean
}
```

The comment at `api.ts:332` is rewritten to state the new boundary: comment and workflow position are the only writes; no other field of an issue may be changed, and nothing may create or delete one.

## What is deliberately not added

- **No `createIssue`, no `deleteIssue`, no general `updateIssue(fields)`.** A field-level write API would reopen every field of every issue to every extension to satisfy one requirement. Intent-based transition is the narrowest thing that satisfies FR-059.
- **No native attachment API.** FR-061 (pull request links on the issue) ships as a comment containing the links, which needs no core change. Linear attachments and Jira remote links are a later, separate decision if comments prove insufficient.

## Caller obligations

1. **Ask `supportsTransitions` when the order is agreed, not when the write is due** (FR-059a). An order whose issue will never move is something the operator should know before the run, not discover in the ledger afterwards.
2. A failed transition never fails the work (FR-063). Record it, retry it, carry on. An _unsupported_ one is not a failure — record once, never retry.
3. An intent with no available option is a normal outcome, not an error to surface loudly — Edge Cases covers the tracker whose workflow has no review state. Recorded and skipped.
4. The intent-to-state mapping is presented to the operator to adjust (FR-060). `states()` supplies the candidates; the operator's override is stored by Foundry, not by core.
5. **Never emulate a missing capability.** A tracker that cannot move an issue does not get a comment saying it moved.

## Test obligations

Core-side, in `tests/unit/main/integrations/`:

- Linear: intent resolves by state `type`, not by name; `issueUpdate` receives the resolved `stateId`.
- Linear: an intent with no available option rejects with a distinguishable error rather than silently succeeding.
- Jira: `supportsTransitions('jira')` is false, and `transition` rejects with the `unsupported` error — **not** with a generic failure, because the caller treats the two differently.
- `IssueService`: a successful transition invalidates that issue's cache entry.
- `ExtensionAPI`: the three new methods are present and delegate; no other write reaches a provider.
- Regression: `jira.provider.ts` is untouched by this feature, and its existing specs still pass unmodified.
