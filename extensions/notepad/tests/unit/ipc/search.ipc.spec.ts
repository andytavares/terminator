import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

import { initDb, closeDb, getDb, insertFts } from '../../../src/db/db'
import { searchNotes, registerSearchIpcHandlers } from '../../../src/ipc/search.ipc'

let tmpDir: string

// Helper: insert a note + its FTS row
function insertNote(
  id: string,
  title: string,
  body: string,
  tagNames: string[] = [],
  archived = false
) {
  const db = getDb()
  const now = new Date().toISOString()
  const archivedAt = archived ? now : null
  db.prepare(
    'INSERT INTO notes (id, title, body, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, title, body, now, now, archivedAt)

  // Insert tags
  for (const name of tagNames) {
    const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as
      | { id: string }
      | undefined
    let tagId = existing?.id
    if (!tagId) {
      tagId = `tag-${name}`
      db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(tagId, name)
    }
    db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(id, tagId)
  }

  // Get rowid for FTS
  const row = db.prepare('SELECT rowid FROM notes WHERE id = ?').get(id) as { rowid: number }
  insertFts(db, row.rowid, title, body, tagNames.join(' '))
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-search-ipc-test-'))
  initDb(tmpDir)
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('registerSearchIpcHandlers', () => {
  it('returns a dispose function', () => {
    const dispose = registerSearchIpcHandlers()
    expect(typeof dispose).toBe('function')
    dispose()
  })
})

describe('searchNotes — basic FTS5 query', () => {
  it('returns matching notes with a snippet', async () => {
    insertNote('n1', 'Project Alpha', 'authentication with OAuth2 tokens')
    insertNote('n2', 'Meeting Notes', 'discussed quarterly targets')

    const result = await searchNotes({ query: 'authentication' })
    const data = (result as { data: { id: string; snippet: string }[] }).data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe('n1')
    expect(typeof data[0].snippet).toBe('string')
  })

  it('returns multiple results ranked by BM25', async () => {
    insertNote('n1', 'First note', 'rust rust rust memory management')
    insertNote('n2', 'Second note', 'rust language basics')

    const result = await searchNotes({ query: 'rust' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.length).toBeGreaterThanOrEqual(2)
    // n1 should rank higher (more occurrences)
    expect(data[0].id).toBe('n1')
  })

  it('handles prefix queries with * wildcard', async () => {
    insertNote('n1', 'Auth guide', 'authentication and authorization')
    insertNote('n2', 'Unrelated', 'completely different content')

    const result = await searchNotes({ query: 'auth*' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.some((r) => r.id === 'n1')).toBe(true)
    expect(data.some((r) => r.id === 'n2')).toBe(false)
  })

  it('returns empty array when no match', async () => {
    insertNote('n1', 'Hello', 'world')
    const result = await searchNotes({ query: 'xyzzy99nonexistent' })
    const data = (result as { data: unknown[] }).data
    expect(data).toHaveLength(0)
  })
})

describe('searchNotes — tag: filter', () => {
  it('tag:foo returns only notes tagged with foo', async () => {
    insertNote('n1', 'Infra note', 'server setup', ['infra'])
    insertNote('n2', 'Dev note', 'code review process', ['dev'])

    const result = await searchNotes({ query: 'tag:infra' })
    const data = (result as { data: { id: string }[] }).data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe('n1')
  })

  it('-tag:bar excludes notes tagged with bar', async () => {
    insertNote('n1', 'Keep this', 'important content', ['keep'])
    insertNote('n2', 'Exclude this', 'content to hide', ['skip'])

    const result = await searchNotes({ query: '-tag:skip' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.every((r) => r.id !== 'n2')).toBe(true)
  })

  it('tag: filter combines with FTS query', async () => {
    insertNote('n1', 'Tagged and matching', 'microservices architecture', ['backend'])
    insertNote('n2', 'Tagged but not matching', 'cooking recipes', ['backend'])
    insertNote('n3', 'Matching but not tagged', 'microservices overview', ['frontend'])

    const result = await searchNotes({ query: 'microservices tag:backend' })
    const data = (result as { data: { id: string }[] }).data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe('n1')
  })
})

describe('searchNotes — archived filter', () => {
  it('excludes archived notes by default', async () => {
    insertNote('n1', 'Active note', 'visible content')
    insertNote('n2', 'Archived note', 'hidden content', [], true)

    const result = await searchNotes({ query: 'content' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.every((r) => r.id !== 'n2')).toBe(true)
  })

  it('includes archived notes when includeArchived=true', async () => {
    insertNote('n1', 'Active note', 'visible content')
    insertNote('n2', 'Archived note', 'hidden content', [], true)

    const result = await searchNotes({ query: 'content', includeArchived: true })
    const data = (result as { data: { id: string }[] }).data
    expect(data.some((r) => r.id === 'n2')).toBe(true)
  })
})

describe('searchNotes — malformed query', () => {
  it('falls back to plain-text on FTS5 syntax error (no crash)', async () => {
    insertNote('n1', 'Hello world', 'test content')
    // Unclosed quote is a common FTS5 error
    const result = await searchNotes({ query: '"unclosed quote' })
    // Should return data (possibly empty), not throw
    expect(result).toHaveProperty('data')
  })
})

describe('searchNotes — validation', () => {
  it('returns error on invalid payload', async () => {
    const result = await searchNotes({ query: 123 as unknown as string })
    expect(result).toHaveProperty('error')
  })
})
