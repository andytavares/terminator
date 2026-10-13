import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ipcMain } from 'electron'
import { dispatchChannel, type ChannelSpec } from '@terminator/extension-sdk'

// Adapter: registerHandler forwards to the electron ipcMain mocks so existing
// capture/assert code (ipcMain.handle calls, removeHandler assertions) still works.
const mockApi = {
  ipc: {
    registerHandler: (spec: ChannelSpec) => {
      ;(ipcMain.handle as unknown as ReturnType<typeof vi.fn>)(
        spec.channel,
        (_e: unknown, payload: unknown) => dispatchChannel(spec, payload)
      )
      return {
        dispose: () => (ipcMain.removeHandler as unknown as ReturnType<typeof vi.fn>)(spec.channel),
      }
    },
  },
} as unknown as import('../../../../../src/main/extensions/api').ExtensionAPI
import { DatabaseSync } from 'node:sqlite'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

import { wrapDb } from '../../../../../src/main/db/index'
import { applyNotepadSchema } from '../../../src/db/db'
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
import type { ExtensionDB } from '@terminator/extension-sdk'

let db: ExtensionDB
let noteId: string

beforeEach(async () => {
  db = wrapDb(new DatabaseSync(':memory:'))
  await applyNotepadSchema(db)
})

beforeEach(async () => {
  noteId = '00000000-0000-0000-0000-000000000001'
  const now = new Date().toISOString()
  await db.run(
    'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [noteId, 'Test Note', 'Hello world this is test content', now, now]
  )
})

describe('registerCommentsIpcHandlers', () => {
  it('returns a dispose function', () => {
    const dispose = registerCommentsIpcHandlers(mockApi, db)
    expect(typeof dispose).toBe('function')
    dispose()
  })
})

describe('listComments', listCommentsTests)

describe('createComment', () => {
  it('creates a top-level comment with anchor fields', async () => {
    const result = await createComment(db, {
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
})

describe('replyComment', replyCommentTests)

describe('updateComment', () => {
  it('updates the comment body', async () => {
    const c = await createComment(db, {
      noteId,
      body: 'original',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id
    const result = await updateComment(db, { id, body: 'updated body' })
    expect((result as { data: { updatedAt: string } }).data.updatedAt).toBeTruthy()
  })
})

describe('deleteComment', () => {
  it('removes the comment', async () => {
    const c = await createComment(db, {
      noteId,
      body: 'to delete',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id
    const result = await deleteComment(db, { id })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const listed = await listComments(db, { noteId })
    expect((listed as { data: unknown[] }).data).toHaveLength(0)
  })
})

describe('resolveComment', resolveCommentTests)

describe('updateAnchor', () => {
  it('updates start and end offsets', async () => {
    const c = await createComment(db, {
      noteId,
      body: 'anchor test',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id
    const result = await updateAnchor(db, { id, startOffset: 10, endOffset: 20 })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const row = await db.get<{ start_offset: number; end_offset: number }>(
      'SELECT start_offset, end_offset FROM comments WHERE id = ?',
      [id]
    )
    expect(Number(row?.start_offset)).toBe(10)
    expect(Number(row?.end_offset)).toBe(20)
  })
})

describe('markOrphaned', () => {
  it('sets comment status to orphaned', async () => {
    const c = await createComment(db, {
      noteId,
      body: 'to orphan',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id
    const result = await markOrphaned(db, { id })
    expect((result as { data: { ok: boolean } }).data.ok).toBe(true)

    const row = await db.get<{ status: string }>('SELECT status FROM comments WHERE id = ?', [id])
    expect(row?.status).toBe('orphaned')
  })
})

describe('IPC handler registration', () => {
  it('registerCommentsIpcHandlers calls ipcMain.handle for all channels', () => {
    vi.mocked(ipcMain.handle).mockClear()
    const dispose = registerCommentsIpcHandlers(mockApi, db)
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:comments.list',
      expect.any(Function)
    )
    dispose()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('terminator.notepad:comments.list')
  })
})

function listCommentsTests() {
  describe('nesting', listCommentsNestingTests)
  describe('excluding resolved', listCommentsExcludingResolvedTests)
  describe('including resolved', listCommentsIncludingResolvedTests)
}

function listCommentsNestingTests() {
  it('returns empty array when no comments', async () => {
    const result = await listComments(db, { noteId })
    expect((result as { data: unknown[] }).data).toEqual([])
  })

  it('returns top-level comments with nested replies', async () => {
    const parent = await createComment(db, {
      noteId,
      body: 'Top level',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: ' world',
    })
    const parentId = (parent as { data: { id: string } }).data.id

    await replyComment(db, { noteId, parentId, body: 'Reply here' })

    const result = await listComments(db, { noteId })
    const comments = (result as { data: { id: string; replies: unknown[] }[] }).data
    expect(comments).toHaveLength(1)
    expect(comments[0].replies).toHaveLength(1)
  })
}

function listCommentsExcludingResolvedTests() {
  it('excludes resolved comments when includeResolved is false', async () => {
    const c = await createComment(db, {
      noteId,
      body: 'will resolve',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const cId = (c as { data: { id: string } }).data.id
    await resolveComment(db, { id: cId, resolved: true })

    const result = await listComments(db, { noteId, includeResolved: false })
    const comments = (result as { data: unknown[] }).data
    expect(comments).toHaveLength(0)
  })
}

function listCommentsIncludingResolvedTests() {
  it('includes resolved comments when includeResolved is true', async () => {
    const c = await createComment(db, {
      noteId,
      body: 'resolved',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const cId = (c as { data: { id: string } }).data.id
    await resolveComment(db, { id: cId, resolved: true })

    const result = await listComments(db, { noteId, includeResolved: true })
    const comments = (result as { data: unknown[] }).data
    expect(comments).toHaveLength(1)
  })
}

function replyCommentTests() {
  describe('replying', replyCommentReplyingTests)
  describe('depth and parents', replyCommentDepthParentsTests)
}

function replyCommentReplyingTests() {
  it('adds a reply to a top-level comment', async () => {
    const parent = await createComment(db, {
      noteId,
      body: 'parent',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const parentId = (parent as { data: { id: string } }).data.id
    const reply = await replyComment(db, { noteId, parentId, body: 'I am a reply' })
    expect((reply as { data: { id: string } }).data.id).toBeTruthy()
  })
}

function replyCommentDepthParentsTests() {
  it('returns MAX_DEPTH_EXCEEDED when replying to a reply', async () => {
    const parent = await createComment(db, {
      noteId,
      body: 'parent',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const parentId = (parent as { data: { id: string } }).data.id
    const reply = await replyComment(db, { noteId, parentId, body: 'reply' })
    const replyId = (reply as { data: { id: string } }).data.id
    const nested = await replyComment(db, { noteId, parentId: replyId, body: 'nested' })
    expect((nested as { error: string }).error).toBe('MAX_DEPTH_EXCEEDED')
  })

  it('returns PARENT_NOT_FOUND for non-existent parentId', async () => {
    const result = await replyComment(db, { noteId, parentId: 'non-existent-id', body: 'reply' })
    expect((result as { error: string }).error).toBe('PARENT_NOT_FOUND')
  })
}

function resolveCommentTests() {
  describe('resolving', resolveCommentResolvingTests)
  describe('reopening', resolveCommentReopeningTests)
}

function resolveCommentResolvingTests() {
  it('sets status to resolved', async () => {
    const c = await createComment(db, {
      noteId,
      body: 'to resolve',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id
    const result = await resolveComment(db, { id, resolved: true })
    expect((result as { data: { status: string } }).data.status).toBe('resolved')
  })
}

function resolveCommentReopeningTests() {
  it('sets status back to open', async () => {
    const c = await createComment(db, {
      noteId,
      body: 'toggle',
      startOffset: 0,
      endOffset: 5,
      quote: 'Hello',
      prefix: '',
      suffix: '',
    })
    const id = (c as { data: { id: string } }).data.id
    await resolveComment(db, { id, resolved: true })

    const result = await resolveComment(db, { id, resolved: false })
    expect((result as { data: { status: string } }).data.status).toBe('open')
  })
}
