# Phase 1 Data Model: Tracker issues attached to projects

**Feature**: 031-linear-project-integration · **Date**: 2026-08-22

All types are declared once in `src/shared/types/` (shape) and `src/shared/schemas/` (Zod
validation), so the main process, the renderer and the remote shim agree. Extensions receive
the same shape through `api.issues` — they do not re-declare it (Constitution II).

---

## TrackerId

```
'linear' | 'jira'
```

Closed set. Every issue, link and credential is tagged with it. Two trackers may issue the same
key (`TAV-42` in both), so **nothing is identified by key alone** — the pair
(`tracker`, `key`) is the identity everywhere in this feature.

## TrackerConnection

What the application knows about one connected tracker. At most one per `TrackerId`.

| Field       | Type                      | Notes                                                                                               |
| ----------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| `tracker`   | `TrackerId`               |                                                                                                     |
| `connected` | `boolean`                 |                                                                                                     |
| `account`   | `{ name, email } \| null` | Who the credential belongs to, from the tracker itself. Proof the credential was verified (FR-002). |
| `site`      | `string \| null`          | Jira only — the site domain. `null` for Linear.                                                     |
| `mine`      | `MineSelector`            | How "my issues" is defined for this tracker (FR-006).                                               |
| `lastError` | `TrackerError \| null`    | Set when a previously good credential starts failing (FR-032).                                      |

**Never** carries the secret. The secret lives only in the encrypted credential file and is
read only by the provider inside the main process (FR-003).

### MineSelector

Tracker-shaped, because the two trackers express it differently and pretending otherwise would
lose information:

- Linear: `{ kind: 'assignee', email: string | null }` — `null` means the credential's own viewer.
- Jira: `{ kind: 'query', jql: string }` — carried over from the existing extension setting.

### StoredCredential (main process only, encrypted at rest)

| Tracker | Fields                      |
| ------- | --------------------------- |
| Linear  | `apiKey`                    |
| Jira    | `site`, `email`, `apiToken` |

Written atomically to one file under `userData`; each value `safeStorage`-encrypted. Migrated
once from `speckit-pilot-creds.json`, which is then renamed `.bak` (FR-004).

## Issue

One shape for both trackers. Anything a tracker does not supply is `null` or empty — never
faked, never omitted.

| Field         | Type                                              | Notes                                                                                                                 |
| ------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `tracker`     | `TrackerId`                                       | Half of the identity.                                                                                                 |
| `id`          | `string`                                          | The tracker's own stable id. Linear: UUID (what `commentCreate` takes — see research R3). Jira: numeric id as string. |
| `key`         | `string`                                          | The human key, `TAV-42`. Other half of the identity.                                                                  |
| `title`       | `string`                                          |                                                                                                                       |
| `url`         | `string`                                          | Where the operator opens it.                                                                                          |
| `description` | `string`                                          | **Always markdown.** Linear supplies it; Jira's ADF is converted before it reaches this type (research R5).           |
| `state`       | `{ name: string; type: IssueStateType }`          | `name` is the tracker's own label and is displayed as-is; `type` is what the UI reasons about.                        |
| `assignee`    | `{ name: string; email: string \| null } \| null` |                                                                                                                       |
| `labels`      | `string[]`                                        |                                                                                                                       |
| `branchName`  | `string \| null`                                  | Linear's suggested VCS branch. Always `null` for Jira (research R4). **Also on `IssueSummary`** — see below.          |
| `completed`   | `boolean`                                         | Derived from `state.type === 'completed'`.                                                                            |
| `updatedAt`   | `string`                                          | ISO 8601.                                                                                                             |
| `comments`    | `IssueComment[]`                                  | Most recent first, bounded (see below).                                                                               |

### IssueStateType

```
'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
```

Normalised from each tracker's own vocabulary. This — not colour — drives the sidebar's state
indicator (FR-009), so the badge survives greyscale and colour-blindness.

### IssueComment

| Field       | Type     | Notes                                               |
| ----------- | -------- | --------------------------------------------------- |
| `author`    | `string` | Display name.                                       |
| `body`      | `string` | Markdown, normalised the same way as `description`. |
| `createdAt` | `string` | ISO 8601.                                           |

**Bounded at 5, newest first.** A long thread is read in the tracker (spec Assumptions). The
bound is applied when the issue is built, so nothing downstream has to remember it.

### IssueSummary

The subset the pickers and lists need — `tracker`, `id`, `key`, `title`, `state`, `assignee`,
`url`, and `branchName`. No description, no comments.

`branchName` is here rather than only on the full `Issue` because the new-project dialog prefills
a branch straight from a picked row, and Linear returns it on the same query the list already
makes. Fetching a whole issue again to read one string would be a request for nothing. Search results and "my issues" return this; a full `Issue`
is fetched only when one is opened or fed to an agent.

## IssueLink

A project's attachment to exactly one issue (FR-033).

| Field           | Type            | Notes                                                                             |
| --------------- | --------------- | --------------------------------------------------------------------------------- |
| `projectId`     | `string` (uuid) | Primary key. **One row per project** — attaching a second issue replaces the row. |
| `tracker`       | `TrackerId`     |                                                                                   |
| `key`           | `string`        | Together with `tracker`, the issue's identity.                                    |
| `injectContext` | `boolean`       | Per-project (FR-021); defaults from the global setting.                           |
| `linkedAt`      | `string`        | ISO 8601.                                                                         |

**Lifecycle**: created on link; replaced on relink (after a confirmation, FR-007 / US2 scenario 5);
deleted on unlink; garbage-collected on project delete via the existing `onProjectDelete` event
(FR-008, research R11). Deleting a link also deletes its context file and removes the owned
block from the project's agent settings (FR-025).

**Validation**: `projectId` must name a project that exists; `tracker` must be connected at link
time. A link whose tracker is later disconnected is kept — it is the operator's association, not
the tracker's — and renders as unavailable until the tracker returns.

## AgentContext

Derived, never authored. Rebuilt whenever the link, the issue, or the toggle changes.

| Field       | Type      | Notes                                                               |
| ----------- | --------- | ------------------------------------------------------------------- |
| `projectId` | `string`  |                                                                     |
| `markdown`  | `string`  | Exactly what a session receives. What the drawer previews (FR-023). |
| `chars`     | `number`  | Length of `markdown`.                                               |
| `truncated` | `boolean` |                                                                     |
| `builtAt`   | `string`  | ISO 8601 — also the "as of" the operator sees when offline.         |

**Budget (FR-022)**: the ceiling is the runtime's documented 10,000-character cap on hook output
(research R7). Within it: description trimmed at ~4,000 characters, at most 5 comments, and when
anything was dropped a final line naming the issue URL. Truncation is by whole blocks where
possible so a code fence is never cut open.

**Composition**: key, title, state, assignee, URL, then description, then comments. Header fields
first, so a truncation that bites only ever costs discussion, never identity.

**Storage**: one file per project under `userData`, addressed by project id. The hook script
reads it and nothing else — it holds no credential, makes no network call, and knows nothing
about trackers.

## Relationships

```
TrackerConnection (0..2)
        │  provides
        ▼
      Issue ──────────────┐
        ▲                 │ subject of
        │ identifies      ▼
   (tracker, key) ── IssueLink (0..1 per Project) ──▶ AgentContext (0..1 per link)
                          │
                          ▼
                      Project (core, existing — unmodified)
```

Nothing in `Project`, `Workspace` or their schemas changes. The association is held beside them
and keyed to them, so removing this feature removes exactly its own files.

## Errors

One taxonomy, so FR-032 can be satisfied — "not connected", "connection failed" and "no results"
must never be presented as one another.

| Kind            | Meaning                                           | What the operator sees                            |
| --------------- | ------------------------------------------------- | ------------------------------------------------- |
| `not-connected` | No credential for this tracker                    | "Connect in Settings", with a way there           |
| `auth-failed`   | Credential rejected — revoked or wrong            | "Reconnect", pointed at settings                  |
| `rate-limited`  | Tracker refused, with a stated wait               | Retrying automatically; the wait is shown         |
| `unavailable`   | Network or tracker down                           | Cached data shown, marked as of its fetch time    |
| `not-found`     | The issue is gone, archived, or out of reach      | Badge shows unavailable; unlink or relink offered |
| `failed`        | Anything else, carrying the tracker's own message | The message, verbatim                             |

An empty list is a result, not an error, and is rendered as one.
