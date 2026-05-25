import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

export { randomUUID }

let _db: Database.Database | null = null

export function initDb(vaultPath: string): Database.Database {
  const dbDir = path.join(vaultPath, '.todo')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'vault.db')
  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  applySchema(_db)
  applyMigrations(_db)
  return _db
}

export function getDb(): Database.Database {
  if (!_db) throw new Error('VaultDB not initialized — call initDb first')
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
  // Always ensure indexes exist (CREATE INDEX IF NOT EXISTS is idempotent)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_area_id ON tasks(area_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_area_id ON projects(area_id)`)
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
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id         TEXT PRIMARY KEY,
      date       TEXT NOT NULL,
      time       TEXT,
      text       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      date       TEXT NOT NULL,
      text       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date);
  `)
}
