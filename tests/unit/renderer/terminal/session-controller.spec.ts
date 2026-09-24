import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockDispatchNotification } = vi.hoisted(() => ({ mockDispatchNotification: vi.fn() }))
vi.mock('../../../../src/renderer/lib/notifications', () => ({
  dispatchNotification: mockDispatchNotification,
}))

// Capture constructor args + hooks so tests can drive bell/busy/idle events.
let screenRows: string[] = []
let screenCursor = 99
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
    readVisibleRows(): string[] {
      return screenRows
    }
    cursorRow(): number {
      return screenCursor
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
  adoptTerminalSession,
  createTerminalSession,
  splitTerminalSession,
  setActivityClock,
  resetActivityThrottle,
  answerChoice,
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
const mockAdoptSession = vi.fn()
const mockStampActivity = vi.fn()
const mockSetSessionScreen = vi.fn()
const mockGetTerminalInstance = vi.fn()
const mockInput = vi.fn()
const mockRequestFocus = vi.fn()

const sessions = new Map<
  string,
  {
    projectId: string
    tabTitle: string
    parentSessionId?: string
    latestLine?: string
    choicePrompt?: unknown
  }
>()

beforeEach(() => {
  vi.clearAllMocks()
  capturedCtorArgs = []
  screenRows = []
  screenCursor = 99
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
    adoptSession: mockAdoptSession,
    stampActivity: mockStampActivity,
    setSessionScreen: mockSetSessionScreen,
    getTerminalInstance: mockGetTerminalInstance,
    requestFocus: mockRequestFocus,
  } as unknown as ReturnType<typeof useSessionStore.getState>)
  resetActivityThrottle()
  setActivityClock(() => 0)
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
      'parent-1',
      undefined
    )
  })

  it('carries the line a resuming terminal opens with', async () => {
    await createTerminalSession(
      'proj-1',
      'human',
      'My Tab',
      '/repo',
      5000,
      undefined,
      'claude --resume abc'
    )
    expect(mockCreateSession).toHaveBeenCalledWith(
      'proj-1',
      'human',
      'My Tab',
      '/repo',
      5000,
      undefined,
      'claude --resume abc'
    )
  })

  // A branch whose worktree was removed outside the app: the main process
  // refuses the spawn, and the operator gets the folder's name rather than a
  // tab that opens and instantly dies with nothing in it.
  it('reports a terminal that could not start, and opens no tab', async () => {
    mockCreateSession.mockRejectedValueOnce(
      new Error('That folder no longer exists: /repo/.worktrees/removed')
    )

    await expect(createTerminalSession('proj-1', 'human', 'T', '/gone', 5000)).rejects.toThrow(
      '/repo/.worktrees/removed'
    )

    expect(mockDispatchNotification).toHaveBeenCalledWith({
      type: 'error',
      title: 'Could not open a terminal',
      message: 'That folder no longer exists: /repo/.worktrees/removed',
      key: 'terminalStartFailed',
    })
    expect(mockSetTerminalInstance).not.toHaveBeenCalled()
    expect(mockSetActiveSessionForProject).not.toHaveBeenCalled()
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

  it('routes busy events into the session store, and idle after the working hold', async () => {
    vi.useFakeTimers()
    try {
      await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
      const { hooks } = capturedCtorArgs[0]
      hooks!.onBusy!()
      expect(mockSetSessionBusy).toHaveBeenCalledWith('session-123')
      hooks!.onIdle!()
      expect(mockSetSessionIdle).not.toHaveBeenCalled()
      vi.advanceTimersByTime(3500)
      expect(mockSetSessionIdle).toHaveBeenCalledWith('session-123')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the screen when output settles, and records its last line', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    screenRows = ['$ pnpm test', '  14 passed, 2 failed', '', '']
    capturedCtorArgs[0].hooks!.onIdle!()
    expect(mockSetSessionScreen).toHaveBeenCalledWith(
      'session-123',
      expect.objectContaining({ latestLine: '14 passed, 2 failed' })
    )
  })

  it('requests focus for the new session, so its pane grabs the keyboard', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    expect(mockRequestFocus).toHaveBeenCalledWith('session-123')
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
      sessionId: 'session-123',
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

describe('adoptTerminalSession', () => {
  // A supervised agent's terminal is spawned in the main process. The store
  // record alone is not a tab you can see: without an xterm instance nothing
  // ever mounts and the project opens empty, which is the invisible agent this
  // runtime exists to have got rid of.
  const adopted = {
    sessionId: 'terminal-1',
    projectId: 'proj-1',
    tabTitle: 'feat/x',
    scrollbackLimit: 5000,
  }

  it('records the session', () => {
    adoptTerminalSession(adopted)
    expect(mockAdoptSession).toHaveBeenCalledWith(adopted)
  })

  it('builds the xterm instance, without which no pane ever mounts', () => {
    adoptTerminalSession(adopted)
    expect(capturedCtorArgs).toEqual([
      expect.objectContaining({ sessionId: 'terminal-1', scrollbackLimit: 5000 }),
    ])
  })

  it('stores the instance before activating, so the pane effect finds it', () => {
    mockGetActiveSessionForProject.mockReturnValue(null)
    adoptTerminalSession(adopted)
    const instanceCall = mockSetTerminalInstance.mock.invocationCallOrder[0]
    const activateCall = mockSetActiveSessionForProject.mock.invocationCallOrder[0]
    expect(instanceCall).toBeLessThan(activateCall)
  })

  it('shows it when the project has nothing selected', () => {
    mockGetActiveSessionForProject.mockReturnValue(null)
    adoptTerminalSession(adopted)
    expect(mockSetActiveSessionForProject).toHaveBeenCalledWith('proj-1', 'terminal-1')
  })

  it('does not steal focus from the terminal being read', () => {
    // A supervised run starting in the background used to yank the operator
    // away from whatever they had open in that project.
    mockGetActiveSessionForProject.mockReturnValue('the-one-being-read')
    adoptTerminalSession(adopted)
    expect(mockSetActiveSessionForProject).not.toHaveBeenCalled()
  })

  it('does nothing for a session it already has, so a repeat is not a second tab', () => {
    sessions.set('terminal-1', { projectId: 'proj-1', tabTitle: 'feat/x' })
    adoptTerminalSession(adopted)
    expect(mockAdoptSession).not.toHaveBeenCalled()
    expect(capturedCtorArgs).toEqual([])
  })

  it('wires bell, busy and idle exactly as a terminal the operator opened', () => {
    vi.useFakeTimers()
    try {
      adoptTerminalSession(adopted)
      capturedCtorArgs[0].hooks?.onBusy?.()
      capturedCtorArgs[0].hooks?.onIdle?.()
      expect(mockSetSessionBusy).toHaveBeenCalledWith('terminal-1')
      vi.advanceTimersByTime(3500)
      expect(mockSetSessionIdle).toHaveBeenCalledWith('terminal-1')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('activity stamping throttle (FR-002)', () => {
  // onBusy fires on every PTY output chunk. Without a throttle a chatty agent
  // would write to the store — and re-render the sidebar — per chunk.
  async function busyHookFor(sessionId: string) {
    mockCreateSession.mockResolvedValue(sessionId)
    await createTerminalSession('proj-1', 'agent', 'A', '/repo', 5000)
    const hooks = capturedCtorArgs.at(-1)!.hooks!
    return hooks.onBusy!
  }

  it('writes once for a burst of output inside one second', async () => {
    const now = 1_000
    setActivityClock(() => now)
    const onBusy = await busyHookFor('s1')
    mockStampActivity.mockClear()
    for (let i = 0; i < 100; i++) onBusy()
    expect(mockStampActivity).toHaveBeenCalledTimes(1)
    expect(mockStampActivity).toHaveBeenCalledWith('s1', 1_000)
  })

  it('writes again once the clock passes one second', async () => {
    let now = 1_000
    setActivityClock(() => now)
    const onBusy = await busyHookFor('s1')
    mockStampActivity.mockClear()
    onBusy()
    now = 2_001
    onBusy()
    expect(mockStampActivity).toHaveBeenCalledTimes(2)
    expect(mockStampActivity).toHaveBeenLastCalledWith('s1', 2_001)
  })

  it('writes again exactly at the one-second boundary — "at most once per second" allows it', async () => {
    let now = 1_000
    setActivityClock(() => now)
    const onBusy = await busyHookFor('s1')
    mockStampActivity.mockClear()
    onBusy()
    now = 2_000
    onBusy()
    expect(mockStampActivity).toHaveBeenCalledTimes(2)
  })

  it('suppresses a write one millisecond short of the boundary', async () => {
    let now = 1_000
    setActivityClock(() => now)
    const onBusy = await busyHookFor('s1')
    mockStampActivity.mockClear()
    onBusy()
    now = 1_999
    onBusy()
    expect(mockStampActivity).toHaveBeenCalledTimes(1)
  })

  it('throttles each session independently', async () => {
    setActivityClock(() => 5_000)
    const first = await busyHookFor('s1')
    const second = await busyHookFor('s2')
    mockStampActivity.mockClear()
    first()
    second()
    expect(mockStampActivity).toHaveBeenCalledTimes(2)
    expect(mockStampActivity.mock.calls.map((c) => c[0])).toEqual(['s1', 's2'])
  })

  it('still marks the session busy on every chunk — only the stamp is throttled', async () => {
    setActivityClock(() => 1_000)
    const onBusy = await busyHookFor('s1')
    mockSetSessionBusy.mockClear()
    onBusy()
    onBusy()
    onBusy()
    expect(mockSetSessionBusy).toHaveBeenCalledTimes(3)
  })

  it('stamps activity when the session goes idle so the last byte counts', async () => {
    setActivityClock(() => 9_000)
    mockCreateSession.mockResolvedValue('s1')
    await createTerminalSession('proj-1', 'agent', 'A', '/repo', 5000)
    const hooks = capturedCtorArgs.at(-1)!.hooks!
    mockStampActivity.mockClear()
    hooks.onIdle!()
    expect(mockStampActivity).toHaveBeenCalledWith('s1', 9_000)
  })
})

const PROMPT_ROWS = [
  '⏺ Write(a.txt)',
  ' Do you want to create a.txt?',
  ' ❯ 1. Yes',
  '   2. No',
  ' Esc to cancel',
  '',
]
const PROMPT = {
  question: 'Do you want to create a.txt?',
  options: [
    { number: 1, label: 'Yes' },
    { number: 2, label: 'No' },
  ],
}

describe('reading a choice prompt off the screen (054)', () => {
  it('records the prompt a settled screen shows', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    screenRows = PROMPT_ROWS
    capturedCtorArgs[0].hooks!.onIdle!()
    expect(mockSetSessionScreen).toHaveBeenCalledWith('session-123', {
      latestLine: 'Esc to cancel',
      choicePrompt: PROMPT,
    })
  })

  it('forgets the prompt as soon as output moves again', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    capturedCtorArgs[0].hooks!.onBusy!()
    mockSetSessionScreen.mockClear()
    sessions.set('session-123', { projectId: 'proj-1', tabTitle: 'T', choicePrompt: PROMPT })
    screenRows = ['⏺ Wrote 1 line to a.txt', '']
    capturedCtorArgs[0].hooks!.onBusy!()
    expect(mockSetSessionScreen).toHaveBeenCalledWith('session-123', {
      latestLine: '⏺ Wrote 1 line to a.txt',
      choicePrompt: null,
    })
  })

  it('refreshes the latest line of a session that never settles, once a second', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    sessions.set('session-123', { projectId: 'proj-1', tabTitle: 'T' })
    screenRows = ['17:02:21 14 passed', '']
    capturedCtorArgs[0].hooks!.onBusy!()
    expect(mockSetSessionScreen).toHaveBeenCalledWith('session-123', {
      latestLine: '17:02:21 14 passed',
      choicePrompt: null,
    })
    mockSetSessionScreen.mockClear()
    capturedCtorArgs[0].hooks!.onBusy!()
    expect(mockSetSessionScreen).not.toHaveBeenCalled()
    setActivityClock(() => 1000)
    capturedCtorArgs[0].hooks!.onBusy!()
    expect(mockSetSessionScreen).toHaveBeenCalledTimes(1)
  })

  it('reads the latest line from above the cursor', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    screenRows = ['$ pnpm test', '14 passed, 2 failed', 'me@host $ ', '']
    screenCursor = 2
    capturedCtorArgs[0].hooks!.onIdle!()
    expect(mockSetSessionScreen).toHaveBeenCalledWith(
      'session-123',
      expect.objectContaining({ latestLine: '14 passed, 2 failed' })
    )
  })
})

describe('working hold before idle (058)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the screen at settle but stays busy until the hold elapses', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    screenRows = ['$ pnpm test', '  14 passed, 2 failed', '', '']
    capturedCtorArgs[0].hooks!.onIdle!()
    expect(mockSetSessionScreen).toHaveBeenCalledWith(
      'session-123',
      expect.objectContaining({ latestLine: '14 passed, 2 failed' })
    )
    expect(mockSetSessionIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3499)
    expect(mockSetSessionIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(mockSetSessionIdle).toHaveBeenCalledWith('session-123')
  })

  it('a choice prompt on screen is reported immediately at settle, before the hold', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    screenRows = PROMPT_ROWS
    capturedCtorArgs[0].hooks!.onIdle!()
    expect(mockSetSessionScreen).toHaveBeenCalledWith('session-123', {
      latestLine: 'Esc to cancel',
      choicePrompt: PROMPT,
    })
    expect(mockSetSessionIdle).not.toHaveBeenCalled()
  })

  it('a busy event inside the hold cancels the pending idle', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    const { hooks } = capturedCtorArgs[0]
    hooks!.onIdle!()
    vi.advanceTimersByTime(2000)
    hooks!.onBusy!()
    vi.advanceTimersByTime(3500)
    expect(mockSetSessionIdle).not.toHaveBeenCalled()
  })

  it('disposing the instance clears its pending idle timer', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    const { hooks } = capturedCtorArgs[0]
    hooks!.onIdle!()
    hooks!.onDispose!()
    vi.advanceTimersByTime(3500)
    expect(mockSetSessionIdle).not.toHaveBeenCalled()
  })
})

describe('answerChoice (054)', () => {
  beforeEach(() => {
    // A node-project spec: the controller only reaches window.electronAPI.
    vi.stubGlobal('window', { electronAPI: { terminal: { input: mockInput } } })
    sessions.set('s1', { projectId: 'p', tabTitle: 'claude', latestLine: '', choicePrompt: PROMPT })
    mockGetTerminalInstance.mockReturnValue({ readVisibleRows: () => screenRows })
  })

  it('types the option number when the prompt is still on screen', () => {
    screenRows = PROMPT_ROWS
    expect(answerChoice('s1', 2)).toBe(true)
    expect(mockInput).toHaveBeenCalledWith('s1', '2')
  })

  it('sends nothing and drops the buttons when the prompt has changed', () => {
    screenRows = PROMPT_ROWS.map((r) => r.replace('2. No', '2. No, and tell Claude why'))
    expect(answerChoice('s1', 1)).toBe(false)
    expect(mockInput).not.toHaveBeenCalled()
    expect(mockSetSessionScreen).toHaveBeenCalledWith('s1', { latestLine: '', choicePrompt: null })
  })

  it('sends nothing when the prompt has gone', () => {
    screenRows = ['⏺ Done.', '']
    expect(answerChoice('s1', 1)).toBe(false)
    expect(mockInput).not.toHaveBeenCalled()
  })

  it('sends nothing for a number the prompt does not offer', () => {
    screenRows = PROMPT_ROWS
    expect(answerChoice('s1', 3)).toBe(false)
    expect(mockInput).not.toHaveBeenCalled()
  })

  it('sends nothing for a session without a terminal', () => {
    mockGetTerminalInstance.mockReturnValue(undefined)
    expect(answerChoice('s1', 1)).toBe(false)
    expect(mockInput).not.toHaveBeenCalled()
  })
})
