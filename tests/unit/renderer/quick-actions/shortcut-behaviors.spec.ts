import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessions = new Map<string, Record<string, unknown>>()
const setActiveProject = vi.fn()
const dispatchNotification = vi.fn()
const requestFocus = vi.fn()
const registry = {
  setActiveGlobalTab: vi.fn(),
  setActiveWorkspaceTab: vi.fn(),
  setActiveProjectTab: vi.fn(),
}

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: { getState: () => ({ sessions, requestFocus }) },
}))
vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: { getState: () => ({ setActiveProject }) },
}))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: { getState: () => registry },
}))
vi.mock('../../../../src/renderer/lib/notifications', () => ({
  dispatchNotification: (...args: unknown[]) => dispatchNotification(...args),
}))

import {
  cycleMostRecentlyAttended,
  jumpToNextAwaitingInput,
  switchToWorkspace,
  cycleTab,
  clearTerminal,
  splitPane,
  closeFocusedPane,
} from '../../../../src/renderer/quick-actions/shortcut-behaviors'

const input = vi.fn()

function addSession(id: string, projectId: string, extra: Record<string, unknown> = {}): void {
  sessions.set(id, { id, projectId, status: 'running', agentState: 'idle', ...extra })
}

function navDeps(activeId: string | null = null) {
  return {
    getActiveSessionForProject: vi.fn(() => activeId),
    setActiveSessionForProject: vi.fn(),
  }
}

beforeEach(() => {
  sessions.clear()
  vi.clearAllMocks()
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = { terminal: { input } }
})

describe('cycleMostRecentlyAttended', () => {
  it('treats sessions never attended as oldest', () => {
    addSession('a', 'p1', { lastAttendedAt: 300 })
    addSession('b', 'p2')
    addSession('c', 'p1', { lastAttendedAt: 100 })
    const deps = navDeps('a')
    cycleMostRecentlyAttended('p1', 1, deps)
    expect(deps.setActiveSessionForProject).toHaveBeenCalledWith('p1', 'c')
  })

  it('starts from the most recent session when no project is active', () => {
    addSession('a', 'p1', { lastAttendedAt: 300 })
    addSession('b', 'p2', { lastAttendedAt: 200 })
    const deps = navDeps()
    cycleMostRecentlyAttended(null, 1, deps)
    expect(setActiveProject).toHaveBeenCalledWith('p2')
    expect(deps.setActiveSessionForProject).toHaveBeenCalledWith('p2', 'b')
    expect(requestFocus).toHaveBeenCalledWith('b')
    expect(registry.setActiveGlobalTab).toHaveBeenCalledWith(null)
    expect(registry.setActiveWorkspaceTab).toHaveBeenCalledWith(null)
    expect(registry.setActiveProjectTab).toHaveBeenCalledWith(null)
  })

  it('starts from the first session when the active one is not listed', () => {
    addSession('a', 'p1', { lastAttendedAt: 300 })
    addSession('b', 'p1', { lastAttendedAt: 200 })
    const deps = navDeps('gone')
    cycleMostRecentlyAttended('p1', -1, deps)
    expect(deps.setActiveSessionForProject).toHaveBeenCalledWith('p1', 'b')
  })

  it('ignores closed sessions and does nothing with fewer than two', () => {
    addSession('a', 'p1', { lastAttendedAt: 300 })
    addSession('b', 'p1', { lastAttendedAt: 200, status: 'closed' })
    const deps = navDeps('a')
    cycleMostRecentlyAttended('p1', 1, deps)
    expect(deps.setActiveSessionForProject).not.toHaveBeenCalled()
  })
})

describe('jumpToNextAwaitingInput', () => {
  it('goes to the first waiting session when no project is active', () => {
    addSession('a', 'p1', { agentState: 'awaiting-input' })
    addSession('b', 'p2', { agentState: 'awaiting-input' })
    const deps = navDeps()
    jumpToNextAwaitingInput(null, deps)
    expect(deps.setActiveSessionForProject).toHaveBeenCalledWith('p1', 'a')
  })

  it('moves past the waiting session already shown', () => {
    addSession('a', 'p1', { agentState: 'awaiting-input' })
    addSession('b', 'p2', { agentState: 'awaiting-input' })
    const deps = navDeps('a')
    jumpToNextAwaitingInput('p1', deps)
    expect(deps.setActiveSessionForProject).toHaveBeenCalledWith('p2', 'b')
  })

  it('does nothing when nothing is waiting', () => {
    addSession('a', 'p1')
    const deps = navDeps('a')
    jumpToNextAwaitingInput('p1', deps)
    expect(deps.setActiveSessionForProject).not.toHaveBeenCalled()
  })
})

describe('switchToWorkspace', () => {
  it('switches to and expands the workspace at that position', () => {
    const deps = {
      workspaces: [{ id: 'w1' }, { id: 'w2' }],
      setActiveWorkspace: vi.fn(),
      setExpandedWorkspaceIds: vi.fn(),
    }
    switchToWorkspace(1, deps)
    expect(deps.setActiveWorkspace).toHaveBeenCalledWith('w2')
    expect(deps.setExpandedWorkspaceIds).toHaveBeenCalledWith(new Set(['w2']))
  })

  it('does nothing past the last workspace', () => {
    const deps = {
      workspaces: [{ id: 'w1' }],
      setActiveWorkspace: vi.fn(),
      setExpandedWorkspaceIds: vi.fn(),
    }
    switchToWorkspace(4, deps)
    expect(deps.setActiveWorkspace).not.toHaveBeenCalled()
  })
})

describe('cycleTab', () => {
  it('wraps from the first tab back to the last', () => {
    const deps = {
      getSessionsForProject: () => [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
      getActiveSessionForProject: () => 's1',
      setActiveSessionForProject: vi.fn(),
    }
    cycleTab('p1', -1, deps)
    expect(deps.setActiveSessionForProject).toHaveBeenCalledWith('p1', 's3')
    expect(requestFocus).toHaveBeenCalledWith('s3')
    expect(registry.setActiveGlobalTab).toHaveBeenCalledWith(null)
  })

  it('does nothing on a project with no tabs', () => {
    const deps = {
      getSessionsForProject: () => [],
      getActiveSessionForProject: () => null,
      setActiveSessionForProject: vi.fn(),
    }
    cycleTab('p1', 1, deps)
    expect(deps.setActiveSessionForProject).not.toHaveBeenCalled()
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
      expect(dispatchNotification).toHaveBeenCalledWith(
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
      expect(dispatchNotification).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'no pty' })
      )
    )
  })
})

describe('closeFocusedPane', () => {
  function deps(overrides: Record<string, unknown> = {}) {
    return {
      getPaneLayout: () => null,
      getFocusedSession: () => null,
      closeSplitLeaf: vi.fn(),
      closeSession: vi.fn(() => Promise.resolve()),
      getActiveSessionForProject: () => null,
      ...overrides,
    }
  }

  it('closes the focused leaf of a split and reports a failed close', async () => {
    const d = deps({
      getPaneLayout: () => ({}),
      getFocusedSession: () => 's2',
      closeSession: vi.fn(() => Promise.reject(new Error('x'))),
    })
    closeFocusedPane('p1', d)
    expect(d.closeSplitLeaf).toHaveBeenCalledWith('p1', 's2')
    await vi.waitFor(() =>
      expect(dispatchNotification).toHaveBeenCalledWith(
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
