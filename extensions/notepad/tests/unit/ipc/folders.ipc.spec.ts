import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

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
import type { ExtensionDB } from '@terminator/extension-sdk'

let db: ExtensionDB

beforeEach(async () => {
  db = wrapDb(new DatabaseSync(':memory:'))
  await applyNotepadSchema(db)
})

/** Invokes the handler registered for a folders channel, as the renderer would. */
function invokeFolders(action: string, payload?: unknown): Promise<unknown> {
  const handler = (ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
    ([c]) => c === `terminator.notepad:folders.${action}`
  )![1] as (e: unknown, payload?: unknown) => Promise<unknown>
  return handler({}, payload)
}

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
})

describe('deleteFolder', deleteFolderTests)
describe('moveItemsToFolder', moveItemsToFolderTests)
describe('registerFoldersIpcHandlers', registerFoldersIpcHandlersTests)

function deleteFolderTests() {
  describe('notes', deleteFolderNotesTests)
  describe('diagrams and unknown folders', deleteFolderDiagramsUnknownFoldersTests)
}

function deleteFolderNotesTests() {
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
}

function deleteFolderDiagramsUnknownFoldersTests() {
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
}

function moveItemsToFolderTests() {
  describe('notes', moveItemsToFolderNotesTests)
  describe('diagrams', moveItemsToFolderDiagramsTests)
  describe('moving out', moveItemsToFolderMovingOutTests)
}

function moveItemsToFolderNotesTests() {
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
}

function moveItemsToFolderDiagramsTests() {
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
}

function moveItemsToFolderMovingOutTests() {
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
}

function registerFoldersIpcHandlersTests() {
  it('dispatches registered handlers to the folder functions', async () => {
    ;(ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mockClear()
    const cleanup = registerFoldersIpcHandlers(mockApi, db)
    const created = (await invokeFolders('create', { name: 'Inbox' })) as { data: { id: string } }
    expect(created.data.id).toBeTruthy()
    const id = created.data.id
    const listed = (await invokeFolders('list')) as { data: unknown[] }
    expect(listed.data).toHaveLength(1)
    expect(await invokeFolders('rename', { id, name: 'Later' })).toHaveProperty('data')
    expect(await invokeFolders('move', { items: 'not-an-array', folderId: id })).toEqual({
      error: 'VALIDATION_ERROR',
    })
    expect(await invokeFolders('delete', { id })).toHaveProperty('data')
    cleanup()
  })

  it('registers and returns a cleanup function', () => {
    const cleanup = registerFoldersIpcHandlers(mockApi, db)
    expect(typeof cleanup).toBe('function')
    for (const action of ['create', 'list', 'rename', 'delete', 'move']) {
      expect(ipcMain.handle).toHaveBeenCalledWith(
        `terminator.notepad:folders.${action}`,
        expect.any(Function)
      )
    }
    cleanup()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('terminator.notepad:folders.create')
  })
}
