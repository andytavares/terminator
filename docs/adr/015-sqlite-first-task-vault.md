# ADR-015: SQLite-First Storage for Task Vault (Supersedes ADR-013)

**Status**: Accepted  
**Date**: 2026-05-31  
**Feature**: `005-task-vault-extension`  
**Supersedes**: ADR-013 (MCP Stdio Sidecar)

## Context

ADR-013 described an MCP stdio sidecar that read vault data directly from plain markdown files using the same parser/writer modules as the Electron extension. The recurrence engine rewrite (`91f8685`, PR #92) migrated the storage layer from markdown files to a SQLite database (`better-sqlite3`, WAL mode). The sidecar's premise — that both the Electron process and MCP clients parse the same markdown files — no longer holds.

## Decision

The Task Vault extension stores all entities (tasks, projects, areas) in a SQLite database at `<vault>/.todo/vault.db`. The MCP server is no longer a separate file-reading sidecar. All reads and writes go through `extensions/task-vault/src/vault/db.ts` via the `initDb` / `getDb` API, which is shared by:

1. The Electron IPC handlers in `extensions/task-vault/src/ipc/vault.ipc.ts`.
2. The MCP server in `extensions/task-vault/src/mcp/server.ts` (which opens the same database file via `initDb`).

Concurrent access is safe because SQLite WAL mode allows one writer and multiple readers. The MCP server must not write while the Electron process is mid-transaction; SQLite's busy-timeout handles contention transparently.

## Consequences

- **Single source of truth**: `vault.db` replaces all markdown files. There are no separate inbox, daily, project, or area files to keep in sync.
- **Task IDs are UUID v4** (stable, session-independent) — the `filepath:line` ID scheme from ADR-014 is removed.
- **Atomic writes**: SQLite transactions replace atomic rename; corruption protection is provided by WAL mode and the DB engine.
- **`TASK_VAULT_PATH` still required**: Both the Electron extension and the MCP server require the vault path at initialization. The Electron extension derives it from extension settings; the MCP sidecar reads it from `TASK_VAULT_PATH` env var.
- **Recurrence**: The engine at `ensure-next-occurrence.ts` enforces a one-open-future-instance invariant via a unique DB index on `(recurrence_template_id, due_date)`.
