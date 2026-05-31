# ADR-016: UUID v4 Task IDs (Supersedes ADR-014)

**Status**: Accepted  
**Date**: 2026-05-31  
**Feature**: `005-task-vault-extension`  
**Supersedes**: ADR-014 (Line-Based Task IDs)

## Context

ADR-014 chose `filepath:line` as the task ID format because tasks were stored as bullet lines in plain markdown files. The ID was session-scoped: it was valid only until the vault file changed, at which point the index was rebuilt and all IDs for that file were invalidated. MCP clients had to re-query after every write.

The migration to SQLite storage (ADR-015) eliminates the markdown-file constraint entirely. There is no longer a line number to encode.

## Decision

Task IDs are UUID v4 values generated at insert time using `node:crypto`'s `randomUUID()`. The UUID is stored in the `id TEXT PRIMARY KEY` column of the `tasks` table in `vault.db`.

```typescript
// extensions/task-vault/src/vault/db.ts:4
import { randomUUID } from 'node:crypto'
```

## Motivation

| Property                  | `filepath:line` (ADR-014)            | UUID v4 (this ADR)                          |
| ------------------------- | ------------------------------------ | ------------------------------------------- |
| Stability across sessions | No — invalidated on any file write   | Yes — survives restarts and edits           |
| Stability across edits    | No — line shift invalidates siblings | Yes — row identity is separate from content |
| MCP re-query after write  | Required                             | Not required                                |
| Uniqueness guarantee      | Within a single index build          | Globally (probability negligible collision) |
| Requires markdown parsing | Yes                                  | No                                          |

## Consequences

- **No `STALE_ID` errors for task identity**: MCP clients and the UI can hold a task UUID across multiple writes without re-querying. The ID refers to the same DB row regardless of mutations.
- **`filepath:line` contract is removed**: `IndexedTask.line` is kept in the TypeScript interface as a legacy field but is always `0` for SQLite-backed tasks. Do not use it for addressing.
- **Deleted tasks are gone**: Deleting a row removes the ID permanently. Callers holding a UUID for a deleted task receive a `NOT_FOUND` error — not `STALE_ID`.
- **Recurrence instances get their own UUID**: Each spawned instance is a new row with a new UUID. The link back to the template is via `recurrence_template_id`, not via a shared prefix in the ID.
