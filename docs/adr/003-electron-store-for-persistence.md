# ADR-003: electron-store for Persistent Data Storage

**Date**: 2026-05-05  
**Status**: Accepted

## Decision

Use `electron-store` to persist workspaces, projects, extensions list, global settings, and workspace settings as JSON files in the OS application data directory. Terminal session state (buffers, PTY processes) is in-memory only. It is not persisted across restarts.

## Motivation

1. **Appropriate fit**: The persistent data in Phase 1 (workspace list, project list, settings) is structured but low-volume. Key-value JSON storage is sufficient. Relational queries are not needed.

2. **Atomic writes and OS integration**: `electron-store` writes atomically (write-then-rename) to prevent corruption on crash. It stores data in the correct OS location (`~/Library/Application Support/` on macOS, `%AppData%` on Windows, `~/.config/` on Linux).

3. **Schema migration**: electron-store supports migration functions that evolve the stored schema between app versions. This is important for a long-lived desktop app.

4. **Community health**: 800K+ weekly downloads. It is built on `conf` (also widely used) and actively maintained by multiple maintainers. It passes Constitution §II.

## Alternatives Considered

- **SQLite (`better-sqlite3`)**: More powerful. Suited to relational queries and large datasets. Overkill for Phase 1 data volumes. Adds native module compilation complexity. Deferred until the data model needs joins or large-scale queries.
- **Plain JSON files (manual)**: We would have to implement atomic writes, file locking, and path resolution. electron-store already solves all three. Rejected as unnecessary reinvention.
- **localStorage**: Only the renderer can access it, not the main process. It cannot be the single source of truth for data that main owns.

## Consequences

- All store operations are synchronous in Phase 1 (electron-store default). If performance becomes a concern at scale, a later phase can migrate to async.
- Each domain uses its own store instance (workspaces, settings) for isolation and independent migration.
- Zod validates all values before they are written to the store, to prevent schema drift.
