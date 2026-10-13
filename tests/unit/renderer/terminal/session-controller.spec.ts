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
  hooks?: {
    onBell?: () => void
    onBusy?: () => void
    onIdle?: () => void
    onDispose?: () => void
  }
}> = []
vi.mock('../../../../src/renderer/components/terminal/TerminalSession', () => ({
  TerminalInstance: class MockTerminalInstance {
    constructor(
      sessionId: string,
      scrollbackLimit: number,
      hooks?: {
        onBell?: () => void
        onBusy?: () => void
        onIdle?: () => void
        onDispose?: () => void
      }
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

import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { leafIds } from '../../../../src/renderer/utils/pane-tree'
import { terminalSessionOf } from '../../../support/renderer-stores'
import type { TerminalSession } from '../../../../src/shared/types/index'
import {
  adoptTerminalSession,
  createTerminalSession,
  splitTerminalSession,
  setActivityClock,
  resetActivityThrottle,
  answerChoice,
} from '../../../../src/renderer/terminal/session-controller'

// The main process's side of the terminal calls. The session store is the
// real one: what the controller does shows up as the state it leaves there.
const terminalApi = {
  create: vi.fn<Window['electronAPI']['terminal']['create']>(),
  input: vi.fn<Window['electronAPI']['terminal']['input']>(),
}

const sessionOf = (id: string): TerminalSession | undefined =>
  useSessionStore.getState().sessions.get(id)
const activeIn = (projectId: string): string | null =>
  useSessionStore.getState().getActiveSessionForProject(projectId)
/** Puts a session in the store as if it had been open a while. */
const addSession = (id: string, patch: Partial<TerminalSession> = {}): void =>
  useSessionStore.setState((s) => ({
    sessions: new Map(s.sessions).set(id, terminalSessionOf({ id, projectId: 'proj-1', ...patch })),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  // A node-project spec: the controller and the store only reach window.electronAPI.
  vi.stubGlobal('window', { electronAPI: { terminal: terminalApi } })
  capturedCtorArgs = []
  screenRows = []
  screenCursor = 99
  terminalApi.create.mockResolvedValue({ sessionId: 'session-123' })
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useWorkspaceStore.setState({ activeProjectId: 'other-project' })
  resetActivityThrottle()
  setActivityClock(() => 0)
})

describe('createTerminalSession', () => {
  it('records the session with the given args and returns the id', async () => {
    const id = await createTerminalSession('proj-1', 'human', 'My Tab', '/repo', 5000, 'parent-1')
    expect(id).toBe('session-123')
    expect(sessionOf('session-123')).toMatchObject({
      projectId: 'proj-1',
      type: 'human',
      tabTitle: 'My Tab',
      scrollbackLimit: 5000,
      parentSessionId: 'parent-1',
    })
    expect(terminalApi.create).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo' }))
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
    expect(terminalApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ initialCommand: 'claude --resume abc' })
    )
  })

  // A branch whose worktree was removed outside the app: the main process
  // refuses the spawn, and the operator gets the folder's name rather than a
  // tab that opens and instantly dies with nothing in it.
  it('reports a terminal that could not start, and opens no tab', async () => {
    terminalApi.create.mockResolvedValueOnce({
      error: 'CWD_MISSING',
      message: 'That folder no longer exists: /repo/.worktrees/removed',
    })

    await expect(createTerminalSession('proj-1', 'human', 'T', '/gone', 5000)).rejects.toThrow(
      '/repo/.worktrees/removed'
    )

    expect(mockDispatchNotification).toHaveBeenCalledWith({
      type: 'error',
      title: 'Could not open a terminal',
      message: 'That folder no longer exists: /repo/.worktrees/removed',
      key: 'terminalStartFailed',
    })
    expect(useSessionStore.getState().sessions.size).toBe(0)
    expect(useSessionStore.getState().terminalInstances.size).toBe(0)
    expect(activeIn('proj-1')).toBeNull()
  })

  it('stores the instance before activating the session', async () => {
    const seen: string[] = []
    const stop = useSessionStore.subscribe((state) => {
      if (state.terminalInstances.has('session-123') && !seen.includes('instance'))
        seen.push('instance')
      if (
        state.projectViews.get('proj-1')?.activeSessionId === 'session-123' &&
        !seen.includes('activate')
      )
        seen.push('activate')
    })
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    stop()
    expect(seen).toEqual(['instance', 'activate'])
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

  it('marks the session busy on output, and idle after the working hold', async () => {
    vi.useFakeTimers()
    try {
      await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
      const { hooks } = capturedCtorArgs[0]
      hooks!.onBusy!()
      expect(sessionOf('session-123')!.busy).toBe(true)
      hooks!.onIdle!()
      expect(sessionOf('session-123')!.busy).toBe(true)
      vi.advanceTimersByTime(3500)
      expect(sessionOf('session-123')!.busy).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the screen when output settles, and records its last line', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    screenRows = ['$ pnpm test', '  14 passed, 2 failed', '', '']
    capturedCtorArgs[0].hooks!.onIdle!()
    expect(sessionOf('session-123')!.latestLine).toBe('14 passed, 2 failed')
  })

  it('requests focus for the new session, so its pane grabs the keyboard', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    expect(useSessionStore.getState().focusRequest?.sessionId).toBe('session-123')
  })
})

describe('bell handling', () => {
  async function createAndGetBell(): Promise<() => void> {
    await createTerminalSession('proj-1', 'human', 'My Tab', '/repo', 5000)
    return capturedCtorArgs[0].hooks!.onBell!
  }

  it('counts and notifies when the session is not the active session', async () => {
    const bell = await createAndGetBell()
    useSessionStore.getState().setActiveSessionForProject('proj-1', 'some-other-session')
    bell()
    expect(sessionOf('session-123')!.bellCount).toBe(1)
    expect(mockDispatchNotification).toHaveBeenCalledWith({
      type: 'info',
      title: 'Terminator',
      message: 'My Tab needs attention',
      key: 'terminalBell',
      sessionId: 'session-123',
    })
  })

  it('counts when the session is active but its project is not the active project', async () => {
    const bell = await createAndGetBell()
    useWorkspaceStore.setState({ activeProjectId: 'different-project' })
    bell()
    expect(activeIn('proj-1')).toBe('session-123')
    expect(sessionOf('session-123')!.bellCount).toBe(1)
  })

  it('does nothing when the session is active in the active project', async () => {
    const bell = await createAndGetBell()
    useWorkspaceStore.setState({ activeProjectId: 'proj-1' })
    bell()
    expect(sessionOf('session-123')!.bellCount).toBeUndefined()
    expect(mockDispatchNotification).not.toHaveBeenCalled()
  })

  it('does not crash when the session is missing from the store', async () => {
    const bell = await createAndGetBell()
    useSessionStore.setState({ sessions: new Map() })
    expect(() => bell()).not.toThrow()
    expect(useSessionStore.getState().sessions.size).toBe(0)
    expect(mockDispatchNotification).not.toHaveBeenCalled()
  })
})

describe('splitTerminalSession', () => {
  const layoutOf = (projectId: string) => useSessionStore.getState().getPaneLayout(projectId)

  it('does nothing when there is no focused or active session', async () => {
    await splitTerminalSession('proj-1', 'horizontal', '/repo', 5000)
    expect(terminalApi.create).not.toHaveBeenCalled()
    expect(layoutOf('proj-1')).toBeNull()
  })

  it('creates a session pinned to the focused session and splits the pane', async () => {
    addSession('focused-1')
    useSessionStore.getState().setFocusedSession('proj-1', 'focused-1')
    await splitTerminalSession('proj-1', 'vertical', '/repo', 5000)
    expect(sessionOf('session-123')).toMatchObject({
      projectId: 'proj-1',
      parentSessionId: 'focused-1',
    })
    expect(useSessionStore.getState().getTerminalInstance('session-123')).toBeDefined()
    expect(layoutOf('proj-1')).toMatchObject({ type: 'split', direction: 'vertical' })
    expect(leafIds(layoutOf('proj-1')!)).toEqual(['focused-1', 'session-123'])
    expect(useSessionStore.getState().getFocusedSession('proj-1')).toBe('session-123')
  })

  it('pins to the focused session root when the focused session is itself a split child', async () => {
    addSession('child-1', { parentSessionId: 'root-1' })
    useSessionStore.getState().setFocusedSession('proj-1', 'child-1')
    await splitTerminalSession('proj-1', 'horizontal', '/repo', 5000)
    expect(sessionOf('session-123')!.parentSessionId).toBe('root-1')
  })

  it('falls back to the active session when nothing is focused', async () => {
    addSession('active-9')
    useSessionStore.getState().setActiveSessionForProject('proj-1', 'active-9')
    await splitTerminalSession('proj-1', 'horizontal', '/repo', 5000)
    expect(layoutOf('proj-1')).toMatchObject({ type: 'split', direction: 'horizontal' })
    expect(leafIds(layoutOf('proj-1')!)).toEqual(['active-9', 'session-123'])
  })

  it('wires the same bell handling into split instances', async () => {
    addSession('focused-1')
    useSessionStore.getState().setFocusedSession('proj-1', 'focused-1')
    await splitTerminalSession('proj-1', 'horizontal', '/repo', 5000)
    useSessionStore.getState().renameSession('session-123', 'Split Tab')
    useSessionStore.getState().setActiveSessionForProject('proj-1', 'focused-1')
    capturedCtorArgs[0].hooks!.onBell!()
    expect(sessionOf('session-123')!.bellCount).toBe(1)
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
    expect(sessionOf('terminal-1')).toMatchObject({
      projectId: 'proj-1',
      tabTitle: 'feat/x',
      scrollbackLimit: 5000,
      type: 'agent',
    })
  })

  it('builds the xterm instance, without which no pane ever mounts', () => {
    adoptTerminalSession(adopted)
    expect(capturedCtorArgs).toEqual([
      expect.objectContaining({ sessionId: 'terminal-1', scrollbackLimit: 5000 }),
    ])
    expect(useSessionStore.getState().getTerminalInstance('terminal-1')).toBeDefined()
  })

  it('shows it when the project has nothing selected', () => {
    adoptTerminalSession(adopted)
    expect(activeIn('proj-1')).toBe('terminal-1')
  })

  it('does not steal focus from the terminal being read', () => {
    // A supervised run starting in the background used to yank the operator
    // away from whatever they had open in that project.
    addSession('the-one-being-read')
    useSessionStore.getState().setActiveSessionForProject('proj-1', 'the-one-being-read')
    adoptTerminalSession(adopted)
    expect(activeIn('proj-1')).toBe('the-one-being-read')
  })

  it('does nothing for a session it already has, so a repeat is not a second tab', () => {
    addSession('terminal-1', { tabTitle: 'feat/x', type: 'human' })
    adoptTerminalSession(adopted)
    expect(sessionOf('terminal-1')!.type).toBe('human')
    expect(capturedCtorArgs).toEqual([])
  })

  it('wires bell, busy and idle exactly as a terminal the operator opened', () => {
    vi.useFakeTimers()
    try {
      adoptTerminalSession(adopted)
      capturedCtorArgs[0].hooks?.onBusy?.()
      capturedCtorArgs[0].hooks?.onIdle?.()
      expect(sessionOf('terminal-1')!.busy).toBe(true)
      vi.advanceTimersByTime(3500)
      expect(sessionOf('terminal-1')!.busy).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('activity stamping throttle (FR-002)', () => {
  // onBusy fires on every PTY output chunk. Without a throttle a chatty agent
  // would write to the store — and re-render the sidebar — per chunk.
  async function busyHookFor(sessionId: string) {
    terminalApi.create.mockResolvedValue({ sessionId })
    await createTerminalSession('proj-1', 'agent', 'A', '/repo', 5000)
    const hooks = capturedCtorArgs.at(-1)!.hooks!
    return hooks.onBusy!
  }

  /** Counts the store writes that move a session's activity stamp. */
  function countStamps(): { of: (id: string) => number[] } {
    const stamps = new Map<string, number[]>()
    useSessionStore.subscribe((state, previous) => {
      for (const [id, session] of state.sessions) {
        const before = previous.sessions.get(id)?.lastActivityAt
        if (before !== session.lastActivityAt)
          stamps.set(id, [...(stamps.get(id) ?? []), session.lastActivityAt])
      }
    })
    return { of: (id) => stamps.get(id) ?? [] }
  }

  it('writes once for a burst of output inside one second', async () => {
    setActivityClock(() => 1_000)
    const onBusy = await busyHookFor('s1')
    const stamps = countStamps()
    for (let i = 0; i < 100; i++) onBusy()
    expect(stamps.of('s1')).toEqual([1_000])
  })

  it('writes again once the clock passes one second', async () => {
    let now = 1_000
    setActivityClock(() => now)
    const onBusy = await busyHookFor('s1')
    const stamps = countStamps()
    onBusy()
    now = 2_001
    onBusy()
    expect(stamps.of('s1')).toEqual([1_000, 2_001])
  })

  it('writes again exactly at the one-second boundary — "at most once per second" allows it', async () => {
    let now = 1_000
    setActivityClock(() => now)
    const onBusy = await busyHookFor('s1')
    const stamps = countStamps()
    onBusy()
    now = 2_000
    onBusy()
    expect(stamps.of('s1')).toEqual([1_000, 2_000])
  })

  it('suppresses a write one millisecond short of the boundary', async () => {
    let now = 1_000
    setActivityClock(() => now)
    const onBusy = await busyHookFor('s1')
    const stamps = countStamps()
    onBusy()
    now = 1_999
    onBusy()
    expect(stamps.of('s1')).toEqual([1_000])
  })

  it('throttles each session independently', async () => {
    setActivityClock(() => 5_000)
    const first = await busyHookFor('s1')
    const second = await busyHookFor('s2')
    const stamps = countStamps()
    first()
    second()
    expect(stamps.of('s1')).toEqual([5_000])
    expect(stamps.of('s2')).toEqual([5_000])
  })

  it('still marks the session busy on every chunk — only the stamp is throttled', async () => {
    setActivityClock(() => 1_000)
    const onBusy = await busyHookFor('s1')
    onBusy()
    useSessionStore.getState().setSessionIdle('s1')
    onBusy()
    expect(sessionOf('s1')!.busy).toBe(true)
  })

  it('stamps activity when the session goes idle so the last byte counts', async () => {
    setActivityClock(() => 9_000)
    terminalApi.create.mockResolvedValue({ sessionId: 's1' })
    await createTerminalSession('proj-1', 'agent', 'A', '/repo', 5000)
    const hooks = capturedCtorArgs.at(-1)!.hooks!
    hooks.onIdle!()
    expect(sessionOf('s1')!.lastActivityAt).toBe(9_000)
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
    expect(sessionOf('session-123')).toMatchObject({
      latestLine: 'Esc to cancel',
      choicePrompt: PROMPT,
    })
  })

  it('forgets the prompt as soon as output moves again', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    screenRows = PROMPT_ROWS
    capturedCtorArgs[0].hooks!.onIdle!()
    screenRows = ['⏺ Wrote 1 line to a.txt', '']
    capturedCtorArgs[0].hooks!.onBusy!()
    expect(sessionOf('session-123')!.latestLine).toBe('⏺ Wrote 1 line to a.txt')
    expect(sessionOf('session-123')!.choicePrompt).toBeUndefined()
  })

  it('refreshes the latest line of a session that never settles, once a second', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    screenRows = ['17:02:21 14 passed', '']
    capturedCtorArgs[0].hooks!.onBusy!()
    expect(sessionOf('session-123')!.latestLine).toBe('17:02:21 14 passed')
    screenRows = ['17:02:22 15 passed', '']
    capturedCtorArgs[0].hooks!.onBusy!()
    expect(sessionOf('session-123')!.latestLine).toBe('17:02:21 14 passed')
    setActivityClock(() => 1000)
    capturedCtorArgs[0].hooks!.onBusy!()
    expect(sessionOf('session-123')!.latestLine).toBe('17:02:22 15 passed')
  })

  it('reads the latest line from above the cursor', async () => {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    screenRows = ['$ pnpm test', '14 passed, 2 failed', 'me@host $ ', '']
    screenCursor = 2
    capturedCtorArgs[0].hooks!.onIdle!()
    expect(sessionOf('session-123')!.latestLine).toBe('14 passed, 2 failed')
  })
})

describe('working hold before idle (058)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function busySession(): Promise<NonNullable<(typeof capturedCtorArgs)[0]['hooks']>> {
    await createTerminalSession('proj-1', 'human', 'T', '/repo', 5000)
    const hooks = capturedCtorArgs[0].hooks!
    hooks.onBusy!()
    return hooks
  }

  it('reads the screen at settle but stays busy until the hold elapses', async () => {
    const hooks = await busySession()
    screenRows = ['$ pnpm test', '  14 passed, 2 failed', '', '']
    hooks.onIdle!()
    expect(sessionOf('session-123')!.latestLine).toBe('14 passed, 2 failed')
    expect(sessionOf('session-123')!.busy).toBe(true)
    vi.advanceTimersByTime(3499)
    expect(sessionOf('session-123')!.busy).toBe(true)
    vi.advanceTimersByTime(1)
    expect(sessionOf('session-123')!.busy).toBe(false)
  })

  it('a choice prompt on screen is reported immediately at settle, before the hold', async () => {
    const hooks = await busySession()
    screenRows = PROMPT_ROWS
    hooks.onIdle!()
    expect(sessionOf('session-123')).toMatchObject({
      latestLine: 'Esc to cancel',
      choicePrompt: PROMPT,
      busy: true,
    })
  })

  it('a busy event inside the hold cancels the pending idle', async () => {
    const hooks = await busySession()
    hooks.onIdle!()
    vi.advanceTimersByTime(2000)
    hooks.onBusy!()
    vi.advanceTimersByTime(3500)
    expect(sessionOf('session-123')!.busy).toBe(true)
  })

  it('disposing the instance clears its pending idle timer', async () => {
    const hooks = await busySession()
    hooks.onIdle!()
    hooks.onDispose!()
    vi.advanceTimersByTime(3500)
    expect(sessionOf('session-123')!.busy).toBe(true)
  })
})

describe('answerChoice (054)', () => {
  beforeEach(async () => {
    terminalApi.create.mockResolvedValue({ sessionId: 's1' })
    await createTerminalSession('p', 'human', 'claude', '/repo', 5000)
    screenRows = PROMPT_ROWS
    capturedCtorArgs[0].hooks!.onIdle!()
  })

  it('types the option number when the prompt is still on screen', () => {
    expect(answerChoice('s1', 2)).toBe(true)
    expect(terminalApi.input).toHaveBeenCalledWith('s1', '2')
  })

  it('sends nothing and drops the buttons when the prompt has changed', () => {
    screenRows = PROMPT_ROWS.map((r) => r.replace('2. No', '2. No, and tell Claude why'))
    expect(answerChoice('s1', 1)).toBe(false)
    expect(terminalApi.input).not.toHaveBeenCalled()
    expect(sessionOf('s1')!.choicePrompt).toBeUndefined()
    expect(sessionOf('s1')!.latestLine).toBe('Esc to cancel')
  })

  it('sends nothing when the prompt has gone', () => {
    screenRows = ['⏺ Done.', '']
    expect(answerChoice('s1', 1)).toBe(false)
    expect(terminalApi.input).not.toHaveBeenCalled()
  })

  it('sends nothing for a number the prompt does not offer', () => {
    expect(answerChoice('s1', 3)).toBe(false)
    expect(terminalApi.input).not.toHaveBeenCalled()
  })

  it('sends nothing for a session without a terminal', () => {
    useSessionStore.setState({ terminalInstances: new Map() })
    expect(answerChoice('s1', 1)).toBe(false)
    expect(terminalApi.input).not.toHaveBeenCalled()
  })
})
