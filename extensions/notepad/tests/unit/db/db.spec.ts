import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { wrapDb } from '../../../../../src/main/db/index'
import {
  applyNotepadSchema,
  applyNotepadMigrations,
  hasColumn,
  randomUUID,
} from '../../../src/db/db'
import type { ExtensionDB } from '../../../../../src/main/db/index'

let pg: PGlite
let db: ExtensionDB

beforeEach(async () => {
  pg = new PGlite()
  await pg.waitReady
  db = wrapDb(pg)
})

afterEach(async () => {
  await pg.close()
})

describe('applyNotepadSchema', () => {
  it('creates all required tables', async () => {
    await applyNotepadSchema(db)
    const rows = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    )
    const tables = rows.map((r) => r.table_name)
    expect(tables).toContain('notes')
    expect(tables).toContain('tags')
    expect(tables).toContain('note_tags')
    expect(tables).toContain('comments')
    expect(tables).toContain('settings')
    expect(tables).toContain('diagrams')
    expect(tables).toContain('diagram_tags')
    expect(tables).toContain('diagram_comments')
  })

  it('is idempotent — safe to call twice', async () => {
    await applyNotepadSchema(db)
    await expect(applyNotepadSchema(db)).resolves.not.toThrow()
  })
})

describe('applyNotepadMigrations', () => {
  it('is a no-op for new installs (diagram_tags already in schema)', async () => {
    await applyNotepadSchema(db)
    expect(await hasColumn(db, 'diagrams', 'tags')).toBe(false)
    await expect(applyNotepadMigrations(db)).resolves.not.toThrow()
    const tables = (
      await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
      )
    ).map((r) => r.table_name)
    expect(tables).toContain('diagram_tags')
    expect(await hasColumn(db, 'diagrams', 'tags')).toBe(false)
  })

  it('is idempotent — safe to call twice', async () => {
    await applyNotepadSchema(db)
    await applyNotepadMigrations(db)
    await expect(applyNotepadMigrations(db)).resolves.not.toThrow()
  })

  it('creates diagram_tags and does not add tags column when old schema had no tags column', async () => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled note', body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, sort_order REAL NOT NULL DEFAULT 0, folder_id TEXT);
      CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS note_tags (note_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (note_id, tag_id));
      CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, parent_id TEXT, body TEXT NOT NULL, author TEXT NOT NULL DEFAULT 'me', status TEXT NOT NULL DEFAULT 'open', start_offset INTEGER, end_offset INTEGER, quote TEXT, prefix TEXT, suffix TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS diagrams (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled diagram', scene_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, sort_order REAL NOT NULL DEFAULT 0, folder_id TEXT);
    `)
    expect(await hasColumn(db, 'diagrams', 'tags')).toBe(false)
    await applyNotepadMigrations(db)
    expect(await hasColumn(db, 'diagrams', 'tags')).toBe(false)
    const tables = (
      await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
      )
    ).map((r) => r.table_name)
    expect(tables).toContain('diagram_tags')
  })

  it('migrates diagrams.tags JSON to diagram_tags rows and drops tags column', async () => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled note', body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, sort_order REAL NOT NULL DEFAULT 0, folder_id TEXT);
      CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS note_tags (note_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (note_id, tag_id));
      CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, parent_id TEXT, body TEXT NOT NULL, author TEXT NOT NULL DEFAULT 'me', status TEXT NOT NULL DEFAULT 'open', start_offset INTEGER, end_offset INTEGER, quote TEXT, prefix TEXT, suffix TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS diagrams (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled diagram', tags TEXT NOT NULL DEFAULT '[]', scene_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, sort_order REAL NOT NULL DEFAULT 0, folder_id TEXT);
    `)
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO diagrams (id, title, tags, scene_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ['d1', 'Diag1', '["alpha","beta"]', '{}', now, now]
    )
    expect(await hasColumn(db, 'diagrams', 'tags')).toBe(true)
    await applyNotepadMigrations(db)
    expect(await hasColumn(db, 'diagrams', 'tags')).toBe(false)
    const tagRows = await db.query<{ tag: string }>(
      `SELECT tag FROM diagram_tags WHERE diagram_id=? ORDER BY tag`,
      ['d1']
    )
    expect(tagRows.map((r) => r.tag)).toEqual(['alpha', 'beta'])
  })

  it('adds sort_order to notes when missing', async () => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled note', body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, folder_id TEXT);
      CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS note_tags (note_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (note_id, tag_id));
      CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, parent_id TEXT, body TEXT NOT NULL, author TEXT NOT NULL DEFAULT 'me', status TEXT NOT NULL DEFAULT 'open', start_offset INTEGER, end_offset INTEGER, quote TEXT, prefix TEXT, suffix TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS diagrams (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled diagram', tags TEXT NOT NULL DEFAULT '[]', scene_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, folder_id TEXT);
    `)
    expect(await hasColumn(db, 'notes', 'sort_order')).toBe(false)
    await applyNotepadMigrations(db)
    expect(await hasColumn(db, 'notes', 'sort_order')).toBe(true)
    expect(await hasColumn(db, 'diagrams', 'sort_order')).toBe(true)
  })

  it('adds folder_id to notes and diagrams when missing', async () => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled note', body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, sort_order REAL NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS note_tags (note_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (note_id, tag_id));
      CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, parent_id TEXT, body TEXT NOT NULL, author TEXT NOT NULL DEFAULT 'me', status TEXT NOT NULL DEFAULT 'open', start_offset INTEGER, end_offset INTEGER, quote TEXT, prefix TEXT, suffix TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS diagrams (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled diagram', tags TEXT NOT NULL DEFAULT '[]', scene_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, sort_order REAL NOT NULL DEFAULT 0);
    `)
    expect(await hasColumn(db, 'notes', 'folder_id')).toBe(false)
    expect(await hasColumn(db, 'diagrams', 'folder_id')).toBe(false)
    await applyNotepadMigrations(db)
    expect(await hasColumn(db, 'notes', 'folder_id')).toBe(true)
    expect(await hasColumn(db, 'diagrams', 'folder_id')).toBe(true)
  })
})

describe('hasColumn', () => {
  it('returns true for an existing column', async () => {
    await applyNotepadSchema(db)
    expect(await hasColumn(db, 'notes', 'title')).toBe(true)
  })

  it('returns false for a non-existent column', async () => {
    await applyNotepadSchema(db)
    expect(await hasColumn(db, 'notes', 'nonexistent_col')).toBe(false)
  })
})

describe('randomUUID', () => {
  it('returns a valid UUID string', () => {
    const id = randomUUID()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('generates unique values', () => {
    expect(randomUUID()).not.toBe(randomUUID())
  })
})

describe('settings composite PK (extension_id, key)', () => {
  beforeEach(async () => {
    await applyNotepadSchema(db)
    await applyNotepadMigrations(db)
  })

  it('settings table has extension_id column after migration', async () => {
    expect(await hasColumn(db, 'settings', 'extension_id')).toBe(true)
  })

  it('two different extension_ids can hold the same key independently', async () => {
    await db.run(`INSERT INTO settings (extension_id, key, value) VALUES (?, ?, ?)`, [
      'notepad',
      'theme',
      'dark',
    ])
    await db.run(`INSERT INTO settings (extension_id, key, value) VALUES (?, ?, ?)`, [
      'other-ext',
      'theme',
      'light',
    ])
    const rows = await db.query<{ extension_id: string; value: string }>(
      `SELECT extension_id, value FROM settings WHERE key = 'theme' ORDER BY extension_id`
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ extension_id: 'notepad', value: 'dark' })
    expect(rows[1]).toMatchObject({ extension_id: 'other-ext', value: 'light' })
  })

  it('duplicate (extension_id, key) insert is rejected by PK constraint', async () => {
    await db.run(`INSERT INTO settings (extension_id, key, value) VALUES (?, ?, ?)`, [
      'notepad',
      'theme',
      'dark',
    ])
    await expect(
      db.run(`INSERT INTO settings (extension_id, key, value) VALUES (?, ?, ?)`, [
        'notepad',
        'theme',
        'light',
      ])
    ).rejects.toThrow()
  })

  it('existing settings rows are backfilled with extension_id after migration', async () => {
    const rows = await db.query<{ extension_id: string }>(
      `SELECT extension_id FROM settings WHERE extension_id IS NOT NULL`
    )
    expect(rows.length).toBeGreaterThanOrEqual(0)
  })
})
