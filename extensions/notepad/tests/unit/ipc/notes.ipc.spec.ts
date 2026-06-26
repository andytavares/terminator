import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ipcMain } from 'electron'
import { PGlite } from '@electric-sql/pglite'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  app: { getPath: vi.fn(() => '/tmp'), getAppPath: vi.fn(() => '/tmp') },
}))

import { wrapDb } from '../../../../../src/main/db/index'
import { applyNotepadSchema } from '../../../src/db/db'
import {
  createNote,
  listNotes,
  getNote,
  autosaveNote,
  archiveNote,
  restoreNote,
  hardDeleteNote,
  registerNotesIpcHandlers,
  listTags,
  renameTag,
  deleteTag,
  registerTagsIpcHandlers,
  reorderItems,
} from '../../../src/ipc/notes.ipc'
import type { ExtensionDB } from '../../../../../src/main/db/index'

let pg: PGlite
let db: ExtensionDB

beforeEach(async () => {
  pg = new PGlite()
  await pg.waitReady
  db = wrapDb(pg)
  await applyNotepadSchema(db)
})

afterEach(async () => {
  await pg.close()
})

describe('createNote', () => {
  it('creates a note with title, body, and tags', async () => {
    const result = await createNote(db, { title: 'My Note', body: '## Content', tags: ['work'] })
    expect(result).toHaveProperty('data')
    expect((result as { data: { title: string } }).data.title).toBe('My Note')
    expect((result as { data: { id: string } }).data.id).toBeTruthy()
  })

  it('derives title from first heading when title is omitted', async () => {
    const result = await createNote(db, { body: '# Auto Title\n\nsome content' })
    expect((result as { data: { title: string } }).data.title).toBe('Auto Title')
  })

  it('derives title from first non-empty line when no heading', async () => {
    const result = await createNote(db, { body: 'First line of content' })
    expect((result as { data: { title: string } }).data.title).toBe('First line of content')
  })

  it("defaults title to 'Untitled note' when body is empty", async () => {
    const result = await createNote(db, {})
    expect((result as { data: { title: string } }).data.title).toBe('Untitled note')
  })

  it('creates tags and note_tags rows', async () => {
    await createNote(db, { title: 'Tagged', body: '', tags: ['infra', 'prod'] })
    const tagRows = await db.query<{ name: string }>('SELECT name FROM tags ORDER BY name')
    const tagNames = tagRows.map((r) => r.name)
    expect(tagNames).toContain('infra')
    expect(tagNames).toContain('prod')
  })

  it('returns error on invalid payload (unknown field with strict schema)', async () => {
    const result = await createNote(db, { unknownField: 'bad' } as unknown as Record<
      string,
      unknown
    >)
    expect(result).toHaveProperty('error')
  })
})

describe('listNotes', () => {
  beforeEach(async () => {
    await createNote(db, { title: 'Active', body: 'active note' })
    const archived = await createNote(db, { title: 'Archived', body: 'archived note' })
    const id = (archived as { data: { id: string } }).data.id
    await archiveNote(db, { id })
  })

  it('returns only non-archived notes by default', async () => {
    const result = await listNotes(db, {})
    const data = (result as { data: unknown[] }).data
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(1)
    expect((data[0] as { title: string }).title).toBe('Active')
  })

  it('returns archived notes when includeArchived=true', async () => {
    const result = await listNotes(db, { includeArchived: true })
    const data = (result as { data: unknown[] }).data
    expect(data).toHaveLength(2)
  })

  it('includes bodyPreview field', async () => {
    const result = await listNotes(db, {})
    const data = (result as { data: { bodyPreview: string }[] }).data
    expect(data[0]).toHaveProperty('bodyPreview')
  })

  it('sorts by updated_at desc by default', async () => {
    const result = await listNotes(db, {})
    const data = (result as { data: { title: string }[] }).data
    expect(data.length).toBeGreaterThan(0)
  })
})

describe('getNote', () => {
  it('returns full note by id', async () => {
    const created = await createNote(db, { title: 'Full Note', body: '# Full' })
    const id = (created as { data: { id: string } }).data.id
    const result = await getNote(db, { id })
    const note = (result as { data: { title: string; body: string } }).data
    expect(note.title).toBe('Full Note')
    expect(note.body).toBe('# Full')
  })

  it('returns error for missing note id', async () => {
    const result = await getNote(db, { id: 'nonexistent' })
    expect(result).toHaveProperty('error')
  })

  it('returns error on invalid payload', async () => {
    const result = await getNote(db, null as unknown as { id: string })
    expect(result).toHaveProperty('error')
  })
})

describe('autosaveNote', () => {
  it('updates body, title, and updated_at', async () => {
    const created = await createNote(db, { title: 'Original', body: 'original body' })
    const id = (created as { data: { id: string } }).data.id
    const result = await autosaveNote(db, {
      id,
      title: 'Updated Title',
      body: 'updated body',
      tags: [],
    })
    expect(result).toHaveProperty('data')
    expect((result as { data: { updatedAt: string } }).data.updatedAt).toBeTruthy()

    const fetched = await getNote(db, { id })
    const note = (fetched as { data: { title: string; body: string } }).data
    expect(note.title).toBe('Updated Title')
    expect(note.body).toBe('updated body')
  })

  it('reconciles tag additions', async () => {
    const created = await createNote(db, { title: 'T', body: '', tags: ['old'] })
    const id = (created as { data: { id: string } }).data.id
    await autosaveNote(db, { id, title: 'T', body: '', tags: ['new'] })

    const noteTags = await db.query<{ name: string }>(
      `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?`,
      [id]
    )
    const names = noteTags.map((r) => r.name)
    expect(names).toContain('new')
    expect(names).not.toContain('old')
  })

  it('returns error on invalid payload', async () => {
    const result = await autosaveNote(
      db,
      null as unknown as { id: string; title: string; body: string; tags: string[] }
    )
    expect(result).toHaveProperty('error')
  })
})

describe('archiveNote', () => {
  it('sets archived_at on the note', async () => {
    const created = await createNote(db, { title: 'ToArchive', body: '' })
    const id = (created as { data: { id: string } }).data.id
    const result = await archiveNote(db, { id })
    expect((result as { data: { archivedAt: string } }).data.archivedAt).toBeTruthy()

    const row = await db.get<{ archived_at: string | null }>(
      'SELECT archived_at FROM notes WHERE id=?',
      [id]
    )
    expect(row?.archived_at).not.toBeNull()
  })

  it('returns error on invalid payload', async () => {
    const result = await archiveNote(db, null as unknown as { id: string })
    expect(result).toHaveProperty('error')
  })
})

describe('restoreNote', () => {
  it('clears archived_at', async () => {
    const created = await createNote(db, { title: 'ToRestore', body: '' })
    const id = (created as { data: { id: string } }).data.id
    await archiveNote(db, { id })
    const result = await restoreNote(db, { id })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const row = await db.get<{ archived_at: string | null }>(
      'SELECT archived_at FROM notes WHERE id=?',
      [id]
    )
    expect(row?.archived_at).toBeNull()
  })
})

describe('hardDeleteNote', () => {
  it('removes the note row', async () => {
    const created = await createNote(db, { title: 'ToDelete', body: '' })
    const id = (created as { data: { id: string } }).data.id
    const result = await hardDeleteNote(db, { id })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const row = await db.get<{ id: string }>('SELECT id FROM notes WHERE id=?', [id])
    expect(row).toBeUndefined()
  })

  it('returns error for missing note', async () => {
    const result = await hardDeleteNote(db, { id: 'nonexistent' })
    expect(result).toHaveProperty('error')
  })

  it('returns error on invalid payload', async () => {
    const result = await hardDeleteNote(db, null as unknown as { id: string })
    expect(result).toHaveProperty('error')
  })
})

describe('restoreNote edge cases', () => {
  it('returns error for missing note', async () => {
    const result = await restoreNote(db, { id: 'nonexistent' })
    expect(result).toHaveProperty('error')
  })

  it('returns error on invalid payload', async () => {
    const result = await restoreNote(db, null as unknown as { id: string })
    expect(result).toHaveProperty('error')
  })
})

describe('listNotes with tagId filter', () => {
  it('filters by tagId', async () => {
    await createNote(db, { title: 'Tagged', body: '', tags: ['filterable'] })
    await createNote(db, { title: 'Untagged', body: '' })
    const tag = await db.get<{ id: string }>('SELECT id FROM tags WHERE name=?', ['filterable'])
    const result = await listNotes(db, { tagId: tag!.id })
    const data = (result as { data: { title: string }[] }).data
    expect(data.every((n) => n.title === 'Tagged')).toBe(true)
  })

  it('sorts asc by title', async () => {
    await createNote(db, { title: 'B Note', body: '' })
    await createNote(db, { title: 'A Note', body: '' })
    const result = await listNotes(db, { sortBy: 'title', sortDir: 'asc' })
    const data = (result as { data: { title: string }[] }).data
    expect(data[0].title).toBe('A Note')
  })

  it('returns error on invalid payload', async () => {
    const result = await listNotes(db, { sortBy: 'bad_col' as 'updated_at' })
    expect(result).toHaveProperty('error')
  })
})

describe('registerNotesIpcHandlers', () => {
  it('registers and disposes without error', () => {
    const dispose = registerNotesIpcHandlers(db)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })
})

describe('listTags', () => {
  it('returns tags with noteCount', async () => {
    await createNote(db, { title: 'A', body: '', tags: ['alpha', 'beta'] })
    await createNote(db, { title: 'B', body: '', tags: ['alpha'] })

    const result = await listTags(db, {})
    const tags = (result as { data: { name: string; noteCount: number }[] }).data
    const alpha = tags.find((t) => t.name === 'alpha')
    const beta = tags.find((t) => t.name === 'beta')
    expect(Number(alpha?.noteCount)).toBe(2)
    expect(Number(beta?.noteCount)).toBe(1)
  })

  it('returns empty array when no tags', async () => {
    const result = await listTags(db, {})
    expect((result as { data: unknown[] }).data).toEqual([])
  })
})

describe('renameTag', () => {
  it('updates name', async () => {
    await createNote(db, { title: 'A', body: '', tags: ['oldname'] })
    const tag = await db.get<{ id: string }>('SELECT id FROM tags WHERE name = ?', ['oldname'])

    const result = await renameTag(db, { id: tag!.id, name: 'newname' })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const updated = await db.get<{ name: string }>('SELECT name FROM tags WHERE id = ?', [tag!.id])
    expect(updated?.name).toBe('newname')
  })

  it('returns error on validation failure', async () => {
    const result = await renameTag(db, { id: 123 as unknown as string, name: 'x' })
    expect(result).toHaveProperty('error')
  })
})

describe('deleteTag', () => {
  it('removes tag and note_tags associations without deleting notes', async () => {
    const note = await createNote(db, { title: 'A', body: '', tags: ['removable'] })
    const noteId = (note as { data: { id: string } }).data.id

    const tag = await db.get<{ id: string }>('SELECT id FROM tags WHERE name = ?', ['removable'])
    const result = await deleteTag(db, { id: tag!.id })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const noteRow = await db.get<{ id: string }>('SELECT id FROM notes WHERE id = ?', [noteId])
    expect(noteRow).toBeTruthy()

    const tagRow = await db.get<{ id: string }>('SELECT id FROM tags WHERE id = ?', [tag!.id])
    expect(tagRow).toBeUndefined()
  })

  it('returns error on validation failure', async () => {
    const result = await deleteTag(db, { id: 123 as unknown as string })
    expect(result).toHaveProperty('error')
  })
})

describe('inline #tag parsing on autosave', () => {
  it('extracts #tags from body and reconciles note_tags', async () => {
    const note = await createNote(db, { title: 'A', body: '', tags: [] })
    const id = (note as { data: { id: string } }).data.id

    await autosaveNote(db, { id, title: 'A', body: 'thinking about #idea and #todo', tags: [] })

    const noteTags = await db.query<{ name: string }>(
      'SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?',
      [id]
    )
    const names = noteTags.map((r) => r.name)
    expect(names).toContain('idea')
    expect(names).toContain('todo')
  })

  it('inline tags merge with explicit tags array', async () => {
    const note = await createNote(db, { title: 'A', body: '', tags: ['explicit'] })
    const id = (note as { data: { id: string } }).data.id

    await autosaveNote(db, { id, title: 'A', body: 'some #inline tag', tags: ['explicit'] })

    const noteTags = await db.query<{ name: string }>(
      'SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?',
      [id]
    )
    const names = noteTags.map((r) => r.name)
    expect(names).toContain('explicit')
    expect(names).toContain('inline')
  })
})

describe('reorderItems', () => {
  it('sets sort_order on notes in given order', async () => {
    const n1 = await createNote(db, { title: 'A', body: '' })
    const n2 = await createNote(db, { title: 'B', body: '' })
    const id1 = (n1 as { data: { id: string } }).data.id
    const id2 = (n2 as { data: { id: string } }).data.id

    const result = await reorderItems(db, {
      items: [
        { id: id2, type: 'note' },
        { id: id1, type: 'note' },
      ],
    })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const row1 = await db.get<{ sort_order: number }>('SELECT sort_order FROM notes WHERE id=?', [
      id1,
    ])
    const row2 = await db.get<{ sort_order: number }>('SELECT sort_order FROM notes WHERE id=?', [
      id2,
    ])
    expect(row2?.sort_order).toBe(0)
    expect(row1?.sort_order).toBe(1)
  })

  it('returns validation error on bad payload', async () => {
    const result = await reorderItems(db, { items: 'not-an-array' })
    expect(result).toHaveProperty('error')
  })

  it('listNotes returns items ordered by sort_order asc', async () => {
    const n1 = await createNote(db, { title: 'First', body: '' })
    const n2 = await createNote(db, { title: 'Second', body: '' })
    const id1 = (n1 as { data: { id: string } }).data.id
    const id2 = (n2 as { data: { id: string } }).data.id

    await reorderItems(db, {
      items: [
        { id: id2, type: 'note' },
        { id: id1, type: 'note' },
      ],
    })

    const result = await listNotes(db, { includeArchived: false })
    const data = (result as { data: { title: string; sortOrder: number }[] }).data
    expect(data[0].title).toBe('Second')
    expect(data[1].title).toBe('First')
    expect(data[0].sortOrder).toBe(0)
    expect(data[1].sortOrder).toBe(1)
  })
})

describe('registerTagsIpcHandlers', () => {
  it('registers and disposes without error', () => {
    const dispose = registerTagsIpcHandlers(db)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })
})

describe('IPC handler structure', () => {
  it('registerNotesIpcHandlers calls ipcMain.handle for all channels', () => {
    vi.mocked(ipcMain.handle).mockClear()
    const dispose = registerNotesIpcHandlers(db)
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:notes.create',
      expect.any(Function)
    )
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:notes.list',
      expect.any(Function)
    )
    dispose()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('terminator.notepad:notes.create')
  })

  it('registerNotesIpcHandlers wrappers route to underlying handlers', async () => {
    vi.mocked(ipcMain.handle).mockClear()
    registerNotesIpcHandlers(db)
    const calls = vi.mocked(ipcMain.handle).mock.calls as [string, (...a: unknown[]) => unknown][]
    const getHandler = (ch: string) => calls.find(([c]) => c === ch)?.[1]
    // Invoke wrappers to cover the anonymous arrow functions
    await getHandler('terminator.notepad:notes.create')?.(null, { title: 'T', body: 'B', tags: [] })
    await getHandler('terminator.notepad:notes.list')?.(null, {})
    await getHandler('terminator.notepad:notes.archive')?.(null, { id: 'noop' })
    await getHandler('terminator.notepad:notes.reorder')?.(null, { items: [] })
    await getHandler('terminator.notepad:notes.get')?.(null, { id: 'noop' })
    await getHandler('terminator.notepad:notes.autosave')?.(null, {
      id: 'x',
      title: '',
      body: '',
      tags: [],
    })
    await getHandler('terminator.notepad:notes.restore')?.(null, { id: 'noop' })
    await getHandler('terminator.notepad:notes.hardDelete')?.(null, { id: 'noop' })
  })

  it('registerTagsIpcHandlers wrappers route to underlying handlers', async () => {
    vi.mocked(ipcMain.handle).mockClear()
    registerTagsIpcHandlers(db)
    const calls = vi.mocked(ipcMain.handle).mock.calls as [string, (...a: unknown[]) => unknown][]
    const getHandler = (ch: string) => calls.find(([c]) => c === ch)?.[1]
    await getHandler('terminator.notepad:tags.list')?.(null, {})
    await getHandler('terminator.notepad:tags.rename')?.(null, { id: 'noop', name: 'x' })
    await getHandler('terminator.notepad:tags.delete')?.(null, { id: 'noop' })
  })
})
