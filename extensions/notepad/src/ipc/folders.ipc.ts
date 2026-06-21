import { ipcMain } from 'electron'
import { z } from 'zod'
import { randomUUID } from '../db/db'
import type { ExtensionDB } from '../../../../src/main/db/index'

const VALIDATION_ERROR = { error: 'VALIDATION_ERROR' }

export async function createFolder(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ name: z.string().min(1) })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const id = randomUUID()
  const now = new Date().toISOString()
  const name = parsed.data.name.trim()

  const maxRow = await db.get<{ max: number | null }>('SELECT MAX(sort_order) AS max FROM folders')
  const sortOrder = (maxRow?.max ?? -1) + 1

  await db.run('INSERT INTO folders (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)', [
    id,
    name,
    sortOrder,
    now,
  ])

  return { data: { id, name, sortOrder, createdAt: now } }
}

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

export async function renameFolder(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string(), name: z.string().min(1) })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const existing = await db.get<{ id: string }>('SELECT id FROM folders WHERE id=?', [
    parsed.data.id,
  ])
  if (!existing) return { error: 'FOLDER_NOT_FOUND' }

  await db.run('UPDATE folders SET name=? WHERE id=?', [parsed.data.name.trim(), parsed.data.id])
  return { data: { ok: true } }
}

export async function deleteFolder(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({ id: z.string() })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const existing = await db.get<{ id: string }>('SELECT id FROM folders WHERE id=?', [
    parsed.data.id,
  ])
  if (!existing) return { error: 'FOLDER_NOT_FOUND' }

  await db.transaction(async (tx) => {
    await tx.run('UPDATE notes SET folder_id=NULL WHERE folder_id=?', [parsed.data.id])
    await tx.run('UPDATE diagrams SET folder_id=NULL WHERE folder_id=?', [parsed.data.id])
    await tx.run('DELETE FROM folders WHERE id=?', [parsed.data.id])
  })

  return { data: { ok: true } }
}

export async function moveItemsToFolder(
  db: ExtensionDB,
  payload: unknown
): Promise<Record<string, unknown>> {
  const schema = z.object({
    items: z.array(z.object({ id: z.string(), type: z.enum(['note', 'diagram']) })),
    folderId: z.string().nullable(),
  })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) return VALIDATION_ERROR

  const { items, folderId } = parsed.data

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

export function registerFoldersIpcHandlers(db: ExtensionDB): () => void {
  ipcMain.handle('terminator.notepad:folders.create', (_, payload) => createFolder(db, payload))
  ipcMain.handle('terminator.notepad:folders.list', () => listFolders(db))
  ipcMain.handle('terminator.notepad:folders.rename', (_, payload) => renameFolder(db, payload))
  ipcMain.handle('terminator.notepad:folders.delete', (_, payload) => deleteFolder(db, payload))
  ipcMain.handle('terminator.notepad:folders.move', (_, payload) => moveItemsToFolder(db, payload))

  return () => {
    ipcMain.removeHandler('terminator.notepad:folders.create')
    ipcMain.removeHandler('terminator.notepad:folders.list')
    ipcMain.removeHandler('terminator.notepad:folders.rename')
    ipcMain.removeHandler('terminator.notepad:folders.delete')
    ipcMain.removeHandler('terminator.notepad:folders.move')
  }
}
