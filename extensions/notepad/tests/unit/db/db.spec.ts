import { describe, it, expect, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  initDb,
  getDb,
  closeDb,
  insertFts,
  deleteFts,
  reinitDb,
  repairDb,
  resetDb,
} from '../../../src/db/db'

describe('initDb', () => {
  let tmpDir: string

  afterEach(() => {
    closeDb()
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the notepad.db file in userData', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    initDb(tmpDir)
    expect(fs.existsSync(path.join(tmpDir, 'notepad.db'))).toBe(true)
  })

  it('enables WAL mode', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    const db = initDb(tmpDir)
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(row.journal_mode).toBe('wal')
  })

  it('enables foreign keys', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    const db = initDb(tmpDir)
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
    expect(row.foreign_keys).toBe(1)
  })

  it('creates all required tables', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    const db = initDb(tmpDir)
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name)
    expect(tables).toContain('notes')
    expect(tables).toContain('tags')
    expect(tables).toContain('note_tags')
    expect(tables).toContain('comments')
    expect(tables).toContain('settings')
  })

  it('creates the FTS5 virtual table', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    const db = initDb(tmpDir)
    const vtables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name)
    expect(vtables).toContain('notes_fts')
  })

  it('is idempotent — safe to call initDb twice', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    initDb(tmpDir)
    closeDb()
    expect(() => initDb(tmpDir)).not.toThrow()
  })

  it('getDb throws if initDb not called', () => {
    expect(() => getDb()).toThrow('NotepadDB not initialized')
  })

  it('getDb returns the db after initDb', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    initDb(tmpDir)
    expect(() => getDb()).not.toThrow()
  })

  it('initDb failure closes db and surfaces real error in subsequent getDb call', () => {
    // /dev/null is a file, not a dir — mkdirSync will throw ENOTDIR
    expect(() => initDb('/dev/null/notepad-test')).toThrow()
    expect(() => getDb()).toThrow('NotepadDB not initialized')
  })
})

describe('reinitDb', () => {
  let tmpDir: string

  afterEach(() => {
    closeDb()
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('closes the existing connection and reopens', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    initDb(tmpDir)
    const db = reinitDb(tmpDir)
    expect(db).toBeTruthy()
    expect(() => getDb()).not.toThrow()
  })
})

describe('repairDb', () => {
  let tmpDir: string

  afterEach(() => {
    closeDb()
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('runs integrity_check and returns result when db is open', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    initDb(tmpDir)
    const result = repairDb(tmpDir)
    expect(result.integrity).toBe('ok')
    expect(() => getDb()).not.toThrow()
  })

  it('initializes db when none is open and returns ok', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    const result = repairDb(tmpDir)
    expect(result.integrity).toBe('ok')
    expect(() => getDb()).not.toThrow()
  })

  it('swallows VACUUM errors and still reopens db', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    initDb(tmpDir)
    const db = getDb()
    vi.spyOn(db, 'exec').mockImplementationOnce(() => {
      throw new Error('VACUUM error')
    })
    const result = repairDb(tmpDir)
    expect(result.integrity).toBe('ok')
    expect(() => getDb()).not.toThrow()
  })
})

describe('resetDb', () => {
  let tmpDir: string

  afterEach(() => {
    closeDb()
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('deletes the db file and reinitializes', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    initDb(tmpDir)
    const dbPath = path.join(tmpDir, 'notepad.db')
    expect(fs.existsSync(dbPath)).toBe(true)
    resetDb(tmpDir)
    expect(() => getDb()).not.toThrow()
  })

  it('works when no db file exists yet', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    const db = resetDb(tmpDir)
    expect(db).toBeTruthy()
  })
})

describe('insertFts / deleteFts', () => {
  let tmpDir: string

  afterEach(() => {
    closeDb()
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('insertFts and deleteFts operate without error', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-test-'))
    const db = initDb(tmpDir)

    // Insert a note first to have a valid rowid
    db.prepare(
      `INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?,?,?,?,?)`
    ).run('n1', 'Test', '# Hello', new Date().toISOString(), new Date().toISOString())

    const row = db.prepare('SELECT rowid FROM notes WHERE id=?').get('n1') as { rowid: number }
    expect(() => insertFts(db, row.rowid, 'Test', '# Hello', '')).not.toThrow()
    expect(() => deleteFts(db, row.rowid)).not.toThrow()
  })
})
