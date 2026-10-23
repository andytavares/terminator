import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../../support/temp-dir'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../../../src/main/logger', () => ({ logger: mockLogger }))

import type { ExtensionDB } from '@terminator/extension-sdk'
import { wrapDb } from '../../../src/main/db/index'
import {
  importLegacyDatabase,
  legacyImportPending,
} from '../../../src/main/db/legacy-pglite-import'
import { applyNotepadSchema } from '../../../extensions/notepad/src/db/db'
import { applyTaskVaultSchema } from '../../../extensions/task-vault/src/vault/db'

// The shape of the data as the last PGlite release left it: Postgres tables with
// the same TEXT/REAL/INTEGER columns the extensions use today.
const LEGACY_SCHEMA = `
  CREATE TABLE notes (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
    sort_order REAL NOT NULL DEFAULT 0, folder_id TEXT
  );
  CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
  CREATE TABLE note_tags (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
  );
  CREATE TABLE settings (
    extension_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (extension_id, key)
  );
  CREATE TABLE areas (
    id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL, updated_at TEXT
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    area_id TEXT REFERENCES areas(id) ON DELETE SET NULL,
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0, metadata TEXT NOT NULL DEFAULT '{}',
    recurrence_end_count INTEGER, source TEXT NOT NULL DEFAULT 'inbox',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE removed_feature (id TEXT PRIMARY KEY);
  ALTER TABLE tasks ADD COLUMN retired_column TEXT;
`

const LEGACY_DATA = `
  INSERT INTO notes (id, title, body, created_at, updated_at, sort_order)
    VALUES ('n1', 'Résumé 日本語', E'line one\\nline "two"', '2026-01-01', '2026-01-02', 1.5),
           ('n2', 'Second', '', '2026-01-03', '2026-01-03', 0);
  INSERT INTO tags VALUES ('g1', 'work');
  INSERT INTO note_tags VALUES ('n1', 'g1');
  INSERT INTO settings VALUES ('notepad', 'theme', 'dark'), ('task-vault', 'stale_days_threshold', '9');
  INSERT INTO areas (id, name, created_at) VALUES ('a1', 'Work', '2026-01-01');
  INSERT INTO tasks (id, text, area_id, parent_id, sort_order, recurrence_end_count, created_at, updated_at, retired_column)
    VALUES ('child', 'Child first in file order', 'a1', 'parent', 2, 5, 't', 't', 'x'),
           ('parent', 'Parent', 'a1', NULL, 1, NULL, 't', 't', NULL);
  INSERT INTO removed_feature VALUES ('gone');
`

let userData: string

async function createLegacyDatabase(sql = LEGACY_SCHEMA + LEGACY_DATA): Promise<void> {
  const legacy = new PGlite(join(userData, 'app.pglite'))
  await legacy.waitReady
  await legacy.exec(sql)
  await legacy.close()
}

async function newDatabaseWithExtensionTables(): Promise<ExtensionDB> {
  const db = wrapDb(new DatabaseSync(join(userData, 'app.sqlite')))
  await applyNotepadSchema(db)
  await applyTaskVaultSchema(db)
  return db
}

beforeEach(() => {
  userData = makeTempDir('legacy-import-')
  vi.clearAllMocks()
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('legacyImportPending', () => {
  it('is true only when app.pglite exists and app.sqlite does not', () => {
    expect(legacyImportPending(userData)).toBe(false)

    mkdirSync(join(userData, 'app.pglite'))
    expect(legacyImportPending(userData)).toBe(true)

    writeFileSync(join(userData, 'app.sqlite'), '')
    expect(legacyImportPending(userData)).toBe(false)
  })
})

const IMPORTED_NOTES = [
  {
    id: 'n1',
    title: 'Résumé 日本語',
    body: 'line one\nline "two"',
    sort_order: 1.5,
    archived_at: null,
  },
  { id: 'n2', title: 'Second', body: '', sort_order: 0, archived_at: null },
]

// The child row comes first in the legacy table.
const IMPORTED_TASKS = [
  {
    id: 'child',
    parent_id: 'parent',
    area_id: 'a1',
    sort_order: 2,
    recurrence_end_count: 5,
    status: 'open',
    metadata: '{}',
  },
  {
    id: 'parent',
    parent_id: null,
    area_id: 'a1',
    sort_order: 1,
    recurrence_end_count: null,
    status: 'open',
    metadata: '{}',
  },
]

describe('importLegacyDatabase', () => {
  it('copies every row of the tables that exist in both databases', async () => {
    await createLegacyDatabase()
    const db = await newDatabaseWithExtensionTables()

    await importLegacyDatabase(userData, db)

    const notes = await db.query<Record<string, unknown>>(
      `SELECT id, title, body, sort_order, archived_at FROM notes ORDER BY id`
    )
    expect(notes.map((note) => ({ ...note }))).toEqual(IMPORTED_NOTES)
    expect(await db.query('SELECT note_id, tag_id FROM note_tags')).toHaveLength(1)
    expect(await db.query('SELECT name FROM tags')).toHaveLength(1)
    const settings = await db.query<{ extension_id: string; key: string }>(
      `SELECT extension_id, key FROM settings ORDER BY extension_id`
    )
    expect(settings.map((row) => row.extension_id)).toEqual(['notepad', 'task-vault'])
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('keeps foreign keys intact when a child row comes before its parent', async () => {
    await createLegacyDatabase()
    const db = await newDatabaseWithExtensionTables()

    await importLegacyDatabase(userData, db)

    const tasks = await db.query<Record<string, unknown>>(
      `SELECT id, parent_id, area_id, sort_order, recurrence_end_count, status, metadata
       FROM tasks ORDER BY id`
    )
    expect(tasks.map((task) => ({ ...task }))).toEqual(IMPORTED_TASKS)
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([])
  })
})

describe('importLegacyDatabase — schema drift and leftovers', () => {
  it('skips tables and columns the new schema no longer has', async () => {
    await createLegacyDatabase()
    const db = await newDatabaseWithExtensionTables()

    await importLegacyDatabase(userData, db)

    expect(await db.get(`SELECT name FROM sqlite_master WHERE name = 'removed_feature'`)).toBe(
      undefined
    )
    expect(
      (await db.query<{ name: string }>(`SELECT name FROM pragma_table_info('tasks')`)).map(
        (column) => column.name
      )
    ).not.toContain('retired_column')
  })

  it('imports a database whose last session ended uncleanly', async () => {
    await createLegacyDatabase()
    // What PGlite leaves behind when the app is killed mid-session.
    writeFileSync(join(userData, 'app.pglite', 'postmaster.pid'), '-42\n/tmp/pglite/base\n')
    const db = await newDatabaseWithExtensionTables()

    await importLegacyDatabase(userData, db)

    expect(await db.query('SELECT id FROM notes')).toHaveLength(2)
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('leaves app.pglite in place', async () => {
    await createLegacyDatabase()
    const db = await newDatabaseWithExtensionTables()
    const before = readdirSync(join(userData, 'app.pglite')).sort()

    await importLegacyDatabase(userData, db)

    expect(readdirSync(join(userData, 'app.pglite')).sort()).toEqual(before)
  })
})

describe('importLegacyDatabase — failures', () => {
  it('imports nothing and logs the error when the legacy database cannot be opened', async () => {
    mkdirSync(join(userData, 'app.pglite'))
    writeFileSync(join(userData, 'app.pglite', 'PG_VERSION'), 'not a database')
    const db = await newDatabaseWithExtensionTables()

    await expect(importLegacyDatabase(userData, db)).resolves.toBeUndefined()

    expect(await db.query('SELECT id FROM notes')).toEqual([])
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Legacy PGlite import failed'),
      expect.objectContaining({ error: expect.any(String) })
    )
    expect(readdirSync(join(userData, 'app.pglite'))).toEqual(['PG_VERSION'])
  })
})

describe('importLegacyDatabase — rollback', () => {
  it('rolls back every table when a row cannot be copied', async () => {
    await createLegacyDatabase(
      LEGACY_SCHEMA +
        LEGACY_DATA +
        `ALTER TABLE tasks ALTER COLUMN text DROP NOT NULL;
         INSERT INTO tasks (id, text, created_at, updated_at) VALUES ('no-text', NULL, 't', 't');`
    )
    const db = await newDatabaseWithExtensionTables()

    await importLegacyDatabase(userData, db)

    expect(await db.query('SELECT id FROM notes')).toEqual([])
    expect(await db.query('SELECT id FROM areas')).toEqual([])
    expect(await db.query('SELECT id FROM tasks')).toEqual([])
    expect(mockLogger.error).toHaveBeenCalledTimes(1)
  })

  it('rolls back and logs when the new database already holds a row with the same key', async () => {
    await createLegacyDatabase()
    const db = await newDatabaseWithExtensionTables()
    await db.run(
      `INSERT INTO settings (extension_id, key, value) VALUES ('notepad', 'theme', 'light')`
    )

    await importLegacyDatabase(userData, db)

    expect(await db.query('SELECT id FROM notes')).toEqual([])
    expect(
      (await db.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'theme'`))?.value
    ).toBe('light')
    expect(mockLogger.error).toHaveBeenCalledTimes(1)
  })
})
