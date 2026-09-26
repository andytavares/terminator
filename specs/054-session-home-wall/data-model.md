# Data Model: Session Home and Monitor Wall

## SessionRecord (persisted, main process)

The retained context of one session. It exists only while the session has a description or its own link, and for 30 days after close (research R1, R3, R4).

| Field           | Type                     | Rule                                                                    |
| --------------- | ------------------------ | ----------------------------------------------------------------------- |
| `sessionId`     | `string` (uuid)          | Key. One record per session.                                            |
| `projectId`     | `string`                 | The session's project at the time of the last write, or the scratch id. |
| `workspaceName` | `string \| null`         | Snapshot. `null` for a scratch terminal.                                |
| `projectName`   | `string \| null`         | Snapshot.                                                               |
| `branch`        | `string \| null`         | Snapshot of `branchLabel(project)`.                                     |
| `tabTitle`      | `string`                 | Snapshot of the session name.                                           |
| `shell`         | `string \| null`         | `null` when unknown (adopted sessions).                                 |
| `description`   | `string \| null`         | Trimmed. 1–500 chars, or `null`. Newlines allowed.                      |
| `link`          | `WorkItemRef \| null`    | The session's own link.                                                 |
| `startedAt`     | `string` (ISO)           | The session's `createdAt`.                                              |
| `updatedAt`     | `string` (ISO)           | Stamped on every write.                                                 |
| `closedAt`      | `string` (ISO) \| absent | Set by `terminal:close` or the startup sweep.                           |

**Validation**:

- A write that leaves both `description` and `link` null on an open record deletes the record.
- `description` longer than 500 chars is rejected with `VALIDATION_ERROR`, never truncated silently. The input caps at 500, so only a bypass hits this.
- Unknown `tracker` values are dropped on load.

**Lifecycle**:

```
(none) ──set description or link──► open
open ──clear both──► (none)
open ──terminal:close / startup sweep──► closed
closed ──now − closedAt > 30 days──► (pruned)
```

A closed record is read-only on every surface in this feature. A closed session cannot be reopened, because PTYs do not survive, so the "reopened" edge case applies only to an Exited session whose tab is still open.

## WorkItemRef

| Field     | Type                    |
| --------- | ----------------------- |
| `tracker` | `'linear' \| 'jira'`    |
| `key`     | `string` (e.g. `NW-88`) |

## WorkItem (derived, renderer)

`resolveWorkItem(record, projectLink) → { source: 'session' | 'project', ref: WorkItemRef } | null`. The session's own link wins over the project link. The resolved ref's `Issue` comes from the `integrations.store` cache keyed `tracker:key`. It is `undefined` while loading and `null` when unavailable (FR-014).

## TerminalSession (renderer, changed)

| Change                                           | Why                                                  |
| ------------------------------------------------ | ---------------------------------------------------- |
| `note?: string` removed                          | Replaced by the record's description (R9).           |
| `shell?: string` added                           | From the `terminal:create` result (R10).             |
| `choicePrompt?: ChoicePrompt` added (view state) | Set on busy → idle, cleared on the next output (R5). |

## ChoicePrompt (derived, renderer view state)

| Field      | Type                                  | Rule                                      |
| ---------- | ------------------------------------- | ----------------------------------------- |
| `question` | `string`                              | Nearest non-empty line above the options. |
| `options`  | `{ number: number; label: string }[]` | Length ≥ 2. `number` runs 1..n in order.  |

## SessionFacts (derived, renderer)

One view model that every surface draws, built by `buildSessionFacts(sessions, records, projects, workspaces, projectLinks, now)`:

`sessionId, name, state, isClosed, workspaceName, workspaceColor, projectName, branch, shell, tags[], workItem, description, lastActivityAt, startedAt, closedAt, latestLine, choicePrompt`

- `state` is `'exited'` for a closed record.
- `workspaceColor` is `null` for scratch terminals and closed records.
- `latestLine` is the last non-empty visible buffer row above the cursor, skipping rows drawn only in box-drawing characters (Claude Code's input box borders), and is empty for closed records.

## HomePrefs (persisted, `localStorage` `terminator.home.prefs`)

| Field             | Type                                                   | Default                  |
| ----------------- | ------------------------------------------------------ | ------------------------ |
| `layout`          | `'ledger' \| 'logbook'`                                | `'ledger'`               |
| `groupBy`         | `'workspace-project' \| 'project' \| 'none'`           | `'workspace-project'`    |
| `sort`            | `'needs-you' \| 'recent'`                              | `'needs-you'`            |
| `columns`         | `{ branch, workItem, tags, latestLine, age: boolean }` | all `true` except `tags` |
| `previewSelected` | `boolean`                                              | `true`                   |
| `hideExited`      | `boolean`                                              | `false`                  |

Filters (the Needs you toggle and filter text) are not persisted, which matches the sidebar's rule that opening to a narrowed surface reads as data loss.

## WallPrefs (persisted, `localStorage` `terminator.wall.prefs`)

| Field      | Type                                         | Default   |
| ---------- | -------------------------------------------- | --------- |
| `size`     | `'s' \| 'm' \| 'l'`                          | `'m'`     |
| `pinNeeds` | `boolean`                                    | `true`    |
| `thenBy`   | `'state' \| 'workspace-project' \| 'recent'` | `'state'` |
