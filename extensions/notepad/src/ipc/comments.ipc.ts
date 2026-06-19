import { ipcMain } from 'electron'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/db'
import { rowToComment } from '../db/mappers'
import type { Comment } from '../db/types'

const ListPayload = z.object({
  noteId: z.string(),
  includeResolved: z.boolean().optional(),
})

const CreatePayload = z.object({
  noteId: z.string(),
  body: z.string().min(1),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  quote: z.string().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
})

const ReplyPayload = z.object({
  noteId: z.string(),
  parentId: z.string(),
  body: z.string().min(1),
})

const UpdatePayload = z.object({
  id: z.string(),
  body: z.string().min(1),
})

const DeletePayload = z.object({ id: z.string() })

const ResolvePayload = z.object({ id: z.string(), resolved: z.boolean() })

const UpdateAnchorPayload = z.object({
  id: z.string(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
})

const MarkOrphanedPayload = z.object({ id: z.string() })

function err(msg: string) {
  return { error: msg }
}

export async function listComments(payload: unknown): Promise<unknown> {
  const parsed = ListPayload.safeParse(payload)
  if (!parsed.success) return err('VALIDATION_ERROR')
  const { noteId, includeResolved } = parsed.data
  const db = getDb()

  const statusFilter = includeResolved === true ? '' : "AND status != 'resolved'"
  const topRows = db
    .prepare(
      `SELECT * FROM comments WHERE note_id = ? AND parent_id IS NULL ${statusFilter} ORDER BY created_at ASC`
    )
    .all(noteId) as Record<string, unknown>[]

  const comments: Comment[] = topRows.map((row) => {
    const comment = rowToComment(row as Parameters<typeof rowToComment>[0])
    const replies = db
      .prepare('SELECT * FROM comments WHERE parent_id = ? ORDER BY created_at ASC')
      .all(comment.id) as Record<string, unknown>[]
    comment.replies = replies.map((r) => rowToComment(r as Parameters<typeof rowToComment>[0]))
    return comment
  })

  return { data: comments }
}

export async function createComment(payload: unknown): Promise<unknown> {
  const parsed = CreatePayload.safeParse(payload)
  if (!parsed.success) return err('VALIDATION_ERROR')
  const { noteId, body, startOffset, endOffset, quote, prefix, suffix } = parsed.data
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO comments (id, note_id, parent_id, body, author, status,
      start_offset, end_offset, quote, prefix, suffix, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'me', 'open', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    noteId,
    body,
    startOffset ?? null,
    endOffset ?? null,
    quote ?? null,
    prefix ?? null,
    suffix ?? null,
    now,
    now
  )

  return { data: { id, createdAt: now } }
}

export async function replyComment(payload: unknown): Promise<unknown> {
  const parsed = ReplyPayload.safeParse(payload)
  if (!parsed.success) return err('VALIDATION_ERROR')
  const { noteId, parentId, body } = parsed.data
  const db = getDb()

  const parent = db.prepare('SELECT parent_id FROM comments WHERE id = ?').get(parentId) as
    | { parent_id: string | null }
    | undefined

  if (!parent) return err('PARENT_NOT_FOUND')
  if (parent.parent_id !== null) return err('MAX_DEPTH_EXCEEDED')

  const id = randomUUID()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO comments (id, note_id, parent_id, body, author, status,
      start_offset, end_offset, quote, prefix, suffix, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'me', 'open', NULL, NULL, NULL, NULL, NULL, ?, ?)`
  ).run(id, noteId, parentId, body, now, now)

  return { data: { id, createdAt: now } }
}

export async function updateComment(payload: unknown): Promise<unknown> {
  const parsed = UpdatePayload.safeParse(payload)
  if (!parsed.success) return err('VALIDATION_ERROR')
  const { id, body } = parsed.data
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?').run(body, now, id)
  return { data: { updatedAt: now } }
}

export async function deleteComment(payload: unknown): Promise<unknown> {
  const parsed = DeletePayload.safeParse(payload)
  if (!parsed.success) return err('VALIDATION_ERROR')
  const { id } = parsed.data
  getDb().prepare('DELETE FROM comments WHERE id = ?').run(id)
  return { data: { ok: true } }
}

export async function resolveComment(payload: unknown): Promise<unknown> {
  const parsed = ResolvePayload.safeParse(payload)
  if (!parsed.success) return err('VALIDATION_ERROR')
  const { id, resolved } = parsed.data
  const db = getDb()
  const status = resolved ? 'resolved' : 'open'
  const now = new Date().toISOString()
  db.prepare('UPDATE comments SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id)
  return { data: { status } }
}

export async function updateAnchor(payload: unknown): Promise<unknown> {
  const parsed = UpdateAnchorPayload.safeParse(payload)
  if (!parsed.success) return err('VALIDATION_ERROR')
  const { id, startOffset, endOffset } = parsed.data
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(
    'UPDATE comments SET start_offset = ?, end_offset = ?, updated_at = ? WHERE id = ?'
  ).run(startOffset, endOffset, now, id)
  return { data: { ok: true } }
}

export async function markOrphaned(payload: unknown): Promise<unknown> {
  const parsed = MarkOrphanedPayload.safeParse(payload)
  if (!parsed.success) return err('VALIDATION_ERROR')
  const { id } = parsed.data
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare("UPDATE comments SET status = 'orphaned', updated_at = ? WHERE id = ?").run(now, id)
  return { data: { ok: true } }
}

export function registerCommentsIpcHandlers(): () => void {
  const channels: [string, (payload: unknown) => Promise<unknown>][] = [
    ['terminator.notepad:comments.list', listComments],
    ['terminator.notepad:comments.create', createComment],
    ['terminator.notepad:comments.reply', replyComment],
    ['terminator.notepad:comments.update', updateComment],
    ['terminator.notepad:comments.delete', deleteComment],
    ['terminator.notepad:comments.resolve', resolveComment],
    ['terminator.notepad:comments.updateAnchor', updateAnchor],
    ['terminator.notepad:comments.markOrphaned', markOrphaned],
  ]

  for (const [channel, handler] of channels) {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        return await handler(payload)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })
  }

  return () => {
    for (const [channel] of channels) {
      ipcMain.removeHandler(channel)
    }
  }
}
