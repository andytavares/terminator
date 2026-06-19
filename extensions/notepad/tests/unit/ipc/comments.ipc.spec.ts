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
  listComments,
  createComment,
  replyComment,
  updateComment,
  deleteComment,
  resolveComment,
  updateAnchor,
  markOrphaned,
  registerCommentsIpcHandlers,
} from '../../../src/ipc/comments.ipc'

let tmpDir: string
let noteId: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-comments-ipc-test-'))
  initDb(tmpDir)
  // Create a note to attach comments to
  const db = getDb()
  const now = new Date().toISOString()
  noteId = '00000000-0000-0000-0000-000000000001'
  db.prepare(
    'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(noteId, 'Test Note', 'Hello world this is test content', now, now)
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('registerCommentsIpcHandlers', () => {
  it('returns a dispose function', () => {
    const dispose = registerCommentsIpcHandlers()
    expect(typeof dispose).toBe('function')
    dispose()
  })
})

describe('listComments', () => {
  it('returns empty array when no comments', async () => {
    const result = await listComments({ noteId })
    expect((result as { data: unknown[] }).data).toEqual([])
  })

  it('returns top-level comments with nested replies', async () => {
    const parent = await createComment({
      noteId,
      body: 'Top level',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: ' world',
    })
    const parentId = (parent as { data: { id: string } }).data.id

    await replyComment({ noteId, parentId, body: 'Reply here' })

    const result = await listComments({ noteId })
    const comments = (result as { data: { id: string; replies: unknown[] }[] }).data
    expect(comments).toHaveLength(1)
    expect(comments[0].replies).toHaveLength(1)
  })

  it('excludes resolved comments when includeResolved is false', async () => {
    const c = await createComment({
      noteId,
      body: 'will resolve',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const cId = (c as { data: { id: string } }).data.id
    await resolveComment({ id: cId, resolved: true })

    const result = await listComments({ noteId, includeResolved: false })
    const comments = (result as { data: unknown[] }).data
    expect(comments).toHaveLength(0)
  })

  it('includes resolved comments when includeResolved is true', async () => {
    const c = await createComment({
      noteId,
      body: 'resolved',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const cId = (c as { data: { id: string } }).data.id
    await resolveComment({ id: cId, resolved: true })

    const result = await listComments({ noteId, includeResolved: true })
    const comments = (result as { data: unknown[] }).data
    expect(comments).toHaveLength(1)
  })
})

describe('createComment', () => {
  it('creates a top-level comment with anchor fields', async () => {
    const result = await createComment({
      noteId,
      body: 'test comment',
      startOffset: 6,
      endOffset: 11,
      quote: 'world',
      prefix: 'Hello ',
      suffix: ' this',
    })
    const data = (result as { data: { id: string; createdAt: string } }).data
    expect(data.id).toBeTruthy()
    expect(data.createdAt).toBeTruthy()
  })

  it('returns error on validation failure', async () => {
    const result = await createComment({ noteId: 123 as unknown as string, body: 'x' })
    expect(result).toHaveProperty('error')
  })
})

describe('replyComment', () => {
  it('adds a reply to a top-level comment', async () => {
    const parent = await createComment({
      noteId,
      body: 'parent',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const parentId = (parent as { data: { id: string } }).data.id

    const reply = await replyComment({ noteId, parentId, body: 'I am a reply' })
    expect((reply as { data: { id: string } }).data.id).toBeTruthy()
  })

  it('returns MAX_DEPTH_EXCEEDED when replying to a reply', async () => {
    const parent = await createComment({
      noteId,
      body: 'parent',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const parentId = (parent as { data: { id: string } }).data.id

    const reply = await replyComment({ noteId, parentId, body: 'reply' })
    const replyId = (reply as { data: { id: string } }).data.id

    const nested = await replyComment({ noteId, parentId: replyId, body: 'nested' })
    expect((nested as { error: string }).error).toBe('MAX_DEPTH_EXCEEDED')
  })
})

describe('updateComment', () => {
  it('updates the comment body', async () => {
    const c = await createComment({
      noteId,
      body: 'original',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id

    const result = await updateComment({ id, body: 'updated body' })
    expect((result as { data: { updatedAt: string } }).data.updatedAt).toBeTruthy()
  })
})

describe('deleteComment', () => {
  it('removes the comment', async () => {
    const c = await createComment({
      noteId,
      body: 'to delete',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id

    const result = await deleteComment({ id })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const listed = await listComments({ noteId })
    expect((listed as { data: unknown[] }).data).toHaveLength(0)
  })
})

describe('resolveComment', () => {
  it('sets status to resolved', async () => {
    const c = await createComment({
      noteId,
      body: 'to resolve',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id

    const result = await resolveComment({ id, resolved: true })
    expect((result as { data: { status: string } }).data.status).toBe('resolved')
  })

  it('sets status back to open', async () => {
    const c = await createComment({
      noteId,
      body: 'toggle',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id
    await resolveComment({ id, resolved: true })

    const result = await resolveComment({ id, resolved: false })
    expect((result as { data: { status: string } }).data.status).toBe('open')
  })
})

describe('updateAnchor', () => {
  it('updates start and end offsets', async () => {
    const c = await createComment({
      noteId,
      body: 'anchor test',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id

    const result = await updateAnchor({ id, startOffset: 10, endOffset: 20 })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const db = getDb()
    const row = db.prepare('SELECT start_offset, end_offset FROM comments WHERE id = ?').get(id) as
      | { start_offset: number; end_offset: number }
      | undefined
    expect(row?.start_offset).toBe(10)
    expect(row?.end_offset).toBe(20)
  })
})

describe('markOrphaned', () => {
  it('sets comment status to orphaned', async () => {
    const c = await createComment({
      noteId,
      body: 'to orphan',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id

    const result = await markOrphaned({ id })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const db = getDb()
    const row = db.prepare('SELECT status FROM comments WHERE id = ?').get(id) as
      | { status: string }
      | undefined
    expect(row?.status).toBe('orphaned')
  })
})

describe('validation errors', () => {
  it('listComments returns error on invalid payload', async () => {
    const result = await listComments({ noteId: 123 })
    expect(result).toHaveProperty('error')
  })

  it('updateComment returns error on invalid payload', async () => {
    const result = await updateComment({ id: 123, body: 'x' })
    expect(result).toHaveProperty('error')
  })

  it('deleteComment returns error on invalid payload', async () => {
    const result = await deleteComment({ id: 123 })
    expect(result).toHaveProperty('error')
  })

  it('resolveComment returns error on invalid payload', async () => {
    const result = await resolveComment({ id: 123, resolved: 'yes' })
    expect(result).toHaveProperty('error')
  })

  it('updateAnchor returns error on invalid payload', async () => {
    const result = await updateAnchor({ id: 123 })
    expect(result).toHaveProperty('error')
  })

  it('markOrphaned returns error on invalid payload', async () => {
    const result = await markOrphaned({ id: 123 })
    expect(result).toHaveProperty('error')
  })

  it('replyComment returns PARENT_NOT_FOUND for non-existent parentId', async () => {
    const result = await replyComment({ noteId, parentId: 'non-existent-id', body: 'reply' })
    expect((result as { error: string }).error).toBe('PARENT_NOT_FOUND')
  })
})

describe('IPC reject — DB not initialized', () => {
  function getHandler(channel: string) {
    let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(ipcMain.handle).mockImplementation((ch, fn) => {
      if (ch === channel) handler = fn as typeof handler
    })
    registerCommentsIpcHandlers()
    vi.mocked(ipcMain.handle).mockReset()
    if (!handler) throw new Error(`Handler for ${channel} not registered`)
    return handler
  }

  it('rejects from comments.list when getDb throws so renderer catch fires', async () => {
    closeDb()
    const handler = getHandler('terminator.notepad:comments.list')
    await expect(handler({}, { noteId: 'any' })).rejects.toThrow('NotepadDB not initialized')
  })
})
