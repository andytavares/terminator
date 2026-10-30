# ADR-014: Line-Based Task IDs (Session-Scoped, Rebuild-on-Write)

**Status**: Superseded by ADR-016  
**Date**: 2026-05-19  
**Feature**: `005-task-vault-extension`

## Decision

Task IDs use the format `filepath:line` (e.g., `~/vault/daily/2026-05-19.md:7`). IDs are valid only for the current VaultIndex snapshot. The index is rebuilt after every file write. MCP clients MUST re-query after any write operation to obtain fresh IDs. Stale IDs return `{ error: 'STALE_ID' }`.

## Motivation

Tasks are stored as bullet lines in plain markdown. The file is the source of truth. No separate ID store exists (a core design constraint: the vault must be readable and editable in any text editor). Given this constraint, the options for task identity are:

| Approach                  | Evaluated                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `filepath:line`           | Simple derivation; works with any vault file; IDs are stable until the file changes                        |
| Content hash              | Fragile: editing task text changes the ID; two identical tasks get the same ID                             |
| UUID anchor comment       | Adds invisible junk to the markdown; breaks plain-text compatibility; external editors don't preserve them |
| Frontmatter UUID per file | Only works for project files, not for daily log task bullets                                               |

`filepath:line` is the simplest approach. It needs zero modification to the markdown format and handles arbitrary vault files uniformly.

## Consequences

- **Session-scoped**: An ID from one index build is invalid after any write to that file. `data-model.md` and the MCP quickstart document this.
- **MCP clients must re-query after writes**: All write tools (`complete_task`, `migrate_task`, `add_task`, `capture`) rebuild the index and return the new ID(s), so the client can update its local reference.
- **Concurrent writes**: When two MCP clients (or UI + MCP) write the same file simultaneously, atomic rename resolves the conflict. The second writer gets `STALE_ID` and must re-query. This is the intended failure mode, not corruption.
- **Archive exclusion**: The live index excludes files under `archive/` by default. MCP tools cannot query or modify tasks in archived files (intentional: archived items are read-only by convention).
