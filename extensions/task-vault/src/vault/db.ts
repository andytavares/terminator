import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { backfillRecurringTasks } from './ensure-next-occurrence.js'

export { randomUUID }

let _db: Database.Database | null = null
let _initError: Error | null = null

export function initDb(userData: string): Database.Database {
  _initError = null
  fs.mkdirSync(userData, { recursive: true })
  const dbPath = path.join(userData, 'vault.db')
  try {
    _db = new Database(dbPath)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    applySchema(_db)
    applyMigrations(_db)
    // Startup gap-fill: create any missing future occurrences for recurring tasks
    try {
      backfillRecurringTasks(_db)
    } catch {
      // Non-fatal: gap-fill runs best-effort; individual task errors are caught inside
    }
    return _db
  } catch (err) {
    // If anything in the init sequence fails, close the DB so getDb() stays null
    if (_db) {
      try {
        _db.close()
      } catch {
        // ignore close errors during cleanup
      }
      _db = null
    }
    _initError = err instanceof Error ? err : new Error(String(err))
    throw _initError
  }
}

export function getDb(): Database.Database {
  if (!_db) {
    const detail = _initError ? _initError.message : 'call initDb first'
    throw new Error(`VaultDB not initialized — ${detail}`)
  }
  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return cols.some((c) => c.name === column)
}

function applyMigrations(db: Database.Database): void {
  if (!hasColumn(db, 'tasks', 'project_id')) {
    db.exec(
      `ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`
    )
    db.exec(
      `UPDATE tasks SET project_id = (SELECT id FROM projects WHERE name = tasks.project) WHERE project IS NOT NULL`
    )
  }
  if (!hasColumn(db, 'tasks', 'area_id')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN area_id TEXT REFERENCES areas(id) ON DELETE SET NULL`)
    db.exec(
      `UPDATE tasks SET area_id = (SELECT id FROM areas WHERE name = tasks.area) WHERE area IS NOT NULL`
    )
  }
  if (!hasColumn(db, 'projects', 'area_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN area_id TEXT REFERENCES areas(id) ON DELETE SET NULL`)
    db.exec(
      `UPDATE projects SET area_id = (SELECT id FROM areas WHERE name = projects.area) WHERE area IS NOT NULL`
    )
  }
  if (!hasColumn(db, 'areas', 'status')) {
    db.exec(`ALTER TABLE areas ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`)
  }
  if (!hasColumn(db, 'areas', 'updated_at')) {
    db.exec(`ALTER TABLE areas ADD COLUMN updated_at TEXT`)
    db.exec(`UPDATE areas SET updated_at = created_at WHERE updated_at IS NULL`)
  }

  // Recurrence engine v2: column-based rule storage
  if (!hasColumn(db, 'tasks', 'recurrence_rule')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT`)
    db.exec(
      `ALTER TABLE tasks ADD COLUMN recurrence_template_id TEXT REFERENCES tasks(id) ON DELETE SET NULL`
    )
    db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_notify_at TEXT`)
    // Migrate existing metadata-based recurrence to new columns
    migrateRecurrenceMetadata(db)
  }

  // Promote blocked / recurrence-end fields from metadata JSON to first-class columns
  if (!hasColumn(db, 'tasks', 'blocked_reason')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN blocked_reason TEXT`)
    db.exec(`ALTER TABLE tasks ADD COLUMN blocked_check_interval TEXT`)
    db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_end_type TEXT`)
    db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_end_date TEXT`)
    db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_end_count INTEGER`)
    db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_completed_count INTEGER`)
    migrateMetadataToColumns(db)
  }

  // today_since: tracks when a task first appeared in today's daily view
  if (!hasColumn(db, 'tasks', 'today_since')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN today_since TEXT`)
  }

  // Drop legacy tables no longer used by the app
  db.exec(`DROP TABLE IF EXISTS events`)
  db.exec(`DROP TABLE IF EXISTS notes`)

  // Always ensure indexes exist (CREATE INDEX IF NOT EXISTS is idempotent)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_area_id ON tasks(area_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_area_id ON projects(area_id)`)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_template ON tasks(recurrence_template_id)`
  )
  // Prevent duplicate future instances at the DB level
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_recurrence_unique
     ON tasks(recurrence_template_id, due_date)
     WHERE recurrence_template_id IS NOT NULL AND due_date IS NOT NULL`
  )
}

function migrateRecurrenceMetadata(db: Database.Database): void {
  type Row = { id: string; metadata: string }
  const rows = db
    .prepare(`SELECT id, metadata FROM tasks WHERE metadata IS NOT NULL AND metadata != '{}'`)
    .all() as Row[]

  const update = db.prepare(`UPDATE tasks SET recurrence_rule=?, recurrence_notify_at=? WHERE id=?`)

  const migrate = db.transaction(() => {
    for (const row of rows) {
      let meta: Record<string, unknown> = {}
      try {
        meta = JSON.parse(row.metadata) as Record<string, unknown>
      } catch {
        continue
      }
      const interval = meta.recurrence_interval as string | undefined
      if (!interval) continue

      // Build rule string; handle double-encoded recurrence_days
      let rule = interval
      if (interval === 'weekly' && meta.recurrence_days != null) {
        let days: number[] = []
        try {
          const raw = meta.recurrence_days
          // May be a JSON string of an array (double-encoded) or already an array
          if (typeof raw === 'string') {
            days = JSON.parse(raw) as number[]
          } else if (Array.isArray(raw)) {
            days = raw as number[]
          }
        } catch {
          // leave days empty — falls back to plain 'weekly'
        }
        if (days.length > 0) rule = `weekly:${days.sort((a, b) => a - b).join(',')}`
      }

      const notifyAt = (meta.recurrence_time as string) || null
      update.run(rule, notifyAt, row.id)
    }
  })
  migrate()
}

function migrateMetadataToColumns(db: Database.Database): void {
  type Row = { id: string; metadata: string }
  const rows = db
    .prepare(`SELECT id, metadata FROM tasks WHERE metadata IS NOT NULL AND metadata != '{}'`)
    .all() as Row[]

  const update = db.prepare(
    `UPDATE tasks SET
       blocked_reason=?, blocked_check_interval=?,
       recurrence_end_type=?, recurrence_end_date=?,
       recurrence_end_count=?, recurrence_completed_count=?
     WHERE id=?`
  )

  const migrate = db.transaction(() => {
    for (const row of rows) {
      let meta: Record<string, unknown> = {}
      try {
        meta = JSON.parse(row.metadata) as Record<string, unknown>
      } catch {
        continue
      }
      const blockedReason = (meta.blocked_reason as string) ?? null
      const blockedCheckInterval = (meta.blocked_check_interval as string) ?? null
      const recurrenceEndType = (meta.recurrence_end_type as string) ?? null
      const recurrenceEndDate = (meta.recurrence_end_date as string) ?? null
      const recurrenceEndCount =
        meta.recurrence_end_count != null ? (meta.recurrence_end_count as number) : null
      const recurrenceCompletedCount =
        meta.recurrence_completed_count != null ? (meta.recurrence_completed_count as number) : null

      // Only update rows that actually have at least one relevant field
      if (
        blockedReason !== null ||
        blockedCheckInterval !== null ||
        recurrenceEndType !== null ||
        recurrenceEndDate !== null ||
        recurrenceEndCount !== null ||
        recurrenceCompletedCount !== null
      ) {
        update.run(
          blockedReason,
          blockedCheckInterval,
          recurrenceEndType,
          recurrenceEndDate,
          recurrenceEndCount,
          recurrenceCompletedCount,
          row.id
        )
      }
    }
  })
  migrate()
}

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      text        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',
      project     TEXT,
      context     TEXT,
      area        TEXT,
      project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
      area_id     TEXT REFERENCES areas(id) ON DELETE SET NULL,
      due_date    TEXT,
      completed_date TEXT,
      migrated_to TEXT,
      source      TEXT NOT NULL DEFAULT 'inbox',
      source_ref  TEXT,
      parent_id   TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      metadata    TEXT NOT NULL DEFAULT '{}',
      terminator_links TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source, source_ref);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);

    CREATE TABLE IF NOT EXISTS projects (
      id               TEXT PRIMARY KEY,
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
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

    CREATE TABLE IF NOT EXISTS areas (
      id         TEXT PRIMARY KEY,
      name       TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

  `)
}
