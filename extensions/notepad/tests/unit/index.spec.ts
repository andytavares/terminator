import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionAPI } from '../../../../src/main/extensions/api'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

vi.mock('../../src/db/db', () => ({
  applyNotepadSchema: vi.fn().mockResolvedValue(undefined),
  applyNotepadMigrations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/ipc/notes.ipc', () => ({
  registerNotesIpcHandlers: vi.fn(() => vi.fn()),
  registerTagsIpcHandlers: vi.fn(() => vi.fn()),
}))
vi.mock('../../src/ipc/comments.ipc', () => ({
  registerCommentsIpcHandlers: vi.fn(() => vi.fn()),
}))
vi.mock('../../src/ipc/search.ipc', () => ({
  registerSearchIpcHandlers: vi.fn(() => vi.fn()),
}))
vi.mock('../../src/ipc/export.ipc', () => ({
  registerExportIpcHandlers: vi.fn(() => vi.fn()),
}))
vi.mock('../../src/ipc/diagrams.ipc', () => ({
  registerDiagramsIpcHandlers: vi.fn(() => vi.fn()),
}))
vi.mock('../../src/ipc/diagram-comments.ipc', () => ({
  registerDiagramCommentsIpcHandlers: vi.fn(() => vi.fn()),
}))
vi.mock('../../src/ipc/folders.ipc', () => ({
  registerFoldersIpcHandlers: vi.fn(() => vi.fn()),
}))

function makeApi() {
  const register = vi.fn(() => ({ dispose: vi.fn() }))
  const api = {
    db: {},
    ipc: { registerHandler: vi.fn(() => ({ dispose: vi.fn() })) },
    settings: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    window: { broadcast: vi.fn(), openAuxiliary: vi.fn() },
    notifications: { showToast: vi.fn() },
    nativeMenu: { addViewMenuItem: vi.fn(() => ({ dispose: vi.fn() })) },
    globalShortcut: { register },
  } as unknown as ExtensionAPI
  return { api, register }
}

describe('notepad activate() global shortcut registrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not claim Cmd+Shift+F as an OS-level global shortcut', async () => {
    const { api, register } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    const accelerators = register.mock.calls.map((c) => c[0])
    expect(accelerators).not.toContain('CommandOrControl+Shift+F')
  })

  it('still registers only the shortcuts that must work while backgrounded', async () => {
    const { api, register } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    const accelerators = register.mock.calls.map((c) => c[0])
    expect(accelerators).toEqual(['CommandOrControl+Shift+N', 'CommandOrControl+Alt+M'])
  })
})
