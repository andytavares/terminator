# ADR-014: Line-Based Task IDs (Session-Scoped, Rebuild-on-Write)

**Status**: Accepted  
**Date**: 2026-05-19  
**Feature**: `005-task-vault-extension`

## Decision

Task IDs use the format `filepath:line` (e.g., `~/vault/daily/2026-05-19.md:7`). IDs are valid only for the current VaultIndex snapshot. The index is rebuilt after every file write. MCP clients MUST re-query after any write operation to obtain fresh IDs. Stale IDs return `{ error: 'STALE_ID' }`.

## Motivation

Tasks are stored as bullet lines in plain markdown. The file is the source of truth; no separate ID store exists (a core design constraint — vault must be readable/editable in any text editor). Given this constraint, the options for task identity are:

| Approach                  | Evaluated                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `filepath:line`           | Simple derivation; works with any vault file; IDs are stable until the file changes                        |
| Content hash              | Fragile: editing task text changes the ID; two identical tasks get the same ID                             |
| UUID anchor comment       | Adds invisible junk to the markdown; breaks plain-text compatibility; external editors don't preserve them |
| Frontmatter UUID per file | Only works for project files, not for daily log task bullets                                               |

`filepath:line` is the simplest approach that requires zero modification to the markdown format and handles arbitrary vault files uniformly.

## Consequences

- **Session-scoped**: An ID from one index build is invalid after any write to that file. This is documented in `data-model.md` and the MCP quickstart.
- **MCP clients must re-query after writes**: All write tools (`complete_task`, `migrate_task`, `add_task`, `capture`) rebuild the index and return the new ID(s) so the client can update its local reference.
- **Concurrent writes**: Two MCP clients (or UI + MCP) writing the same file simultaneously are resolved by atomic rename. The second writer gets `STALE_ID` and must re-query — this is the intended failure mode, not corruption.
- **Archive exclusion**: Files under `archive/` are excluded from the live index by default. Tasks in archived files cannot be queried or modified via MCP tools (intentional — archived items are read-only by convention).
