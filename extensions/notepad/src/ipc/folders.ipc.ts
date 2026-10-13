import { z } from 'zod'
import { randomUUID } from '../db/db'
import { noPayload, type ExtensionDB, type ExtensionAPI } from '@terminator/extension-sdk'
import { createIpcRegistrar, IdPayload } from './register'

const CreateFolderPayload = z.object({ name: z.string().min(1) })

/** @internal */
export async function createFolder(
  db: ExtensionDB,
  args: z.infer<typeof CreateFolderPayload>
): Promise<Record<string, unknown>> {
  const id = randomUUID()
  const now = new Date().toISOString()
  const name = args.name.trim()

  let sortOrder = 0
  await db.transaction(async (tx) => {
    const maxRow = await tx.get<{ max: number | null }>(
      'SELECT MAX(sort_order) AS max FROM folders'
    )
    sortOrder = (maxRow?.max ?? -1) + 1
    await tx.run('INSERT INTO folders (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)', [
      id,
      name,
      sortOrder,
      now,
    ])
  })

  return { data: { id, name, sortOrder, createdAt: now } }
}

/** @internal */
export async function listFolders(db: ExtensionDB): Promise<Record<string, unknown>> {
  const rows = await db.query<{
    id: string
    name: string
    sort_order: number
    created_at: string
  }>('SELECT id, name, sort_order, created_at FROM folders ORDER BY sort_order ASC, created_at ASC')

  return {
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
    })),
  }
}

const RenameFolderPayload = z.object({ id: z.string(), name: z.string().min(1) })

/** @internal */
export async function renameFolder(
  db: ExtensionDB,
  args: z.infer<typeof RenameFolderPayload>
): Promise<Record<string, unknown>> {
  const existing = await db.get<{ id: string }>('SELECT id FROM folders WHERE id=?', [args.id])
  if (!existing) return { error: 'FOLDER_NOT_FOUND' }

  await db.run('UPDATE folders SET name=? WHERE id=?', [args.name.trim(), args.id])
  return { data: { ok: true } }
}

/** @internal */
export async function deleteFolder(
  db: ExtensionDB,
  args: z.infer<typeof IdPayload>
): Promise<Record<string, unknown>> {
  const existing = await db.get<{ id: string }>('SELECT id FROM folders WHERE id=?', [args.id])
  if (!existing) return { error: 'FOLDER_NOT_FOUND' }

  await db.transaction(async (tx) => {
    await tx.run('UPDATE notes SET folder_id=NULL WHERE folder_id=?', [args.id])
    await tx.run('UPDATE diagrams SET folder_id=NULL WHERE folder_id=?', [args.id])
    await tx.run('DELETE FROM folders WHERE id=?', [args.id])
  })

  return { data: { ok: true } }
}

const MoveItemsToFolderPayload = z.object({
  items: z.array(z.object({ id: z.string(), type: z.enum(['note', 'diagram']) })),
  folderId: z.string().nullable(),
})

/** @internal */
export async function moveItemsToFolder(
  db: ExtensionDB,
  args: z.infer<typeof MoveItemsToFolderPayload>
): Promise<Record<string, unknown>> {
  const { items, folderId } = args

  if (folderId !== null) {
    const folderExists = await db.get<{ id: string }>('SELECT id FROM folders WHERE id=?', [
      folderId,
    ])
    if (!folderExists) return { error: 'FOLDER_NOT_FOUND' }
  }

  const TABLE_MAP = { note: 'notes', diagram: 'diagrams' } as const
  await db.transaction(async (tx) => {
    for (const { id, type } of items) {
      const table = TABLE_MAP[type]
      await tx.run(`UPDATE ${table} SET folder_id=? WHERE id=?`, [folderId, id])
    }
  })

  return { data: { ok: true } }
}

export function registerFoldersIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  const { handleRemote, cleanup } = createIpcRegistrar(api)
  handleRemote('terminator.notepad:folders.create', CreateFolderPayload, (args) =>
    createFolder(db, args)
  )
  handleRemote('terminator.notepad:folders.list', noPayload, () => listFolders(db))
  handleRemote('terminator.notepad:folders.rename', RenameFolderPayload, (args) =>
    renameFolder(db, args)
  )
  handleRemote('terminator.notepad:folders.delete', IdPayload, (args) => deleteFolder(db, args))
  handleRemote('terminator.notepad:folders.move', MoveItemsToFolderPayload, (args) =>
    moveItemsToFolder(db, args)
  )

  return cleanup
}
