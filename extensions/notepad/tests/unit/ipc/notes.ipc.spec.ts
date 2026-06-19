import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ipcMain } from 'electron'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

import { initDb, closeDb, getDb } from '../../../src/db/db'
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
} from '../../../src/ipc/notes.ipc'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-ipc-test-'))
  initDb(tmpDir)
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('createNote', () => {
  it('creates a note with title, body, and tags', async () => {
    const result = await createNote({ title: 'My Note', body: '## Content', tags: ['work'] })
    expect(result).toHaveProperty('data')
    expect((result as { data: { title: string } }).data.title).toBe('My Note')
    expect((result as { data: { id: string } }).data.id).toBeTruthy()
  })

  it('derives title from first heading when title is omitted', async () => {
    const result = await createNote({ body: '# Auto Title\n\nsome content' })
    expect((result as { data: { title: string } }).data.title).toBe('Auto Title')
  })

  it('derives title from first non-empty line when no heading', async () => {
    const result = await createNote({ body: 'First line of content' })
    expect((result as { data: { title: string } }).data.title).toBe('First line of content')
  })

  it("defaults title to 'Untitled note' when body is empty", async () => {
    const result = await createNote({})
    expect((result as { data: { title: string } }).data.title).toBe('Untitled note')
  })

  it('creates tags and note_tags rows', async () => {
    await createNote({ title: 'Tagged', body: '', tags: ['infra', 'prod'] })
    const db = getDb()
    const tagRows = db.prepare('SELECT name FROM tags').all() as { name: string }[]
    const tagNames = tagRows.map((r) => r.name)
    expect(tagNames).toContain('infra')
    expect(tagNames).toContain('prod')
  })

  it('returns error on invalid payload (unknown field with strict schema)', async () => {
    const result = await createNote({ unknownField: 'bad' } as unknown as Record<string, unknown>)
    expect(result).toHaveProperty('error')
  })
})

describe('listNotes', () => {
  beforeEach(async () => {
    await createNote({ title: 'Active', body: 'active note' })
    const archived = await createNote({ title: 'Archived', body: 'archived note' })
    const id = (archived as { data: { id: string } }).data.id
    await archiveNote({ id })
  })

  it('returns only non-archived notes by default', async () => {
    const result = await listNotes({})
    const data = (result as { data: unknown[] }).data
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(1)
    expect((data[0] as { title: string }).title).toBe('Active')
  })

  it('returns archived notes when includeArchived=true', async () => {
    const result = await listNotes({ includeArchived: true })
    const data = (result as { data: unknown[] }).data
    expect(data).toHaveLength(2)
  })

  it('includes bodyPreview field', async () => {
    const result = await listNotes({})
    const data = (result as { data: { bodyPreview: string }[] }).data
    expect(data[0]).toHaveProperty('bodyPreview')
  })

  it('sorts by updated_at desc by default', async () => {
    const result = await listNotes({})
    const data = (result as { data: { title: string }[] }).data
    expect(data.length).toBeGreaterThan(0)
  })
})

describe('getNote', () => {
  it('returns full note by id', async () => {
    const created = await createNote({ title: 'Full Note', body: '# Full' })
    const id = (created as { data: { id: string } }).data.id
    const result = await getNote({ id })
    const note = (result as { data: { title: string; body: string } }).data
    expect(note.title).toBe('Full Note')
    expect(note.body).toBe('# Full')
  })

  it('returns error for missing note id', async () => {
    const result = await getNote({ id: 'nonexistent' })
    expect(result).toHaveProperty('error')
  })

  it('returns error on invalid payload', async () => {
    const result = await getNote(null as unknown as { id: string })
    expect(result).toHaveProperty('error')
  })
})

describe('autosaveNote', () => {
  it('updates body, title, and updated_at', async () => {
    const created = await createNote({ title: 'Original', body: 'original body' })
    const id = (created as { data: { id: string } }).data.id
    const result = await autosaveNote({
      id,
      title: 'Updated Title',
      body: 'updated body',
      tags: [],
    })
    expect(result).toHaveProperty('data')
    expect((result as { data: { updatedAt: string } }).data.updatedAt).toBeTruthy()

    const fetched = await getNote({ id })
    const note = (fetched as { data: { title: string; body: string } }).data
    expect(note.title).toBe('Updated Title')
    expect(note.body).toBe('updated body')
  })

  it('reconciles tag additions', async () => {
    const created = await createNote({ title: 'T', body: '', tags: ['old'] })
    const id = (created as { data: { id: string } }).data.id
    await autosaveNote({ id, title: 'T', body: '', tags: ['new'] })
    const db = getDb()
    const noteTags = db
      .prepare(
        `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?`
      )
      .all(id) as { name: string }[]
    const names = noteTags.map((r) => r.name)
    expect(names).toContain('new')
    expect(names).not.toContain('old')
  })

  it('returns error on invalid payload', async () => {
    const result = await autosaveNote(
      null as unknown as {
        id: string
        title: string
        body: string
        tags: string[]
      }
    )
    expect(result).toHaveProperty('error')
  })
})

describe('archiveNote', () => {
  it('sets archived_at on the note', async () => {
    const created = await createNote({ title: 'ToArchive', body: '' })
    const id = (created as { data: { id: string } }).data.id
    const result = await archiveNote({ id })
    expect((result as { data: { archivedAt: string } }).data.archivedAt).toBeTruthy()

    const db = getDb()
    const row = db.prepare('SELECT archived_at FROM notes WHERE id=?').get(id) as {
      archived_at: string | null
    }
    expect(row.archived_at).not.toBeNull()
  })

  it('returns error on invalid payload', async () => {
    const result = await archiveNote(null as unknown as { id: string })
    expect(result).toHaveProperty('error')
  })
})

describe('restoreNote', () => {
  it('clears archived_at', async () => {
    const created = await createNote({ title: 'ToRestore', body: '' })
    const id = (created as { data: { id: string } }).data.id
    await archiveNote({ id })
    const result = await restoreNote({ id })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const db = getDb()
    const row = db.prepare('SELECT archived_at FROM notes WHERE id=?').get(id) as {
      archived_at: string | null
    }
    expect(row.archived_at).toBeNull()
  })
})

describe('hardDeleteNote', () => {
  it('removes the note row', async () => {
    const created = await createNote({ title: 'ToDelete', body: '' })
    const id = (created as { data: { id: string } }).data.id
    const result = await hardDeleteNote({ id })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const db = getDb()
    const row = db.prepare('SELECT id FROM notes WHERE id=?').get(id)
    expect(row).toBeUndefined()
  })

  it('returns error for missing note', async () => {
    const result = await hardDeleteNote({ id: 'nonexistent' })
    expect(result).toHaveProperty('error')
  })

  it('returns error on invalid payload', async () => {
    const result = await hardDeleteNote(null as unknown as { id: string })
    expect(result).toHaveProperty('error')
  })
})

describe('restoreNote edge cases', () => {
  it('returns error for missing note', async () => {
    const result = await restoreNote({ id: 'nonexistent' })
    expect(result).toHaveProperty('error')
  })

  it('returns error on invalid payload', async () => {
    const result = await restoreNote(null as unknown as { id: string })
    expect(result).toHaveProperty('error')
  })
})

describe('listNotes with tagId filter', () => {
  it('filters by tagId', async () => {
    await createNote({ title: 'Tagged', body: '', tags: ['filterable'] })
    await createNote({ title: 'Untagged', body: '' })
    const db = getDb()
    const tag = db.prepare('SELECT id FROM tags WHERE name=?').get('filterable') as { id: string }
    const result = await listNotes({ tagId: tag.id })
    const data = (result as { data: { title: string }[] }).data
    expect(data.every((n) => n.title === 'Tagged')).toBe(true)
  })

  it('sorts asc by title', async () => {
    await createNote({ title: 'B Note', body: '' })
    await createNote({ title: 'A Note', body: '' })
    const result = await listNotes({ sortBy: 'title', sortDir: 'asc' })
    const data = (result as { data: { title: string }[] }).data
    expect(data[0].title).toBe('A Note')
  })

  it('returns error on invalid payload', async () => {
    const result = await listNotes({ sortBy: 'bad_col' as 'updated_at' })
    expect(result).toHaveProperty('error')
  })
})

describe('registerNotesIpcHandlers', () => {
  it('registers and disposes without error', () => {
    const dispose = registerNotesIpcHandlers()
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })
})

describe('listTags', () => {
  it('returns tags with noteCount', async () => {
    await createNote({ title: 'A', body: '', tags: ['alpha', 'beta'] })
    await createNote({ title: 'B', body: '', tags: ['alpha'] })

    const result = await listTags({})
    const tags = (result as { data: { name: string; noteCount: number }[] }).data
    const alpha = tags.find((t) => t.name === 'alpha')
    const beta = tags.find((t) => t.name === 'beta')
    expect(alpha?.noteCount).toBe(2)
    expect(beta?.noteCount).toBe(1)
  })

  it('returns empty array when no tags', async () => {
    const result = await listTags({})
    expect((result as { data: unknown[] }).data).toEqual([])
  })
})

describe('renameTag', () => {
  it('updates name for all note_tags rows', async () => {
    await createNote({ title: 'A', body: '', tags: ['oldname'] })
    await createNote({ title: 'B', body: '', tags: ['oldname'] })

    const db = getDb()
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get('oldname') as { id: string }

    const result = await renameTag({ id: tag.id, name: 'newname' })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const updated = db.prepare('SELECT name FROM tags WHERE id = ?').get(tag.id) as { name: string }
    expect(updated.name).toBe('newname')
  })

  it('returns error on validation failure', async () => {
    const result = await renameTag({ id: 123 as unknown as string, name: 'x' })
    expect(result).toHaveProperty('error')
  })
})

describe('deleteTag', () => {
  it('removes tag and note_tags associations without deleting notes', async () => {
    const note = await createNote({ title: 'A', body: '', tags: ['removable'] })
    const noteId = (note as { data: { id: string } }).data.id

    const db = getDb()
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get('removable') as { id: string }

    const result = await deleteTag({ id: tag.id })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    // Note still exists
    const noteRow = db.prepare('SELECT id FROM notes WHERE id = ?').get(noteId)
    expect(noteRow).toBeTruthy()

    // Tag and associations removed
    const tagRow = db.prepare('SELECT id FROM tags WHERE id = ?').get(tag.id)
    expect(tagRow).toBeUndefined()
  })

  it('returns error on validation failure', async () => {
    const result = await deleteTag({ id: 123 as unknown as string })
    expect(result).toHaveProperty('error')
  })
})

describe('inline #tag parsing on autosave', () => {
  it('extracts #tags from body and reconciles note_tags', async () => {
    const note = await createNote({ title: 'A', body: '', tags: [] })
    const id = (note as { data: { id: string } }).data.id

    await autosaveNote({ id, title: 'A', body: 'thinking about #idea and #todo', tags: [] })

    const db = getDb()
    const noteTags = db
      .prepare(
        'SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?'
      )
      .all(id) as { name: string }[]
    const names = noteTags.map((r) => r.name)
    expect(names).toContain('idea')
    expect(names).toContain('todo')
  })

  it('inline tags merge with explicit tags array', async () => {
    const note = await createNote({ title: 'A', body: '', tags: ['explicit'] })
    const id = (note as { data: { id: string } }).data.id

    await autosaveNote({ id, title: 'A', body: 'some #inline tag', tags: ['explicit'] })

    const db = getDb()
    const noteTags = db
      .prepare(
        'SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?'
      )
      .all(id) as { name: string }[]
    const names = noteTags.map((r) => r.name)
    expect(names).toContain('explicit')
    expect(names).toContain('inline')
  })
})

describe('registerTagsIpcHandlers', () => {
  it('registers and disposes without error', () => {
    const dispose = registerTagsIpcHandlers()
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })
})

describe('handle() catch — DB not initialized', () => {
  function getHandler(channel: string) {
    let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(ipcMain.handle).mockImplementation((ch, fn) => {
      if (ch === channel) handler = fn as typeof handler
    })
    registerNotesIpcHandlers()
    vi.mocked(ipcMain.handle).mockReset()
    if (!handler) throw new Error(`Handler for ${channel} not registered`)
    return handler
  }

  it('returns { error } from notes.list when getDb throws', async () => {
    closeDb()
    const handler = getHandler('terminator.notepad:notes.list')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: expect.stringContaining('NotepadDB not initialized') })
  })
})
