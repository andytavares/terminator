import { describe, it, expect, vi, beforeEach } from 'vitest'
import { corruptStoreFile } from '../../support/stores'

const { mockHandle, detectEditor, openInEditor } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  detectEditor: vi.fn(),
  openInEditor: vi.fn(),
}))

vi.mock('electron', () => ({ ipcMain: { handle: mockHandle } }))
vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)
// Detecting and launching an editor runs programs on the machine; that is the boundary.
vi.mock('../../../src/main/editor/open-in-editor.js', () => ({
  detectEditor: (...a: unknown[]) => detectEditor(...a),
  openInEditor: (...a: unknown[]) => openInEditor(...a),
}))

import { updateGlobalSettings } from '../../../src/main/storage/settings-store.js'
import { registerEditorHandlers } from '../../../src/main/ipc/editor.ipc.js'

registerEditorHandlers()

function handlerFor(channel: string): (event: unknown, payload?: unknown) => unknown {
  const match = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No handler registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

function chooseEditor(editor: string): void {
  updateGlobalSettings({ ui: { editor } })
}

beforeEach(() => {
  detectEditor.mockReset().mockResolvedValue({ id: 'cursor', name: 'Cursor' })
  openInEditor.mockReset().mockResolvedValue({ ok: true, editor: 'Cursor' })
  corruptStoreFile(null)
  chooseEditor('')
})

describe('editor:detect', () => {
  it('reports the editor this machine will use', async () => {
    expect(await handlerFor('editor:detect')({})).toEqual({
      editor: { id: 'cursor', name: 'Cursor' },
    })
  })

  it('reports null when the machine has none it recognises', async () => {
    detectEditor.mockResolvedValue(null)
    expect(await handlerFor('editor:detect')({})).toEqual({ editor: null })
  })

  it('passes the configured editor through', async () => {
    chooseEditor('sublime')
    await handlerFor('editor:detect')({})
    expect(detectEditor).toHaveBeenCalledWith('sublime')
  })

  it('treats an empty setting as "detect" rather than as an editor named ""', async () => {
    await handlerFor('editor:detect')({})
    expect(detectEditor).toHaveBeenCalledWith(undefined)
  })

  it('still answers when the settings file cannot be read', async () => {
    chooseEditor('sublime')
    corruptStoreFile('settings')
    expect(await handlerFor('editor:detect')({})).toEqual({
      editor: { id: 'cursor', name: 'Cursor' },
    })
    expect(detectEditor).toHaveBeenCalledWith(undefined)
  })
})

describe('editor:open', () => {
  it('opens the folder it is given', async () => {
    const result = await handlerFor('editor:open')({}, { folderPath: '/repos/app' })
    expect(openInEditor).toHaveBeenCalledWith('/repos/app', undefined)
    expect(result).toEqual({ ok: true, editor: 'Cursor' })
  })

  it('uses the configured editor when one is set', async () => {
    chooseEditor('zed')
    await handlerFor('editor:open')({}, { folderPath: '/repos/app' })
    expect(openInEditor).toHaveBeenCalledWith('/repos/app', 'zed')
  })

  it('passes a launch failure back rather than throwing', async () => {
    openInEditor.mockResolvedValue({ error: 'NO_EDITOR_FOUND' })
    expect(await handlerFor('editor:open')({}, { folderPath: '/repos/app' })).toEqual({
      error: 'NO_EDITOR_FOUND',
    })
  })
})
