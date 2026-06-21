import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

vi.mock('../../../src/main/logger', () => ({
  makeLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { runLegacyMigration } from '../../../src/main/db/migrate'
import type { ExtensionDB } from '../../../src/main/db/index'

function makeMockDb(): ExtensionDB {
  return {
    exec: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(undefined),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: ExtensionDB) => Promise<unknown>) => fn(makeMockDb())),
  }
}

async function makeRealSqliteFile(dir: string, filename: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require('sql.js') as (opts?: unknown) => Promise<import('sql.js').SqlJsStatic>
  const SQL = await initSqlJs()
  const sqlite = new SQL.Database()
  sqlite.run(
    `CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  )
  sqlite.run(`INSERT INTO notes VALUES ('n1', 'Hello', 'body text', '2024-01-01', '2024-01-01')`)
  const buf = sqlite.export()
  sqlite.close()
  const dbPath = path.join(dir, filename)
  fs.writeFileSync(dbPath, buf)
  return dbPath
}

describe('runLegacyMigration', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('is a no-op when no legacy db files exist', async () => {
    const db = makeMockDb()
    await runLegacyMigration(tmpDir, db)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('skips migration gracefully when sql.js cannot parse the file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'vault.db'), 'not a real sqlite file')
    const db = makeMockDb()
    await expect(runLegacyMigration(tmpDir, db)).resolves.not.toThrow()
  })

  it('migrates rows from a real SQLite file into PGlite and renames the file', async () => {
    const dbPath = await makeRealSqliteFile(tmpDir, 'notepad.db')
    const db = makeMockDb()

    await runLegacyMigration(tmpDir, db)

    // db.run should have been called to insert the note row
    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO notes'),
      expect.arrayContaining(['n1', 'Hello'])
    )
    // Original file should be renamed to .bak
    expect(fs.existsSync(dbPath)).toBe(false)
    expect(fs.existsSync(dbPath + '.bak')).toBe(true)
  })

  it('skips tables that do not exist in the legacy db', async () => {
    // notepad.db only has a notes table — diagram_comments etc are absent
    const dbPath = await makeRealSqliteFile(tmpDir, 'notepad.db')
    const db = makeMockDb()
    await runLegacyMigration(tmpDir, db)
    // Should complete without throwing even though most NOTEPAD_TABLES are missing
    expect(fs.existsSync(dbPath + '.bak')).toBe(true)
  })

  it('skips rows that fail to insert and continues', async () => {
    const dbPath = await makeRealSqliteFile(tmpDir, 'notepad.db')
    // Make db.run fail on every call
    const db = makeMockDb()
    ;(db.run as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('constraint violation'))

    await expect(runLegacyMigration(tmpDir, db)).resolves.not.toThrow()
    // File should still be renamed (migration ran, inserts just failed)
    expect(fs.existsSync(dbPath + '.bak')).toBe(true)
  })

  it('handles the outer error branch when the SQLite file is corrupt', async () => {
    // Write a file that exists but is invalid SQLite — sql.js will throw when
    // trying to open it, hitting the outer catch at line 94-97 of migrate.ts
    const dbPath = path.join(tmpDir, 'vault.db')
    // Valid SQLite files start with "SQLite format 3\0". This is just garbage.
    fs.writeFileSync(dbPath, Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x03]))
    const db = makeMockDb()
    await expect(runLegacyMigration(tmpDir, db)).resolves.not.toThrow()
  })
})
