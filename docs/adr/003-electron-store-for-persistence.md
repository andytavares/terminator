# ADR-003: electron-store for Persistent Data Storage

**Date**: 2026-05-05  
**Status**: Accepted

## Decision

Use `electron-store` to persist workspaces, projects, extensions list, global settings, and workspace settings as JSON files in the OS application data directory. Terminal session state (buffers, PTY processes) is in-memory only and is not persisted across restarts.

## Motivation

1. **Appropriate fit**: The persistent data in Phase 1 (workspace list, project list, settings) is structured but low-volume. Key-value JSON storage is sufficient; relational queries are not needed.

2. **Atomic writes and OS integration**: `electron-store` writes atomically (write-then-rename) to prevent corruption on crash. It stores data in the correct OS location (`~/Library/Application Support/` on macOS, `%AppData%` on Windows, `~/.config/` on Linux).

3. **Schema migration**: electron-store supports migration functions to evolve the stored schema between app versions — important for a long-lived desktop app.

4. **Community health**: 800K+ weekly downloads, built on `conf` (also widely used), actively maintained. Multiple maintainers. Passes Constitution §II.

## Alternatives Considered

- **SQLite (`better-sqlite3`)**: More powerful, appropriate for relational queries and large datasets. Overkill for Phase 1 data volumes. Adds native module compilation complexity. Deferred if data model grows to need joins or large-scale queries.
- **Plain JSON files (manual)**: Would require implementing atomic writes, file locking, and path resolution — all already solved by electron-store. Rejected as unnecessary reinvention.
- **localStorage**: Only accessible from renderer, not main process. Cannot be the single source of truth for data owned by main.

## Consequences

- All store operations are synchronous in Phase 1 (electron-store default). If performance becomes a concern at scale, async migration can be addressed in a later phase.
- Each domain uses its own store instance (workspaces, settings) for isolation and independent migration.
- All values written to the store are Zod-validated before write to prevent schema drift.
