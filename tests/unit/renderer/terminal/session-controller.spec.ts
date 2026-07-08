import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDispatchNotification } = vi.hoisted(() => ({ mockDispatchNotification: vi.fn() }))
vi.mock('../../../../src/renderer/lib/notifications', () => ({
  dispatchNotification: mockDispatchNotification,
}))

// Capture constructor args + hooks so tests can drive bell/busy/idle events.
let capturedCtorArgs: Array<{
  sessionId: string
  scrollbackLimit: number
  hooks?: { onBell?: () => void; onBusy?: () => void; onIdle?: () => void }
}> = []
vi.mock('../../../../src/renderer/components/terminal/TerminalSession', () => ({
  TerminalInstance: class MockTerminalInstance {
    constructor(
      sessionId: string,
      scrollbackLimit: number,
      hooks?: { onBell?: () => void; onBusy?: () => void; onIdle?: () => void }
    ) {
      capturedCtorArgs.push({ sessionId, scrollbackLimit, hooks })
    }
  },
}))

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: { getState: vi.fn() },
}))
vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: { getState: vi.fn() },
}))

import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import {
  createTerminalSession,
  splitTerminalSession,
} from '../../../../src/renderer/terminal/session-controller'

const mockCreateSession = vi.fn()
const mockSetTerminalInstance = vi.fn()
const mockSetActiveSessionForProject = vi.fn()
const mockActivateSplit = vi.fn()
const mockIncrementBellCount = vi.fn()
const mockSetSessionBusy = vi.fn()
const mockSetSessionIdle = vi.fn()
const mockGetFocusedSession = vi.fn()
const mockGetActiveSessionForProject = vi.fn()

const sessions = new Map<
  string,
  { projectId: string; tabTitle: string; parentSessionId?: string }
>()

beforeEach(() => {
  vi.clearAllMocks()
  capturedCtorArgs = []
  sessions.clear()
  mockCreateSession.mockResolvedValue('session-123')
  vi.mocked(useSessionStore.getState).mockReturnValue({
    sessions,
    createSession: mockCreateSession,
    setTerminalInstance: mockSetTerminalInstance,
    setActiveSessionForProject: mockSetActiveSessionForProject,
    activateSplit: mockActivateSplit,
    incrementBellCount: mockIncrementBellCount,
    setSessionBusy: mockSetSessionBusy,
    setSessionIdle: mockSetSessionIdle,
    getFocusedSession: mockGetFocusedSession,
    getActiveSessionForProject: mockGetActiveSessionForProject,
  } as unknown as ReturnType<typeof useSessionStore.getState>)
  vi.mocked(useWorkspaceStore.getState).mockReturnValue({
    activeProjectId: 'other-project',
  } as unknown as ReturnType<typeof useWorkspaceStore.getState>)
})

describe('createTerminalSession', () => {
  it('creates the store record with the given args and returns the id', async () => {
    const id = await createTerminalSession('proj-1', 'human', 'My Tab', '/repo', 5000, 'parent-1')
    expect(id).toBe('session-123')
    expect(mockCreateSession).toHaveBeenCalledWith(
      'proj-1',
      'human',
      'My Tab',
      '/repo',
      5000,
      'parent-1'
    )
  })

  it('stores the instance before activating the session', async () => {
    const calls: string[] = []
    mockSetTerminalInstance.mockImplementation(() => calls.push('instance'))
    mockSetActiveSessionForProject.mockImplementation(() => calls.push('activate'))
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    expect(calls).toEqual(['instance', 'activate'])
    expect(mockSetTerminalInstance).toHaveBeenCalledWith('session-123', expect.any(Object))
    expect(mockSetActiveSessionForProject).toHaveBeenCalledWith('proj-1', 'session-123')
  })

  it('constructs the instance with the session id, scrollback, and activity hooks', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 7777)
    expect(capturedCtorArgs).toHaveLength(1)
    const { sessionId, scrollbackLimit, hooks } = capturedCtorArgs[0]
    expect(sessionId).toBe('session-123')
    expect(scrollbackLimit).toBe(7777)
    expect(hooks?.onBell).toBeTypeOf('function')
    expect(hooks?.onBusy).toBeTypeOf('function')
    expect(hooks?.onIdle).toBeTypeOf('function')
  })

  it('routes busy/idle events into the session store', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    const { hooks } = capturedCtorArgs[0]
    hooks!.onBusy!()
    expect(mockSetSessionBusy).toHaveBeenCalledWith('session-123')
    hooks!.onIdle!()
    expect(mockSetSessionIdle).toHaveBeenCalledWith('session-123')
  })
})

describe('bell handling', () => {
  async function createAndGetBell(): Promise<() => void> {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    return capturedCtorArgs[0].hooks!.onBell!
  }

  it('increments and notifies when the session is not the active session', async () => {
    sessions.set('session-123', { projectId: 'proj-1', tabTitle: 'My Tab' })
    mockGetActiveSessionForProject.mockReturnValue('some-other-session')
    const bell = await createAndGetBell()
    bell()
    expect(mockIncrementBellCount).toHaveBeenCalledWith('session-123')
    expect(mockDispatchNotification).toHaveBeenCalledWith({
      type: 'info',
      title: 'Terminator',
      message: 'My Tab needs attention',
      key: 'terminalBell',
    })
  })

  it('increments when the session is active but its project is not the active project', async () => {
    sessions.set('session-123', { projectId: 'proj-1', tabTitle: 'My Tab' })
    mockGetActiveSessionForProject.mockReturnValue('session-123')
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      activeProjectId: 'different-project',
    } as unknown as ReturnType<typeof useWorkspaceStore.getState>)
    const bell = await createAndGetBell()
    bell()
    expect(mockIncrementBellCount).toHaveBeenCalledWith('session-123')
  })

  it('does nothing when the session is active in the active project', async () => {
    sessions.set('session-123', { projectId: 'proj-1', tabTitle: 'My Tab' })
    mockGetActiveSessionForProject.mockReturnValue('session-123')
    vi.mocked(useWorkspaceStore.getState).mockReturnValue({
      activeProjectId: 'proj-1',
    } as unknown as ReturnType<typeof useWorkspaceStore.getState>)
    const bell = await createAndGetBell()
    bell()
    expect(mockIncrementBellCount).not.toHaveBeenCalled()
    expect(mockDispatchNotification).not.toHaveBeenCalled()
  })

  it('does not crash when the session is missing from the store', async () => {
    const bell = await createAndGetBell()
    expect(() => bell()).not.toThrow()
    expect(mockIncrementBellCount).not.toHaveBeenCalled()
    expect(mockDispatchNotification).not.toHaveBeenCalled()
  })
})

describe('splitTerminalSession', () => {
  it('does nothing when there is no focused or active session', async () => {
    mockGetFocusedSession.mockReturnValue(null)
    mockGetActiveSessionForProject.mockReturnValue(null)
    await splitTerminalSession('proj-1', 'horizontal', '/repo', 5000)
    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(mockActivateSplit).not.toHaveBeenCalled()
  })

  it('creates a session pinned to the focused session and activates the split', async () => {
    mockGetFocusedSession.mockReturnValue('focused-1')
    sessions.set('focused-1', { projectId: 'proj-1', tabTitle: 'F' })
    await splitTerminalSession('proj-1', 'vertical', '/repo', 5000)
    expect(mockCreateSession).toHaveBeenCalledWith(
      'proj-1',
      'human',
      '',
      '/repo',
      5000,
      'focused-1'
    )
    expect(mockSetTerminalInstance).toHaveBeenCalledWith('session-123', expect.any(Object))
    expect(mockActivateSplit).toHaveBeenCalledWith('proj-1', 'focused-1', 'session-123', 'vertical')
  })

  it('pins to the focused session root when the focused session is itself a split child', async () => {
    mockGetFocusedSession.mockReturnValue('child-1')
    sessions.set('child-1', { projectId: 'proj-1', tabTitle: 'C', parentSessionId: 'root-1' })
    await splitTerminalSession('proj-1', 'horizontal', '/repo', 5000)
    expect(mockCreateSession).toHaveBeenCalledWith('proj-1', 'human', '', '/repo', 5000, 'root-1')
  })

  it('falls back to the active session when nothing is focused', async () => {
    mockGetFocusedSession.mockReturnValue(null)
    mockGetActiveSessionForProject.mockReturnValue('active-9')
    sessions.set('active-9', { projectId: 'proj-1', tabTitle: 'A' })
    await splitTerminalSession('proj-1', 'horizontal', '/repo', 5000)
    expect(mockActivateSplit).toHaveBeenCalledWith(
      'proj-1',
      'active-9',
      'session-123',
      'horizontal'
    )
  })

  it('wires the same bell handling into split instances', async () => {
    mockGetFocusedSession.mockReturnValue('focused-1')
    sessions.set('focused-1', { projectId: 'proj-1', tabTitle: 'F' })
    await splitTerminalSession('proj-1', 'horizontal', '/repo', 5000)
    sessions.set('session-123', { projectId: 'proj-1', tabTitle: 'Split Tab' })
    mockGetActiveSessionForProject.mockReturnValue('other')
    capturedCtorArgs[0].hooks!.onBell!()
    expect(mockIncrementBellCount).toHaveBeenCalledWith('session-123')
    expect(mockDispatchNotification).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Split Tab needs attention' })
    )
  })
})
