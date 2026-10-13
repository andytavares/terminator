import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ipcMain } from 'electron'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'
import { partialFake } from '../../../../../tests/support/fakes'

// Adapter: registerHandler forwards to the electron ipcMain mocks so existing
// capture/assert code (ipcMain.handle calls, removeHandler assertions) still works.
const mockApi = partialFake<ExtensionAPI>({
  ipc: partialFake<ExtensionAPI['ipc']>({
    registerHandler: (spec: ChannelSpec) => {
      vi.mocked(ipcMain.handle)(spec.channel, (_e, payload: unknown) =>
        dispatchChannel(spec, payload)
      )
      return { dispose: () => vi.mocked(ipcMain.removeHandler)(spec.channel) }
    },
  }),
})
import { DatabaseSync } from 'node:sqlite'

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
  NOTES_CHANGED_CHANNEL,
} from '../../../src/ipc/notes.ipc'
import type { ExtensionDB } from '@terminator/extension-sdk'

let db: ExtensionDB

beforeEach(async () => {
  db = wrapDb(new DatabaseSync(':memory:'))
  await applyNotepadSchema(db)
})

describe('createNote', createNoteTests)
describe('listNotes', listNotesTests)

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
})

describe('autosaveNote', autosaveNoteTests)

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
})

describe('restoreNote edge cases', () => {
  it('returns error for missing note', async () => {
    const result = await restoreNote(db, { id: 'nonexistent' })
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
})

describe('registerNotesIpcHandlers', () => {
  it('registers and disposes without error', () => {
    const dispose = registerNotesIpcHandlers(mockApi, db)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })
})

describe('listTags', () => {
  it('returns tags with noteCount', async () => {
    await createNote(db, { title: 'A', body: '', tags: ['alpha', 'beta'] })
    await createNote(db, { title: 'B', body: '', tags: ['alpha'] })

    const result = await listTags(db)
    const tags = (result as { data: { name: string; noteCount: number }[] }).data
    const alpha = tags.find((t) => t.name === 'alpha')
    const beta = tags.find((t) => t.name === 'beta')
    expect(Number(alpha?.noteCount)).toBe(2)
    expect(Number(beta?.noteCount)).toBe(1)
  })

  it('returns empty array when no tags', async () => {
    const result = await listTags(db)
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
})

describe('inline #tag parsing on autosave', inlineTagParsingAutosaveTests)
describe('reorderItems', reorderItemsTests)

describe('registerTagsIpcHandlers', () => {
  it('registers and disposes without error', () => {
    const dispose = registerTagsIpcHandlers(mockApi, db)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })
})

describe('IPC handler structure', iPCHandlerStructureTests)

function autosaveNoteTests() {
  describe('saving', autosaveNoteSavingTests)
  describe('tags', autosaveNoteTagsTests)
  describe('broadcasting', autosaveNoteBroadcastingTests)
  describe('broadcast content', autosaveNoteBroadcastContentTests)
  describe('missing notes and callbacks', autosaveNoteMissingNotesCallbacksTests)
  describe('titles set by hand', autosaveNoteTitleSetByHandTests)
  describe('derived titles', autosaveNoteDerivedTitleTests)
}

function autosaveNoteSavingTests() {
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
}

function autosaveNoteTagsTests() {
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
}

function autosaveNoteBroadcastingTests() {
  // The docked panel and a popped-out note window are separate renderers with
  // separate body caches; without this push they serve divergent content.
  it('broadcasts the saved body so other surfaces can adopt it', async () => {
    const created = await createNote(db, { title: 'T', body: 'before' })
    const id = (created as { data: { id: string } }).data.id
    const broadcast = vi.fn()

    await autosaveNote(
      db,
      { id, title: 'After', body: 'after', tags: ['a'], originId: 'window-1' },
      broadcast
    )

    expect(broadcast).toHaveBeenCalledWith(
      NOTES_CHANGED_CHANNEL,
      expect.objectContaining({
        id,
        title: 'After',
        body: 'after',
        originId: 'window-1',
      })
    )
  })
}

function autosaveNoteBroadcastContentTests() {
  it('includes inline body tags in the broadcast payload', async () => {
    const created = await createNote(db, { title: 'T', body: '' })
    const id = (created as { data: { id: string } }).data.id
    const broadcast = vi.fn()

    await autosaveNote(db, { id, title: 'T', body: 'see #alpha', tags: ['beta'] }, broadcast)

    const payload = broadcast.mock.calls[0][1] as { tags: string[]; originId: string | null }
    expect(payload.tags).toEqual(expect.arrayContaining(['alpha', 'beta']))
    expect(payload.originId).toBeNull()
  })
}

function autosaveNoteMissingNotesCallbacksTests() {
  it('does not broadcast when the note does not exist', async () => {
    const broadcast = vi.fn()
    const result = await autosaveNote(
      db,
      { id: 'missing', title: 'T', body: 'b', tags: [] },
      broadcast
    )
    expect(result).toHaveProperty('error', 'NOTE_NOT_FOUND')
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('saves without a broadcast callback', async () => {
    const created = await createNote(db, { title: 'T', body: 'x' })
    const id = (created as { data: { id: string } }).data.id
    const result = await autosaveNote(db, { id, title: 'T', body: 'y', tags: [] })
    expect(result).toHaveProperty('data')
  })
}

function reorderItemsTests() {
  describe('writing the order', reorderItemsWritingOrderTests)
  describe('reading the order', reorderItemsReadingOrderTests)
}

function reorderItemsWritingOrderTests() {
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
}

function reorderItemsReadingOrderTests() {
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
}

function iPCHandlerStructureTests() {
  describe('notes channels', iPCHandlerStructureNotesChannelsTests)
  describe('notes wrappers', iPCHandlerStructureNotesWrappersTests)
  describe('tags wrappers', iPCHandlerStructureTagsWrappersTests)
}

function iPCHandlerStructureNotesChannelsTests() {
  it('registerNotesIpcHandlers calls ipcMain.handle for all channels', () => {
    vi.mocked(ipcMain.handle).mockClear()
    const dispose = registerNotesIpcHandlers(mockApi, db)
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
}

function iPCHandlerStructureNotesWrappersTests() {
  it('registerNotesIpcHandlers wrappers route to underlying handlers', async () => {
    vi.mocked(ipcMain.handle).mockClear()
    registerNotesIpcHandlers(mockApi, db)
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
}

function iPCHandlerStructureTagsWrappersTests() {
  it('registerTagsIpcHandlers wrappers route to underlying handlers', async () => {
    vi.mocked(ipcMain.handle).mockClear()
    registerTagsIpcHandlers(mockApi, db)
    const calls = vi.mocked(ipcMain.handle).mock.calls as [string, (...a: unknown[]) => unknown][]
    const getHandler = (ch: string) => calls.find(([c]) => c === ch)?.[1]
    await getHandler('terminator.notepad:tags.list')?.(null, {})
    await getHandler('terminator.notepad:tags.rename')?.(null, { id: 'noop', name: 'x' })
    await getHandler('terminator.notepad:tags.delete')?.(null, { id: 'noop' })
  })
}

function createNoteTests() {
  describe('creating', createNoteCreatingTests)
  describe('titles', createNoteTitlesTests)
  describe('tags', createNoteTagsTests)
}

function createNoteCreatingTests() {
  it('creates a note with title, body, and tags', async () => {
    const result = await createNote(db, { title: 'My Note', body: '## Content', tags: ['work'] })
    expect(result).toHaveProperty('data')
    expect((result as { data: { title: string } }).data.title).toBe('My Note')
    expect((result as { data: { id: string } }).data.id).toBeTruthy()
  })
}

function createNoteTitlesTests() {
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
}

function createNoteTagsTests() {
  it('creates tags and note_tags rows', async () => {
    await createNote(db, { title: 'Tagged', body: '', tags: ['infra', 'prod'] })
    const tagRows = await db.query<{ name: string }>('SELECT name FROM tags ORDER BY name')
    const tagNames = tagRows.map((r) => r.name)
    expect(tagNames).toContain('infra')
    expect(tagNames).toContain('prod')
  })
}

function listNotesTests() {
  beforeEach(async () => {
    await createNote(db, { title: 'Active', body: 'active note' })
    const archived = await createNote(db, { title: 'Archived', body: 'archived note' })
    const id = (archived as { data: { id: string } }).data.id
    await archiveNote(db, { id })
  })

  describe('archived notes', listNotesArchivedNotesTests)
  describe('fields and order', listNotesFieldsOrderTests)
}

function listNotesArchivedNotesTests() {
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
}

function listNotesFieldsOrderTests() {
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
}

function inlineTagParsingAutosaveTests() {
  describe('extracting', inlineTagParsingAutosaveExtractingTests)
  describe('merging', inlineTagParsingAutosaveMergingTests)
}

function inlineTagParsingAutosaveExtractingTests() {
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
}

function inlineTagParsingAutosaveMergingTests() {
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
}

function autosaveNoteTitleSetByHandTests() {
  it('keeps a title set by hand when later saves derive another', async () => {
    const created = await createNote(db, { title: 'Groceries', body: 'milk' })
    const id = (created as { data: { id: string } }).data.id
    await autosaveNote(db, {
      id,
      title: 'Weekly shop',
      body: 'milk',
      tags: [],
      titleSetByHand: true,
    })
    const broadcast = vi.fn()

    const result = await autosaveNote(
      db,
      { id, title: 'milk and eggs', body: 'milk and eggs', tags: [] },
      broadcast
    )

    expect(result).toMatchObject({ data: { title: 'Weekly shop' } })
    const note = ((await getNote(db, { id })) as { data: { title: string; body: string } }).data
    expect(note).toMatchObject({ title: 'Weekly shop', body: 'milk and eggs' })
    expect(broadcast.mock.calls[0][1]).toMatchObject({ title: 'Weekly shop' })
  })
}

function autosaveNoteDerivedTitleTests() {
  it('keeps deriving the title of a note whose title was never set by hand', async () => {
    const created = await createNote(db, { title: 'Groceries', body: 'milk' })
    const id = (created as { data: { id: string } }).data.id

    const result = await autosaveNote(db, {
      id,
      title: 'milk and eggs',
      body: 'milk and eggs',
      tags: [],
    })

    expect(result).toMatchObject({ data: { title: 'milk and eggs' } })
  })
}
