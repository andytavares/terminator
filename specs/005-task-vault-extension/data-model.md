# Data Model: Task Vault Extension

**Date**: 2026-05-31 (revised)  
**Branch**: `005-task-vault-extension`  
**Supersedes**: original markdown-file architecture described at commit prior to `91f8685`

All entities are stored in the shared **PGlite (PostgreSQL-compatible WASM)** application database. The markdown-file architecture with `filepath:line` IDs described in earlier drafts of this document has been removed. See ADR-015 and ADR-016 for the formal supersession notices. The original `better-sqlite3` / `<vault>/.todo/vault.db` storage has since been replaced by the shared PGlite database (see `docs/ARCHITECTURE.md` → Task Vault Extension Architecture).

---

## Storage

**Database**: shared PGlite (PostgreSQL-compatible), accessed through the injected `ExtensionDB` handle (`src/main/db/index.ts`) — not a per-vault file. Foreign keys are enforced by Postgres.  
**Location**: `<userData>/app.pglite` (the single app-wide database shared by all extensions; legacy `vault.db` rows are migrated in once via `src/main/db/migrate.ts`).  
**Initialization**: `applyTaskVaultSchema(db)` in `extensions/task-vault/src/vault/db.ts` creates the schema and `applyTaskVaultMigrations(db)` runs additive migrations on every startup. Both receive the shared `ExtensionDB` instance; the extension never opens its own database file.

---

## Core Entities

### Task

A single unit of work stored as a row in the `tasks` table.

```typescript
// extensions/task-vault/src/vault/types.ts:37
interface Task {
  id: string // UUID v4 — stable across sessions and file changes
  filePath: string // Derived at read time: "<source>/<source_ref>"
  line: number // Legacy field; always 0 for database-backed tasks
  status: TaskStatus
  text: string
  project?: string // Denormalized tag; also mirrored in project_id FK
  context?: string
  area?: string // Denormalized tag; also mirrored in area_id FK
  dueDate?: string // YYYY-MM-DD
  completedDate?: string
  migratedTo?: string
  metadata: Record<string, string>
  terminatorLinks: string[]
  subtasks?: Task[]
}

// extensions/task-vault/src/vault/types.ts:1
type TaskStatus =
  | 'open'
  | 'done'
  | 'migrated'
  | 'cancelled'
  | 'in-progress'
  | 'in-review' // added in recurrence engine rewrite
  | 'blocked' // added in recurrence engine rewrite
```

**SQL schema** (`applyTaskVaultSchema` / `applyTaskVaultMigrations` in `extensions/task-vault/src/vault/db.ts`; the recurrence columns shown below are added by migration when absent, not in the base `CREATE TABLE`):

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,          -- UUID v4
  text            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  project         TEXT,                      -- denormalized tag string
  context         TEXT,
  area            TEXT,                      -- denormalized tag string
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  area_id         TEXT REFERENCES areas(id) ON DELETE SET NULL,
  due_date        TEXT,                      -- YYYY-MM-DD
  completed_date  TEXT,
  migrated_to     TEXT,
  source          TEXT NOT NULL DEFAULT 'inbox',
  source_ref      TEXT,
  parent_id       TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  metadata        TEXT NOT NULL DEFAULT '{}',
  terminator_links TEXT NOT NULL DEFAULT '[]',
  -- Recurrence columns (added in migration if absent)
  recurrence_rule          TEXT,   -- 'daily' | 'weekly' | 'weekly:0,3' | 'biweekly' | 'monthly'
  recurrence_template_id   TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  recurrence_notify_at     TEXT,   -- HH:MM override
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
```

**State transitions**:

```
open        → done        (complete_task)
open        → migrated    (migrate_task)
open        → cancelled   (cancel_task)
open        → in-progress (edit_task / kanban drag)
open        → in-review   (edit_task / kanban drag)
open        → blocked     (block_task)
blocked     → open        (unblock_task)
done        → (terminal)
migrated    → (terminal)
cancelled   → open        (restore_task)
```

---

### Recurrence

Recurring tasks are managed by the recurrence engine in `extensions/task-vault/src/vault/recurrence.ts` and `extensions/task-vault/src/vault/ensure-next-occurrence.ts`.

**Rule format** (`extensions/task-vault/src/vault/recurrence.ts:5`):

```typescript
type RecurrenceRule =
  | { kind: 'daily' }
  | { kind: 'biweekly' }
  | { kind: 'monthly' }
  | { kind: 'weekly'; days: number[] } // days: 0=Sun … 6=Sat; empty = every 7 days
```

Serialised column strings: `'daily'`, `'weekly'`, `'weekly:1,3'`, `'biweekly'`, `'monthly'`.

**Invariant**: For any recurring template task, exactly one `status='open'` future instance exists. `ensureNextOccurrence` in `ensure-next-occurrence.ts:27` enforces this atomically; `backfillRecurringTasks` in `ensure-next-occurrence.ts:125` runs at startup to close gaps caused by the app being offline.

**Template vs. instance**:

| Field                    | Template task | Spawned instance       |
| ------------------------ | ------------- | ---------------------- |
| `recurrence_rule`        | set           | copied from template   |
| `recurrence_template_id` | `NULL`        | template's `id`        |
| `due_date`               | seed date     | computed next due date |

**End conditions** (stored in `metadata` JSON):

| Key                          | Values                                     | Meaning                                            |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------- |
| `recurrence_end_type`        | `'none'` \| `'on_date'` \| `'after_count'` | How the series terminates                          |
| `recurrence_end_date`        | `YYYY-MM-DD`                               | Stop spawning after this date                      |
| `recurrence_end_count`       | integer                                    | Total number of completions allowed                |
| `recurrence_completed_count` | integer                                    | Completions so far (carried forward on each spawn) |

**Deduplication**: A unique DB index (`idx_tasks_recurrence_unique`) on `(recurrence_template_id, due_date)` prevents duplicate future instances at the storage layer.

---

### DailyLog

```typescript
// extensions/task-vault/src/vault/types.ts:54
interface DailyLog {
  date: string // YYYY-MM-DD
  filePath: string // Logical: "daily/<YYYY-MM-DD>"
  tasks: Task[] // tasks with source='daily' AND source_ref=date
  exists: boolean
}
```

Tasks belonging to a daily log are stored in the `tasks` table with `source='daily'` and `source_ref='YYYY-MM-DD'`. There is no separate `events` or `notes` table (those legacy tables are dropped in the migration at `db.ts:83`).

---

### InboxItem

```typescript
// extensions/task-vault/src/vault/types.ts:61
interface InboxItem extends Task {
  capturedAt?: string // ISO timestamp stored in metadata
  source?: 'quick-capture' | 'mcp' | 'manual'
}
```

Inbox items have `source='inbox'` in the `tasks` table.

---

### Project

```typescript
// extensions/task-vault/src/vault/types.ts:66
interface Project {
  filePath: string // Logical: "projects/<name>"
  name: string // UNIQUE in projects table
  status: ProjectStatus
  deadline?: string
  area?: string
  created: string
  outcome?: string
  nextActions: Task[]
  allTasks: Task[]
  isStale: boolean
  lastModified: Date
  terminatorLinks: string[]
}

type ProjectStatus = 'active' | 'someday' | 'done' | 'archived'
```

**SQL schema** (`db.ts:172`):

```sql
CREATE TABLE IF NOT EXISTS projects (
  id               TEXT PRIMARY KEY,   -- UUID v4
  name             TEXT UNIQUE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  area             TEXT,
  area_id          TEXT REFERENCES areas(id) ON DELETE SET NULL,
  deadline         TEXT,
  outcome          TEXT,
  terminator_links TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
```

---

### Area

```typescript
// extensions/task-vault/src/vault/types.ts:81
interface Area {
  filePath: string
  name: string
  area: string
  tasks: Task[]
  terminatorLinks: string[]
}
```

**SQL schema** (`db.ts:187`):

```sql
CREATE TABLE IF NOT EXISTS areas (
  id         TEXT PRIMARY KEY,    -- UUID v4
  name       TEXT UNIQUE NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',  -- added in migration
  created_at TEXT NOT NULL
);
```

---

### IndexedTask / IndexedProject

These are the read-model shapes returned by IPC query handlers. `IndexedTask` carries all recurrence fields for the UI:

```typescript
// extensions/task-vault/src/vault/types.ts:89
interface IndexedTask {
  id: string // UUID v4 — stable
  filePath: string
  line: number
  status: TaskStatus
  text: string
  project?: string
  context?: string
  area?: string
  dueDate?: string
  terminatorLinks: string[]
  subtasks?: IndexedTask[]
  blockedReason?: string
  blockedCheckInterval?: string
  recurrenceRule?: string
  recurrenceTemplateId?: string
  recurrenceNotifyAt?: string
  recurrenceEndType?: 'none' | 'on_date' | 'after_count'
  recurrenceEndDate?: string
  recurrenceEndCount?: number
  recurrenceCompletedCount?: number
}
```

---

### TerminatorLink

```typescript
// extensions/task-vault/src/vault/types.ts:127
interface TerminatorLink {
  targetId: string // Terminator workspace or project UUID
  targetType: 'workspace' | 'project'
  displayName?: string // Resolved at render time; never stored
  isBroken: boolean
}
```

Links are stored as JSON arrays in the `terminator_links` column of `tasks` and `projects`.

---

### CalendarEvent / IcsFeedCache

```typescript
// extensions/task-vault/src/vault/types.ts:134
interface CalendarEvent {
  uid: string
  summary: string
  startDate: Date
  endDate: Date
  allDay: boolean
  location?: string
  description?: string
}

interface IcsFeedCache {
  feedUrl: string
  events: CalendarEvent[]
  lastFetchedAt: string
  fetchError?: string
}
```

**Status**: `IcsFeedCache` (`extensions/task-vault/src/vault/types.ts:145`) and the `ics:get-events` request schema (`extensions/task-vault/src/schemas/vault.schema.ts:229`) are defined, but no fetch/cache handler is wired up in the current code — there is no `ics:get-events` handler in `vault.ipc.ts` and no persisted cache. The old `<vault>/.todo/ics-cache.json` location was removed in the PGlite migration and has no replacement yet.

---

## Storage Layout

All structured data lives in the shared app-wide PGlite database at `<userData>/app.pglite` (tables: `settings`, `tasks`, `projects`, `areas`, `links`). The task-vault extension no longer creates a per-vault `<vault>/.todo/` directory: the former `vault.db`, `config.yaml`, and inline file-based settings have been folded into the shared database — user settings such as `stale_days_threshold` are rows in the `settings` table keyed by `(extension_id, key)`.

The `daily/`, `inbox.md`, `projects/`, `areas/`, and `archive/` directories from the earlier markdown-file spec are no longer used. All data lives in the shared database.

---

## Task ID Stability Contract

Task IDs are UUID v4 values generated at insert time (`randomUUID()` from `node:crypto`). They are:

- **Stable across sessions** — survive app restarts, file-system changes, and index rebuilds.
- **Stable across edits** — updating a task's text, status, or metadata does not change its ID.
- **Never reused** — deleted task IDs are not recycled.

The `STALE_ID` error and `filepath:line` contract described in ADR-014 are superseded by ADR-016. MCP tools may use task UUIDs indefinitely without re-querying after writes.
