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
vi.mock('../../../../src/renderer/stores/toast.store', () => ({
  useToastStore: vi.fn(() => ({ addToast: vi.fn() })),
}))

const mockSetActiveWorkspace = vi.fn()
const mockGetActiveSessionForProject = vi.fn().mockReturnValue(null)
const mockSetActiveSessionForProject = vi.fn()
const mockGetSessionsForProject = vi.fn().mockReturnValue([])
const mockCreateSession = vi.fn().mockResolvedValue('session-id')
const mockSplitSession = vi.fn().mockResolvedValue(undefined)
const mockGetPaneLayout = vi.fn().mockReturnValue(null)
const mockGetFocusedSession = vi.fn().mockReturnValue(null)
const mockCloseSplitLeaf = vi.fn()
const mockCloseSession = vi.fn().mockResolvedValue(undefined)
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
    resolveActiveCwd: vi.fn().mockReturnValue('/workspace/path'),
    setExpandedWorkspaceIds: vi.fn(),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useSessionStore).mockReturnValue({
    getActiveSessionForProject: mockGetActiveSessionForProject,
    setActiveSessionForProject: mockSetActiveSessionForProject,
    getSessionsForProject: mockGetSessionsForProject,
    getPaneLayout: mockGetPaneLayout,
    getFocusedSession: mockGetFocusedSession,
    closeSplitLeaf: mockCloseSplitLeaf,
    closeSession: mockCloseSession,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useSettingsStore).mockReturnValue({
    resolveSettings: mockResolveSettings,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useExtensionRegistry).mockReturnValue({
    keyboardShortcuts: [],
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useTerminalSession).mockReturnValue({
    createSession: mockCreateSession,
    splitSession: mockSplitSession,
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

  it('calls onOpenCommandPalette when Cmd+P is pressed', async () => {
    const useKeyboardShortcuts = await importHook()
    const onOpenCommandPalette = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onOpenCommandPalette }))
    pressKey('p', { metaKey: true })
    expect(onOpenCommandPalette).toHaveBeenCalled()
  })

  it('sends clear escape to active terminal on Cmd+K when project and session active', async () => {
    const mockTerminalInput = vi.fn()
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { input: mockTerminalInput },
    }
    mockGetActiveSessionForProject.mockReturnValue('session-1')
    setupMocks({ activeProjectId: 'proj-1', activeWorkspaceId: 'ws-1' })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('k', { metaKey: true })
    expect(mockTerminalInput).toHaveBeenCalledWith('session-1', '\x0c')
    delete (globalThis as unknown as Record<string, unknown>).electronAPI
  })

  it('does nothing on Cmd+K when no active project', async () => {
    const mockTerminalInput = vi.fn()
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      terminal: { input: mockTerminalInput },
    }
    setupMocks({ activeProjectId: null })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('k', { metaKey: true })
    expect(mockTerminalInput).not.toHaveBeenCalled()
    delete (globalThis as unknown as Record<string, unknown>).electronAPI
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

  it('calls onToggleOverview when Cmd+Shift+I is pressed', async () => {
    const useKeyboardShortcuts = await importHook()
    const onToggleOverview = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onToggleOverview }))
    pressKey('i', { metaKey: true, shiftKey: true })
    expect(onToggleOverview).toHaveBeenCalled()
  })

  it('calls onNewScratch when Cmd+Shift+T is pressed', async () => {
    const useKeyboardShortcuts = await importHook()
    const onNewScratch = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onNewScratch }))
    pressKey('t', { metaKey: true, shiftKey: true })
    expect(onNewScratch).toHaveBeenCalled()
  })

  it('Cmd+= also calls setExpandedWorkspaceIds on the cycled workspace', async () => {
    const mockSetExpanded = vi.fn()
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [workspace1, workspace2],
      activeWorkspaceId: 'ws-1',
      setActiveWorkspace: mockSetActiveWorkspace,
      activeProjectId: null,
      resolveActiveCwd: vi.fn().mockReturnValue('/workspace/path'),
      setExpandedWorkspaceIds: mockSetExpanded,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('=', { metaKey: true })
    expect(mockSetExpanded).toHaveBeenCalledWith(new Set(['ws-2']))
  })

  it('cycleWorkspace does nothing when workspaces list is empty', async () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [],
      activeWorkspaceId: null,
      setActiveWorkspace: mockSetActiveWorkspace,
      activeProjectId: null,
      resolveActiveCwd: vi.fn().mockReturnValue('/'),
      setExpandedWorkspaceIds: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('=', { metaKey: true })
    expect(mockSetActiveWorkspace).not.toHaveBeenCalled()
  })

  it('Cmd+D does not crash when splitSession rejects', async () => {
    mockSplitSession.mockRejectedValueOnce(new Error('split failed'))
    setupMocks({ activeProjectId: 'proj-1' })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    // Should not throw — the .catch handler swallows and calls addToast
    pressKey('d', { metaKey: true })
    await new Promise((r) => setTimeout(r, 10))
    expect(mockSplitSession).toHaveBeenCalled()
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

  it('suppresses bare-key extension shortcut when pressed inside an input', async () => {
    const shortcutAction = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      keyboardShortcuts: [{ accelerator: '1', action: shortcutAction }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    vi.mocked(matchesAccelerator).mockReturnValue(true)
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())

    const input = document.createElement('input')
    document.body.appendChild(input)
    const event = new KeyboardEvent('keydown', { key: '1', bubbles: true })
    input.dispatchEvent(event)
    document.body.removeChild(input)

    expect(shortcutAction).not.toHaveBeenCalled()
  })

  it('fires bare-key extension shortcut when pressed outside an input', async () => {
    const shortcutAction = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      keyboardShortcuts: [{ accelerator: '1', action: shortcutAction }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    vi.mocked(matchesAccelerator).mockReturnValue(true)
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('1')
    expect(shortcutAction).toHaveBeenCalled()
  })

  it('fires modifier+key extension shortcut even when pressed inside an input', async () => {
    const shortcutAction = vi.fn()
    vi.mocked(useExtensionRegistry).mockReturnValue({
      keyboardShortcuts: [{ accelerator: 'CmdOrCtrl+1', action: shortcutAction }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    vi.mocked(matchesAccelerator).mockReturnValue(true)
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())

    const input = document.createElement('input')
    document.body.appendChild(input)
    const event = new KeyboardEvent('keydown', { key: '1', bubbles: true, metaKey: true })
    input.dispatchEvent(event)
    document.body.removeChild(input)

    expect(shortcutAction).toHaveBeenCalled()
  })

  it('Cmd+D splits vertically when activeProjectId is set', async () => {
    setupMocks({ activeProjectId: 'proj-1' })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('d', { metaKey: true })
    expect(mockSplitSession).toHaveBeenCalledWith('proj-1', 'vertical', expect.any(String), 5000)
  })

  it('Cmd+D does nothing when no activeProjectId', async () => {
    setupMocks({ activeProjectId: null })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('d', { metaKey: true })
    expect(mockSplitSession).not.toHaveBeenCalled()
  })

  it('Cmd+Shift+D splits horizontally when activeProjectId is set', async () => {
    setupMocks({ activeProjectId: 'proj-1' })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('d', { metaKey: true, shiftKey: true })
    expect(mockSplitSession).toHaveBeenCalledWith('proj-1', 'horizontal', expect.any(String), 5000)
  })

  it('Cmd+W closes focused split pane when in split mode', async () => {
    mockGetPaneLayout.mockReturnValue({ type: 'split' })
    mockGetFocusedSession.mockReturnValue('ses-focused')
    mockGetActiveSessionForProject.mockReturnValue('ses-focused')
    setupMocks({ activeProjectId: 'proj-1' })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('w', { metaKey: true })
    expect(mockCloseSplitLeaf).toHaveBeenCalledWith('proj-1', 'ses-focused')
    expect(mockCloseSession).toHaveBeenCalledWith('ses-focused')
  })

  it('Cmd+W closes active tab when not in split mode', async () => {
    mockGetPaneLayout.mockReturnValue(null)
    mockGetActiveSessionForProject.mockReturnValue('ses-active')
    setupMocks({ activeProjectId: 'proj-1' })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('w', { metaKey: true })
    expect(mockCloseSession).toHaveBeenCalledWith('ses-active')
  })

  it('Cmd+W does nothing when no activeProjectId', async () => {
    setupMocks({ activeProjectId: null })
    const useKeyboardShortcuts = await importHook()
    renderHook(() => useKeyboardShortcuts())
    pressKey('w', { metaKey: true })
    expect(mockCloseSession).not.toHaveBeenCalled()
  })

  describe('scratch mode — scratchProjectId overrides activeProjectId', () => {
    const SCRATCH_ID = '00000000-0000-0000-0000-000000000000'

    it('Cmd+K clears scratch session when scratchProjectId is set and activeProjectId is null', async () => {
      const mockTerminalInput = vi.fn()
      ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
        terminal: { input: mockTerminalInput },
      }
      mockGetActiveSessionForProject.mockReturnValue('scratch-ses-1')
      setupMocks({ activeProjectId: null })
      const useKeyboardShortcuts = await importHook()
      renderHook(() => useKeyboardShortcuts({ scratchProjectId: SCRATCH_ID }))
      pressKey('k', { metaKey: true })
      expect(mockGetActiveSessionForProject).toHaveBeenCalledWith(SCRATCH_ID)
      expect(mockTerminalInput).toHaveBeenCalledWith('scratch-ses-1', '\x0c')
      delete (globalThis as unknown as Record<string, unknown>).electronAPI
    })

    it('Cmd+T creates scratch session when scratchProjectId is set and activeProjectId is null', async () => {
      setupMocks({ activeProjectId: null })
      const useKeyboardShortcuts = await importHook()
      renderHook(() => useKeyboardShortcuts({ scratchProjectId: SCRATCH_ID }))
      pressKey('t', { metaKey: true })
      expect(mockCreateSession).toHaveBeenCalledWith(
        SCRATCH_ID,
        'human',
        'Terminal',
        expect.any(String),
        5000
      )
    })

    it('Cmd+D does nothing when scratchProjectId is set but activeProjectId is null', async () => {
      setupMocks({ activeProjectId: null })
      const useKeyboardShortcuts = await importHook()
      renderHook(() => useKeyboardShortcuts({ scratchProjectId: SCRATCH_ID }))
      pressKey('d', { metaKey: true })
      expect(mockSplitSession).not.toHaveBeenCalled()
    })

    it('Cmd+W closes scratch tab when scratchProjectId is set', async () => {
      mockGetPaneLayout.mockReturnValue(null)
      mockGetActiveSessionForProject.mockReturnValue('scratch-ses-1')
      setupMocks({ activeProjectId: null })
      const useKeyboardShortcuts = await importHook()
      renderHook(() => useKeyboardShortcuts({ scratchProjectId: SCRATCH_ID }))
      pressKey('w', { metaKey: true })
      expect(mockCloseSession).toHaveBeenCalledWith('scratch-ses-1')
    })

    it('Cmd+ArrowRight cycles scratch tabs when scratchProjectId is set', async () => {
      const sessions = [{ id: 'ss1' }, { id: 'ss2' }]
      mockGetSessionsForProject.mockReturnValue(sessions)
      mockGetActiveSessionForProject.mockReturnValue('ss1')
      setupMocks({ activeProjectId: null })
      const useKeyboardShortcuts = await importHook()
      renderHook(() => useKeyboardShortcuts({ scratchProjectId: SCRATCH_ID }))
      pressKey('ArrowRight', { metaKey: true })
      expect(mockSetActiveSessionForProject).toHaveBeenCalledWith(SCRATCH_ID, 'ss2')
    })

    it('regular project shortcuts still work when both activeProjectId and scratchProjectId are null', async () => {
      setupMocks({ activeProjectId: null })
      const useKeyboardShortcuts = await importHook()
      renderHook(() => useKeyboardShortcuts({ scratchProjectId: null }))
      pressKey('t', { metaKey: true })
      expect(mockCreateSession).not.toHaveBeenCalled()
    })
  })
})
