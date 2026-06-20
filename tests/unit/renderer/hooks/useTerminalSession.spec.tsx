import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useNotificationStore } from '../../../../src/renderer/stores/notification.store'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: Object.assign(vi.fn(), { getState: vi.fn() }),
}))

const { mockAddNotification } = vi.hoisted(() => ({ mockAddNotification: vi.fn() }))
vi.mock('../../../../src/renderer/stores/notification.store', () => ({
  useNotificationStore: Object.assign(vi.fn(), {
    getState: vi.fn().mockReturnValue({ addNotification: mockAddNotification }),
  }),
}))

vi.mock('../../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: vi.fn().mockReturnValue({
    globalSettings: {
      terminal: {
        scrollToBottomOnMount: false,
        scrollToBottomOnClick: false,
        scrollToBottomOnFocus: false,
        scrollbackLimit: 10000,
        defaultShell: '/bin/zsh',
      },
    },
  }),
}))

// Track the bell callback so we can invoke it in tests
let capturedBellCallback: (() => void) | undefined

// Track constructor args so tests can assert on them
let capturedConstructorArgs: [string, number, (() => void) | undefined] | undefined

// Mock TerminalSession to avoid xterm import issues in test environment
vi.mock('../../../../src/renderer/components/terminal/TerminalSession', () => ({
  TerminalInstance: class MockTerminalInstance {
    constructor(sessionId: string, scrollbackLimit: number, onBell?: () => void) {
      capturedConstructorArgs = [sessionId, scrollbackLimit, onBell]
      capturedBellCallback = onBell
    }
  },
}))

const mockCreateSession = vi.fn().mockResolvedValue('session-123')
const mockSetTerminalInstance = vi.fn()
const mockSetActiveSessionForProject = vi.fn()
const mockIncrementBellCount = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  capturedConstructorArgs = undefined
  Object.assign(useNotificationStore, {
    getState: vi.fn().mockReturnValue({ addNotification: mockAddNotification }),
  })
  vi.mocked(useSessionStore).mockReturnValue({
    createSession: mockCreateSession,
    setTerminalInstance: mockSetTerminalInstance,
    setActiveSessionForProject: mockSetActiveSessionForProject,
    incrementBellCount: mockIncrementBellCount,
  } as unknown as ReturnType<typeof useSessionStore>)
  // Setup getState for use inside the closure
  Object.assign(useSessionStore, {
    getState: vi.fn().mockReturnValue({
      activeSessionIdByProject: new Map(),
      sessions: new Map(),
    }),
  })
  Object.assign(useWorkspaceStore, {
    getState: vi.fn().mockReturnValue({
      activeProjectId: null,
    }),
  })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    terminal: {
      input: vi.fn(),
      resize: vi.fn(),
      onOutput: vi.fn().mockReturnValue(vi.fn()),
    },
    notification: {
      show: vi.fn(),
    },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('useTerminalSession', () => {
  it('returns a createSession function', async () => {
    const { useTerminalSession } = await import('../../../../src/renderer/hooks/useTerminalSession')
    const { result } = renderHook(() => useTerminalSession())
    expect(typeof result.current.createSession).toBe('function')
  })

  it('createSession calls store createSession with correct args', async () => {
    const { useTerminalSession } = await import('../../../../src/renderer/hooks/useTerminalSession')
    const { result } = renderHook(() => useTerminalSession())
    await result.current.createSession('proj-1', 'human', 'Terminal', '/cwd', 5000)
    expect(mockCreateSession).toHaveBeenCalledWith(
      'proj-1',
      'human',
      'Terminal',
      '/cwd',
      5000,
      undefined
    )
  })

  it('createSession stores terminal instance and activates session', async () => {
    const { useTerminalSession } = await import('../../../../src/renderer/hooks/useTerminalSession')
    const { result } = renderHook(() => useTerminalSession())
    await result.current.createSession('proj-1', 'human', 'Terminal', '/cwd', 5000)
    expect(mockSetTerminalInstance).toHaveBeenCalledWith('session-123', expect.anything())
    expect(mockSetActiveSessionForProject).toHaveBeenCalledWith('proj-1', 'session-123')
  })

  it('createSession returns the session id', async () => {
    const { useTerminalSession } = await import('../../../../src/renderer/hooks/useTerminalSession')
    const { result } = renderHook(() => useTerminalSession())
    const sessionId = await result.current.createSession(
      'proj-1',
      'human',
      'Terminal',
      '/cwd',
      5000
    )
    expect(sessionId).toBe('session-123')
  })

  it('bell callback increments bell count when session is not the active session', async () => {
    // Session exists but a different session is the active one for the project
    Object.assign(useSessionStore, {
      getState: vi.fn().mockReturnValue({
        activeSessionIdByProject: new Map([['proj-1', 'other-session']]),
        sessions: new Map([
          ['session-123', { id: 'session-123', projectId: 'proj-1', tabTitle: 'T', type: 'human' }],
        ]),
      }),
    })
    Object.assign(useWorkspaceStore, {
      getState: vi.fn().mockReturnValue({ activeProjectId: 'proj-1' }),
    })

    const { useTerminalSession } = await import('../../../../src/renderer/hooks/useTerminalSession')
    const { result } = renderHook(() => useTerminalSession())
    capturedBellCallback = undefined
    await result.current.createSession('proj-1', 'human', 'Terminal', '/cwd', 5000)

    // Invoke the captured bell callback — session is not active, so count should increment
    capturedBellCallback?.()
    expect(mockIncrementBellCount).toHaveBeenCalledWith('session-123')
  })

  it('bell callback increments when session is active but project is not active', async () => {
    Object.assign(useSessionStore, {
      getState: vi.fn().mockReturnValue({
        activeSessionIdByProject: new Map([['proj-1', 'session-123']]),
        sessions: new Map([
          ['session-123', { id: 'session-123', projectId: 'proj-1', tabTitle: 'T', type: 'human' }],
        ]),
      }),
    })
    // Different project is active
    Object.assign(useWorkspaceStore, {
      getState: vi.fn().mockReturnValue({ activeProjectId: 'proj-2' }),
    })

    const { useTerminalSession } = await import('../../../../src/renderer/hooks/useTerminalSession')
    const { result } = renderHook(() => useTerminalSession())
    capturedBellCallback = undefined
    await result.current.createSession('proj-1', 'human', 'Terminal', '/cwd', 5000)
    capturedBellCallback?.()
    expect(mockIncrementBellCount).toHaveBeenCalledWith('session-123')
  })

  it('bell callback does not increment when session is active and project is active', async () => {
    Object.assign(useSessionStore, {
      getState: vi.fn().mockReturnValue({
        activeSessionIdByProject: new Map([['proj-1', 'session-123']]),
        sessions: new Map([
          ['session-123', { id: 'session-123', projectId: 'proj-1', tabTitle: 'T', type: 'human' }],
        ]),
      }),
    })
    Object.assign(useWorkspaceStore, {
      getState: vi.fn().mockReturnValue({ activeProjectId: 'proj-1' }),
    })

    const { useTerminalSession } = await import('../../../../src/renderer/hooks/useTerminalSession')
    const { result } = renderHook(() => useTerminalSession())
    capturedBellCallback = undefined
    await result.current.createSession('proj-1', 'human', 'Terminal', '/cwd', 5000)
    capturedBellCallback?.()
    // Both active — should NOT increment
    expect(mockIncrementBellCount).not.toHaveBeenCalled()
  })

  it('bell callback does not crash when session is not found in store', async () => {
    // Session not in the sessions map
    Object.assign(useSessionStore, {
      getState: vi.fn().mockReturnValue({
        activeSessionIdByProject: new Map(),
        sessions: new Map(), // empty — session not found
      }),
    })
    Object.assign(useWorkspaceStore, {
      getState: vi.fn().mockReturnValue({ activeProjectId: null }),
    })

    const { useTerminalSession } = await import('../../../../src/renderer/hooks/useTerminalSession')
    const { result } = renderHook(() => useTerminalSession())
    capturedBellCallback = undefined
    await result.current.createSession('proj-1', 'human', 'Terminal', '/cwd', 5000)

    // Should not throw and should not call incrementBellCount
    expect(() => capturedBellCallback?.()).not.toThrow()
    expect(mockIncrementBellCount).not.toHaveBeenCalled()
  })

  describe('splitSession', () => {
    it('returns a splitSession function', async () => {
      const mockActivateSplit = vi.fn()
      vi.mocked(useSessionStore).mockReturnValue({
        createSession: mockCreateSession,
        setTerminalInstance: mockSetTerminalInstance,
        setActiveSessionForProject: mockSetActiveSessionForProject,
        incrementBellCount: mockIncrementBellCount,
        activateSplit: mockActivateSplit,
        getFocusedSession: vi.fn().mockReturnValue(null),
        getActiveSessionForProject: vi.fn().mockReturnValue(null),
      } as unknown as ReturnType<typeof useSessionStore>)
      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      expect(typeof result.current.splitSession).toBe('function')
    })

    it('splitSession does nothing when no focused or active session', async () => {
      vi.mocked(useSessionStore).mockReturnValue({
        createSession: mockCreateSession,
        setTerminalInstance: mockSetTerminalInstance,
        setActiveSessionForProject: mockSetActiveSessionForProject,
        incrementBellCount: mockIncrementBellCount,
        activateSplit: vi.fn(),
        getFocusedSession: vi.fn().mockReturnValue(null),
        getActiveSessionForProject: vi.fn().mockReturnValue(null),
      } as unknown as ReturnType<typeof useSessionStore>)
      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      await result.current.splitSession('proj-1', 'vertical', '/cwd', 5000)
      expect(mockCreateSession).not.toHaveBeenCalled()
    })

    it('creates a session and activates split when focused session exists', async () => {
      const mockActivateSplit = vi.fn()
      vi.mocked(useSessionStore).mockReturnValue({
        createSession: mockCreateSession,
        setTerminalInstance: mockSetTerminalInstance,
        setActiveSessionForProject: mockSetActiveSessionForProject,
        incrementBellCount: mockIncrementBellCount,
        activateSplit: mockActivateSplit,
        getFocusedSession: vi.fn().mockReturnValue('ses-focused'),
        getActiveSessionForProject: vi.fn().mockReturnValue('ses-focused'),
      } as unknown as ReturnType<typeof useSessionStore>)
      Object.assign(useSessionStore, {
        getState: vi.fn().mockReturnValue({
          sessions: new Map([['session-123', { tabTitle: 'Terminal' }]]),
          activeSessionIdByProject: new Map(),
        }),
      })
      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      await result.current.splitSession('proj-1', 'vertical', '/cwd', 5000)
      expect(mockCreateSession).toHaveBeenCalledWith(
        'proj-1',
        'human',
        '',
        '/cwd',
        5000,
        'ses-focused'
      )
      expect(mockSetTerminalInstance).toHaveBeenCalled()
      expect(mockActivateSplit).toHaveBeenCalledWith(
        'proj-1',
        'ses-focused',
        'session-123',
        'vertical'
      )
    })

    it('uses getActiveSessionForProject when getFocusedSession returns null', async () => {
      const mockActivateSplit = vi.fn()
      vi.mocked(useSessionStore).mockReturnValue({
        createSession: mockCreateSession,
        setTerminalInstance: mockSetTerminalInstance,
        setActiveSessionForProject: mockSetActiveSessionForProject,
        incrementBellCount: mockIncrementBellCount,
        activateSplit: mockActivateSplit,
        getFocusedSession: vi.fn().mockReturnValue(null),
        getActiveSessionForProject: vi.fn().mockReturnValue('ses-active'),
      } as unknown as ReturnType<typeof useSessionStore>)
      Object.assign(useSessionStore, {
        getState: vi.fn().mockReturnValue({
          sessions: new Map([['session-123', { tabTitle: 'Terminal' }]]),
          activeSessionIdByProject: new Map(),
        }),
      })
      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      await result.current.splitSession('proj-1', 'horizontal', '/cwd', 5000)
      expect(mockActivateSplit).toHaveBeenCalledWith(
        'proj-1',
        'ses-active',
        'session-123',
        'horizontal'
      )
    })

    it('splitSession bell callback fires incrementBellCount, notification.show, and addNotification', async () => {
      const mockActivateSplit = vi.fn()
      vi.mocked(useSessionStore).mockReturnValue({
        createSession: mockCreateSession,
        setTerminalInstance: mockSetTerminalInstance,
        setActiveSessionForProject: mockSetActiveSessionForProject,
        incrementBellCount: mockIncrementBellCount,
        activateSplit: mockActivateSplit,
        getFocusedSession: vi.fn().mockReturnValue('ses-focused'),
        getActiveSessionForProject: vi.fn().mockReturnValue('ses-focused'),
      } as unknown as ReturnType<typeof useSessionStore>)
      Object.assign(useSessionStore, {
        getState: vi.fn().mockReturnValue({
          sessions: new Map([['session-123', { tabTitle: 'Split Terminal' }]]),
          activeSessionIdByProject: new Map(),
        }),
      })
      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      capturedBellCallback = undefined
      await result.current.splitSession('proj-1', 'vertical', '/cwd', 5000)

      capturedBellCallback?.()

      expect(mockIncrementBellCount).toHaveBeenCalledWith('session-123')
      expect(
        (
          globalThis as unknown as {
            electronAPI: { notification: { show: ReturnType<typeof vi.fn> } }
          }
        ).electronAPI.notification.show
      ).toHaveBeenCalledWith('Terminator', 'Split Terminal needs attention')
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Terminator',
          message: 'Split Terminal needs attention',
          type: 'info',
          id: expect.any(String),
          timestamp: expect.any(Number),
        })
      )
    })

    it('splitSession bell callback does not fire when session is not found in store', async () => {
      // Consistent with createSession: if the session record is gone, no notification is sent.
      const mockActivateSplit = vi.fn()
      vi.mocked(useSessionStore).mockReturnValue({
        createSession: mockCreateSession,
        setTerminalInstance: mockSetTerminalInstance,
        setActiveSessionForProject: mockSetActiveSessionForProject,
        incrementBellCount: mockIncrementBellCount,
        activateSplit: mockActivateSplit,
        getFocusedSession: vi.fn().mockReturnValue('ses-focused'),
        getActiveSessionForProject: vi.fn().mockReturnValue('ses-focused'),
      } as unknown as ReturnType<typeof useSessionStore>)
      Object.assign(useSessionStore, {
        getState: vi.fn().mockReturnValue({
          sessions: new Map(), // session not in map
          activeSessionIdByProject: new Map(),
        }),
      })
      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      capturedBellCallback = undefined
      await result.current.splitSession('proj-1', 'vertical', '/cwd', 5000)

      capturedBellCallback?.()

      expect(mockAddNotification).not.toHaveBeenCalled()
    })
  })

  describe('bell event — addNotification integration', () => {
    it('calls addNotification with correct title and message when bell fires in backgrounded session', async () => {
      Object.assign(useSessionStore, {
        getState: vi.fn().mockReturnValue({
          activeSessionIdByProject: new Map([['proj-1', 'other-session']]),
          sessions: new Map([
            [
              'session-123',
              { id: 'session-123', projectId: 'proj-1', tabTitle: 'My Tab', type: 'human' },
            ],
          ]),
        }),
      })
      Object.assign(useWorkspaceStore, {
        getState: vi.fn().mockReturnValue({ activeProjectId: 'proj-1' }),
      })

      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      capturedBellCallback = undefined
      await result.current.createSession('proj-1', 'human', 'My Tab', '/cwd', 5000)
      capturedBellCallback?.()

      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Terminator',
          message: 'My Tab needs attention',
        })
      )
    })

    it('addNotification payload includes an id and a timestamp', async () => {
      Object.assign(useSessionStore, {
        getState: vi.fn().mockReturnValue({
          activeSessionIdByProject: new Map([['proj-1', 'other-session']]),
          sessions: new Map([
            [
              'session-123',
              { id: 'session-123', projectId: 'proj-1', tabTitle: 'Terminal', type: 'human' },
            ],
          ]),
        }),
      })
      Object.assign(useWorkspaceStore, {
        getState: vi.fn().mockReturnValue({ activeProjectId: 'proj-1' }),
      })

      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      capturedBellCallback = undefined
      await result.current.createSession('proj-1', 'human', 'Terminal', '/cwd', 5000)
      capturedBellCallback?.()

      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          timestamp: expect.any(Number),
        })
      )
    })

    it('still calls notification.show (native) when bell fires in backgrounded session', async () => {
      Object.assign(useSessionStore, {
        getState: vi.fn().mockReturnValue({
          activeSessionIdByProject: new Map([['proj-1', 'other-session']]),
          sessions: new Map([
            [
              'session-123',
              { id: 'session-123', projectId: 'proj-1', tabTitle: 'Terminal', type: 'human' },
            ],
          ]),
        }),
      })
      Object.assign(useWorkspaceStore, {
        getState: vi.fn().mockReturnValue({ activeProjectId: 'proj-1' }),
      })

      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      capturedBellCallback = undefined
      await result.current.createSession('proj-1', 'human', 'Terminal', '/cwd', 5000)
      capturedBellCallback?.()

      expect(
        (
          globalThis as unknown as {
            electronAPI: { notification: { show: ReturnType<typeof vi.fn> } }
          }
        ).electronAPI.notification.show
      ).toHaveBeenCalledWith('Terminator', 'Terminal needs attention')
    })

    it('does not call addNotification when bell fires for the currently active session in the active project', async () => {
      Object.assign(useSessionStore, {
        getState: vi.fn().mockReturnValue({
          activeSessionIdByProject: new Map([['proj-1', 'session-123']]),
          sessions: new Map([
            [
              'session-123',
              { id: 'session-123', projectId: 'proj-1', tabTitle: 'Terminal', type: 'human' },
            ],
          ]),
        }),
      })
      Object.assign(useWorkspaceStore, {
        getState: vi.fn().mockReturnValue({ activeProjectId: 'proj-1' }),
      })

      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      capturedBellCallback = undefined
      await result.current.createSession('proj-1', 'human', 'Terminal', '/cwd', 5000)
      capturedBellCallback?.()

      expect(mockAddNotification).not.toHaveBeenCalled()
    })

    it('splitSession bell callback does not fire when session is active and project is active', async () => {
      // Regression test: splitSession previously omitted this guard
      const mockActivateSplit = vi.fn()
      vi.mocked(useSessionStore).mockReturnValue({
        createSession: mockCreateSession,
        setTerminalInstance: mockSetTerminalInstance,
        setActiveSessionForProject: mockSetActiveSessionForProject,
        incrementBellCount: mockIncrementBellCount,
        activateSplit: mockActivateSplit,
        getFocusedSession: vi.fn().mockReturnValue('ses-focused'),
        getActiveSessionForProject: vi.fn().mockReturnValue('ses-focused'),
      } as unknown as ReturnType<typeof useSessionStore>)
      Object.assign(useSessionStore, {
        getState: vi.fn().mockReturnValue({
          activeSessionIdByProject: new Map([['proj-1', 'session-123']]),
          sessions: new Map([['session-123', { projectId: 'proj-1', tabTitle: 'Split' }]]),
        }),
      })
      Object.assign(useWorkspaceStore, {
        getState: vi.fn().mockReturnValue({ activeProjectId: 'proj-1' }),
      })
      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      capturedBellCallback = undefined
      await result.current.splitSession('proj-1', 'vertical', '/cwd', 5000)
      capturedBellCallback?.()

      expect(mockAddNotification).not.toHaveBeenCalled()
      expect(mockIncrementBellCount).not.toHaveBeenCalled()
    })
  })

  describe('TerminalInstance constructor', () => {
    it('createSession constructs TerminalInstance with (sessionId, scrollbackLimit, onBell) — no scroll flag', async () => {
      capturedConstructorArgs = undefined
      const { useTerminalSession } = await import(
        '../../../../src/renderer/hooks/useTerminalSession'
      )
      const { result } = renderHook(() => useTerminalSession())
      await result.current.createSession('proj-1', 'human', 'Terminal', '/cwd', 5000)
      expect(capturedConstructorArgs).toBeDefined()
      const [sessionId, scrollbackLimit, onBell] = capturedConstructorArgs!
      expect(sessionId).toBe('session-123')
      expect(scrollbackLimit).toBe(5000)
      expect(typeof onBell).toBe('function')
    })
  })
})
