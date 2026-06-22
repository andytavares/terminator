import { randomUUID } from 'node:crypto'
import type { ExtensionDB } from '../../../../src/main/extensions/api'

export { randomUUID }

export async function hasColumn(db: ExtensionDB, table: string, column: string): Promise<boolean> {
  const row = await db.get<{ count: string }>(
    `SELECT COUNT(*) as count FROM information_schema.columns WHERE table_schema='public' AND table_name=? AND column_name=?`,
    [table, column]
  )
  return parseInt(row?.count ?? '0', 10) > 0
}

export async function applyTaskVaultSchema(db: ExtensionDB): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      extension_id TEXT NOT NULL DEFAULT 'task-vault',
      key          TEXT NOT NULL,
      value        TEXT NOT NULL,
      PRIMARY KEY (extension_id, key)
    );

    CREATE TABLE IF NOT EXISTS areas (
      id         TEXT PRIMARY KEY,
      name       TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

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
  `)
}

export async function applyTaskVaultMigrations(db: ExtensionDB): Promise<void> {
  if (!(await hasColumn(db, 'tasks', 'project_id'))) {
    await db.exec(
      `ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`
    )
    await db.exec(
      `UPDATE tasks SET project_id = (SELECT id FROM projects WHERE name = tasks.project) WHERE project IS NOT NULL`
    )
  }
  if (!(await hasColumn(db, 'tasks', 'area_id'))) {
    await db.exec(
      `ALTER TABLE tasks ADD COLUMN area_id TEXT REFERENCES areas(id) ON DELETE SET NULL`
    )
    await db.exec(
      `UPDATE tasks SET area_id = (SELECT id FROM areas WHERE name = tasks.area) WHERE area IS NOT NULL`
    )
  }
  if (!(await hasColumn(db, 'projects', 'area_id'))) {
    await db.exec(
      `ALTER TABLE projects ADD COLUMN area_id TEXT REFERENCES areas(id) ON DELETE SET NULL`
    )
    await db.exec(
      `UPDATE projects SET area_id = (SELECT id FROM areas WHERE name = projects.area) WHERE area IS NOT NULL`
    )
  }
  if (!(await hasColumn(db, 'areas', 'status'))) {
    await db.exec(`ALTER TABLE areas ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`)
  }
  if (!(await hasColumn(db, 'areas', 'updated_at'))) {
    await db.exec(`ALTER TABLE areas ADD COLUMN updated_at TEXT`)
    await db.exec(`UPDATE areas SET updated_at = created_at WHERE updated_at IS NULL`)
  }
  if (!(await hasColumn(db, 'tasks', 'recurrence_rule'))) {
    await db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT`)
    await db.exec(
      `ALTER TABLE tasks ADD COLUMN recurrence_template_id TEXT REFERENCES tasks(id) ON DELETE SET NULL`
    )
    await db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_notify_at TEXT`)
    await migrateRecurrenceMetadata(db)
  }
  if (!(await hasColumn(db, 'tasks', 'blocked_reason'))) {
    await db.exec(`ALTER TABLE tasks ADD COLUMN blocked_reason TEXT`)
    await db.exec(`ALTER TABLE tasks ADD COLUMN blocked_check_interval TEXT`)
    await db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_end_type TEXT`)
    await db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_end_date TEXT`)
    await db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_end_count INTEGER`)
    await db.exec(`ALTER TABLE tasks ADD COLUMN recurrence_completed_count INTEGER`)
    await migrateMetadataToColumns(db)
  }
  if (!(await hasColumn(db, 'tasks', 'today_since'))) {
    await db.exec(`ALTER TABLE tasks ADD COLUMN today_since TEXT`)
  }

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_area_id ON tasks(area_id)`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_area_id ON projects(area_id)`)
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_template ON tasks(recurrence_template_id)`
  )
  await db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_recurrence_unique
     ON tasks(recurrence_template_id, due_date)
     WHERE recurrence_template_id IS NOT NULL AND due_date IS NOT NULL`
  )
  if (!(await hasColumn(db, 'settings', 'extension_id'))) {
    await db.exec(`
      CREATE TABLE settings_new (
        extension_id TEXT NOT NULL DEFAULT 'task-vault',
        key          TEXT NOT NULL,
        value        TEXT NOT NULL,
        PRIMARY KEY (extension_id, key)
      );
      INSERT INTO settings_new (extension_id, key, value)
        SELECT 'task-vault', key, value FROM settings;
      DROP TABLE settings;
      ALTER TABLE settings_new RENAME TO settings;
    `)
  }
}

async function migrateRecurrenceMetadata(db: ExtensionDB): Promise<void> {
  type Row = { id: string; metadata: string }
  const rows = await db.query<Row>(
    `SELECT id, metadata FROM tasks WHERE metadata IS NOT NULL AND metadata != '{}'`
  )

  await db.transaction(async (tx) => {
    for (const row of rows) {
      let meta: Record<string, unknown> = {}
      try {
        meta = JSON.parse(row.metadata) as Record<string, unknown>
      } catch {
        continue
      }
      const interval = meta.recurrence_interval as string | undefined
      if (!interval) continue

      let rule = interval
      if (interval === 'weekly' && meta.recurrence_days != null) {
        let days: number[] = []
        try {
          const raw = meta.recurrence_days
          if (typeof raw === 'string') {
            days = JSON.parse(raw) as number[]
          } else if (Array.isArray(raw)) {
            days = raw as number[]
          }
        } catch {
          // leave days empty
        }
        if (days.length > 0) rule = `weekly:${days.sort((a, b) => a - b).join(',')}`
      }

      const notifyAt = (meta.recurrence_time as string) || null
      await tx.run(`UPDATE tasks SET recurrence_rule=?, recurrence_notify_at=? WHERE id=?`, [
        rule,
        notifyAt,
        row.id,
      ])
    }
  })
}

async function migrateMetadataToColumns(db: ExtensionDB): Promise<void> {
  type Row = { id: string; metadata: string }
  const rows = await db.query<Row>(
    `SELECT id, metadata FROM tasks WHERE metadata IS NOT NULL AND metadata != '{}'`
  )

  await db.transaction(async (tx) => {
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

      if (
        blockedReason !== null ||
        blockedCheckInterval !== null ||
        recurrenceEndType !== null ||
        recurrenceEndDate !== null ||
        recurrenceEndCount !== null ||
        recurrenceCompletedCount !== null
      ) {
        await tx.run(
          `UPDATE tasks SET
             blocked_reason=?, blocked_check_interval=?,
             recurrence_end_type=?, recurrence_end_date=?,
             recurrence_end_count=?, recurrence_completed_count=?
           WHERE id=?`,
          [
            blockedReason,
            blockedCheckInterval,
            recurrenceEndType,
            recurrenceEndDate,
            recurrenceEndCount,
            recurrenceCompletedCount,
            row.id,
          ]
        )
      }
    }
  })
}
