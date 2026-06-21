import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ipcMain } from 'electron'
import { PGlite } from '@electric-sql/pglite'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

import { wrapDb } from '../../../../../src/main/db/index'
import { applyNotepadSchema } from '../../../src/db/db'
import { searchNotes, registerSearchIpcHandlers } from '../../../src/ipc/search.ipc'
import type { ExtensionDB } from '../../../../../src/main/db/index'

let pg: PGlite
let db: ExtensionDB

async function insertNote(
  id: string,
  title: string,
  body: string,
  tagNames: string[] = [],
  archived = false
) {
  const now = new Date().toISOString()
  const archivedAt = archived ? now : null
  await db.run(
    'INSERT INTO notes (id, title, body, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, title, body, now, now, archivedAt]
  )

  for (const name of tagNames) {
    const existing = await db.get<{ id: string }>('SELECT id FROM tags WHERE name = ?', [name])
    let tagId = existing?.id
    if (!tagId) {
      tagId = `tag-${name}`
      await db.run('INSERT INTO tags (id, name) VALUES (?, ?)', [tagId, name])
    }
    await db.run('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [
      id,
      tagId,
    ])
  }
}

beforeEach(async () => {
  pg = new PGlite()
  await pg.waitReady
  db = wrapDb(pg)
  await applyNotepadSchema(db)
})

afterEach(async () => {
  await pg.close()
})

describe('registerSearchIpcHandlers', () => {
  it('returns a dispose function', () => {
    const dispose = registerSearchIpcHandlers(db)
    expect(typeof dispose).toBe('function')
    dispose()
  })
})

describe('searchNotes — basic text query (ILIKE)', () => {
  it('returns matching notes with a snippet', async () => {
    await insertNote('n1', 'Project Alpha', 'authentication with OAuth2 tokens')
    await insertNote('n2', 'Meeting Notes', 'discussed quarterly targets')

    const result = await searchNotes(db, { query: 'authentication' })
    const data = (result as { data: { id: string; snippet: string }[] }).data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe('n1')
    expect(typeof data[0].snippet).toBe('string')
  })

  it('returns multiple results for a shared keyword', async () => {
    await insertNote('n1', 'First note', 'rust memory management')
    await insertNote('n2', 'Second note', 'rust language basics')

    const result = await searchNotes(db, { query: 'rust' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.length).toBeGreaterThanOrEqual(2)
  })

  it('returns empty array when no match', async () => {
    await insertNote('n1', 'Hello', 'world')
    const result = await searchNotes(db, { query: 'xyzzy99nonexistent' })
    const data = (result as { data: unknown[] }).data
    expect(data).toHaveLength(0)
  })

  it('matches partial words (substring search)', async () => {
    await insertNote('n1', 'Auth guide', 'authentication and authorization')
    await insertNote('n2', 'Unrelated', 'completely different content')

    const result = await searchNotes(db, { query: 'auth' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.some((r) => r.id === 'n1')).toBe(true)
    expect(data.some((r) => r.id === 'n2')).toBe(false)
  })

  it('search is case-insensitive', async () => {
    await insertNote('n1', 'Hello World', 'Some content here')
    const result = await searchNotes(db, { query: 'HELLO' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.some((r) => r.id === 'n1')).toBe(true)
  })
})

describe('searchNotes — tag: filter', () => {
  it('tag:foo returns only notes tagged with foo', async () => {
    await insertNote('n1', 'Infra note', 'server setup', ['infra'])
    await insertNote('n2', 'Dev note', 'code review process', ['dev'])

    const result = await searchNotes(db, { query: 'tag:infra' })
    const data = (result as { data: { id: string }[] }).data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe('n1')
  })

  it('-tag:bar excludes notes tagged with bar', async () => {
    await insertNote('n1', 'Keep this', 'important content', ['keep'])
    await insertNote('n2', 'Exclude this', 'content to hide', ['skip'])

    const result = await searchNotes(db, { query: '-tag:skip' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.every((r) => r.id !== 'n2')).toBe(true)
  })

  it('tag: filter combines with text query', async () => {
    await insertNote('n1', 'Tagged and matching', 'microservices architecture', ['backend'])
    await insertNote('n2', 'Tagged but not matching', 'cooking recipes', ['backend'])
    await insertNote('n3', 'Matching but not tagged', 'microservices overview', ['frontend'])

    const result = await searchNotes(db, { query: 'microservices tag:backend' })
    const data = (result as { data: { id: string }[] }).data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe('n1')
  })
})

describe('searchNotes — archived filter', () => {
  it('excludes archived notes by default', async () => {
    await insertNote('n1', 'Active note', 'visible content')
    await insertNote('n2', 'Archived note', 'hidden content', [], true)

    const result = await searchNotes(db, { query: 'content' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.every((r) => r.id !== 'n2')).toBe(true)
  })

  it('includes archived notes when includeArchived=true', async () => {
    await insertNote('n1', 'Active note', 'visible content')
    await insertNote('n2', 'Archived note', 'hidden content', [], true)

    const result = await searchNotes(db, { query: 'content', includeArchived: true })
    const data = (result as { data: { id: string }[] }).data
    expect(data.some((r) => r.id === 'n2')).toBe(true)
  })
})

describe('searchNotes — empty query returns all', () => {
  it('returns all non-archived notes when query is empty', async () => {
    await insertNote('n1', 'Note 1', 'content 1')
    await insertNote('n2', 'Note 2', 'content 2')

    const result = await searchNotes(db, { query: '' })
    const data = (result as { data: unknown[] }).data
    expect(data).toHaveLength(2)
  })
})

describe('searchNotes — validation', () => {
  it('returns error on invalid payload', async () => {
    const result = await searchNotes(db, { query: 123 as unknown as string })
    expect(result).toHaveProperty('error')
  })
})

describe('IPC handler registration', () => {
  it('registerSearchIpcHandlers registers and disposes the channel', () => {
    vi.mocked(ipcMain.handle).mockClear()
    const dispose = registerSearchIpcHandlers(db)
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:search.query',
      expect.any(Function)
    )
    dispose()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('terminator.notepad:search.query')
  })
})
