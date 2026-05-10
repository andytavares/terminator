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

// Mock TerminalSession to avoid xterm import issues in test environment
vi.mock('../../../../src/renderer/components/terminal/TerminalSession', () => ({
  TerminalInstance: class MockTerminalInstance {
    constructor(_sessionId: string, _scrollbackLimit: number, _onBell?: () => void) {}
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
  } as any)
  // Setup getState for use inside the closure
  ;(useSessionStore as any).getState = vi.fn().mockReturnValue({
    activeSessionIdByProject: new Map(),
    sessions: new Map(),
  })
  ;(useWorkspaceStore as any).getState = vi.fn().mockReturnValue({
    activeProjectId: null,
  })
  ;(globalThis as any).electronAPI = {
    terminal: {
      input: vi.fn(),
      resize: vi.fn(),
      onOutput: vi.fn().mockReturnValue(vi.fn()),
    },
  }
})

afterEach(() => {
  delete (globalThis as any).electronAPI
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
})
