# Contract: the tracker provider seam

**Feature**: 031-linear-project-integration

One interface, two implementations. The facade above it owns caching, single-flight, the error
taxonomy and the link store; a provider owns exactly one tracker's wire protocol and nothing
else. This is the boundary that keeps ADF, JQL, and Linear's GraphQL out of every other file.

```typescript
interface TrackerProvider {
  readonly id: TrackerId

  /** Prove a credential before it is stored. Throws TrackerError on rejection. */
  verify(cred: StoredCredential): Promise<{ name: string; email: string; site?: string }>

  /** "My issues", per this tracker's own notion of mine. */
  listMine(cred: StoredCredential, mine: MineSelector, limit: number): Promise<IssueSummary[]>

  /** Full-text search. */
  search(cred: StoredCredential, term: string, limit: number): Promise<IssueSummary[]>

  /** One issue, fully populated. `description` and comment bodies MUST be markdown. */
  get(cred: StoredCredential, key: string): Promise<Issue | null>

  /** Post a comment. Rejects on failure; never swallows. */
  comment(cred: StoredCredential, key: string, body: string): Promise<void>
}
```

**Invariants every provider must hold**

1. **Markdown out.** Whatever the tracker stores, `description` and `comments[].body` leave the
   provider as markdown. Conversion happens here, once, not downstream.
2. **Normalised state.** `state.type` is one of the five `IssueStateType` values; `state.name`
   is the tracker's own label, passed through for display.
3. **Typed errors.** Every failure surfaces as a `TrackerError` carrying a kind from the
   taxonomy in `data-model.md`. A raw HTTP status or SDK error never escapes.
4. **Honour the stated wait.** A rate-limit refusal is raised as `rate-limited` with the
   tracker's own retry period. The facade waits it out; the provider does not sleep on its own.
5. **No caching, no state.** Providers are stateless functions over a credential. All caching
   lives in the facade so both trackers share one policy.
6. **No mutation beyond `comment`.** The interface exposes no way to change an issue's state,
   assignee, or any other field, and no implementation may add one. FR-034 and SC-014 are
   enforced here, by a test over the interface surface — not by the absence of code, which
   nothing checks.
7. **Absent means null.** A field the tracker does not have is `null` or empty — never
   synthesised. Jira's `branchName` is always `null`.

---

## Linear provider

`@linear/sdk` pinned `91.0.0` (root `package.json`).

| Operation   | Mechanism                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify`    | `client.viewer` — name and email                                                                                                             |
| `listMine`  | `client.issues({ filter: { assignee: { email: { eq } } }, first, orderBy })`, or the viewer's `assignedIssues()` when no email is configured |
| `search`    | `client.searchIssues({ term, first })`                                                                                                       |
| `get`       | `issue(key)` — the shorthand key is **documented** as accepted here                                                                          |
| `comment`   | resolve key → UUID via `issue(key)`, then `createComment({ issueId: <uuid>, body })`                                                         |
| rate limits | `RatelimitedLinearError.retryAfter` (seconds)                                                                                                |
| pagination  | `pageInfo.hasNextPage` / `endCursor`                                                                                                         |

**Why the key → UUID resolution**: Linear issues are addressed by **UUID, always** — not by the
human key, even where Linear would accept one. One addressing mechanism means one thing to be right
about, and the UUID is the form Linear documents as working for every operation. The extension this
replaces passed the key and swallowed the result, so nobody could tell whether it had ever worked;
that ambiguity is designed out rather than investigated.

## Jira provider

Jira Cloud REST **v3**, `fetch`, Basic auth (`base64(email:apiToken)`).

| Operation   | Mechanism                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `verify`    | `GET /rest/api/3/myself`                                                                           |
| `listMine`  | `GET /rest/api/3/search/jql?jql=…&fields=…`, paginated by `nextPageToken`                          |
| `search`    | `/search/jql` with a `text ~ "…"` clause, ANDed with the configured JQL                            |
| `get`       | `GET /rest/api/3/issue/{key}` plus `GET …/comment`                                                 |
| `comment`   | `POST /rest/api/3/issue/{issueIdOrKey}/comment` with an ADF body — the key is accepted in the path |
| rate limits | HTTP 429 with `Retry-After`                                                                        |

**The deprecated endpoint**: `GET /rest/api/3/search` is documented as _"currently being
deprecated and removed"_. The current extension calls it. Moving to `/search/jql` is part of this
work, not a later cleanup (research R4).

**ADF in, markdown out**: v3 returns descriptions and comments as Atlassian Document Format — a
JSON document. The provider converts ADF → markdown with an in-house pure mapper covering the
node set FR-014 names: heading, paragraph, bulletList, orderedList, taskList, table, blockquote,
codeBlock, rule, hardBreak, and text marks (strong, em, code, strike, link). An unmapped node
degrades to its text content — visible and bounded, never dropped silently and never thrown on.

The alternatives (`renderedFields` HTML, `adf-to-md`, `@atlaskit/editor-markdown-transformer`)
and why each was rejected are recorded in research R5. The short form: one of them forces a
second renderer and a second sanitiser; one is single-maintainer, which Constitution IV
forbids outright; one drags an editor's dependency tree into the main process.

## Adding a third tracker later

Implement the interface, register it, extend `TrackerId`, add its credential shape and its
`MineSelector` variant. Nothing in the facade, the cache, the link store, the UI, the context
builder, or the extension API is expected to change. **No third provider is written now** —
YAGNI (Constitution VII); the seam exists because this feature genuinely has two.
