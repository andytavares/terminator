# ADR 041: An extension may move an issue, and nothing else about it

**Status**: Accepted

**Date**: 2026-09-06

**Supersedes**: the write boundary set in feature 031 (`comment` is the only write)

## Context

Feature 031 gave the application one tracker connection. It published a slice of that connection to extensions as `ExtensionAPI.issues`. The boundary it drew was narrow and deliberate, and the code states it:

> There is deliberately no way to create or edit an issue, or to change any
> field of one: `comment` is the only write, and FR-034 says so.

Feature 037's FR-059 asks for something that this boundary forbids. A work order must move its source issue's workflow state when work starts, when a draft pull request opens, and when it merges. This is the difference between a board that reflects what the factory is doing and a board that somebody updates by hand afterwards. A board updated by hand afterwards is a board that is wrong.

An extension cannot work around this. Constitution Principle II forbids holding a tracker credential inside an extension, and `ExtensionAPI.issues` exists to prevent it. So we either add the capability to core or cut FR-059.

Three things made the decision harder than "add a setter".

**The two trackers do not share a model.** Linear sets the target state directly with `issueUpdate(id, input: { stateId })`. Its own agent guidance resolves the state by querying `team(id) { states(filter: { type: { eq: "started" } }) }`, by `type` and not by name. Jira cannot set a status at all. `GET /rest/api/3/issue/{key}/transitions` returns only the transitions available _from the issue's current status_, and a `POST` to the same endpoint performs one. A `setState(stateId)` signature cannot be implemented for a tracker that the application already ships.

**Name matching is wrong for both.** Linear's guidance says to use `type`. Teams rename Jira workflows freely. An integration that matches "In Progress" stops working, silently, the day a team renames it.

**"In review" is not a fact about a tracker.** It is a decision about which of a team's states means "in review". Linear has no review state type at all. Whatever resolves the state, the operator must be able to overrule it (FR-060).

## Decision

`ExtensionAPI.issues` gains three methods in v2.3.0. The write boundary becomes two writes instead of one: a comment, and the issue's own position in its own workflow.

```typescript
states(tracker, key): Promise<TrackerStateOption[]>
transition(tracker, key, intent: TransitionIntent, optionId?: string): Promise<void>
supportsTransitions(tracker): boolean
```

Four properties carry the decision.

**Intent, not identifier.** `TransitionIntent` is `started | in_review | done`. The caller says what moment this is, and the provider decides which of its own states that means. This keeps the resolution in one place, so every caller does not re-implement it. It is also the only signature that both tracker models can satisfy.

**Optional on the provider.** `states` and `transition` are optional members of `TrackerProvider`. Linear implements them. `jira.provider.ts` is untouched by this feature and omits both. Required methods that throw `not supported` would give an interface that claims a capability which half its implementations lack. A caller could discover this only by calling and catching.

**`supportsTransitions` is synchronous, and callers ask early.** It is a fact about the provider, not about a credential or an issue, so a caller asks before it needs to know. FR-059a requires an order whose issue will never move to say so when the order is agreed. It must not wait for the write to fail, which happens after the run.

**The operator's mapping is passed, not assumed.** `states()` supplies the candidates, and `transition()` takes the option that the operator chose. Foundry stores that mapping on the work order. Core stores nothing about it. Without the fourth argument, the mapping would be a setting that changed nothing, which is worse than no setting.

Linear's own resolution, for the record:

- `unstarted`, `backlog` and `canceled` carry no intent.
- The first `started` state by position is `started`.
- The last `started` state is `in_review` when there is more than one, and nothing when there is not.
- `completed` is `done`.

Linear resolves by `type` and by its own ordering, never by name. A workflow with one started state has no review position, and the intent resolves to nothing, not to something approximate.

A fifth error kind, `unsupported`, joins `TrackerErrorKind`. A caller retries a failure, and records an unsupported capability once (FR-063). If we merged the two into `failed`, the factory would ask Jira to move an issue for ever.

## Consequences

**Good.**

- The board stays right without anybody typing, which is the point.
- The capability is generic. Core learned that an extension may move an issue's workflow position. It learned nothing about Foundry. No `foundry:*` name appears in `src/`, and core still builds with `extensions/foundry/` deleted. This is Principle II's own test.
- Adding Jira later means filling in an optional method. It is not a redesign.

**Bad, and accepted.**

- The write surface is one operation wider than before. The comment that said "comment is the only write" is now wrong, and we had to rewrite it. This is a real loss: the old sentence was simple and checkable at a glance. `provider.spec.ts` compensates by testing the shape of the surface. Nothing outside `PROVIDER_OPERATIONS` may exist. Widening that list takes a deliberate edit to a test whose whole purpose is to make widening conspicuous.
- Jira users get less than Linear users, and the difference is visible. The mapping panel says so and does not hide it.
- `transition` has an optional fourth argument that most callers will not pass. This is a mild wart on a published interface.

**Not done.**

- No `createIssue`, no `deleteIssue`, no `updateIssue(fields)`. A field-level write API would open every field of every issue to every extension, to satisfy one requirement.
- No native attachment API. Pull request links ship as a comment (FR-061), which needs no core change. Linear attachments and Jira remote links are a later, separate decision, if comments prove insufficient.

## References

- `specs/037-foundry-software-factory/contracts/extension-api-issues.md`
- Linear developer documentation: GraphQL API (`issueUpdate`), agent best
  practices (querying states by `type`)
- Jira Cloud platform REST API v3, issues API group (`/transitions`)
