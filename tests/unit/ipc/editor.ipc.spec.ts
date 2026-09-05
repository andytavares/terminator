import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.fn()
const detectEditor = vi.fn()
const openInEditor = vi.fn()
const getGlobalSettings = vi.fn()

vi.mock('electron', () => ({ ipcMain: { handle: mockHandle } }))
vi.mock('../../../src/main/editor/open-in-editor.js', () => ({
  detectEditor: (...a: unknown[]) => detectEditor(...a),
  openInEditor: (...a: unknown[]) => openInEditor(...a),
}))
vi.mock('../../../src/main/storage/settings-store.js', () => ({
  getGlobalSettings: () => getGlobalSettings(),
}))

function handlerFor(channel: string): (event: unknown, payload?: unknown) => unknown {
  const match = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No handler registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  getGlobalSettings.mockReturnValue({ ui: { hasSeenWelcome: true, editor: '' } })
  detectEditor.mockResolvedValue({ id: 'cursor', name: 'Cursor' })
  openInEditor.mockResolvedValue({ ok: true, editor: 'Cursor' })
  const { registerEditorHandlers } = await import('../../../src/main/ipc/editor.ipc.js')
  registerEditorHandlers()
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
    getGlobalSettings.mockReturnValue({ ui: { hasSeenWelcome: true, editor: 'sublime' } })
    await handlerFor('editor:detect')({})
    expect(detectEditor).toHaveBeenCalledWith('sublime')
  })

  it('treats an empty setting as "detect" rather than as an editor named ""', async () => {
    await handlerFor('editor:detect')({})
    expect(detectEditor).toHaveBeenCalledWith(undefined)
  })

  it('still answers when settings cannot be read', async () => {
    getGlobalSettings.mockImplementation(() => {
      throw new Error('store unavailable')
    })
    expect(await handlerFor('editor:detect')({})).toEqual({
      editor: { id: 'cursor', name: 'Cursor' },
    })
  })
})

describe('editor:open', () => {
  it('opens the folder it is given', async () => {
    const result = await handlerFor('editor:open')({}, { folderPath: '/repos/app' })
    expect(openInEditor).toHaveBeenCalledWith('/repos/app', undefined)
    expect(result).toEqual({ ok: true, editor: 'Cursor' })
  })

  it('uses the configured editor when one is set', async () => {
    getGlobalSettings.mockReturnValue({ ui: { hasSeenWelcome: true, editor: 'zed' } })
    await handlerFor('editor:open')({}, { folderPath: '/repos/app' })
    expect(openInEditor).toHaveBeenCalledWith('/repos/app', 'zed')
  })

  // The renderer sends a folder and nothing else. It never names a command —
  // a channel that took one would be a way to run anything.
  it.each([
    ['no payload', undefined],
    ['an empty path', { folderPath: '' }],
    ['a missing path', {}],
    ['a non-string path', { folderPath: 42 }],
    ['a command instead of a path', { command: 'rm', args: ['-rf', '/'] }],
  ])('rejects %s without launching anything', async (_name, payload) => {
    expect(await handlerFor('editor:open')({}, payload)).toEqual({ error: 'VALIDATION_ERROR' })
    expect(openInEditor).not.toHaveBeenCalled()
  })

  it('passes a launch failure back rather than throwing', async () => {
    openInEditor.mockResolvedValue({ error: 'NO_EDITOR_FOUND' })
    expect(await handlerFor('editor:open')({}, { folderPath: '/repos/app' })).toEqual({
      error: 'NO_EDITOR_FOUND',
    })
  })
})
