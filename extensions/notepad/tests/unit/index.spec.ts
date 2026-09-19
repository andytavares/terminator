import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    commands: { register: vi.fn(() => ({ dispose: vi.fn() })) },
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

  it('registers no OS-global shortcuts at all — nothing here needs to fire while backgrounded', async () => {
    const { api, register } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    expect(register).not.toHaveBeenCalled()
  })

  it('exposes New Note as a focused-only View menu accelerator', async () => {
    const { api } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    const addItem = api.nativeMenu.addViewMenuItem as unknown as ReturnType<typeof vi.fn>
    const item = addItem.mock.calls.map((c) => c[0]).find((i) => i.id === 'notepad-new-note')
    expect(item?.accelerator).toBe('CmdOrCtrl+Shift+N')
  })

  it('New Note activates the notepad tab so it works before the view is mounted', async () => {
    const { api } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    const addItem = api.nativeMenu.addViewMenuItem as unknown as ReturnType<typeof vi.fn>
    const item = addItem.mock.calls.map((c) => c[0]).find((i) => i.id === 'notepad-new-note')
    item?.onClick()

    const channels = (api.window.broadcast as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0]
    )
    expect(channels).toContain('terminator.notepad:ui.openQuickCreate')
    expect(channels).toContain('extension:activate-global-tab')
  })
})

describe('notepad manifest quick action', () => {
  it('declares a Notes group and a mnemonic on the quick-create command', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../manifest.json'), 'utf-8')) as {
      contributes: {
        quickActions?: { group?: { mnemonic?: string; label?: string } }
        commands?: { id: string; mnemonic?: string; shortcut?: string; label?: string }[]
      }
    }

    expect(manifest.contributes.quickActions?.group).toEqual({ mnemonic: 'n', label: 'Notes' })

    const command = manifest.contributes.commands?.find((c) => c.id === 'notepad:quick-create')
    expect(command?.mnemonic).toBe('n')
    expect(command?.shortcut).toBe('⌘⇧N')
    expect(command?.label).toBe('New note')
  })
})

describe('notepad activate() quick-actions command registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the manifest command id with its label and mnemonic', async () => {
    const { api } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    const commandsRegister = api.commands.register as unknown as ReturnType<typeof vi.fn>
    expect(commandsRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'notepad:quick-create',
        label: 'New note',
        mnemonic: 'n',
        shortcut: '⌘⇧N',
        category: 'Notes',
      }),
      expect.any(Function)
    )
  })

  it('running the registered command does what the View-menu item does', async () => {
    const { api } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    const commandsRegister = api.commands.register as unknown as ReturnType<typeof vi.fn>
    const handler = commandsRegister.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'notepad:quick-create'
    )?.[1] as (ctx: unknown) => void
    handler({ projectId: null, sessionId: null, repoRoot: null })

    const channels = (api.window.broadcast as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0]
    )
    expect(channels).toContain('terminator.notepad:ui.openQuickCreate')
    expect(channels).toContain('extension:activate-global-tab')
  })

  it('deactivate disposes the registered command', async () => {
    const { api } = makeApi()
    const { activate, deactivate } = await import('../../src/index.ts')

    await activate(api)

    const commandsRegister = api.commands.register as unknown as ReturnType<typeof vi.fn>
    const disposable = commandsRegister.mock.results[0]?.value as {
      dispose: ReturnType<typeof vi.fn>
    }

    deactivate()

    expect(disposable.dispose).toHaveBeenCalled()
  })
})
