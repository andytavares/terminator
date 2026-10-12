import { randomUUID } from 'node:crypto'
import type { ExtensionDB } from '@terminator/extension-sdk'

export { randomUUID }

export async function applyNotepadSchema(db: ExtensionDB): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      sort_order REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL DEFAULT 'Untitled note',
      body        TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      archived_at TEXT,
      sort_order  REAL NOT NULL DEFAULT 0,
      folder_id   TEXT
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

    CREATE TABLE IF NOT EXISTS settings (
      extension_id TEXT NOT NULL DEFAULT 'notepad',
      key          TEXT NOT NULL,
      value        TEXT NOT NULL,
      PRIMARY KEY (extension_id, key)
    );

    CREATE TABLE IF NOT EXISTS diagrams (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL DEFAULT 'Untitled diagram',
      scene_json  TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      archived_at TEXT,
      sort_order  REAL NOT NULL DEFAULT 0,
      folder_id   TEXT
    );

    CREATE TABLE IF NOT EXISTS diagram_tags (
      diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
      tag        TEXT NOT NULL,
      PRIMARY KEY (diagram_id, tag)
    );

    CREATE TABLE IF NOT EXISTS diagram_comments (
      id         TEXT PRIMARY KEY,
      diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
      parent_id  TEXT REFERENCES diagram_comments(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      author     TEXT NOT NULL DEFAULT 'me',
      status     TEXT NOT NULL DEFAULT 'open',
      scene_x    REAL NOT NULL DEFAULT 0,
      scene_y    REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_diagram_comments_diagram ON diagram_comments(diagram_id, status);
  `)
  await addColumnIfMissing(db, 'notes', 'title_set_by_hand', 'INTEGER NOT NULL DEFAULT 0')
}

/** Adds a column to a table created by an earlier version of this schema. */
async function addColumnIfMissing(
  db: ExtensionDB,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const present = await db.get('SELECT 1 FROM pragma_table_info(?) WHERE name = ?', [table, column])
  if (!present) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}
