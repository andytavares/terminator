import { randomUUID } from 'node:crypto'
import type { ExtensionDB } from '@terminator/extension-sdk'

export { randomUUID }

const SETTINGS_SCHEMA = `
    CREATE TABLE IF NOT EXISTS settings (
      extension_id TEXT NOT NULL DEFAULT 'task-vault',
      key          TEXT NOT NULL,
      value        TEXT NOT NULL,
      PRIMARY KEY (extension_id, key)
    );`

const AREAS_SCHEMA = `
    CREATE TABLE IF NOT EXISTS areas (
      id         TEXT PRIMARY KEY,
      name       TEXT UNIQUE NOT NULL,
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );`

const PROJECTS_SCHEMA = `
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
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);`

const TASKS_SCHEMA = `
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
      recurrence_rule TEXT,
      recurrence_template_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      recurrence_notify_at TEXT,
      blocked_reason TEXT,
      blocked_check_interval TEXT,
      recurrence_end_type TEXT,
      recurrence_end_date TEXT,
      recurrence_end_count INTEGER,
      recurrence_completed_count INTEGER,
      today_since TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source, source_ref);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_area_id ON tasks(area_id);
    CREATE INDEX IF NOT EXISTS idx_projects_area_id ON projects(area_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_template ON tasks(recurrence_template_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_recurrence_unique
      ON tasks(recurrence_template_id, due_date)
      WHERE recurrence_template_id IS NOT NULL AND due_date IS NOT NULL;`

const AREA_ARCHIVE_SCHEMA = `
    CREATE TABLE IF NOT EXISTS area_archive_changes (
      area_id         TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
      entity_type     TEXT NOT NULL,
      entity_id       TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      PRIMARY KEY (area_id, entity_type, entity_id)
    );`

/** Run on every launch, after the schema. Each statement is safe to repeat. */
const MIGRATIONS = `
    DROP TABLE IF EXISTS weekly_review_actions;
    DROP TABLE IF EXISTS weekly_reviews;
    DELETE FROM settings WHERE extension_id = 'task-vault' AND key = 'kanban_config';
    UPDATE tasks SET
      recurrence_end_type = json_extract(metadata, '$.recurrence_end_type'),
      recurrence_end_date = json_extract(metadata, '$.recurrence_end_date'),
      recurrence_end_count = json_extract(metadata, '$.recurrence_end_count'),
      recurrence_completed_count = COALESCE(json_extract(metadata, '$.recurrence_completed_count'), 0)
    WHERE COALESCE(recurrence_end_type, 'none') = 'none'
      AND COALESCE(CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.recurrence_end_type') END, '') <> '';`

/** Every statement of the schema, in creation order. */
const SCHEMA = [SETTINGS_SCHEMA, AREAS_SCHEMA, PROJECTS_SCHEMA, TASKS_SCHEMA, AREA_ARCHIVE_SCHEMA]

export async function applyTaskVaultSchema(db: ExtensionDB): Promise<void> {
  await db.exec(`\n${SCHEMA.join('\n\n')}\n${MIGRATIONS}\n  `)
}
