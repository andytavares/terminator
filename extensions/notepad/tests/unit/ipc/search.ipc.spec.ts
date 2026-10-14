import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

import { apiOverIpcMain } from '../support/ipc-main-api'

const mockApi = apiOverIpcMain()
import { DatabaseSync } from 'node:sqlite'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

import { wrapDb } from '../../../../../src/main/db/index'
import { applyNotepadSchema } from '../../../src/db/db'
import { searchNotes, registerSearchIpcHandlers } from '../../../src/ipc/search.ipc'
import type { ExtensionDB } from '@terminator/extension-sdk'

let db: ExtensionDB

interface SeedOptions {
  tags?: string[]
  archived?: boolean
}

/** Inserts a note with the given [title, body], plus any tags, straight into the database. */
async function insertNote(id: string, text: [string, string], options: SeedOptions = {}) {
  const [title, body] = text
  const { tags: tagNames = [], archived = false } = options
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
  db = wrapDb(new DatabaseSync(':memory:'))
  await applyNotepadSchema(db)
})

describe('registerSearchIpcHandlers', () => {
  it('returns a dispose function', () => {
    const dispose = registerSearchIpcHandlers(mockApi, db)
    expect(typeof dispose).toBe('function')
    dispose()
  })
})

describe('searchNotes — basic text query (LIKE)', searchNotesBasicTextQueryLIKETests)
describe('searchNotes — tag: filter', searchNotesTagFilterTests)

describe('searchNotes — archived filter', () => {
  it('excludes archived notes by default', async () => {
    await insertNote('n1', ['Active note', 'visible content'])
    await insertNote('n2', ['Archived note', 'hidden content'], { archived: true })

    const result = await searchNotes(db, { query: 'content' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.every((r) => r.id !== 'n2')).toBe(true)
  })

  it('includes archived notes when includeArchived=true', async () => {
    await insertNote('n1', ['Active note', 'visible content'])
    await insertNote('n2', ['Archived note', 'hidden content'], { archived: true })

    const result = await searchNotes(db, { query: 'content', includeArchived: true })
    const data = (result as { data: { id: string }[] }).data
    expect(data.some((r) => r.id === 'n2')).toBe(true)
  })
})

describe('searchNotes — empty query returns all', () => {
  it('returns all non-archived notes when query is empty', async () => {
    await insertNote('n1', ['Note 1', 'content 1'])
    await insertNote('n2', ['Note 2', 'content 2'])

    const result = await searchNotes(db, { query: '' })
    const data = (result as { data: unknown[] }).data
    expect(data).toHaveLength(2)
  })
})

describe('IPC handler registration', () => {
  it('registerSearchIpcHandlers registers and disposes the channel', () => {
    vi.mocked(ipcMain.handle).mockClear()
    const dispose = registerSearchIpcHandlers(mockApi, db)
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:search.query',
      expect.any(Function)
    )
    dispose()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('terminator.notepad:search.query')
  })
})

function searchNotesBasicTextQueryLIKETests() {
  describe('matching', searchNotesBasicTextQueryLIKEMatchingTests)
  describe('no match and partial words', searchNotesBasicTextQueryLIKENoMatchPartialTests)
  describe('case and wildcards', searchNotesBasicTextQueryCaseWildcardTests)
}

function searchNotesBasicTextQueryLIKEMatchingTests() {
  it('returns matching notes with a snippet', async () => {
    await insertNote('n1', ['Project Alpha', 'authentication with OAuth2 tokens'])
    await insertNote('n2', ['Meeting Notes', 'discussed quarterly targets'])

    const result = await searchNotes(db, { query: 'authentication' })
    const data = (result as { data: { id: string; snippet: string }[] }).data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe('n1')
    expect(typeof data[0].snippet).toBe('string')
  })

  it('returns multiple results for a shared keyword', async () => {
    await insertNote('n1', ['First note', 'rust memory management'])
    await insertNote('n2', ['Second note', 'rust language basics'])

    const result = await searchNotes(db, { query: 'rust' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.length).toBeGreaterThanOrEqual(2)
  })
}

function searchNotesBasicTextQueryLIKENoMatchPartialTests() {
  it('returns empty array when no match', async () => {
    await insertNote('n1', ['Hello', 'world'])
    const result = await searchNotes(db, { query: 'xyzzy99nonexistent' })
    const data = (result as { data: unknown[] }).data
    expect(data).toHaveLength(0)
  })

  it('matches partial words (substring search)', async () => {
    await insertNote('n1', ['Auth guide', 'authentication and authorization'])
    await insertNote('n2', ['Unrelated', 'completely different content'])

    const result = await searchNotes(db, { query: 'auth' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.some((r) => r.id === 'n1')).toBe(true)
    expect(data.some((r) => r.id === 'n2')).toBe(false)
  })

  it('search is case-insensitive', async () => {
    await insertNote('n1', ['Hello World', 'Some content here'])
    const result = await searchNotes(db, { query: 'HELLO' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.some((r) => r.id === 'n1')).toBe(true)
  })
}

function searchNotesTagFilterTests() {
  describe('including and excluding', searchNotesTagFilterIncludingExcludingTests)
  describe('combined with text', searchNotesTagFilterCombinedTextTests)
}

function searchNotesTagFilterIncludingExcludingTests() {
  it('tag:foo returns only notes tagged with foo', async () => {
    await insertNote('n1', ['Infra note', 'server setup'], { tags: ['infra'] })
    await insertNote('n2', ['Dev note', 'code review process'], { tags: ['dev'] })

    const result = await searchNotes(db, { query: 'tag:infra' })
    const data = (result as { data: { id: string }[] }).data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe('n1')
  })

  it('-tag:bar excludes notes tagged with bar', async () => {
    await insertNote('n1', ['Keep this', 'important content'], { tags: ['keep'] })
    await insertNote('n2', ['Exclude this', 'content to hide'], { tags: ['skip'] })

    const result = await searchNotes(db, { query: '-tag:skip' })
    const data = (result as { data: { id: string }[] }).data
    expect(data.every((r) => r.id !== 'n2')).toBe(true)
  })
}

function searchNotesTagFilterCombinedTextTests() {
  it('tag: filter combines with text query', async () => {
    await insertNote('n1', ['Tagged and matching', 'microservices architecture'], {
      tags: ['backend'],
    })
    await insertNote('n2', ['Tagged but not matching', 'cooking recipes'], { tags: ['backend'] })
    await insertNote('n3', ['Matching but not tagged', 'microservices overview'], {
      tags: ['frontend'],
    })

    const result = await searchNotes(db, { query: 'microservices tag:backend' })
    const data = (result as { data: { id: string }[] }).data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe('n1')
  })
}

function searchNotesBasicTextQueryCaseWildcardTests() {
  it('folds the case of non-ASCII letters too', async () => {
    await insertNote('n1', ['Über den Wolken', 'Die Freiheit wäre grenzenlos'])
    await insertNote('n2', ['Café', 'CRÈME BRÛLÉE'])

    const idsMatching = async (query: string) =>
      ((await searchNotes(db, { query })) as { data: { id: string }[] }).data.map((r) => r.id)
    expect(await idsMatching('über')).toEqual(['n1'])
    expect(await idsMatching('WÄRE')).toEqual(['n1'])
    expect(await idsMatching('crème brûlée')).toEqual(['n2'])
  })

  it('matches % and _ as the characters typed', async () => {
    await insertNote('n1', ['Discount', 'save 10% today'])
    await insertNote('n2', ['Other', 'save 100 today'])

    const result = await searchNotes(db, { query: '10%' })
    expect((result as { data: { id: string }[] }).data.map((r) => r.id)).toEqual(['n1'])
  })
}
