import { randomUUID } from 'node:crypto'
import type { ExtensionDB } from '../../../../src/main/db/index'

export { randomUUID }

export async function hasColumn(db: ExtensionDB, table: string, column: string): Promise<boolean> {
  const rows = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name = ? AND column_name = ?`,
    [table, column]
  )
  return rows.length > 0
}

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
}

export async function applyNotepadMigrations(db: ExtensionDB): Promise<void> {
  const hasTags = await hasColumn(db, 'diagrams', 'tags')
  if (!hasTags) {
    await db.exec(`ALTER TABLE diagrams ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`)
  }
  const hasSortOrderNotes = await hasColumn(db, 'notes', 'sort_order')
  if (!hasSortOrderNotes) {
    await db.exec(`ALTER TABLE notes ADD COLUMN sort_order REAL NOT NULL DEFAULT 0`)
  }
  const hasSortOrderDiagrams = await hasColumn(db, 'diagrams', 'sort_order')
  if (!hasSortOrderDiagrams) {
    await db.exec(`ALTER TABLE diagrams ADD COLUMN sort_order REAL NOT NULL DEFAULT 0`)
  }
  await db.exec(`CREATE TABLE IF NOT EXISTS folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`)
  const hasFolderIdNotes = await hasColumn(db, 'notes', 'folder_id')
  if (!hasFolderIdNotes) {
    await db.exec(`ALTER TABLE notes ADD COLUMN folder_id TEXT`)
  }
  const hasFolderIdDiagrams = await hasColumn(db, 'diagrams', 'folder_id')
  if (!hasFolderIdDiagrams) {
    await db.exec(`ALTER TABLE diagrams ADD COLUMN folder_id TEXT`)
  }
  if (!(await hasColumn(db, 'settings', 'extension_id'))) {
    await db.exec(`
      CREATE TABLE settings_new (
        extension_id TEXT NOT NULL DEFAULT 'notepad',
        key          TEXT NOT NULL,
        value        TEXT NOT NULL,
        PRIMARY KEY (extension_id, key)
      );
      INSERT INTO settings_new (extension_id, key, value)
        SELECT 'notepad', key, value FROM settings;
      DROP TABLE settings;
      ALTER TABLE settings_new RENAME TO settings;
    `)
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS diagram_tags (
      diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
      tag        TEXT NOT NULL,
      PRIMARY KEY (diagram_id, tag)
    )
  `)
  if (await hasColumn(db, 'diagrams', 'tags')) {
    const rows = await db.query<{ id: string; tags: string }>(`SELECT id, tags FROM diagrams`)
    for (const row of rows) {
      let parsed: string[] = []
      try {
        parsed = JSON.parse(row.tags ?? '[]') as string[]
      } catch {
        parsed = []
      }
      for (const tag of parsed) {
        await db.run(
          `INSERT INTO diagram_tags (diagram_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING`,
          [row.id, tag]
        )
      }
    }
    await db.exec(`ALTER TABLE diagrams DROP COLUMN tags`)
  }
}
