import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useKeyboardShortcuts } from '../../../../src/renderer/hooks/useKeyboardShortcuts'
import type { useTerminalSession } from '../../../../src/renderer/hooks/useTerminalSession'
import { resetStore, terminalSessionOf, workspaceFixture } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import { SCRATCH_PROJECT_ID, type TerminalSession } from '../../../../src/shared/types/index'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { sessionState, workspaceState } from '../../../support/store-state'

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

const workspace1 = workspaceFixture({ id: 'ws-1', name: 'WS 1', folderPath: '/ws1' })
const workspace2 = workspaceFixture({ id: 'ws-2', name: 'WS 2', folderPath: '/ws2' })

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
  const all = new Map(sessionState().sessions)
  for (const id of ids) all.set(id, terminalSessionOf({ id, projectId }))
  useSessionStore.setState({ sessions: all })
  sessionState().setActiveSessionForProject(projectId, active)
}

beforeEach(() => {
  vi.clearAllMocks()
  // The app ships for macOS: Cmd is the command key. A test of another platform says so.
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
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
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  window.dispatchEvent(event)
  return event
}

describe('useKeyboardShortcuts', () => {
  it('leaves Cmd+, to the Open Settings menu accelerator', () => {
    // The menu consumes the key before the renderer sees it (App.spec: menu:open-settings).
    renderHook(() => useKeyboardShortcuts())
    expect(pressKey(',', { metaKey: true }).defaultPrevented).toBe(false)
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
    expect(workspaceState().activeWorkspaceId).toBe('ws-2')
    expect(workspaceState().expandedWorkspaceIds).toEqual(new Set(['ws-2']))
  })

  it('does nothing for out-of-range workspace index', () => {
    renderHook(() => useKeyboardShortcuts())
    pressKey('9', { metaKey: true })
    expect(workspaceState().activeWorkspaceId).toBe('ws-1')
  })
})

describe('useKeyboardShortcuts — Ctrl+1–9 are the lane keys on a Mac', () => {
  it('leaves Ctrl+2 alone on a Mac: it switches lanes there, not workspaces', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    renderHook(() => useKeyboardShortcuts())
    pressKey('2', { ctrlKey: true })
    expect(workspaceState().activeWorkspaceId).toBe('ws-1')
    pressKey('2', { metaKey: true })
    expect(workspaceState().activeWorkspaceId).toBe('ws-2')
  })

  it('switches workspace on Ctrl+2 where Ctrl is the command key', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
    renderHook(() => useKeyboardShortcuts())
    pressKey('2', { ctrlKey: true })
    expect(workspaceState().activeWorkspaceId).toBe('ws-2')
  })
})

describe('useKeyboardShortcuts — cycles to next workspace on Cmd+=, expanding only it', () => {
  it('cycles to next workspace on Cmd+=, expanding only it', () => {
    renderHook(() => useKeyboardShortcuts())
    pressKey('=', { metaKey: true })
    expect(workspaceState().activeWorkspaceId).toBe('ws-2')
    expect(workspaceState().expandedWorkspaceIds).toEqual(new Set(['ws-2']))
  })

  it('cycles to previous workspace on Cmd+-', () => {
    renderHook(() => useKeyboardShortcuts())
    pressKey('-', { metaKey: true })
    expect(workspaceState().activeWorkspaceId).toBe('ws-2') // wraps around
  })

  it('cycleWorkspace does nothing when workspaces list is empty', () => {
    resetStore(useWorkspaceStore)
    renderHook(() => useKeyboardShortcuts())
    pressKey('=', { metaKey: true })
    expect(workspaceState().activeWorkspaceId).toBeNull()
  })
})

describe('useKeyboardShortcuts — cycles to next workspace on Cmd+=, expanding only it — creates new session on Cmd+T when project is active', () => {
  it('creates new session on Cmd+T when project is active', () => {
    setup({ activeProjectId: 'proj-1' })
    renderHook(() => useKeyboardShortcuts())
    pressKey('t', { metaKey: true })
    expect(createSession).toHaveBeenCalledWith({
      projectId: 'proj-1',
      type: 'human',
      title: 'Terminal',
      cwd: '/ws1',
      scrollbackLimit: 5000,
    })
  })
})

describe('useKeyboardShortcuts — does not create session on Cmd+T when no active project', () => {
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
})

describe('useKeyboardShortcuts — cycles tabs on Cmd+ArrowRight when sessions exist', () => {
  it('cycles tabs on Cmd+ArrowRight when sessions exist', () => {
    setup({ activeProjectId: 'proj-1' })
    withTabs('proj-1', ['s1', 's2'], 's1')
    renderHook(() => useKeyboardShortcuts())
    pressKey('ArrowRight', { metaKey: true })
    expect(sessionState().getActiveSessionForProject('proj-1')).toBe('s2')
  })

  it('cycles tabs on Cmd+ArrowLeft when sessions exist', () => {
    setup({ activeProjectId: 'proj-1' })
    withTabs('proj-1', ['s1', 's2'], 's2')
    renderHook(() => useKeyboardShortcuts())
    pressKey('ArrowLeft', { metaKey: true })
    expect(sessionState().getActiveSessionForProject('proj-1')).toBe('s1')
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
})

describe('useKeyboardShortcuts — calls onNewScratch when Cmd+Shift+T is pressed', () => {
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
    const onToggleLog = vi.fn()
    const { unmount } = renderHook(() => useKeyboardShortcuts({ onToggleLog }))
    unmount()
    pressKey('l', { metaKey: true, shiftKey: true })
    expect(onToggleLog).not.toHaveBeenCalled()
  })
})

function registeredAccelerator(accelerator: string) {
  const action = vi.fn()
  useExtensionRegistry.getState().registerKeyboardShortcut({ accelerator, action })
  return action
}

function pressIn(field: HTMLElement, key: string, metaKey = false): void {
  document.body.appendChild(field)
  field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, metaKey }))
  field.remove()
}

describe('useKeyboardShortcuts — extension shortcuts', () => {
  it('calls extension shortcut action when accelerator matches', () => {
    const action = registeredAccelerator('CmdOrCtrl+Shift+K')
    renderHook(() => useKeyboardShortcuts())
    pressKey('k', { metaKey: true, shiftKey: true })
    expect(action).toHaveBeenCalled()
  })

  it('suppresses bare-key extension shortcut when pressed inside an input', () => {
    const action = registeredAccelerator('1')
    renderHook(() => useKeyboardShortcuts())
    pressIn(document.createElement('input'), '1')
    expect(action).not.toHaveBeenCalled()
  })

  it('fires bare-key extension shortcut when pressed outside an input', () => {
    const action = registeredAccelerator('1')
    renderHook(() => useKeyboardShortcuts())
    pressKey('1')
    expect(action).toHaveBeenCalled()
  })

  it('fires modifier+key extension shortcut even when pressed inside an input', () => {
    const action = registeredAccelerator('CmdOrCtrl+1')
    renderHook(() => useKeyboardShortcuts())
    pressIn(document.createElement('input'), '1', true)
    expect(action).toHaveBeenCalled()
  })
})

describe('useKeyboardShortcuts — Cmd+D splits vertically when activeProjectId is set', () => {
  it('Cmd+D splits vertically when activeProjectId is set', () => {
    setup({ activeProjectId: 'proj-1' })
    renderHook(() => useKeyboardShortcuts())
    pressKey('d', { metaKey: true })
    expect(splitSession).toHaveBeenCalledWith('proj-1', 'vertical', {
      cwd: '/ws1',
      scrollbackLimit: 5000,
    })
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
    expect(splitSession).toHaveBeenCalledWith('proj-1', 'horizontal', {
      cwd: '/ws1',
      scrollbackLimit: 5000,
    })
  })
})

describe('useKeyboardShortcuts — Cmd+W', () => {
  it('leaves Cmd+W to the Close Tab menu accelerator', () => {
    // The menu consumes the key before the renderer sees it (App.spec: menu:close-tab).
    setup({ activeProjectId: 'proj-1' })
    withTabs('proj-1', ['ses-active'], 'ses-active')
    renderHook(() => useKeyboardShortcuts())
    const event = pressKey('w', { metaKey: true })
    expect(event.defaultPrevented).toBe(false)
    expect(sessionState().sessions.has('ses-active')).toBe(true)
  })
})

const scratch = { scratchProjectId: SCRATCH_PROJECT_ID }

describe('useKeyboardShortcuts — scratch mode — scratchProjectId overrides activeProjectId', () => {
  it('Cmd+K clears scratch session when scratchProjectId is set and activeProjectId is null', () => {
    withTabs(SCRATCH_PROJECT_ID, ['scratch-ses-1'], 'scratch-ses-1')
    renderHook(() => useKeyboardShortcuts(scratch))
    pressKey('k', { metaKey: true })
    expect(input).toHaveBeenCalledWith('scratch-ses-1', '\x0c')
  })

  it('Cmd+T creates scratch session when scratchProjectId is set and activeProjectId is null', () => {
    renderHook(() => useKeyboardShortcuts(scratch))
    pressKey('t', { metaKey: true })
    expect(createSession).toHaveBeenCalledWith({
      projectId: SCRATCH_PROJECT_ID,
      type: 'human',
      title: 'Terminal',
      cwd: '/ws1',
      scrollbackLimit: 5000,
    })
  })

  it('Cmd+D splits the scratch terminal when that is what is on screen', () => {
    // Scratch is an ordinary project here, as for Cmd+T and Cmd+W; doing nothing silently
    // read as the feature having been removed.
    renderHook(() => useKeyboardShortcuts(scratch))
    pressKey('d', { metaKey: true })
    expect(splitSession).toHaveBeenCalledWith(SCRATCH_PROJECT_ID, 'vertical', {
      cwd: '/ws1',
      scrollbackLimit: 5000,
    })
  })
})

describe('useKeyboardShortcuts — scratch mode — scratchProjectId overrides activeProjectId — Cmd+Shift+D splits the scratch terminal horizontally', () => {
  it('Cmd+Shift+D splits the scratch terminal horizontally', () => {
    renderHook(() => useKeyboardShortcuts(scratch))
    pressKey('d', { metaKey: true, shiftKey: true })
    expect(splitSession).toHaveBeenCalledWith(SCRATCH_PROJECT_ID, 'horizontal', {
      cwd: '/ws1',
      scrollbackLimit: 5000,
    })
  })
})

describe('useKeyboardShortcuts — scratch mode — Cmd+ArrowRight', () => {
  it('Cmd+ArrowRight cycles scratch tabs when scratchProjectId is set', () => {
    withTabs(SCRATCH_PROJECT_ID, ['ss1', 'ss2'], 'ss1')
    renderHook(() => useKeyboardShortcuts(scratch))
    pressKey('ArrowRight', { metaKey: true })
    expect(sessionState().getActiveSessionForProject(SCRATCH_PROJECT_ID)).toBe('ss2')
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

const mkSession = (id: string, projectId: string, patch: Partial<TerminalSession> = {}) =>
  terminalSessionOf({ id, projectId, type: 'agent', ...patch })

function seedSessionsWithActive(...list: TerminalSession[]): void {
  useSessionStore.setState({ sessions: new Map(list.map((s) => [s.id, s])) })
  useSessionStore.setState({
    projectViews: new Map([['p1', { terminalCounter: 0, activeSessionId: 'a' }]]),
  })
}

/** The hooks every "session navigation shortcuts (FR-032)" describe registers. */
function setUpSessionNavigationShortcutsFR(): void {
  beforeEach(() => {
    setup({ activeProjectId: 'p1' })
    seedSessionsWithActive(
      mkSession('a', 'p1', { lastAttendedAt: 300 }),
      mkSession('b', 'p2', { lastAttendedAt: 200 }),
      mkSession('c', 'p3', { lastAttendedAt: 100, bellCount: 1 })
    )
  })
}

describe('session navigation shortcuts (FR-032)', () => {
  setUpSessionNavigationShortcutsFR()

  it('Cmd+] moves to the next most-recently-attended session, across projects', () => {
    renderHook(() => useKeyboardShortcuts({}))
    pressKey(']', { metaKey: true })
    expect(sessionState().getActiveSessionForProject('p2')).toBe('b')
  })

  it('Cmd+[ moves the other way and wraps around', () => {
    renderHook(() => useKeyboardShortcuts({}))
    pressKey('[', { metaKey: true })
    expect(sessionState().getActiveSessionForProject('p3')).toBe('c')
  })

  it('keeps activeProjectId in step so the project tab bar does not lose its footing', () => {
    renderHook(() => useKeyboardShortcuts({}))
    pressKey(']', { metaKey: true })
    expect(workspaceState().activeProjectId).toBe('p2')
  })

  it('does nothing when there is only one session to cycle', () => {
    seedSessionsWithActive(mkSession('a', 'p1', { lastAttendedAt: 1 }))
    renderHook(() => useKeyboardShortcuts({}))
    pressKey(']', { metaKey: true })
    expect(workspaceState().activeProjectId).toBe('p1')
    expect(sessionState().focusRequest).toBeNull()
  })
})

describe('session navigation shortcuts (FR-032) — Cmd+Shift+A jumps to a session waiting on you', () => {
  setUpSessionNavigationShortcutsFR()

  it('Cmd+Shift+A jumps to a session waiting on you', () => {
    renderHook(() => useKeyboardShortcuts({}))
    pressKey('a', { metaKey: true, shiftKey: true })
    expect(sessionState().getActiveSessionForProject('p3')).toBe('c')
    expect(workspaceState().activeProjectId).toBe('p3')
  })

  it('Cmd+Shift+A does nothing when no session is waiting', () => {
    seedSessionsWithActive(mkSession('a', 'p1'))
    renderHook(() => useKeyboardShortcuts({}))
    pressKey('a', { metaKey: true, shiftKey: true })
    expect(workspaceState().activeProjectId).toBe('p1')
    expect(sessionState().focusRequest).toBeNull()
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
})

describe('session navigation shortcuts (FR-032) — leaves the new bindings alone while typing in a text field', () => {
  setUpSessionNavigationShortcutsFR()

  it('leaves the new bindings alone while typing in a text field', () => {
    renderHook(() => useKeyboardShortcuts({}))
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()
    field.dispatchEvent(new KeyboardEvent('keydown', { key: ']', metaKey: true, bubbles: true }))
    expect(workspaceState().activeProjectId).toBe('p1')
    field.remove()
  })
})

describe('useKeyboardShortcuts — Cmd+K on Home', () => {
  it('leaves Cmd+K to the search field while Home is the active tab', () => {
    setup({ activeProjectId: 'proj-1' })
    withTabs('proj-1', ['session-1'], 'session-1')
    useExtensionRegistry.setState({ activeGlobalTabId: 'core.home' })
    renderHook(() => useKeyboardShortcuts())
    pressKey('k', { metaKey: true })
    expect(input).not.toHaveBeenCalled()
  })
})
