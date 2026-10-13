import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../../../src/main/db/index'
import { applyNotepadSchema, randomUUID } from '../../../src/db/db'
import type { ExtensionDB } from '@terminator/extension-sdk'

let db: ExtensionDB

beforeEach(() => {
  db = wrapDb(new DatabaseSync(':memory:'))
})

describe('applyNotepadSchema', () => {
  it('creates all required tables', async () => {
    await applyNotepadSchema(db)
    const rows = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    )
    expect(rows.map((r) => r.name).sort()).toEqual([
      'comments',
      'diagram_comments',
      'diagram_tags',
      'diagrams',
      'folders',
      'note_tags',
      'notes',
      'settings',
      'tags',
    ])
  })

  it('gives notes from an earlier schema a title that still follows the body', async () => {
    await db.exec(
      `CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled note', body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, sort_order REAL NOT NULL DEFAULT 0, folder_id TEXT);
       INSERT INTO notes (id, created_at, updated_at) VALUES ('old', 't', 't');`
    )
    await applyNotepadSchema(db)
    expect(await db.get('SELECT title_set_by_hand FROM notes WHERE id = ?', ['old'])).toEqual({
      title_set_by_hand: 0,
    })
  })

  it('is idempotent — safe to call twice', async () => {
    await applyNotepadSchema(db)
    await expect(applyNotepadSchema(db)).resolves.not.toThrow()
  })

  it('deleting a note deletes its tag links and comments but keeps the tag', async () => {
    await applyNotepadSchema(db)
    await db.exec(`
      INSERT INTO notes (id, created_at, updated_at) VALUES ('n', 't', 't');
      INSERT INTO tags (id, name) VALUES ('g', 'work');
      INSERT INTO note_tags (note_id, tag_id) VALUES ('n', 'g');
      INSERT INTO comments (id, note_id, body, created_at, updated_at) VALUES ('c', 'n', 'hi', 't', 't');
    `)
    await db.run('DELETE FROM notes WHERE id = ?', ['n'])
    expect(await db.query('SELECT * FROM note_tags')).toEqual([])
    expect(await db.query('SELECT * FROM comments')).toEqual([])
    expect(await db.query('SELECT * FROM tags')).toHaveLength(1)
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
})
