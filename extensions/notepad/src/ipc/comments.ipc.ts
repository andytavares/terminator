import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { rowToComment, type CommentRow } from '../db/mappers'
import type { Comment } from '../db/types'
import type { ExtensionDB, ExtensionAPI } from '@terminator/extension-sdk'
import { createIpcRegistrar, IdPayload } from './register'

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

const ResolvePayload = z.object({ id: z.string(), resolved: z.boolean() })

const UpdateAnchorPayload = z.object({
  id: z.string(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
})

function err(msg: string) {
  return { error: msg }
}

export async function listComments(
  db: ExtensionDB,
  args: z.infer<typeof ListPayload>
): Promise<unknown> {
  const { noteId, includeResolved } = args

  const statusFilter = includeResolved === true ? '' : "AND status != 'resolved'"
  const topRows = await db.query<CommentRow>(
    `SELECT * FROM comments WHERE note_id = ? AND parent_id IS NULL ${statusFilter} ORDER BY created_at ASC`,
    [noteId]
  )

  const comments: Comment[] = await Promise.all(
    topRows.map(async (row) => {
      const comment = rowToComment(row)
      const replies = await db.query<CommentRow>(
        'SELECT * FROM comments WHERE parent_id = ? ORDER BY created_at ASC',
        [comment.id]
      )
      comment.replies = replies.map((r) => rowToComment(r))
      return comment
    })
  )

  return { data: comments }
}

export async function createComment(
  db: ExtensionDB,
  args: z.infer<typeof CreatePayload>
): Promise<unknown> {
  const { noteId, body, startOffset, endOffset, quote, prefix, suffix } = args
  const id = randomUUID()
  const now = new Date().toISOString()

  await db.run(
    `INSERT INTO comments (id, note_id, parent_id, body, author, status,
      start_offset, end_offset, quote, prefix, suffix, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'me', 'open', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      noteId,
      body,
      startOffset ?? null,
      endOffset ?? null,
      quote ?? null,
      prefix ?? null,
      suffix ?? null,
      now,
      now,
    ]
  )

  return { data: { id, createdAt: now } }
}

export async function replyComment(
  db: ExtensionDB,
  args: z.infer<typeof ReplyPayload>
): Promise<unknown> {
  const { noteId, parentId, body } = args

  const parent = await db.get<{ parent_id: string | null }>(
    'SELECT parent_id FROM comments WHERE id = ?',
    [parentId]
  )

  if (!parent) return err('PARENT_NOT_FOUND')
  if (parent.parent_id !== null) return err('MAX_DEPTH_EXCEEDED')

  const id = randomUUID()
  const now = new Date().toISOString()

  await db.run(
    `INSERT INTO comments (id, note_id, parent_id, body, author, status,
      start_offset, end_offset, quote, prefix, suffix, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'me', 'open', NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    [id, noteId, parentId, body, now, now]
  )

  return { data: { id, createdAt: now } }
}

export async function updateComment(
  db: ExtensionDB,
  args: z.infer<typeof UpdatePayload>
): Promise<unknown> {
  const { id, body } = args
  const now = new Date().toISOString()
  await db.run('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?', [body, now, id])
  return { data: { updatedAt: now } }
}

export async function deleteComment(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<unknown> {
  const { id } = args
  await db.run('DELETE FROM comments WHERE id = ?', [id])
  return { data: { ok: true } }
}

export async function resolveComment(
  db: ExtensionDB,
  args: z.infer<typeof ResolvePayload>
): Promise<unknown> {
  const { id, resolved } = args
  const status = resolved ? 'resolved' : 'open'
  const now = new Date().toISOString()
  await db.run('UPDATE comments SET status = ?, updated_at = ? WHERE id = ?', [status, now, id])
  return { data: { status } }
}

export async function updateAnchor(
  db: ExtensionDB,
  args: z.infer<typeof UpdateAnchorPayload>
): Promise<unknown> {
  const { id, startOffset, endOffset } = args
  const now = new Date().toISOString()
  await db.run(
    'UPDATE comments SET start_offset = ?, end_offset = ?, updated_at = ? WHERE id = ?',
    [startOffset, endOffset, now, id]
  )
  return { data: { ok: true } }
}

export async function markOrphaned(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<unknown> {
  const { id } = args
  const now = new Date().toISOString()
  await db.run("UPDATE comments SET status = 'orphaned', updated_at = ? WHERE id = ?", [now, id])
  return { data: { ok: true } }
}

export function registerCommentsIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handleRemote, cleanup } = createIpcRegistrar(api)
  handleRemote('terminator.notepad:comments.list', ListPayload, (args) => listComments(db, args))
  handleRemote('terminator.notepad:comments.create', CreatePayload, (args) =>
    createComment(db, args)
  )
  handleRemote('terminator.notepad:comments.reply', ReplyPayload, (args) => replyComment(db, args))
  handleRemote('terminator.notepad:comments.update', UpdatePayload, (args) =>
    updateComment(db, args)
  )
  handleRemote('terminator.notepad:comments.delete', IdPayload, (args) => deleteComment(db, args))
  handleRemote('terminator.notepad:comments.resolve', ResolvePayload, (args) =>
    resolveComment(db, args)
  )
  handleRemote('terminator.notepad:comments.updateAnchor', UpdateAnchorPayload, (args) =>
    updateAnchor(db, args)
  )
  handleRemote('terminator.notepad:comments.markOrphaned', IdPayload, (args) =>
    markOrphaned(db, args)
  )
  return cleanup
}
