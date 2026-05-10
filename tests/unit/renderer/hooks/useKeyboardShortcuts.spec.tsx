import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useTerminalSession } from '../../../../src/renderer/hooks/useTerminalSession'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({ useWorkspaceStore: vi.fn() }))
vi.mock('../../../../src/renderer/stores/session.store', () => ({ useSessionStore: vi.fn() }))
vi.mock('../../../../src/renderer/stores/settings.store', () => ({ useSettingsStore: vi.fn() }))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: vi.fn(),
  matchesAccelerator: vi.fn(),
}))
vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: vi.fn(),
}))

const mockSetActiveWorkspace = vi.fn()
const mockGetActiveSessionForProject = vi.fn().mockReturnValue(null)
const mockSetActiveSessionForProject = vi.fn()
const mockGetSessionsForProject = vi.fn().mockReturnValue([])
const mockCreateSession = vi.fn().mockResolvedValue('session-id')
const mockResolveSettings = vi.fn().mockReturnValue({ terminal: { scrollbackLimit: 5000 } })
const { matchesAccelerator } = await import('../../../../src/renderer/extensions/registry')

const workspace1 = { id: 'ws-1', name: 'WS 1', folderPath: '/ws1', color: '#fff', tags: [] }
const workspace2 = { id: 'ws-2', name: 'WS 2', folderPath: '/ws2', color: '#f00', tags: [] }

function setupMocks(
  overrides: {
    activeWorkspaceId?: string | null
    activeProjectId?: string | null
    workspaces?: unknown[]
  } = {}
) {
  vi.mocked(useWorkspaceStore).mockReturnValue({
    workspaces: overrides.workspaces ?? [workspace1, workspace2],
    activeWorkspaceId: overrides.activeWorkspaceId ?? 'ws-1',
    setActiveWorkspace: mockSetActiveWorkspace,
    activeProjectId: overrides.activeProjectId ?? null,
    projectsByWorkspaceId: new Map([
      ['ws-1', [{ id: 'proj-1', name: 'Proj', worktreePath: null }]],
    ]),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useSessionStore).mockReturnValue({
    getActiveSessionForProject: mockGetActiveSessionForProject,
    setActiveSessionForProject: mockSetActiveSessionForProject,
    getSessionsForProject: mockGetSessionsForProject,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useSettingsStore).mockReturnValue({
    resolveSettings: mockResolveSettings,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useExtensionRegistry).mockReturnValue({
    keyboardShortcuts: [],
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useTerminalSession).mockReturnValue({
    createSession: mockCreateSession,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
}

beforeEach(() => {
  vi.clearAllMocks()
  setupMocks()
})

async function importHook() {
  const { useKeyboardShortcuts } = await import(
    '../../../../src/renderer/hooks/useKeyboardShortcuts'
  )
  return useKeyboardShortcuts
}

function pressKey(
  key: string,
  options: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}
) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...options })
  window.dispatchEvent(event)
  return event
}

describe('useKeyboardShortcuts', () => {
  it('calls onOpenSettings when Cmd+, is pressed', async () => {
    const useKeyboardShortcuts = await importHook()
    const onOpenSettings = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onOpenSettings }))
    pressKey(',', { metaKey: true })
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('calls onToggleLog when Cmd+Shift+L is pressed', async () => {
    const useKeyboardShortcuts = await importHook()
    const onToggleLog = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onToggleLog }))
    pressKey('l', { metaKey: true, shiftKey: true })
    expect(onToggleLog).toHaveBeenCalled()
  })

  it('switches to workspace by number when Cmd+1 is pressed', async () => {
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('1', { metaKey: true })
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('switches to second workspace when Cmd+2 is pressed', async () => {
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('2', { metaKey: true })
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('ws-2')
  })

  it('does nothing for out-of-range workspace index', async () => {
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('9', { metaKey: true })
    expect(mockSetActiveWorkspace).not.toHaveBeenCalled()
  })

  it('cycles to next workspace on Cmd+=', async () => {
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('=', { metaKey: true })
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('ws-2')
  })

  it('cycles to previous workspace on Cmd+-', async () => {
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('-', { metaKey: true })
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('ws-2') // wraps around
  })

  it('creates new session on Cmd+T when project is active', async () => {
    setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('t', { metaKey: true })
    expect(mockCreateSession).toHaveBeenCalledWith(
      'proj-1',
      'human',
      'Terminal',
      expect.any(String),
      5000
    )
  })

  it('does not create session on Cmd+T when no active project', async () => {
    setupMocks({ activeProjectId: null })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('t', { metaKey: true })
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('cycles tabs on Cmd+ArrowRight when sessions exist', async () => {
    const sessions = [{ id: 's1' }, { id: 's2' }]
    mockGetSessionsForProject.mockReturnValue(sessions)
    mockGetActiveSessionForProject.mockReturnValue('s1')
    setupMocks({ activeProjectId: 'proj-1' })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('ArrowRight', { metaKey: true })
    expect(mockSetActiveSessionForProject).toHaveBeenCalledWith('proj-1', 's2')
  })

  it('cycles tabs on Cmd+ArrowLeft when sessions exist', async () => {
    const sessions = [{ id: 's1' }, { id: 's2' }]
    mockGetSessionsForProject.mockReturnValue(sessions)
    mockGetActiveSessionForProject.mockReturnValue('s2')
    setupMocks({ activeProjectId: 'proj-1' })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('ArrowLeft', { metaKey: true })
    expect(mockSetActiveSessionForProject).toHaveBeenCalledWith('proj-1', 's1')
  })

  it('removes keydown listener on unmount', async () => {
    const useKeyboardShortcuts = await importHook()
    const onOpenSettings = vi.fn()
    const { unmount } = renderHook(() => useKeyboardShortcuts({ onOpenSettings }))
    unmount()
    pressKey(',', { metaKey: true })
    expect(onOpenSettings).not.toHaveBeenCalled()
  })

  it('calls extension shortcut action when accelerator matches', async () => {
    const shortcutAction = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      keyboardShortcuts: [{ accelerator: 'CmdOrCtrl+Shift+K', action: shortcutAction }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    vi.mocked(matchesAccelerator).mockReturnValue(true)
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('k', { metaKey: true, shiftKey: true })
    expect(shortcutAction).toHaveBeenCalled()
  })
})
