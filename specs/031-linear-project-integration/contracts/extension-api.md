# Contract: Extension API v2.2.0 — `api.issues`

**Feature**: 031-linear-project-integration

Additive release. Nothing existing changes shape. The version follows the documented series in
`docs/EXTENSION-DEVELOPMENT.md`, whose highest marker is v2.1.0 (see research R10 for the noted
inconsistency with the annotations in `src/main/extensions/api.ts`).

An extension **never** holds a tracker credential and **never** contacts a tracker directly
(FR-027). It asks core, the same way it asks for a shell, a database, or a PTY.

## `api.issues`

```typescript
issues: {
  /** Connected trackers and who each credential belongs to. Never a secret. */
  connections(): TrackerConnection[]

  /** "My issues" across connected trackers. Per-tracker failures are reported, not thrown. */
  listMine(opts?: { tracker?: TrackerId; limit?: number }): Promise<IssueListResult>

  /** Full-text search. An exact issue key resolves directly and sorts first. */
  search(term: string, opts?: { tracker?: TrackerId; limit?: number }): Promise<IssueListResult>

  /** One issue, description and comments as markdown whichever tracker it came from. */
  get(tracker: TrackerId, key: string, opts?: { refresh?: boolean }): Promise<Issue | null>

  /** Comment on an issue. Rejects on failure — it must not be swallowed. */
  comment(tracker: TrackerId, key: string, body: string): Promise<void>

  /** The issue attached to a project, or null. Synchronous: it is local state. */
  linkFor(projectId: string): IssueLink | null

  /** Fires when any project's link is set, replaced, cleared, or garbage-collected. */
  onLinkChange(handler: (projectId: string, link: IssueLink | null) => void): Disposable
}

interface IssueListResult {
  issues: IssueSummary[]
  failures: { tracker: TrackerId; error: TrackerErrorKind }[]
}
```

Types (`TrackerId`, `TrackerConnection`, `Issue`, `IssueSummary`, `IssueLink`,
`TrackerErrorKind`) are exported from the API module, per Constitution II's rule that an
extension imports shared types from the API rather than re-declaring them.

**Deliberately absent** (YAGNI, Constitution VII): creating or editing issues, changing state,
managing labels, listing teams or projects, and setting a link. Setting a link is an operator
action performed in core's own UI; an extension that provisions a project passes the issue at
creation time instead — see below.

## `api.workspace.createProject` — optional issue

```typescript
interface CreateProjectInput {
  workspaceId: string
  name: string
  worktreePath: string
  gitBranch?: string
  isWorktree?: boolean
  /** v2.2.0 — attach this issue to the project as it is created. */
  issue?: { tracker: TrackerId; key: string }
}
```

When `issue` is present the project is created already linked, with `injectContext` taking the
global default (FR-012). When the existing project is returned instead of a new one — the
documented same-path behaviour — the issue is attached to **that** project, replacing any link it
already had, because the caller has just said what that checkout is for.

Attaching an issue here does **not** create or reconcile a board card, and importing an issue as
a card does not attach it to a project. The two associations stay independent unless an
extension chooses to make both (spec Assumptions).

## Migration required by this release

**`speckit-pilot`** — after migration it must contain no tracker client, no tracker credential,
and no tracker settings UI:

| Removed                                                 | Replaced by                                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/api/linear.ts`                                     | `api.issues.listMine()` / `api.issues.comment()`                                        |
| `src/api/jira.ts`                                       | same                                                                                    |
| Linear/Jira halves of `src/api/credentials.ts`          | core's credential store                                                                 |
| `speckit:credentials-set`, `speckit:credentials-status` | `integrations:connect` / `integrations:status`                                          |
| `speckit:ticket-list` internals                         | `api.issues.listMine()` (channel may remain as a thin shim if its callers are external) |
| `@linear/sdk` in its `package.json`                     | core's pinned dependency                                                                |
| `transitionStatus()` (Jira)                             | nothing — dead, and FR-034 forbids state changes                                        |
| Settings UI for Linear/Jira                             | Settings → Integrations                                                                 |

`reconcile-tickets.ts` keeps its `source:key` dedup identity — which already matches this
feature's (tracker, key) identity — and its behaviour must be unchanged (FR-029, SC-011).

**`git-integration`** — its PR-body reference scraper (`src/github/pr-review-service.ts:848`)
keeps finding references; each is enriched through `api.issues.get()` so `PrOverviewPanel`
renders title and state instead of a bare key (FR-030). When no tracker is connected it renders
exactly what it renders today.

## The isolation test

> If `extensions/` were deleted, would core still build and run?

Yes. Core owns the service, the credentials, the channels and the UI. Extensions consume a
published namespace. The reverse — an extension's tracker code being deleted — is the point of
this feature.
