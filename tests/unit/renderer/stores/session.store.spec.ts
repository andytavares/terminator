import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockElectronAPI = {
  terminal: {
    create: vi.fn(),
    close: vi.fn(),
  },
}

Object.defineProperty(globalThis, 'window', {
  value: { electronAPI: mockElectronAPI },
  writable: true,
})

import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import type { TerminalSession } from '../../../../src/shared/types/index'

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    tabTitle: 'Shell',
    status: 'active',
    type: 'human',
    scrollbackLimit: 10000,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function resetStore() {
  useSessionStore.setState({
    sessions: new Map(),
    terminalInstances: new Map(),
    activeSessionIdByProject: new Map(),
    bellCounts: new Map(),
    busySessions: new Set(),
    terminalCountByProject: new Map(),
    paneLayoutByProject: new Map(),
    focusedSessionByProject: new Map(),
  })
}

describe('useSessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  describe('createSession', () => {
    it('creates a session and stores it', async () => {
      mockElectronAPI.terminal.create.mockResolvedValue({ sessionId: 'sess-1' })
      const id = await useSessionStore
        .getState()
        .createSession('proj-1', 'human', 'Shell', '/home', 10000)
      expect(id).toBe('sess-1')
      const session = useSessionStore.getState().sessions.get('sess-1')
      expect(session).toMatchObject({
        id: 'sess-1',
        projectId: 'proj-1',
        tabTitle: 'Shell',
        status: 'active',
        type: 'human',
        scrollbackLimit: 10000,
      })
    })

    it('throws when terminal.create returns an error', async () => {
      mockElectronAPI.terminal.create.mockResolvedValue({ error: 'FAILED' })
      await expect(
        useSessionStore.getState().createSession('proj-1', 'human', 'Shell', '/home', 10000)
      ).rejects.toThrow('FAILED')
    })

    it('auto-numbers title as "Terminal 1" when empty title given', async () => {
      mockElectronAPI.terminal.create.mockResolvedValue({ sessionId: 'sess-1' })
      await useSessionStore.getState().createSession('proj-1', 'human', '', '/home', 10000)
      const session = useSessionStore.getState().sessions.get('sess-1')
      expect(session?.tabTitle).toBe('Terminal 1')
    })

    it('increments counter per project for subsequent empty-title sessions', async () => {
      mockElectronAPI.terminal.create
        .mockResolvedValueOnce({ sessionId: 'sess-1' })
        .mockResolvedValueOnce({ sessionId: 'sess-2' })
      await useSessionStore.getState().createSession('proj-1', 'human', '', '/home', 10000)
      await useSessionStore.getState().createSession('proj-1', 'human', '', '/home', 10000)
      expect(useSessionStore.getState().sessions.get('sess-1')?.tabTitle).toBe('Terminal 1')
      expect(useSessionStore.getState().sessions.get('sess-2')?.tabTitle).toBe('Terminal 2')
    })

    it('uses explicit title when provided (no auto-numbering)', async () => {
      mockElectronAPI.terminal.create.mockResolvedValue({ sessionId: 'sess-1' })
      await useSessionStore.getState().createSession('proj-1', 'human', 'My Tab', '/home', 10000)
      expect(useSessionStore.getState().sessions.get('sess-1')?.tabTitle).toBe('My Tab')
    })
  })

  describe('renameSession', () => {
    it('updates tabTitle of existing session', () => {
      const session = makeSession({ id: 'sess-1', tabTitle: 'Shell' })
      useSessionStore.setState({ sessions: new Map([['sess-1', session]]) })
      useSessionStore.getState().renameSession('sess-1', 'My Custom Name')
      expect(useSessionStore.getState().sessions.get('sess-1')?.tabTitle).toBe('My Custom Name')
    })

    it('is a no-op for unknown session id', () => {
      expect(() => useSessionStore.getState().renameSession('nonexistent', 'Title')).not.toThrow()
    })
  })

  describe('closeSession', () => {
    it('removes session from store', async () => {
      const session = makeSession()
      useSessionStore.setState({ sessions: new Map([['sess-1', session]]) })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      await useSessionStore.getState().closeSession('sess-1')
      expect(useSessionStore.getState().sessions.has('sess-1')).toBe(false)
    })

    it('disposes xterm instance if present', async () => {
      const session = makeSession()
      const dispose = vi.fn()
      useSessionStore.setState({
        sessions: new Map([['sess-1', session]]),
        terminalInstances: new Map([['sess-1', { dispose }]]),
      })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      await useSessionStore.getState().closeSession('sess-1')
      expect(dispose).toHaveBeenCalled()
    })

    it('clears bell count for closed session', async () => {
      const session = makeSession()
      useSessionStore.setState({
        sessions: new Map([['sess-1', session]]),
        bellCounts: new Map([['sess-1', 3]]),
      })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      await useSessionStore.getState().closeSession('sess-1')
      expect(useSessionStore.getState().bellCounts.has('sess-1')).toBe(false)
    })

    it('updates activeSessionIdByProject when closed session was active', async () => {
      const session1 = makeSession({ id: 'sess-1' })
      const session2 = makeSession({ id: 'sess-2' })
      useSessionStore.setState({
        sessions: new Map([
          ['sess-1', session1],
          ['sess-2', session2],
        ]),
        activeSessionIdByProject: new Map([['proj-1', 'sess-1']]),
      })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      await useSessionStore.getState().closeSession('sess-1')
      // sess-2 remains, should become active
      expect(useSessionStore.getState().activeSessionIdByProject.get('proj-1')).toBe('sess-2')
    })

    it('removes project from activeSessionIdByProject when last session closed', async () => {
      const session = makeSession()
      useSessionStore.setState({
        sessions: new Map([['sess-1', session]]),
        activeSessionIdByProject: new Map([['proj-1', 'sess-1']]),
      })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      await useSessionStore.getState().closeSession('sess-1')
      expect(useSessionStore.getState().activeSessionIdByProject.has('proj-1')).toBe(false)
    })
  })

  describe('getSessionsForProject', () => {
    it('returns only sessions belonging to the given project', () => {
      const s1 = makeSession({ id: 'sess-1', projectId: 'proj-1' })
      const s2 = makeSession({ id: 'sess-2', projectId: 'proj-2' })
      const s3 = makeSession({ id: 'sess-3', projectId: 'proj-1' })
      useSessionStore.setState({
        sessions: new Map([
          ['sess-1', s1],
          ['sess-2', s2],
          ['sess-3', s3],
        ]),
      })
      const sessions = useSessionStore.getState().getSessionsForProject('proj-1')
      expect(sessions).toHaveLength(2)
      expect(sessions.map((s) => s.id)).toContain('sess-1')
      expect(sessions.map((s) => s.id)).toContain('sess-3')
    })

    it('returns empty array for unknown project', () => {
      expect(useSessionStore.getState().getSessionsForProject('nonexistent')).toHaveLength(0)
    })
  })

  describe('setActiveSessionForProject', () => {
    it('marks the given session as active and others as backgrounded', () => {
      const s1 = makeSession({ id: 'sess-1', status: 'active' })
      const s2 = makeSession({ id: 'sess-2', status: 'active' })
      useSessionStore.setState({
        sessions: new Map([
          ['sess-1', s1],
          ['sess-2', s2],
        ]),
      })
      useSessionStore.getState().setActiveSessionForProject('proj-1', 'sess-2')
      expect(useSessionStore.getState().sessions.get('sess-2')?.status).toBe('active')
      expect(useSessionStore.getState().sessions.get('sess-1')?.status).toBe('backgrounded')
    })

    it('clears bell count for the newly active session', () => {
      const session = makeSession()
      useSessionStore.setState({
        sessions: new Map([['sess-1', session]]),
        bellCounts: new Map([['sess-1', 5]]),
      })
      useSessionStore.getState().setActiveSessionForProject('proj-1', 'sess-1')
      expect(useSessionStore.getState().bellCounts.has('sess-1')).toBe(false)
    })

    it('sets activeSessionIdByProject for the project', () => {
      const session = makeSession()
      useSessionStore.setState({ sessions: new Map([['sess-1', session]]) })
      useSessionStore.getState().setActiveSessionForProject('proj-1', 'sess-1')
      expect(useSessionStore.getState().activeSessionIdByProject.get('proj-1')).toBe('sess-1')
    })
  })

  describe('getActiveSessionForProject', () => {
    it('returns the active session id', () => {
      useSessionStore.setState({ activeSessionIdByProject: new Map([['proj-1', 'sess-1']]) })
      expect(useSessionStore.getState().getActiveSessionForProject('proj-1')).toBe('sess-1')
    })

    it('returns null for unknown project', () => {
      expect(useSessionStore.getState().getActiveSessionForProject('unknown')).toBeNull()
    })
  })

  describe('handleProcessExit', () => {
    it('marks session status as closed and appends [exited] to title', () => {
      const session = makeSession({ tabTitle: 'Shell' })
      useSessionStore.setState({ sessions: new Map([['sess-1', session]]) })
      useSessionStore.getState().handleProcessExit('sess-1', 0)
      const updated = useSessionStore.getState().sessions.get('sess-1')
      expect(updated?.status).toBe('closed')
      expect(updated?.tabTitle).toBe('Shell [exited]')
      expect(updated?.closedAt).toBeDefined()
    })

    it('is a no-op for unknown session id', () => {
      expect(() => useSessionStore.getState().handleProcessExit('unknown', 0)).not.toThrow()
    })
  })

  describe('bell counts', () => {
    it('incrementBellCount increases count', () => {
      useSessionStore.getState().incrementBellCount('sess-1')
      useSessionStore.getState().incrementBellCount('sess-1')
      expect(useSessionStore.getState().getBellCountForSession('sess-1')).toBe(2)
    })

    it('clearBellCount removes entry', () => {
      useSessionStore.setState({ bellCounts: new Map([['sess-1', 3]]) })
      useSessionStore.getState().clearBellCount('sess-1')
      expect(useSessionStore.getState().getBellCountForSession('sess-1')).toBe(0)
    })

    it('clearBellCount is a no-op when count is already 0', () => {
      expect(() => useSessionStore.getState().clearBellCount('never-set')).not.toThrow()
    })

    it('getBellCountForSession returns 0 for unknown session', () => {
      expect(useSessionStore.getState().getBellCountForSession('unknown')).toBe(0)
    })

    it('getBellCountForProject sums bell counts across all project sessions', () => {
      const s1 = makeSession({ id: 'sess-1', projectId: 'proj-1' })
      const s2 = makeSession({ id: 'sess-2', projectId: 'proj-1' })
      const s3 = makeSession({ id: 'sess-3', projectId: 'proj-2' })
      useSessionStore.setState({
        sessions: new Map([
          ['sess-1', s1],
          ['sess-2', s2],
          ['sess-3', s3],
        ]),
        bellCounts: new Map([
          ['sess-1', 2],
          ['sess-2', 3],
          ['sess-3', 10],
        ]),
      })
      expect(useSessionStore.getState().getBellCountForProject('proj-1')).toBe(5)
      expect(useSessionStore.getState().getBellCountForProject('proj-2')).toBe(10)
    })
  })

  describe('busy state', () => {
    it('setSessionBusy marks session as busy', () => {
      useSessionStore.getState().setSessionBusy('sess-1')
      expect(useSessionStore.getState().isSessionBusy('sess-1')).toBe(true)
    })

    it('setSessionBusy is idempotent (no extra re-renders)', () => {
      useSessionStore.getState().setSessionBusy('sess-1')
      const before = useSessionStore.getState().busySessions
      useSessionStore.getState().setSessionBusy('sess-1')
      expect(useSessionStore.getState().busySessions).toBe(before)
    })

    it('setSessionIdle removes busy mark', () => {
      useSessionStore.setState({ busySessions: new Set(['sess-1']) })
      useSessionStore.getState().setSessionIdle('sess-1')
      expect(useSessionStore.getState().isSessionBusy('sess-1')).toBe(false)
    })

    it('setSessionIdle is a no-op when session is not busy', () => {
      const before = useSessionStore.getState().busySessions
      useSessionStore.getState().setSessionIdle('not-busy')
      expect(useSessionStore.getState().busySessions).toBe(before)
    })

    it('isSessionBusy returns false for unknown session', () => {
      expect(useSessionStore.getState().isSessionBusy('unknown')).toBe(false)
    })

    it('isProjectBusy returns true when any session in project is busy', () => {
      const s1 = makeSession({ id: 'sess-1', projectId: 'proj-1' })
      const s2 = makeSession({ id: 'sess-2', projectId: 'proj-1' })
      useSessionStore.setState({
        sessions: new Map([
          ['sess-1', s1],
          ['sess-2', s2],
        ]),
        busySessions: new Set(['sess-2']),
      })
      expect(useSessionStore.getState().isProjectBusy('proj-1')).toBe(true)
    })

    it('isProjectBusy returns false when no session in project is busy', () => {
      const s1 = makeSession({ id: 'sess-1', projectId: 'proj-1' })
      useSessionStore.setState({
        sessions: new Map([['sess-1', s1]]),
        busySessions: new Set(['sess-other']),
      })
      expect(useSessionStore.getState().isProjectBusy('proj-1')).toBe(false)
    })

    it('closeSession clears busy state for the closed session', async () => {
      const session = makeSession()
      useSessionStore.setState({
        sessions: new Map([['sess-1', session]]),
        busySessions: new Set(['sess-1']),
      })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      await useSessionStore.getState().closeSession('sess-1')
      expect(useSessionStore.getState().busySessions.has('sess-1')).toBe(false)
    })
  })

  describe('setTerminalInstance / getTerminalInstance', () => {
    it('stores and retrieves terminal instance by sessionId', () => {
      const fakeTerminal = { write: vi.fn() }
      useSessionStore.getState().setTerminalInstance('sess-1', fakeTerminal)
      expect(useSessionStore.getState().getTerminalInstance('sess-1')).toBe(fakeTerminal)
    })

    it('returns undefined for unknown session', () => {
      expect(useSessionStore.getState().getTerminalInstance('unknown')).toBeUndefined()
    })
  })

  describe('split pane actions', () => {
    beforeEach(() => {
      vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'split-uuid') })
    })

    it('getPaneLayout returns null when no layout set', () => {
      expect(useSessionStore.getState().getPaneLayout('proj-1')).toBeNull()
    })

    it('setSplitLayout stores and retrieves a layout', () => {
      const layout = { type: 'leaf' as const, sessionId: 'sess-1' }
      useSessionStore.getState().setSplitLayout('proj-1', layout)
      expect(useSessionStore.getState().getPaneLayout('proj-1')).toEqual(layout)
    })

    it('setSplitLayout with null removes the layout', () => {
      const layout = { type: 'leaf' as const, sessionId: 'sess-1' }
      useSessionStore.getState().setSplitLayout('proj-1', layout)
      useSessionStore.getState().setSplitLayout('proj-1', null)
      expect(useSessionStore.getState().getPaneLayout('proj-1')).toBeNull()
    })

    it('getFocusedSession returns null when nothing focused', () => {
      expect(useSessionStore.getState().getFocusedSession('proj-1')).toBeNull()
    })

    it('setFocusedSession stores the focused session', () => {
      useSessionStore.getState().setFocusedSession('proj-1', 'sess-1')
      expect(useSessionStore.getState().getFocusedSession('proj-1')).toBe('sess-1')
    })

    it('activateSplit creates a split layout from a single session', () => {
      useSessionStore.getState().activateSplit('proj-1', 'sess-a', 'sess-b', 'vertical')
      const layout = useSessionStore.getState().getPaneLayout('proj-1')
      expect(layout?.type).toBe('split')
      if (layout?.type !== 'split') return
      expect(layout.direction).toBe('vertical')
      expect(layout.first).toEqual({ type: 'leaf', sessionId: 'sess-a' })
      expect(layout.second).toEqual({ type: 'leaf', sessionId: 'sess-b' })
      expect(layout.ratio).toBe(0.5)
    })

    it('activateSplit sets the new session as focused', () => {
      useSessionStore.getState().activateSplit('proj-1', 'sess-a', 'sess-b', 'horizontal')
      expect(useSessionStore.getState().getFocusedSession('proj-1')).toBe('sess-b')
    })

    it('activateSplit splits an existing layout leaf', () => {
      useSessionStore.getState().activateSplit('proj-1', 'sess-a', 'sess-b', 'vertical')
      useSessionStore.getState().setFocusedSession('proj-1', 'sess-b')
      useSessionStore.getState().activateSplit('proj-1', 'sess-b', 'sess-c', 'horizontal')
      const layout = useSessionStore.getState().getPaneLayout('proj-1')
      expect(layout?.type).toBe('split')
      if (layout?.type !== 'split') return
      expect(layout.second.type).toBe('split')
    })

    it('setSplitRatio updates the ratio of a split node', () => {
      useSessionStore.getState().activateSplit('proj-1', 'sess-a', 'sess-b', 'vertical')
      const layout = useSessionStore.getState().getPaneLayout('proj-1')
      if (!layout || layout.type !== 'split') throw new Error('expected split')
      useSessionStore.getState().setSplitRatio('proj-1', layout.id, 0.7)
      const updated = useSessionStore.getState().getPaneLayout('proj-1')
      if (!updated || updated.type !== 'split') throw new Error('expected split')
      expect(updated.ratio).toBe(0.7)
    })

    it('setSplitRatio is no-op when no layout exists', () => {
      expect(() => useSessionStore.getState().setSplitRatio('proj-1', 'noop', 0.5)).not.toThrow()
    })

    it('closeSplitLeaf removes a leaf and collapses split to null when 1 left', () => {
      useSessionStore.getState().activateSplit('proj-1', 'sess-a', 'sess-b', 'vertical')
      useSessionStore.getState().closeSplitLeaf('proj-1', 'sess-b')
      expect(useSessionStore.getState().getPaneLayout('proj-1')).toBeNull()
    })

    it('closeSplitLeaf sets the surviving session as active', () => {
      useSessionStore.getState().setFocusedSession('proj-1', 'sess-b')
      useSessionStore.getState().activateSplit('proj-1', 'sess-a', 'sess-b', 'vertical')
      useSessionStore.getState().closeSplitLeaf('proj-1', 'sess-b')
      expect(useSessionStore.getState().getActiveSessionForProject('proj-1')).toBe('sess-a')
    })

    it('closeSplitLeaf keeps layout when 2+ panes remain', () => {
      useSessionStore.getState().activateSplit('proj-1', 'sess-a', 'sess-b', 'vertical')
      useSessionStore.getState().activateSplit('proj-1', 'sess-b', 'sess-c', 'horizontal')
      useSessionStore.getState().closeSplitLeaf('proj-1', 'sess-c')
      expect(useSessionStore.getState().getPaneLayout('proj-1')).not.toBeNull()
    })

    it('closeSplitLeaf moves focus to first remaining leaf when focused one is closed', () => {
      useSessionStore.getState().activateSplit('proj-1', 'sess-a', 'sess-b', 'vertical')
      useSessionStore.getState().setFocusedSession('proj-1', 'sess-b')
      useSessionStore.getState().activateSplit('proj-1', 'sess-b', 'sess-c', 'horizontal')
      useSessionStore.getState().setFocusedSession('proj-1', 'sess-c')
      useSessionStore.getState().closeSplitLeaf('proj-1', 'sess-c')
      // leafIds after removal = ['sess-a', 'sess-b'], first remaining = 'sess-a'
      expect(useSessionStore.getState().getFocusedSession('proj-1')).toBe('sess-a')
    })

    it('closeSession clears the layout when the only split session is closed', async () => {
      mockElectronAPI.terminal.close.mockResolvedValue({})
      useSessionStore.getState().activateSplit('proj-1', 'sess-a', 'sess-b', 'vertical')
      useSessionStore.setState((s) => {
        const sessions = new Map(s.sessions)
        sessions.set('sess-a', makeSession({ id: 'sess-a', projectId: 'proj-1' }))
        sessions.set('sess-b', makeSession({ id: 'sess-b', projectId: 'proj-1' }))
        return { sessions }
      })
      await useSessionStore.getState().closeSession('sess-a')
      await useSessionStore.getState().closeSession('sess-b')
      expect(useSessionStore.getState().getPaneLayout('proj-1')).toBeNull()
    })
  })
})
