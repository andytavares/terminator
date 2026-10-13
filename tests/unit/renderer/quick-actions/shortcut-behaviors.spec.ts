// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  cycleMostRecentlyAttended,
  jumpToNextAwaitingInput,
  switchToWorkspace,
  cycleTab,
  clearTerminal,
  splitPane,
  closeFocusedPane,
  type ClosePaneDeps,
} from '../../../../src/renderer/quick-actions/shortcut-behaviors'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import type { TerminalSession } from '../../../../src/shared/types/index'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { resetStore, terminalSessionOf, workspaceOf } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'

// What reaches the main process: keystrokes for a terminal, and notifications.
const input = vi.fn<ElectronAPI['terminal']['input']>()
const createNotification = vi.fn<ElectronAPI['notifications']['create']>(async () => ({
  id: 'n1',
}))

const sessions = () => useSessionStore.getState()
const workspaces = () => useWorkspaceStore.getState()
const registry = () => useExtensionRegistry.getState()

function addSession(id: string, projectId: string, extra: Partial<TerminalSession> = {}): void {
  const all = new Map(sessions().sessions)
  all.set(id, terminalSessionOf({ id, projectId, ...extra }))
  useSessionStore.setState({ sessions: all })
}

/** The session the project shows, as the store holds it after a step. */
const shownIn = (projectId: string) => sessions().getActiveSessionForProject(projectId)

beforeEach(() => {
  vi.clearAllMocks()
  resetStore(useSessionStore)
  resetStore(useWorkspaceStore)
  resetStore(useExtensionRegistry, {
    activeGlobalTabId: 'core.home',
    activeWorkspaceTabId: 'reviews',
    activeProjectTabId: 'git',
  })
  installElectronApi({
    terminal: { input },
    notifications: { create: createNotification },
  })
})

function expectTabsLeft(): void {
  expect(registry()).toMatchObject({
    activeGlobalTabId: null,
    activeWorkspaceTabId: null,
    activeProjectTabId: null,
  })
}

describe('cycleMostRecentlyAttended', () => {
  it('treats sessions never attended as oldest', () => {
    addSession('a', 'p1', { lastAttendedAt: 300 })
    addSession('b', 'p2')
    addSession('c', 'p1', { lastAttendedAt: 100 })
    sessions().setActiveSessionForProject('p1', 'a')
    cycleMostRecentlyAttended('p1', 1, sessions())
    expect(shownIn('p1')).toBe('c')
  })

  it('starts from the most recent session when no project is active', () => {
    addSession('a', 'p1', { lastAttendedAt: 300 })
    addSession('b', 'p2', { lastAttendedAt: 200 })
    cycleMostRecentlyAttended(null, 1, sessions())
    expect(workspaces().activeProjectId).toBe('p2')
    expect(shownIn('p2')).toBe('b')
    expect(sessions().focusRequest?.sessionId).toBe('b')
    expectTabsLeft()
  })

  it('starts from the first session when the active one is not listed', () => {
    addSession('a', 'p1', { lastAttendedAt: 300 })
    addSession('b', 'p1', { lastAttendedAt: 200 })
    sessions().setActiveSessionForProject('p1', 'gone')
    cycleMostRecentlyAttended('p1', -1, sessions())
    expect(shownIn('p1')).toBe('b')
  })
})

describe('cycleMostRecentlyAttended — ignores closed sessions and does nothing with fewer than two', () => {
  it('ignores closed sessions and does nothing with fewer than two', () => {
    addSession('a', 'p1', { lastAttendedAt: 300 })
    addSession('b', 'p1', { lastAttendedAt: 200, status: 'closed' })
    sessions().setActiveSessionForProject('p1', 'a')
    cycleMostRecentlyAttended('p1', 1, sessions())
    expect(shownIn('p1')).toBe('a')
    expect(registry().activeGlobalTabId).toBe('core.home')
  })
})

// Waiting is derived from the bell, never stored: each session here rang.
describe('jumpToNextAwaitingInput', () => {
  it('goes to the first waiting session when no project is active', () => {
    addSession('a', 'p1', { bellCount: 1 })
    addSession('b', 'p2', { bellCount: 1 })
    jumpToNextAwaitingInput(null, sessions())
    expect(workspaces().activeProjectId).toBe('p1')
    expect(shownIn('p1')).toBe('a')
  })

  it('moves past the waiting session already shown', () => {
    addSession('a', 'p1', { bellCount: 1 })
    addSession('b', 'p2', { bellCount: 1 })
    sessions().setActiveSessionForProject('p1', 'a')
    jumpToNextAwaitingInput('p1', sessions())
    expect(workspaces().activeProjectId).toBe('p2')
    expect(shownIn('p2')).toBe('b')
  })

  it('does nothing when nothing is waiting', () => {
    addSession('a', 'p1')
    jumpToNextAwaitingInput('p1', sessions())
    expect(workspaces().activeProjectId).toBeNull()
    expect(sessions().focusRequest).toBeNull()
  })
})

describe('switchToWorkspace', () => {
  beforeEach(() => {
    installElectronApi({ project: { list: async () => ({ projects: [] }) } })
    resetStore(useWorkspaceStore, {
      workspaces: [workspaceOf({ id: 'w1' }), workspaceOf({ id: 'w2' })],
    })
  })

  it('switches to and expands the workspace at that position', () => {
    switchToWorkspace(1, workspaces())
    expect(workspaces().activeWorkspaceId).toBe('w2')
    expect(workspaces().expandedWorkspaceIds).toEqual(new Set(['w2']))
  })

  it('does nothing past the last workspace', () => {
    switchToWorkspace(4, workspaces())
    expect(workspaces().activeWorkspaceId).toBeNull()
  })
})

describe('cycleTab', () => {
  beforeEach(() => {
    for (const id of ['s1', 's2', 's3']) addSession(id, 'p1')
    sessions().setActiveSessionForProject('p1', 's1')
  })

  it('wraps from the first tab back to the last', () => {
    cycleTab('p1', -1, sessions())
    expect(shownIn('p1')).toBe('s3')
    expect(sessions().focusRequest?.sessionId).toBe('s3')
    expectTabsLeft()
  })

  it('does nothing on a project with no tabs', () => {
    cycleTab('p2', 1, sessions())
    expect(shownIn('p2')).toBeNull()
    expect(registry().activeGlobalTabId).toBe('core.home')
  })
})

describe('clearTerminal', () => {
  it('sends form feed to the active session', () => {
    clearTerminal('p1', { getActiveSessionForProject: () => 's1' })
    expect(input).toHaveBeenCalledWith('s1', '\x0c')
  })

  it('sends nothing without a project or an active session', () => {
    clearTerminal(null, { getActiveSessionForProject: () => 's1' })
    clearTerminal('p1', { getActiveSessionForProject: () => null })
    expect(input).not.toHaveBeenCalled()
  })
})

describe('splitPane', () => {
  const base = {
    resolveSettings: () => ({ terminal: { scrollbackLimit: 5000 } }),
    resolveActiveCwd: () => '/repo',
    activeWorkspaceId: 'w1',
  }

  it('reports a failure that is not an Error with a stock message', async () => {
    splitPane('p1', 'vertical', { ...base, splitSession: () => Promise.reject('nope') })
    await vi.waitFor(() =>
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Could not create split pane' })
      )
    )
  })

  it('reports the error message of a failed split', async () => {
    splitPane('p1', 'horizontal', {
      ...base,
      splitSession: () => Promise.reject(new Error('no pty')),
    })
    await vi.waitFor(() =>
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'no pty' })
      )
    )
  })
})

function deps(overrides: Partial<ClosePaneDeps> = {}): ClosePaneDeps {
  return {
    getPaneLayout: () => null,
    getFocusedSession: () => null,
    closeSplitLeaf: vi.fn(),
    closeSession: vi.fn(() => Promise.resolve()),
    getActiveSessionForProject: () => null,
    ...overrides,
  }
}

describe('closeFocusedPane', () => {
  it('closes the focused leaf of a split and reports a failed close', async () => {
    const d = deps({
      getPaneLayout: () => ({}),
      getFocusedSession: () => 's2',
      closeSession: vi.fn(() => Promise.reject(new Error('x'))),
    })
    closeFocusedPane('p1', d)
    expect(d.closeSplitLeaf).toHaveBeenCalledWith('p1', 's2')
    await vi.waitFor(() =>
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'closeTerminalFailed' })
      )
    )
  })

  it('closes the active tab when there is no split', () => {
    const d = deps({ getActiveSessionForProject: () => 's1' })
    closeFocusedPane('p1', d)
    expect(d.closeSession).toHaveBeenCalledWith('s1')
    expect(d.closeSplitLeaf).not.toHaveBeenCalled()
  })

  it('closes nothing when no tab is active', () => {
    const d = deps()
    closeFocusedPane('p1', d)
    closeFocusedPane(null, d)
    expect(d.closeSession).not.toHaveBeenCalled()
  })
})
