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
    lastActivityAt: 0,
    agentState: 'idle',
    ...overrides,
  }
}

function resetStore() {
  useSessionStore.setState({
    sessions: new Map(),
    terminalInstances: new Map(),
    projectViews: new Map(),
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
        // bell count folded into the session record below
      })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      await useSessionStore.getState().closeSession('sess-1')
      expect(useSessionStore.getState().getBellCountForSession('sess-1')).toBe(0)
    })

    it('updates activeSessionIdByProject when closed session was active', async () => {
      const session1 = makeSession({ id: 'sess-1' })
      const session2 = makeSession({ id: 'sess-2' })
      useSessionStore.setState({
        sessions: new Map([
          ['sess-1', session1],
          ['sess-2', session2],
        ]),
        projectViews: new Map([['proj-1', { terminalCounter: 0, activeSessionId: 'sess-1' }]]),
      })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      await useSessionStore.getState().closeSession('sess-1')
      // sess-2 remains, should become active
      expect(useSessionStore.getState().getActiveSessionForProject('proj-1')).toBe('sess-2')
    })

    it('removes project from activeSessionIdByProject when last session closed', async () => {
      const session = makeSession()
      useSessionStore.setState({
        sessions: new Map([['sess-1', session]]),
        projectViews: new Map([['proj-1', { terminalCounter: 0, activeSessionId: 'sess-1' }]]),
      })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      await useSessionStore.getState().closeSession('sess-1')
      expect(useSessionStore.getState().getActiveSessionForProject('proj-1')).toBeNull()
    })

    it('cascades close to child sessions with matching parentSessionId', async () => {
      const parent = makeSession({ id: 'parent', projectId: 'proj-1' })
      const child = makeSession({ id: 'child', projectId: 'proj-1', parentSessionId: 'parent' })
      useSessionStore.setState({
        sessions: new Map([
          ['parent', parent],
          ['child', child],
        ]),
      })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      await useSessionStore.getState().closeSession('parent')
      expect(useSessionStore.getState().sessions.has('parent')).toBe(false)
      expect(useSessionStore.getState().sessions.has('child')).toBe(false)
      expect(mockElectronAPI.terminal.close).toHaveBeenCalledWith('child')
      expect(mockElectronAPI.terminal.close).toHaveBeenCalledWith('parent')
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
        // bell count folded into the session record below
      })
      useSessionStore.getState().setActiveSessionForProject('proj-1', 'sess-1')
      expect(useSessionStore.getState().getBellCountForSession('sess-1')).toBe(0)
    })

    it('sets activeSessionIdByProject for the project', () => {
      const session = makeSession()
      useSessionStore.setState({ sessions: new Map([['sess-1', session]]) })
      useSessionStore.getState().setActiveSessionForProject('proj-1', 'sess-1')
      expect(useSessionStore.getState().getActiveSessionForProject('proj-1')).toBe('sess-1')
    })
  })

  describe('getActiveSessionForProject', () => {
    it('returns the active session id', () => {
      useSessionStore.setState({
        projectViews: new Map([['proj-1', { terminalCounter: 0, activeSessionId: 'sess-1' }]]),
      })
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
      useSessionStore.setState({ sessions: new Map([['sess-1', makeSession()]]) })
      useSessionStore.getState().incrementBellCount('sess-1')
      useSessionStore.getState().incrementBellCount('sess-1')
      expect(useSessionStore.getState().getBellCountForSession('sess-1')).toBe(2)
    })

    it('clearBellCount removes entry', () => {
      useSessionStore.setState((st) => ({
        sessions: new Map(
          [...st.sessions].map(([id, se]) => [id, id === 'sess-1' ? { ...se, bellCount: 3 } : se])
        ),
      }))
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
          ['sess-1', { ...s1, bellCount: 2 }],
          ['sess-2', { ...s2, bellCount: 3 }],
          ['sess-3', { ...s3, bellCount: 10 }],
        ]),
      })
      expect(useSessionStore.getState().getBellCountForProject('proj-1')).toBe(5)
      expect(useSessionStore.getState().getBellCountForProject('proj-2')).toBe(10)
    })
  })

  describe('busy state', () => {
    it('setSessionBusy marks session as busy', () => {
      useSessionStore.setState({ sessions: new Map([['sess-1', makeSession()]]) })
      useSessionStore.getState().setSessionBusy('sess-1')
      expect(useSessionStore.getState().isSessionBusy('sess-1')).toBe(true)
    })

    it('setSessionBusy is idempotent (no extra re-renders)', () => {
      useSessionStore.setState({ sessions: new Map([['sess-1', makeSession()]]) })
      useSessionStore.getState().setSessionBusy('sess-1')
      const before = useSessionStore.getState().sessions
      useSessionStore.getState().setSessionBusy('sess-1')
      expect(useSessionStore.getState().sessions).toBe(before)
    })

    it('setSessionIdle removes busy mark', () => {
      useSessionStore.setState({ sessions: new Map([['sess-1', makeSession()]]) })
      useSessionStore.getState().setSessionBusy('sess-1')
      useSessionStore.getState().setSessionIdle('sess-1')
      expect(useSessionStore.getState().isSessionBusy('sess-1')).toBe(false)
    })

    it('setSessionIdle is a no-op when session is not busy', () => {
      const before = useSessionStore.getState().sessions
      useSessionStore.getState().setSessionIdle('not-busy')
      expect(useSessionStore.getState().sessions).toBe(before)
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
          ['sess-2', { ...s2, busy: true }],
        ]),
      })
      expect(useSessionStore.getState().isProjectBusy('proj-1')).toBe(true)
    })

    it('isProjectBusy returns false when no session in project is busy', () => {
      const s1 = makeSession({ id: 'sess-1', projectId: 'proj-1' })
      useSessionStore.setState({
        sessions: new Map([
          ['sess-1', s1],
          [
            'sess-other',
            { ...makeSession({ id: 'sess-other', projectId: 'proj-other' }), busy: true },
          ],
        ]),
      })
      expect(useSessionStore.getState().isProjectBusy('proj-1')).toBe(false)
    })

    it('closeSession clears busy state for the closed session', async () => {
      const session = makeSession()
      useSessionStore.setState({
        sessions: new Map([['sess-1', { ...session, busy: true }]]),
      })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      await useSessionStore.getState().closeSession('sess-1')
      expect(useSessionStore.getState().isSessionBusy('sess-1')).toBe(false)
    })
  })

  describe('setTerminalInstance / getTerminalInstance', () => {
    it('stores and retrieves terminal instance by sessionId', () => {
      const fakeTerminal = { write: vi.fn() }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useSessionStore.getState().setTerminalInstance('sess-1', fakeTerminal as any)
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

  describe('getScratchSessions', () => {
    it('returns sessions with SCRATCH_PROJECT_ID', () => {
      const SCRATCH = '00000000-0000-0000-0000-000000000000'
      const s1 = makeSession({ id: 'sess-1', projectId: SCRATCH })
      const s2 = makeSession({ id: 'sess-2', projectId: 'proj-1' })
      useSessionStore.setState({
        sessions: new Map([
          ['sess-1', s1],
          ['sess-2', s2],
        ]),
      })
      const scratch = useSessionStore.getState().getScratchSessions()
      expect(scratch).toHaveLength(1)
      expect(scratch[0].id).toBe('sess-1')
    })

    it('returns empty array when no scratch sessions exist', () => {
      useSessionStore.setState({ sessions: new Map() })
      expect(useSessionStore.getState().getScratchSessions()).toHaveLength(0)
    })
  })

  describe('reorderSessions', () => {
    it('stores the given order for a project', () => {
      useSessionStore.getState().reorderSessions('proj-1', ['sess-2', 'sess-1'])
      expect(useSessionStore.getState().projectViews.get('proj-1')?.order).toEqual([
        'sess-2',
        'sess-1',
      ])
    })

    it('getSessionsForProject respects the order', () => {
      const s1 = makeSession({ id: 'sess-1', projectId: 'proj-1' })
      const s2 = makeSession({ id: 'sess-2', projectId: 'proj-1' })
      useSessionStore.setState({
        sessions: new Map([
          ['sess-1', s1],
          ['sess-2', s2],
        ]),
      })
      useSessionStore.getState().reorderSessions('proj-1', ['sess-2', 'sess-1'])
      const ordered = useSessionStore.getState().getSessionsForProject('proj-1')
      expect(ordered.map((s) => s.id)).toEqual(['sess-2', 'sess-1'])
    })

    it('untracked sessions appear after ordered ones', () => {
      const s1 = makeSession({ id: 'sess-1', projectId: 'proj-1' })
      const s2 = makeSession({ id: 'sess-2', projectId: 'proj-1' })
      const s3 = makeSession({ id: 'sess-3', projectId: 'proj-1' })
      useSessionStore.setState({
        sessions: new Map([
          ['sess-1', s1],
          ['sess-2', s2],
          ['sess-3', s3],
        ]),
      })
      useSessionStore.getState().reorderSessions('proj-1', ['sess-2', 'sess-1'])
      const ordered = useSessionStore.getState().getSessionsForProject('proj-1')
      expect(ordered[0].id).toBe('sess-2')
      expect(ordered[1].id).toBe('sess-1')
      expect(ordered[2].id).toBe('sess-3')
    })
  })

  describe('moveSession', () => {
    it('updates session projectId to target', () => {
      const s = makeSession({ id: 'sess-1', projectId: 'proj-1' })
      useSessionStore.setState({ sessions: new Map([['sess-1', s]]) })
      useSessionStore.getState().moveSession('sess-1', 'proj-2')
      expect(useSessionStore.getState().sessions.get('sess-1')?.projectId).toBe('proj-2')
    })

    it('updates activeSessionIdByProject — removes from old, sets in target', () => {
      const s = makeSession({ id: 'sess-1', projectId: 'proj-1' })
      useSessionStore.setState({
        sessions: new Map([['sess-1', s]]),
        projectViews: new Map([['proj-1', { terminalCounter: 0, activeSessionId: 'sess-1' }]]),
      })
      useSessionStore.getState().moveSession('sess-1', 'proj-2')
      const active = new Map(
        [...useSessionStore.getState().projectViews].map(([pid, v]) => [pid, v.activeSessionId])
      )
      expect(active.has('proj-1')).toBe(false)
      expect(active.get('proj-2')).toBe('sess-1')
    })

    it('removes sessionId from old project order, appends to target order', () => {
      const s1 = makeSession({ id: 'sess-1', projectId: 'proj-1' })
      const s2 = makeSession({ id: 'sess-2', projectId: 'proj-1' })
      useSessionStore.setState({
        sessions: new Map([
          ['sess-1', s1],
          ['sess-2', s2],
        ]),
        projectViews: new Map([
          ['proj-1', { terminalCounter: 0, order: ['sess-1', 'sess-2'] }],
          ['proj-2', { terminalCounter: 0, order: ['sess-3'] }],
        ]),
      })
      useSessionStore.getState().moveSession('sess-1', 'proj-2')
      expect(useSessionStore.getState().projectViews.get('proj-1')?.order).toEqual(['sess-2'])
      expect(useSessionStore.getState().projectViews.get('proj-2')?.order).toEqual([
        'sess-3',
        'sess-1',
      ])
    })

    it('is a no-op for unknown session', () => {
      expect(() => useSessionStore.getState().moveSession('nonexistent', 'proj-2')).not.toThrow()
    })

    it('clears focusedSession for old project when moved session was focused', () => {
      const s = makeSession({ id: 'sess-1', projectId: 'proj-1' })
      useSessionStore.setState({
        sessions: new Map([['sess-1', s]]),
        projectViews: new Map([['proj-1', { terminalCounter: 0, focusedSessionId: 'sess-1' }]]),
      })
      useSessionStore.getState().moveSession('sess-1', 'proj-2')
      expect(useSessionStore.getState().getFocusedSession('proj-1')).toBeNull()
    })
  })

  describe('closeSession scratch guard', () => {
    it('does not call deleteProject for SCRATCH_PROJECT_ID sessions', async () => {
      const SCRATCH = '00000000-0000-0000-0000-000000000000'
      const session = makeSession({ id: 'sess-1', projectId: SCRATCH })
      useSessionStore.setState({ sessions: new Map([['sess-1', session]]) })
      mockElectronAPI.terminal.close.mockResolvedValue({})
      // If deleteProject were called it would throw (workspace store not mocked)
      await expect(useSessionStore.getState().closeSession('sess-1')).resolves.not.toThrow()
    })
  })
})

describe('adoptSession', () => {
  // A supervised agent's terminal is spawned in the main process; this takes
  // ownership of it so it becomes an ordinary tab.
  const adopted = {
    sessionId: 'terminal-1',
    projectId: 'proj-1',
    tabTitle: 'feat/x',
    scrollbackLimit: 5000,
  }

  beforeEach(() => resetStore())

  it('records it as an agent’s terminal', () => {
    useSessionStore.getState().adoptSession(adopted)
    expect(useSessionStore.getState().sessions.get('terminal-1')).toMatchObject({
      id: 'terminal-1',
      projectId: 'proj-1',
      tabTitle: 'feat/x',
      type: 'agent',
      status: 'active',
    })
  })

  it('shows it, when the project has nothing showing', () => {
    useSessionStore.getState().adoptSession(adopted)
    expect(useSessionStore.getState().getActiveSessionForProject('proj-1')).toBe('terminal-1')
  })

  it('does not steal focus from a terminal the operator is already looking at', () => {
    useSessionStore.setState({
      projectViews: new Map([['proj-1', { activeSessionId: 'existing', terminalCounter: 0 }]]),
    })
    useSessionStore.getState().adoptSession(adopted)
    expect(useSessionStore.getState().getActiveSessionForProject('proj-1')).toBe('existing')
  })

  it('appends to an explicit tab order when the project has one', () => {
    useSessionStore.setState({
      projectViews: new Map([['proj-1', { order: ['sess-1'], terminalCounter: 0 }]]),
    })
    useSessionStore.getState().adoptSession(adopted)
    expect(useSessionStore.getState().projectViews.get('proj-1')?.order).toEqual([
      'sess-1',
      'terminal-1',
    ])
  })

  it('leaves a project with no explicit order without one', () => {
    useSessionStore.getState().adoptSession(adopted)
    expect(useSessionStore.getState().projectViews.get('proj-1')?.order).toBeUndefined()
  })

  it('ignores a repeat, so a re-sent notification is not a second tab', () => {
    useSessionStore.getState().adoptSession(adopted)
    useSessionStore.getState().adoptSession({ ...adopted, tabTitle: 'changed' })
    expect(useSessionStore.getState().sessions.size).toBe(1)
    expect(useSessionStore.getState().sessions.get('terminal-1')?.tabTitle).toBe('feat/x')
  })
})

describe('activity, attention and notes (feature 030)', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  function seed(overrides: Partial<TerminalSession> = {}) {
    const session = makeSession(overrides)
    useSessionStore.setState({ sessions: new Map([[session.id, session]]) })
    return session
  }

  describe('stampActivity', () => {
    it('records the supplied time without reading the clock itself', () => {
      seed({ lastActivityAt: 100 })
      useSessionStore.getState().stampActivity('sess-1', 4242)
      expect(useSessionStore.getState().sessions.get('sess-1')!.lastActivityAt).toBe(4242)
    })

    it('leaves every other field alone', () => {
      const before = seed({ tabTitle: 'Keep me', bellCount: 2 })
      useSessionStore.getState().stampActivity('sess-1', 999)
      const after = useSessionStore.getState().sessions.get('sess-1')!
      expect(after).toEqual({ ...before, lastActivityAt: 999 })
    })

    it('is a no-op for an unknown session', () => {
      const before = useSessionStore.getState().sessions
      useSessionStore.getState().stampActivity('nope', 1)
      expect(useSessionStore.getState().sessions).toBe(before)
    })
  })

  describe('lastActivityAt backfill (FR-007)', () => {
    it('createSession stamps lastActivityAt from createdAt', async () => {
      mockElectronAPI.terminal.create.mockResolvedValue({ sessionId: 'new-1' })
      await useSessionStore.getState().createSession('proj-1', 'human', 'T', '/tmp', 10000)
      const created = useSessionStore.getState().sessions.get('new-1')!
      expect(created.lastActivityAt).toBe(Date.parse(created.createdAt))
    })

    it('adoptSession stamps lastActivityAt from createdAt', () => {
      useSessionStore.getState().adoptSession({
        sessionId: 'adopted-1',
        projectId: 'proj-1',
        tabTitle: 'Agent',
        scrollbackLimit: 10000,
      })
      const adopted = useSessionStore.getState().sessions.get('adopted-1')!
      expect(adopted.lastActivityAt).toBe(Date.parse(adopted.createdAt))
    })

    it('a newly created session starts idle', async () => {
      mockElectronAPI.terminal.create.mockResolvedValue({ sessionId: 'new-2' })
      await useSessionStore.getState().createSession('proj-1', 'human', 'T', '/tmp', 10000)
      expect(useSessionStore.getState().sessions.get('new-2')!.agentState).toBe('idle')
    })
  })

  describe('lastAttendedAt', () => {
    it('is stamped when the session becomes the visible one', () => {
      seed()
      useSessionStore.getState().setActiveSessionForProject('proj-1', 'sess-1', 777)
      expect(useSessionStore.getState().sessions.get('sess-1')!.lastAttendedAt).toBe(777)
    })

    it('is not stamped on the sessions that were deactivated', () => {
      const a = makeSession({ id: 'a' })
      const b = makeSession({ id: 'b' })
      useSessionStore.setState({
        sessions: new Map([
          ['a', a],
          ['b', b],
        ]),
      })
      useSessionStore.getState().setActiveSessionForProject('proj-1', 'a', 555)
      expect(useSessionStore.getState().sessions.get('b')!.lastAttendedAt).toBeUndefined()
    })
  })

  describe('setSessionNote', () => {
    it('stores a trimmed single-line note', () => {
      seed()
      useSessionStore.getState().setSessionNote('sess-1', '  waiting on review  ')
      expect(useSessionStore.getState().sessions.get('sess-1')!.note).toBe('waiting on review')
    })

    it('collapses newlines so the note stays one line', () => {
      seed()
      useSessionStore.getState().setSessionNote('sess-1', 'first\nsecond\r\nthird')
      expect(useSessionStore.getState().sessions.get('sess-1')!.note).toBe('first second third')
    })

    it('caps the note at 120 characters', () => {
      seed()
      useSessionStore.getState().setSessionNote('sess-1', 'x'.repeat(200))
      expect(useSessionStore.getState().sessions.get('sess-1')!.note).toHaveLength(120)
    })

    it('stores an all-whitespace note as undefined, not an empty string', () => {
      seed({ note: 'old' })
      useSessionStore.getState().setSessionNote('sess-1', '   ')
      expect(useSessionStore.getState().sessions.get('sess-1')!.note).toBeUndefined()
    })

    it('is a no-op for an unknown session', () => {
      const before = useSessionStore.getState().sessions
      useSessionStore.getState().setSessionNote('nope', 'hi')
      expect(useSessionStore.getState().sessions).toBe(before)
    })
  })
})
