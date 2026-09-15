# Contract: `session-records:*` IPC

These are core-only channels, registered in `src/main/ipc/session-records.ipc.ts` through `handleChannel` and validated with Zod schemas in `src/shared/schemas/session-records.schema.ts`. They are not part of the Extension API: no `api.*` surface, and no `manifest.ts` exposure to extension views (Principle II).

Every handler validates its payload with `safeParse` and returns `{ error: 'VALIDATION_ERROR', message }` on failure, never throwing. This is the same convention as `terminal:create`.

## `session-records:list` (invoke)

**Input**: none.

**Output**: `{ data: SessionRecord[] }`, pruned against `now` before return. Closed records come newest `closedAt` first. Open records follow in any order.

## `session-records:set-description` (invoke)

**Input**:

```ts
{
  session: SessionSnapshot // sessionId, projectId, workspaceName, projectName, branch, tabTitle, shell, startedAt
  description: string | null // null or whitespace-only clears
}
```

**Output**: `{ data: SessionRecord | null }`, where `null` means the write removed the record (R4).

**Errors**:

- `VALIDATION_ERROR` when the trimmed description is over 500 chars.
- `RECORD_CLOSED` when the record is closed.

## `session-records:set-link` (invoke)

**Input**: `{ session: SessionSnapshot; link: { tracker: 'linear' | 'jira'; key: string } | null }`.

**Output** and **Errors**: as for `set-description`. `null` removes only the session's own link (FR-012). The project link in `issue-link-store` is never touched.

## `session-records:changed` (main → renderer event)

**Payload**: `{ sessionId: string; record: SessionRecord | null }`.

Sent after every create, update, delete and close, so every surface converges on the last write (edge case "edited from two surfaces").

## Main-process hooks (not channels)

- `terminal:close` handler calls `markClosed(sessionId, new Date())` after `ptyManager.kill`.
- Startup, after `loadRecords()`: `sweepOpenRecords()` sets `closedAt = updatedAt` on every record without one, then prunes and persists.

## `terminal:create` (changed)

The success output gains `shell: string`, the resolved shell actually spawned. Existing callers that read only `sessionId` are unaffected.
