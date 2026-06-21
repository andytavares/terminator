import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

import { ipcMain } from 'electron'
import { wrapDb } from '../../../../../src/main/db/index'
import { applyNotepadSchema } from '../../../src/db/db'
import {
  createFolder,
  listFolders,
  renameFolder,
  deleteFolder,
  moveItemsToFolder,
  registerFoldersIpcHandlers,
} from '../../../src/ipc/folders.ipc'
import { createNote } from '../../../src/ipc/notes.ipc'
import { createDiagram } from '../../../src/ipc/diagrams.ipc'
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

describe('createFolder', () => {
  it('creates a folder with the given name', async () => {
    const result = await createFolder(db, { name: 'Work' })
    expect(result).toHaveProperty('data')
    const data = (result as { data: { id: string; name: string; sortOrder: number } }).data
    expect(data.id).toBeTruthy()
    expect(data.name).toBe('Work')
    expect(typeof data.sortOrder).toBe('number')
  })

  it('trims whitespace from the name', async () => {
    const result = await createFolder(db, { name: '  Projects  ' })
    const data = (result as { data: { name: string } }).data
    expect(data.name).toBe('Projects')
  })

  it('assigns incrementing sort_order for multiple folders', async () => {
    await createFolder(db, { name: 'A' })
    await createFolder(db, { name: 'B' })
    const listResult = await listFolders(db)
    const folders = (listResult as { data: { name: string; sortOrder: number }[] }).data
    expect(folders[0].sortOrder).toBeLessThan(folders[1].sortOrder)
  })

  it('returns VALIDATION_ERROR for empty name', async () => {
    const result = await createFolder(db, { name: '' })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = await createFolder(db, { unexpected: true })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('listFolders', () => {
  it('returns empty array when no folders exist', async () => {
    const result = await listFolders(db)
    expect((result as { data: unknown[] }).data).toEqual([])
  })

  it('returns folders ordered by sort_order', async () => {
    await createFolder(db, { name: 'First' })
    await createFolder(db, { name: 'Second' })
    const result = await listFolders(db)
    const folders = (result as { data: { name: string }[] }).data
    expect(folders[0].name).toBe('First')
    expect(folders[1].name).toBe('Second')
  })

  it('includes id, name, sortOrder, createdAt fields', async () => {
    await createFolder(db, { name: 'Test' })
    const result = await listFolders(db)
    const [f] = (result as { data: Record<string, unknown>[] }).data
    expect(f).toHaveProperty('id')
    expect(f).toHaveProperty('name')
    expect(f).toHaveProperty('sortOrder')
    expect(f).toHaveProperty('createdAt')
  })
})

describe('renameFolder', () => {
  it('renames an existing folder', async () => {
    const createResult = await createFolder(db, { name: 'Old Name' })
    const { id } = (createResult as { data: { id: string } }).data
    await renameFolder(db, { id, name: 'New Name' })
    const listResult = await listFolders(db)
    const folders = (listResult as { data: { name: string }[] }).data
    expect(folders[0].name).toBe('New Name')
  })

  it('returns FOLDER_NOT_FOUND for unknown id', async () => {
    const result = await renameFolder(db, { id: 'nonexistent', name: 'X' })
    expect(result).toEqual({ error: 'FOLDER_NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for missing name', async () => {
    const result = await renameFolder(db, { id: 'abc' })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('deleteFolder', () => {
  it('deletes a folder and nullifies folder_id on notes', async () => {
    const folderResult = await createFolder(db, { name: 'To Delete' })
    const { id: folderId } = (folderResult as { data: { id: string } }).data

    const noteResult = await createNote(db, { title: 'Note in folder' })
    const { id: noteId } = (noteResult as { data: { id: string } }).data
    await db.run('UPDATE notes SET folder_id=? WHERE id=?', [folderId, noteId])

    await deleteFolder(db, { id: folderId })

    const listResult = await listFolders(db)
    expect((listResult as { data: unknown[] }).data).toHaveLength(0)

    const noteRow = await db.get<{ folder_id: string | null }>(
      'SELECT folder_id FROM notes WHERE id=?',
      [noteId]
    )
    expect(noteRow?.folder_id).toBeNull()
  })

  it('deletes a folder and nullifies folder_id on diagrams', async () => {
    const folderResult = await createFolder(db, { name: 'Diagram folder' })
    const { id: folderId } = (folderResult as { data: { id: string } }).data

    const diagramResult = await createDiagram(db, { title: 'Diagram in folder' })
    const { id: diagramId } = (diagramResult as { data: { id: string } }).data
    await db.run('UPDATE diagrams SET folder_id=? WHERE id=?', [folderId, diagramId])

    await deleteFolder(db, { id: folderId })

    const diagramRow = await db.get<{ folder_id: string | null }>(
      'SELECT folder_id FROM diagrams WHERE id=?',
      [diagramId]
    )
    expect(diagramRow?.folder_id).toBeNull()
  })

  it('returns FOLDER_NOT_FOUND for unknown id', async () => {
    const result = await deleteFolder(db, { id: 'nonexistent' })
    expect(result).toEqual({ error: 'FOLDER_NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = await deleteFolder(db, {})
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('moveItemsToFolder', () => {
  it('moves a note into a folder', async () => {
    const folderResult = await createFolder(db, { name: 'Target' })
    const { id: folderId } = (folderResult as { data: { id: string } }).data

    const noteResult = await createNote(db, { title: 'My note' })
    const { id: noteId } = (noteResult as { data: { id: string } }).data

    await moveItemsToFolder(db, { items: [{ id: noteId, type: 'note' }], folderId })

    const row = await db.get<{ folder_id: string }>('SELECT folder_id FROM notes WHERE id=?', [
      noteId,
    ])
    expect(row?.folder_id).toBe(folderId)
  })

  it('moves a diagram into a folder', async () => {
    const folderResult = await createFolder(db, { name: 'Diagrams folder' })
    const { id: folderId } = (folderResult as { data: { id: string } }).data

    const diagramResult = await createDiagram(db, { title: 'Flow' })
    const { id: diagramId } = (diagramResult as { data: { id: string } }).data

    await moveItemsToFolder(db, { items: [{ id: diagramId, type: 'diagram' }], folderId })

    const row = await db.get<{ folder_id: string }>('SELECT folder_id FROM diagrams WHERE id=?', [
      diagramId,
    ])
    expect(row?.folder_id).toBe(folderId)
  })

  it('removes an item from a folder by passing folderId: null', async () => {
    const folderResult = await createFolder(db, { name: 'Temp' })
    const { id: folderId } = (folderResult as { data: { id: string } }).data

    const noteResult = await createNote(db, { title: 'Note' })
    const { id: noteId } = (noteResult as { data: { id: string } }).data
    await db.run('UPDATE notes SET folder_id=? WHERE id=?', [folderId, noteId])

    await moveItemsToFolder(db, { items: [{ id: noteId, type: 'note' }], folderId: null })

    const row = await db.get<{ folder_id: string | null }>(
      'SELECT folder_id FROM notes WHERE id=?',
      [noteId]
    )
    expect(row?.folder_id).toBeNull()
  })

  it('returns FOLDER_NOT_FOUND when target folder does not exist', async () => {
    const noteResult = await createNote(db, { title: 'Note' })
    const { id: noteId } = (noteResult as { data: { id: string } }).data
    const result = await moveItemsToFolder(db, {
      items: [{ id: noteId, type: 'note' }],
      folderId: 'bad-id',
    })
    expect(result).toEqual({ error: 'FOLDER_NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const result = await moveItemsToFolder(db, { items: 'not-an-array', folderId: null })
    expect(result).toEqual({ error: 'VALIDATION_ERROR' })
  })
})

describe('registerFoldersIpcHandlers', () => {
  it('registers and returns a cleanup function', () => {
    const cleanup = registerFoldersIpcHandlers(db)
    expect(typeof cleanup).toBe('function')
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:folders.create',
      expect.any(Function)
    )
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:folders.list',
      expect.any(Function)
    )
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:folders.rename',
      expect.any(Function)
    )
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:folders.delete',
      expect.any(Function)
    )
    expect(ipcMain.handle).toHaveBeenCalledWith(
      'terminator.notepad:folders.move',
      expect.any(Function)
    )
    cleanup()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('terminator.notepad:folders.create')
  })
})
