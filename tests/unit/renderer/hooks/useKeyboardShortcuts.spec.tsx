import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useKeyboardShortcuts } from '../../../../src/renderer/hooks/useKeyboardShortcuts'
import type { useTerminalSession } from '../../../../src/renderer/hooks/useTerminalSession'
import { resetStore, terminalSessionOf, workspaceOf } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import { SCRATCH_PROJECT_ID, type TerminalSession } from '../../../../src/shared/types/index'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'

type TerminalSessionApi = ReturnType<typeof useTerminalSession>

// The hook builds an xterm for each terminal it opens, which jsdom cannot run;
// what is asserted is the terminal it asks for.
const terminals = vi.hoisted(() => ({
  createSession: vi.fn(),
  splitSession: vi.fn(),
}))
vi.mock('../../../../src/renderer/hooks/useTerminalSession', () => ({
  useTerminalSession: (): TerminalSessionApi => terminals,
}))

const createSession = vi.mocked<TerminalSessionApi['createSession']>(terminals.createSession)
const splitSession = vi.mocked<TerminalSessionApi['splitSession']>(terminals.splitSession)
const input = vi.fn<ElectronAPI['terminal']['input']>()
const createNotification = vi.fn<ElectronAPI['notifications']['create']>(async () => ({
  id: 'n1',
}))

const workspace1 = workspaceOf({ id: 'ws-1', name: 'WS 1', folderPath: '/ws1' })
const workspace2 = workspaceOf({ id: 'ws-2', name: 'WS 2', folderPath: '/ws2' })

const workspaces = () => useWorkspaceStore.getState()
const sessions = () => useSessionStore.getState()

function setup(
  overrides: { activeProjectId?: string | null; workspaces?: (typeof workspace1)[] } = {}
) {
  resetStore(useWorkspaceStore, {
    workspaces: overrides.workspaces ?? [workspace1, workspace2],
    activeWorkspaceId: 'ws-1',
    activeProjectId: overrides.activeProjectId ?? null,
  })
}

/** Sessions of one project, as tabs in that order, with `active` shown. */
function withTabs(projectId: string, ids: string[], active: string): void {
  const all = new Map(sessions().sessions)
  for (const id of ids) all.set(id, terminalSessionOf({ id, projectId }))
  useSessionStore.setState({ sessions: all })
  sessions().setActiveSessionForProject(projectId, active)
}

beforeEach(() => {
  vi.clearAllMocks()
  createSession.mockResolvedValue('session-id')
  splitSession.mockResolvedValue(undefined)
  resetStore(useSessionStore)
  resetStore(useExtensionRegistry)
  resetStore(useSettingsStore, {
    globalSettings: {
      ...DEFAULT_GLOBAL_SETTINGS,
      terminal: { ...DEFAULT_GLOBAL_SETTINGS.terminal, scrollbackLimit: 5000 },
    },
  })
  setup()
  installElectronApi({
    project: { list: async () => ({ projects: [] }) },
    terminal: { input, close: async () => ({ success: true }) },
    notifications: { create: createNotification },
  })
})

function pressKey(
  key: string,
  options: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {}
) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...options })
  window.dispatchEvent(event)
  return event
}

describe('useKeyboardShortcuts', () => {
  it('calls onOpenSettings when Cmd+, is pressed', () => {
    const onOpenSettings = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onOpenSettings }))
    pressKey(',', { metaKey: true })
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('calls onToggleLog when Cmd+Shift+L is pressed', () => {
    const onToggleLog = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onToggleLog }))
    pressKey('l', { metaKey: true, shiftKey: true })
    expect(onToggleLog).toHaveBeenCalled()
  })

  it('switches to workspace by number when Cmd+2 is pressed, expanding only it', () => {
    renderHook(() => useKeyboardShortcuts())
    pressKey('2', { metaKey: true })
    expect(workspaces().activeWorkspaceId).toBe('ws-2')
    expect(workspaces().expandedWorkspaceIds).toEqual(new Set(['ws-2']))
  })

  it('does nothing for out-of-range workspace index', () => {
    renderHook(() => useKeyboardShortcuts())
    pressKey('9', { metaKey: true })
    expect(workspaces().activeWorkspaceId).toBe('ws-1')
  })

  it('cycles to next workspace on Cmd+=, expanding only it', () => {
    renderHook(() => useKeyboardShortcuts())
    pressKey('=', { metaKey: true })
    expect(workspaces().activeWorkspaceId).toBe('ws-2')
    expect(workspaces().expandedWorkspaceIds).toEqual(new Set(['ws-2']))
  })

  it('cycles to previous workspace on Cmd+-', () => {
    renderHook(() => useKeyboardShortcuts())
    pressKey('-', { metaKey: true })
    expect(workspaces().activeWorkspaceId).toBe('ws-2') // wraps around
  })

  it('cycleWorkspace does nothing when workspaces list is empty', () => {
    resetStore(useWorkspaceStore)
    renderHook(() => useKeyboardShortcuts())
    pressKey('=', { metaKey: true })
    expect(workspaces().activeWorkspaceId).toBeNull()
  })

  it('creates new session on Cmd+T when project is active', () => {
    setup({ activeProjectId: 'proj-1' })
    renderHook(() => useKeyboardShortcuts())
    pressKey('t', { metaKey: true })
    expect(createSession).toHaveBeenCalledWith('proj-1', 'human', 'Terminal', '/ws1', 5000)
  })

  it('does not create session on Cmd+T when no active project', () => {
    renderHook(() => useKeyboardShortcuts())
    pressKey('t', { metaKey: true })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('calls onOpenCommandPalette when Cmd+P is pressed', () => {
    const onOpenCommandPalette = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onOpenCommandPalette }))
    pressKey('p', { metaKey: true })
    expect(onOpenCommandPalette).toHaveBeenCalled()
  })

  it('sends clear escape to active terminal on Cmd+K when project and session active', () => {
    setup({ activeProjectId: 'proj-1' })
    withTabs('proj-1', ['session-1'], 'session-1')
    renderHook(() => useKeyboardShortcuts())
    pressKey('k', { metaKey: true })
    expect(input).toHaveBeenCalledWith('session-1', '\x0c')
  })

  it('does nothing on Cmd+K when no active project', () => {
    withTabs('proj-1', ['session-1'], 'session-1')
    renderHook(() => useKeyboardShortcuts())
    pressKey('k', { metaKey: true })
    expect(input).not.toHaveBeenCalled()
  })

  it('cycles tabs on Cmd+ArrowRight when sessions exist', () => {
    setup({ activeProjectId: 'proj-1' })
    withTabs('proj-1', ['s1', 's2'], 's1')
    renderHook(() => useKeyboardShortcuts())
    pressKey('ArrowRight', { metaKey: true })
    expect(sessions().getActiveSessionForProject('proj-1')).toBe('s2')
  })

  it('cycles tabs on Cmd+ArrowLeft when sessions exist', () => {
    setup({ activeProjectId: 'proj-1' })
    withTabs('proj-1', ['s1', 's2'], 's2')
    renderHook(() => useKeyboardShortcuts())
    pressKey('ArrowLeft', { metaKey: true })
    expect(sessions().getActiveSessionForProject('proj-1')).toBe('s1')
  })

  it('calls onToggleOverview when Cmd+Shift+E is pressed', () => {
    const onToggleOverview = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onToggleOverview }))
    pressKey('e', { metaKey: true, shiftKey: true })
    expect(onToggleOverview).toHaveBeenCalled()
  })

  // Cmd+Shift+I belongs to the "Open Extension DevTools" menu accelerator, which Electron
  // consumes before the renderer sees it — the hook must not also claim it.
  it('does not call onToggleOverview when Cmd+Shift+I is pressed', () => {
    const onToggleOverview = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onToggleOverview }))
    pressKey('i', { metaKey: true, shiftKey: true })
    expect(onToggleOverview).not.toHaveBeenCalled()
  })

  it('calls onNewScratch when Cmd+Shift+T is pressed', () => {
    const onNewScratch = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onNewScratch }))
    pressKey('t', { metaKey: true, shiftKey: true })
    expect(onNewScratch).toHaveBeenCalled()
  })

  it('reports a split that fails on Cmd+D', async () => {
    splitSession.mockRejectedValueOnce(new Error('split failed'))
    setup({ activeProjectId: 'proj-1' })
    renderHook(() => useKeyboardShortcuts())
    pressKey('d', { metaKey: true })
    await waitFor(() =>
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'splitPaneFailed', message: 'split failed' })
      )
    )
  })

  it('removes keydown listener on unmount', () => {
    const onOpenSettings = vi.fn()
    const { unmount } = renderHook(() => useKeyboardShortcuts({ onOpenSettings }))
    unmount()
    pressKey(',', { metaKey: true })
    expect(onOpenSettings).not.toHaveBeenCalled()
  })

  describe('extension shortcuts', () => {
    function registered(accelerator: string) {
      const action = vi.fn()
      useExtensionRegistry.getState().registerKeyboardShortcut({ accelerator, action })
      return action
    }

    function pressIn(field: HTMLElement, key: string, metaKey = false): void {
      document.body.appendChild(field)
      field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, metaKey }))
      field.remove()
    }

    it('calls extension shortcut action when accelerator matches', () => {
      const action = registered('CmdOrCtrl+Shift+K')
      renderHook(() => useKeyboardShortcuts())
      pressKey('k', { metaKey: true, shiftKey: true })
      expect(action).toHaveBeenCalled()
    })

    it('suppresses bare-key extension shortcut when pressed inside an input', () => {
      const action = registered('1')
      renderHook(() => useKeyboardShortcuts())
      pressIn(document.createElement('input'), '1')
      expect(action).not.toHaveBeenCalled()
    })

    it('fires bare-key extension shortcut when pressed outside an input', () => {
      const action = registered('1')
      renderHook(() => useKeyboardShortcuts())
      pressKey('1')
      expect(action).toHaveBeenCalled()
    })

    it('fires modifier+key extension shortcut even when pressed inside an input', () => {
      const action = registered('CmdOrCtrl+1')
      renderHook(() => useKeyboardShortcuts())
      pressIn(document.createElement('input'), '1', true)
      expect(action).toHaveBeenCalled()
    })
  })

  it('Cmd+D splits vertically when activeProjectId is set', () => {
    setup({ activeProjectId: 'proj-1' })
    renderHook(() => useKeyboardShortcuts())
    pressKey('d', { metaKey: true })
    expect(splitSession).toHaveBeenCalledWith('proj-1', 'vertical', '/ws1', 5000)
  })

  it('Cmd+D does nothing when no activeProjectId', () => {
    renderHook(() => useKeyboardShortcuts())
    pressKey('d', { metaKey: true })
    expect(splitSession).not.toHaveBeenCalled()
  })

  it('Cmd+Shift+D splits horizontally when activeProjectId is set', () => {
    setup({ activeProjectId: 'proj-1' })
    renderHook(() => useKeyboardShortcuts())
    pressKey('d', { metaKey: true, shiftKey: true })
    expect(splitSession).toHaveBeenCalledWith('proj-1', 'horizontal', '/ws1', 5000)
  })

  it('Cmd+W closes focused split pane when in split mode', async () => {
    setup({ activeProjectId: 'proj-1' })
    withTabs('proj-1', ['ses-root', 'ses-focused'], 'ses-root')
    sessions().activateSplit('proj-1', 'ses-root', 'ses-focused', 'vertical')
    sessions().setFocusedSession('proj-1', 'ses-focused')
    renderHook(() => useKeyboardShortcuts())
    pressKey('w', { metaKey: true })
    expect(JSON.stringify(sessions().getPaneLayout('proj-1'))).not.toContain('ses-focused')
    await waitFor(() => expect(sessions().sessions.has('ses-focused')).toBe(false))
    expect(sessions().sessions.has('ses-root')).toBe(true)
  })

  it('Cmd+W closes active tab when not in split mode', async () => {
    setup({ activeProjectId: 'proj-1' })
    withTabs('proj-1', ['ses-other', 'ses-active'], 'ses-active')
    renderHook(() => useKeyboardShortcuts())
    pressKey('w', { metaKey: true })
    await waitFor(() => expect(sessions().sessions.has('ses-active')).toBe(false))
    expect(sessions().sessions.has('ses-other')).toBe(true)
  })

  it('Cmd+W does nothing when no activeProjectId', async () => {
    withTabs('proj-1', ['ses-active'], 'ses-active')
    renderHook(() => useKeyboardShortcuts())
    pressKey('w', { metaKey: true })
    await Promise.resolve()
    expect(sessions().sessions.has('ses-active')).toBe(true)
  })

  describe('scratch mode — scratchProjectId overrides activeProjectId', () => {
    const scratch = { scratchProjectId: SCRATCH_PROJECT_ID }

    it('Cmd+K clears scratch session when scratchProjectId is set and activeProjectId is null', () => {
      withTabs(SCRATCH_PROJECT_ID, ['scratch-ses-1'], 'scratch-ses-1')
      renderHook(() => useKeyboardShortcuts(scratch))
      pressKey('k', { metaKey: true })
      expect(input).toHaveBeenCalledWith('scratch-ses-1', '\x0c')
    })

    it('Cmd+T creates scratch session when scratchProjectId is set and activeProjectId is null', () => {
      renderHook(() => useKeyboardShortcuts(scratch))
      pressKey('t', { metaKey: true })
      expect(createSession).toHaveBeenCalledWith(
        SCRATCH_PROJECT_ID,
        'human',
        'Terminal',
        '/ws1',
        5000
      )
    })

    it('Cmd+D splits the scratch terminal when that is what is on screen', () => {
      // This used to be gated on `activeProjectId` alone and do nothing at
      // all here — silently, with the palette entries absent too, which reads
      // as the feature having been removed rather than as not applying. Cmd+T
      // and Cmd+W already treat scratch as an ordinary project; this now does
      // the same.
      renderHook(() => useKeyboardShortcuts(scratch))
      pressKey('d', { metaKey: true })
      expect(splitSession).toHaveBeenCalledWith(SCRATCH_PROJECT_ID, 'vertical', '/ws1', 5000)
    })

    it('Cmd+Shift+D splits the scratch terminal horizontally', () => {
      renderHook(() => useKeyboardShortcuts(scratch))
      pressKey('d', { metaKey: true, shiftKey: true })
      expect(splitSession).toHaveBeenCalledWith(SCRATCH_PROJECT_ID, 'horizontal', '/ws1', 5000)
    })

    it('Cmd+W closes scratch tab when scratchProjectId is set', async () => {
      withTabs(SCRATCH_PROJECT_ID, ['scratch-ses-1'], 'scratch-ses-1')
      renderHook(() => useKeyboardShortcuts(scratch))
      pressKey('w', { metaKey: true })
      await waitFor(() => expect(sessions().sessions.has('scratch-ses-1')).toBe(false))
    })

    it('Cmd+ArrowRight cycles scratch tabs when scratchProjectId is set', () => {
      withTabs(SCRATCH_PROJECT_ID, ['ss1', 'ss2'], 'ss1')
      renderHook(() => useKeyboardShortcuts(scratch))
      pressKey('ArrowRight', { metaKey: true })
      expect(sessions().getActiveSessionForProject(SCRATCH_PROJECT_ID)).toBe('ss2')
    })

    it('regular project shortcuts still work when both activeProjectId and scratchProjectId are null', () => {
      renderHook(() => useKeyboardShortcuts({ scratchProjectId: null }))
      pressKey('t', { metaKey: true })
      expect(createSession).not.toHaveBeenCalled()
    })

    it('Cmd+T calls onNewTab when provided instead of creating a session directly', () => {
      const onNewTab = vi.fn()
      setup({ activeProjectId: 'proj-1' })
      renderHook(() => useKeyboardShortcuts({ scratchProjectId: null, onNewTab }))
      pressKey('t', { metaKey: true })
      expect(onNewTab).toHaveBeenCalled()
      expect(createSession).not.toHaveBeenCalled()
    })
  })
})

describe('session navigation shortcuts (FR-032)', () => {
  const mkSession = (id: string, projectId: string, patch: Partial<TerminalSession> = {}) =>
    terminalSessionOf({ id, projectId, type: 'agent', ...patch })

  function withSessions(...list: TerminalSession[]): void {
    useSessionStore.setState({ sessions: new Map(list.map((s) => [s.id, s])) })
    useSessionStore.setState({
      projectViews: new Map([['p1', { terminalCounter: 0, activeSessionId: 'a' }]]),
    })
  }

  beforeEach(() => {
    setup({ activeProjectId: 'p1' })
    withSessions(
      mkSession('a', 'p1', { lastAttendedAt: 300 }),
      mkSession('b', 'p2', { lastAttendedAt: 200 }),
      mkSession('c', 'p3', { lastAttendedAt: 100, agentState: 'awaiting-input' })
    )
  })

  it('Cmd+] moves to the next most-recently-attended session, across projects', () => {
    renderHook(() => useKeyboardShortcuts({}))
    pressKey(']', { metaKey: true })
    expect(sessions().getActiveSessionForProject('p2')).toBe('b')
  })

  it('Cmd+[ moves the other way and wraps around', () => {
    renderHook(() => useKeyboardShortcuts({}))
    pressKey('[', { metaKey: true })
    expect(sessions().getActiveSessionForProject('p3')).toBe('c')
  })

  it('keeps activeProjectId in step so the project tab bar does not lose its footing', () => {
    renderHook(() => useKeyboardShortcuts({}))
    pressKey(']', { metaKey: true })
    expect(workspaces().activeProjectId).toBe('p2')
  })

  it('does nothing when there is only one session to cycle', () => {
    withSessions(mkSession('a', 'p1', { lastAttendedAt: 1 }))
    renderHook(() => useKeyboardShortcuts({}))
    pressKey(']', { metaKey: true })
    expect(workspaces().activeProjectId).toBe('p1')
    expect(sessions().focusRequest).toBeNull()
  })

  it('Cmd+Shift+A jumps to a session waiting on you', () => {
    renderHook(() => useKeyboardShortcuts({}))
    pressKey('a', { metaKey: true, shiftKey: true })
    expect(sessions().getActiveSessionForProject('p3')).toBe('c')
    expect(workspaces().activeProjectId).toBe('p3')
  })

  it('Cmd+Shift+A does nothing when no session is waiting', () => {
    withSessions(mkSession('a', 'p1'))
    renderHook(() => useKeyboardShortcuts({}))
    pressKey('a', { metaKey: true, shiftKey: true })
    expect(workspaces().activeProjectId).toBe('p1')
    expect(sessions().focusRequest).toBeNull()
  })

  it('Cmd+I opens the note editor', () => {
    const onEditSessionNote = vi.fn()
    renderHook(() => useKeyboardShortcuts({ onEditSessionNote }))
    pressKey('i', { metaKey: true })
    expect(onEditSessionNote).toHaveBeenCalledOnce()
  })

  it('never binds Escape — it belongs to the terminal (FR-033)', () => {
    renderHook(() => useKeyboardShortcuts({ onEditSessionNote: vi.fn() }))
    const event = pressKey('Escape', { metaKey: true })
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves the new bindings alone while typing in a text field', () => {
    renderHook(() => useKeyboardShortcuts({}))
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()
    field.dispatchEvent(new KeyboardEvent('keydown', { key: ']', metaKey: true, bubbles: true }))
    expect(workspaces().activeProjectId).toBe('p1')
    field.remove()
  })
})
