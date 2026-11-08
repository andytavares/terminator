import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { partialFake } from '../../../../tests/support/fakes'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

vi.mock('../../src/db/db', () => ({
  applyNotepadSchema: vi.fn().mockResolvedValue(undefined),
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
  const register = vi.fn<ExtensionAPI['globalShortcut']['register']>(async () => ({
    dispose: vi.fn(),
  }))
  const api = partialFake<ExtensionAPI>({
    db: partialFake<ExtensionAPI['db']>({}),
    ipc: partialFake<ExtensionAPI['ipc']>({ registerHandler: vi.fn(() => ({ dispose: vi.fn() })) }),
    settings: partialFake<ExtensionAPI['settings']>({
      register: vi.fn(() => ({ dispose: vi.fn() })),
    }),
    window: partialFake<ExtensionAPI['window']>({ broadcast: vi.fn(), openAuxiliary: vi.fn() }),
    notifications: partialFake<ExtensionAPI['notifications']>({ showToast: vi.fn() }),
    nativeMenu: partialFake<ExtensionAPI['nativeMenu']>({
      addViewMenuItem: vi.fn(() => ({ dispose: vi.fn() })),
    }),
    globalShortcut: partialFake<ExtensionAPI['globalShortcut']>({ register }),
    commands: partialFake<ExtensionAPI['commands']>({
      register: vi.fn(() => ({ dispose: vi.fn() })),
    }),
  })
  return { api, register }
}

describe(
  'notepad activate() global shortcut registrations',
  notepadActivateGlobalShortcutRegistrationsTests
)

describe(
  'notepad activate() quick-actions command registration',
  notepadActivateQuickActionsCommandTests
)

function notepadActivateGlobalShortcutRegistrationsTests() {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('global shortcuts', notepadActivateGlobalShortcutRegistrationsGlobalShortcutsTests)
  describe('View menu', notepadActivateGlobalShortcutRegistrationsViewMenuTests)
}

function notepadActivateGlobalShortcutRegistrationsGlobalShortcutsTests() {
  it('registers no OS-global shortcuts at all — nothing here needs to fire while backgrounded', async () => {
    const { api, register } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    expect(register).not.toHaveBeenCalled()
  })
}

function notepadActivateGlobalShortcutRegistrationsViewMenuTests() {
  it('exposes New Note as a focused-only View menu accelerator', async () => {
    const { api } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    const addItem = vi.mocked(api.nativeMenu.addViewMenuItem)
    const item = addItem.mock.calls.map((c) => c[0]).find((i) => i.id === 'notepad-new-note')
    expect(item?.accelerator).toBe('CmdOrCtrl+Shift+N')
  })

  it('New Note activates the notepad tab so it works before the view is mounted', async () => {
    const { api } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    const addItem = vi.mocked(api.nativeMenu.addViewMenuItem)
    const item = addItem.mock.calls.map((c) => c[0]).find((i) => i.id === 'notepad-new-note')
    item?.onClick()

    const channels = vi.mocked(api.window.broadcast).mock.calls.map((c) => c[0])
    expect(channels).toContain('terminator.notepad:ui.openQuickCreate')
    expect(channels).toContain('extension:activate-global-tab')
  })
}

function notepadActivateQuickActionsCommandTests() {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('registration', notepadActivateQuickActionsCommandRegistrationTests)
  describe('running', notepadActivateQuickActionsCommandRunningTests)
  describe('disposal', notepadActivateQuickActionsCommandDisposalTests)
}

function notepadActivateQuickActionsCommandRegistrationTests() {
  it('registers the manifest quick-create command under the manifest quick-action group', async () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../manifest.json'), 'utf-8')) as {
      contributes: {
        quickActions: { group: { label: string } }
        commands: { id: string }[]
      }
    }
    const declared = manifest.contributes.commands.find((c) => c.id === 'notepad:quick-create')
    const { api } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    const registered = vi
      .mocked(api.commands.register)
      .mock.calls.map((c) => c[0])
      .find((c) => c.id === 'notepad:quick-create')
    expect(declared).toBeDefined()
    expect(registered).toMatchObject({
      ...declared,
      category: manifest.contributes.quickActions.group.label,
    })
  })
}

function notepadActivateQuickActionsCommandRunningTests() {
  it('running the registered command does what the View-menu item does', async () => {
    const { api } = makeApi()
    const { activate } = await import('../../src/index.ts')

    await activate(api)

    const commandsRegister = vi.mocked(api.commands.register)
    const handler = commandsRegister.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'notepad:quick-create'
    )?.[1] as (ctx: unknown) => void
    handler({ projectId: null, sessionId: null, repoRoot: null })

    const channels = vi.mocked(api.window.broadcast).mock.calls.map((c) => c[0])
    expect(channels).toContain('terminator.notepad:ui.openQuickCreate')
    expect(channels).toContain('extension:activate-global-tab')
  })
}

function notepadActivateQuickActionsCommandDisposalTests() {
  it('deactivate disposes the registered command', async () => {
    const { api } = makeApi()
    const { activate, deactivate } = await import('../../src/index.ts')

    await activate(api)

    const commandsRegister = vi.mocked(api.commands.register)
    const disposable = commandsRegister.mock.results[0]?.value as {
      dispose: ReturnType<typeof vi.fn>
    }

    deactivate()

    expect(disposable.dispose).toHaveBeenCalled()
  })
}
