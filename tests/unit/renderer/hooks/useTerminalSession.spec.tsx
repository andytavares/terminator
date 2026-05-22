import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: Object.assign(vi.fn(), { getState: vi.fn() }),
}))

// Track the bell callback so we can invoke it in tests
let capturedBellCallback: (() => void) | undefined

// Mock TerminalSession to avoid xterm import issues in test environment
vi.mock('../../../../src/renderer/components/terminal/TerminalSession', () => ({
  TerminalInstance: class MockTerminalInstance {
    constructor(_sessionId: string, _scrollbackLimit: number, onBell?: () => void) {
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
    expect(mockCreateSession).toHaveBeenCalledWith('proj-1', 'human', 'Terminal', '/cwd', 5000)
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
})
