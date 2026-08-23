# Contract: IPC channels (`integrations:*`)

**Feature**: 031-linear-project-integration

Every method is declared **once** in `src/shared/electron-api/manifest.ts`, which generates the
preload adapter, the remote shim, and the remote allowlist. Handlers are registered with the
existing `registerInvokeTable` / `invokeSpec` pattern in `src/main/ipc/integrations.ipc.ts`, so
every payload is Zod-validated and every failure returns an envelope rather than throwing across
the boundary.

`manifest.spec.ts` pins the full expected channel list, so adding these appears as a reviewable
test diff.

## Remote behaviour

| Channels                                          | Remote     | Why                                                                                                                                                                           |
| ------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integrations:connect`, `integrations:disconnect` | **`omit`** | Credential entry stays on the local renderer. A LAN-reachable surface has no business writing tracker credentials, however well authenticated (ADR-023 default-deny posture). |
| everything else                                   | `same`     | The remote surface keeps working.                                                                                                                                             |

## Error envelope

Every channel returns either its success shape or `{ error: TrackerErrorKind, message?: string }`,
using the taxonomy in `data-model.md`. A validation failure returns
`{ error: 'failed', message: <zod message> }`. Handlers never throw across IPC.

## Channels

### `integrations:status`

- **Payload**: `{ tracker?: TrackerId }` — omitted means all.
- **Returns**: `{ connections: TrackerConnection[] }`
- Never includes a secret. `account` present ⟹ the credential was verified.

### `integrations:connect`

- **Payload**: `{ tracker: 'linear', apiKey: string, email?: string }`
  or `{ tracker: 'jira', site: string, email: string, apiToken: string, jql: string }`
- **Returns**: `{ connection: TrackerConnection }` | `{ error }`
- **Contract**: the credential is verified against the tracker **before** anything is written.
  A rejected credential leaves no trace (FR-002). Re-connecting an already-connected tracker
  replaces the credential.

### `integrations:disconnect`

- **Payload**: `{ tracker: TrackerId }`
- **Returns**: `{ ok: true }`
- **Contract**: destroys that tracker's stored credential. Existing links are **kept** — they
  are the operator's associations, not the tracker's — and render as unavailable (FR-005).

### `integrations:issue-list-mine`

- **Payload**: `{ tracker?: TrackerId, limit?: number }`
- **Returns**: `{ issues: IssueSummary[], failures: { tracker: TrackerId, error: TrackerErrorKind }[] }`
- **Contract**: with both trackers connected, results are merged. **A tracker that fails does
  not fail the call** — its issues are absent and it appears in `failures`, so the caller can
  show what it has and say what is missing (spec edge case: partial fetch failure).
  A tracker that is **not connected also appears in `failures`**, with kind `not-connected`. It
  is not silently omitted: "Jira is not connected" is precisely the difference between an
  incomplete list and an empty one, which FR-032 requires be distinguishable, and only the
  caller knows whether it is worth putting on screen.

### `integrations:issue-search`

- **Payload**: `{ term: string, tracker?: TrackerId, limit?: number }`
- **Returns**: same shape as `issue-list-mine`.
- **Contract**: a `term` that matches the shape of an issue key resolves that issue directly and
  places it first. Callers debounce; the service does not.

### `integrations:issue-get`

- **Payload**: `{ tracker: TrackerId, key: string, refresh?: boolean }`
- **Returns**: `{ issue: Issue }` | `{ error }`
- **Contract**: served from the TTL cache unless `refresh` is true. Concurrent calls for the
  same (tracker, key) are single-flighted into one request (FR-028, SC-008). `description` and
  every `comments[].body` are markdown, whichever tracker they came from.

### `integrations:issue-comment`

- **Payload**: `{ tracker: TrackerId, key: string, body: string }`
- **Returns**: `{ ok: true }` | `{ error }`
- **Contract**: the **only** write this feature performs besides FR-034a's automatic comment.
  Failure is returned, never swallowed (FR-034a). Linear resolves key → UUID first (research R3);
  Jira posts to `issueIdOrKey` directly.

### `integrations:link-set`

- **Payload**: `{ projectId: string, tracker: TrackerId, key: string, injectContext?: boolean }`
- **Returns**: `{ link: IssueLink }` | `{ error }`
- **Contract**: **replaces** any existing link for that project (FR-033) — the confirmation is
  the caller's job, the replacement is this channel's. `injectContext` defaults to the global
  setting. On success the context file is written and, if injecting, the owned settings block is
  merged into the project directory. If that write fails the link is **not** created and the
  error says why (FR-026).

### `integrations:link-get`

- **Payload**: `{ projectId: string }`
- **Returns**: `{ link: IssueLink | null, issue: Issue | null, issueError?: TrackerErrorKind }`
- **Contract**: `link` present with `issue` null and an `issueError` means the association exists but
  the issue could not be read — the badge renders unavailable rather than vanishing. It is
  deliberately **not** called `error`: the call succeeded, and a caller narrowing on `error` must
  not mistake a readable link for a failed channel.

### `integrations:link-clear`

- **Payload**: `{ projectId: string }`
- **Returns**: `{ ok: true }`
- **Contract**: deletes the link, deletes the context file, and removes the owned block from the
  project's agent settings, leaving the file byte-identical to its pre-link state where the
  operator has not edited it otherwise (FR-025, SC-010).

### `integrations:context-preview`

- **Payload**: `{ projectId: string }`
- **Returns**: `{ context: AgentContext }` | `{ error }`
- **Contract**: returns exactly the text a session would receive — built by the same function
  that writes the context file, never a re-render of it (FR-023).

## Events (main → renderer)

| Channel                         | Payload                                         | When                                                  |
| ------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `integrations:status-changed`   | `{ connections: TrackerConnection[] }`          | Connect, disconnect, or a credential starting to fail |
| `integrations:link-changed`     | `{ projectId, link: IssueLink \| null }`        | Link set, replaced, cleared, or garbage-collected     |
| `integrations:context-injected` | `{ projectId, tracker, key, chars, truncated }` | A session started and received context (FR-024)       |

**Deliberately no `issue-updated` event.** Nothing in this design polls: a refresh is either
explicit (the drawer's Refresh) or happens on link, and in both cases the caller already has the
result. An event with no producer is a promise nothing keeps, so it is not declared.
