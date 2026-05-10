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
})
