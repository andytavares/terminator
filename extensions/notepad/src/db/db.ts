import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

export { randomUUID }

let _db: Database.Database | null = null

export function initDb(userData: string): Database.Database {
  fs.mkdirSync(userData, { recursive: true })
  const dbPath = path.join(userData, 'notepad.db')
  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  applySchema(_db)
  return _db
}

export function getDb(): Database.Database {
  if (!_db) throw new Error('NotepadDB not initialized — call initDb first')
  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

export function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return cols.some((c) => c.name === column)
}

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL DEFAULT 'Untitled note',
      body        TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id   TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS note_tags (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id           TEXT PRIMARY KEY,
      note_id      TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      parent_id    TEXT REFERENCES comments(id) ON DELETE CASCADE,
      body         TEXT NOT NULL,
      author       TEXT NOT NULL DEFAULT 'me',
      status       TEXT NOT NULL DEFAULT 'open',
      start_offset INTEGER,
      end_offset   INTEGER,
      quote        TEXT,
      prefix       TEXT,
      suffix       TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_note ON comments(note_id, status);

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title, body, tags,
      content='',
      tokenize='unicode61'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

export function insertFts(
  db: Database.Database,
  rowid: number,
  title: string,
  body: string,
  tags: string
): void {
  db.prepare(`INSERT OR REPLACE INTO notes_fts(rowid, title, body, tags) VALUES (?, ?, ?, ?)`).run(
    rowid,
    title,
    body,
    tags
  )
}

export function deleteFts(db: Database.Database, rowid: number): void {
  db.prepare(`INSERT INTO notes_fts(notes_fts, rowid) VALUES('delete', ?)`).run(rowid)
}
