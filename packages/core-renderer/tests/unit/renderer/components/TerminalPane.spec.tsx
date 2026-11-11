import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSessionStore } from '../../../../src/stores/session.store'
import { useTerminalOpenErrorStore } from '../../../../src/stores/terminal-open-error.store'
import { TerminalPane } from '../../../../src/components/terminal/TerminalPane'
import { useBreakoutStore } from '../../../../src/stores/breakout.store'
import { seedStore, terminalSessionOf } from '../../../../../test-support/src/renderer-stores'
import type { PaneNode } from '../../../../../core-shared/src/types/index'
import type { TerminalInstance } from '../../../../src/components/terminal/TerminalSession'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import { partialFake } from '../../../../../test-support/src/fakes'
import { eventually } from '../../../../../test-support/src/eventually'
import { useSessionRecordsStore } from '../../../../src/stores/session-records.store'
import { SESSION_DRAG_TYPE } from '../../../../src/components/agent/session-drag'
import type { SessionRecordListing } from '../../../../../core-shared/src/types/index'

vi.mock('../../../../src/components/terminal/LeafPane', () => ({
  LeafPane: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`leaf-${sessionId}`}>{sessionId}</div>
  ),
}))

const mockGetSessions = vi.fn()
const mockGetActive = vi.fn()
const mockGetInstance = vi.fn()
const mockClearBell = vi.fn()
const mockTerminalInput = vi.fn()
const mockGetPaneLayout = vi.fn<(projectId: string) => PaneNode | null>(() => null)
const mockSetSplitRatio = vi.fn()

const mockSetFocusedSession = vi.fn()

// Electron 32+ dropped File.path; the preload's getFilePath is what knows it.
const filePaths = new WeakMap<File, string>()
function fileAt(path: string): File {
  const file = new File([], path.slice(path.lastIndexOf('/') + 1))
  filePaths.set(file, path)
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  seedStore(useSessionStore, {
    getSessionsForProject: mockGetSessions,
    getActiveSessionForProject: mockGetActive,
    getTerminalInstance: mockGetInstance,
    clearBellCount: mockClearBell,
    getPaneLayout: mockGetPaneLayout,
    setSplitRatio: mockSetSplitRatio,
    setFocusedSession: mockSetFocusedSession,
    focusRequest: null,
  })
  mockGetSessions.mockReturnValue([])
  mockGetActive.mockReturnValue(null)
  mockGetInstance.mockReturnValue(undefined)
  mockGetPaneLayout.mockReturnValue(null)
  installElectronApi({
    terminal: { input: mockTerminalInput },
    getFilePath: (file: File) => filePaths.get(file) ?? '',
  })
})

afterEach(() => {
  useTerminalOpenErrorStore.setState({ errors: {}, retries: {} })
})

describe('TerminalPane', () => {
  it('shows empty state when no sessions', () => {
    render(<TerminalPane projectId="proj-1" />)
    expect(screen.getByText('Open a terminal tab to get started')).toBeTruthy()
  })

  it('shows why the terminal failed to open, and Try again asks the app to open it again', async () => {
    const user = userEvent.setup()
    useTerminalOpenErrorStore.getState().setError('proj-1', 'spawn EBADF')
    render(<TerminalPane projectId="proj-1" />)
    expect(screen.getByRole('alert').textContent).toContain("Couldn't open a terminal: spawn EBADF")
    expect(screen.queryByText('Open a terminal tab to get started')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(useTerminalOpenErrorStore.getState().retries['proj-1']).toBe(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Open a terminal tab to get started')).toBeTruthy()
  })

  it('shows only the error of its own project', () => {
    useTerminalOpenErrorStore.getState().setError('proj-2', 'spawn EBADF')
    render(<TerminalPane projectId="proj-1" />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears the error once a session exists', () => {
    useTerminalOpenErrorStore.getState().setError('proj-1', 'spawn EBADF')
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'Terminal', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    render(<TerminalPane projectId="proj-1" />)
    expect(useTerminalOpenErrorStore.getState().errors['proj-1']).toBeUndefined()
  })
})

describe('TerminalPane — renders container when sessions exist', () => {
  it('clears the bell count of the session it shows', () => {
    seedRealSessions({ sessions: [{ id: 'ses-1', bellCount: 3 }], activeSessionId: 'ses-1' })
    render(<TerminalPane projectId="proj-1" />)
    expect(useSessionStore.getState().getBellCountForSession('ses-1')).toBe(0)
  })
})

describe('TerminalPane — calls terminal focus when pane is clicked with an active session', () => {
  it('calls terminal focus when pane is clicked with an active session', async () => {
    const user = userEvent.setup()
    const mockFocus = vi.fn()
    const mockScrollToBottom = vi.fn()
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue({
      terminal: { focus: mockFocus, scrollToBottom: mockScrollToBottom },
      mount: vi.fn(),
      unmount: vi.fn(),
    })
    render(<TerminalPane projectId="proj-1" />)
    await user.click(screen.getByTestId('terminal-pane'))
    expect(mockFocus).toHaveBeenCalled()
  })
})

describe('TerminalPane — pastes dropped file paths into the active terminal session', () => {
  it('pastes dropped file paths into the active terminal session', () => {
    const mockPaste = vi.fn()
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue({
      terminal: { paste: mockPaste, focus: vi.fn(), scrollToBottom: vi.fn() },
      mount: vi.fn(),
      unmount: vi.fn(),
    })
    render(<TerminalPane projectId="proj-1" />)
    const pane = screen.getByTestId('terminal-pane')
    const file = fileAt('/Users/me/report.pdf')
    fireEvent.drop(pane, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(mockPaste).toHaveBeenCalledWith('/Users/me/report.pdf')
  })
})

describe('TerminalPane — does not call paste when no active session on drop', () => {
  it('does not call paste when no active session on drop', () => {
    const mockPaste = vi.fn()
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue(null)
    mockGetInstance.mockReturnValue({
      terminal: { paste: mockPaste, focus: vi.fn(), scrollToBottom: vi.fn() },
      mount: vi.fn(),
      unmount: vi.fn(),
    })
    render(<TerminalPane projectId="proj-1" />)
    const pane = screen.getByTestId('terminal-pane')
    const file = fileAt('/x.txt')
    fireEvent.drop(pane, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(mockPaste).not.toHaveBeenCalled()
  })
})

describe('TerminalPane — accepts a file drag and refuses any other drag', () => {
  it.each([
    { types: ['Files'], accepted: true },
    { types: ['text/plain'], accepted: false },
  ])('drag of $types is accepted: $accepted', ({ types, accepted }) => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    render(<TerminalPane projectId="proj-1" />)
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types } })
    screen.getByTestId('terminal-pane').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(accepted)
  })
})

describe('TerminalPane — unmounts previous session instance when active session changes', () => {
  it('unmounts previous session instance when active session changes', () => {
    const mockMount = vi.fn()
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'T1', type: 'human' },
      { id: 'ses-2', tabTitle: 'T2', type: 'human' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    const unmountFirst = vi.fn()
    const unmountSecond = vi.fn()
    const instances = new Map([
      ['ses-1', { ...instanceFocusing(vi.fn()), mount: mockMount, unmount: unmountFirst }],
      ['ses-2', { ...instanceFocusing(vi.fn()), mount: mockMount, unmount: unmountSecond }],
    ])
    mockGetInstance.mockImplementation((id: string) => instances.get(id))
    const { rerender } = render(<TerminalPane projectId="proj-1" />)
    mockGetActive.mockReturnValue('ses-2')
    rerender(<TerminalPane projectId="proj-1" />)
    expect(unmountFirst).toHaveBeenCalled()
    expect(unmountSecond).not.toHaveBeenCalled()
  })
})

describe('TerminalPane — the active tab lives in its own window', () => {
  const sole = [{ id: 'ses-1', tabTitle: 'T', type: 'human' }]

  afterEach(() => useBreakoutStore.setState(useBreakoutStore.getInitialState(), true))

  it('keeps the terminal out of the pane while the window has it, and takes it back on dock', () => {
    const mockMount = vi.fn()
    mockGetSessions.mockReturnValue(sole)
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue({ ...instanceFocusing(vi.fn()), mount: mockMount })
    useBreakoutStore.getState().add('ses-1', {} as Window)
    render(<TerminalPane projectId="proj-1" />)
    expect(mockMount).not.toHaveBeenCalled()
    act(() => useBreakoutStore.getState().remove('ses-1'))
    expect(mockMount).toHaveBeenCalledTimes(1)
  })
})

/** ses-1 and ses-2 side by side. */
function twoPaneLayout(): PaneNode {
  return {
    type: 'split',
    id: 'split-1',
    direction: 'vertical',
    ratio: 0.5,
    first: { type: 'leaf', sessionId: 'ses-1' },
    second: { type: 'leaf', sessionId: 'ses-2' },
  }
}

/** The real session store, holding `sessions` in proj-1 with the given view. */
function seedRealSessions(seed: {
  sessions: Array<{ id: string; bellCount?: number }>
  activeSessionId: string
  paneLayouts?: PaneNode[]
}): void {
  const sessions = seed.sessions.map((s) => terminalSessionOf({ ...s, projectId: 'proj-1' }))
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useSessionStore.setState({
    sessions: new Map(sessions.map((s) => [s.id, s])),
    projectViews: new Map([
      [
        'proj-1',
        {
          activeSessionId: seed.activeSessionId,
          paneLayouts: seed.paneLayouts,
          terminalCounter: 2,
        },
      ],
    ]),
  })
}

/** ses-1 and ses-2 side by side, ses-1 the active tab. */
function withTwoPaneSplit(): PaneNode {
  const layout = twoPaneLayout()
  mockGetPaneLayout.mockReturnValue(layout)
  mockGetSessions.mockReturnValue([
    { id: 'ses-1', tabTitle: 'T1', type: 'human' },
    { id: 'ses-2', tabTitle: 'T2', type: 'human' },
  ])
  mockGetActive.mockReturnValue('ses-1')
  return layout
}

/** The session store's pane reads, with `focusRequest` waiting to be met. */
function seedWithFocusRequest(focusRequest: { sessionId: string; nonce: number } | null): void {
  seedStore(useSessionStore, {
    getSessionsForProject: mockGetSessions,
    getActiveSessionForProject: mockGetActive,
    getTerminalInstance: mockGetInstance,
    clearBellCount: mockClearBell,
    getPaneLayout: mockGetPaneLayout,
    setSplitRatio: mockSetSplitRatio,
    setFocusedSession: mockSetFocusedSession,
    focusRequest,
  })
}

/** A terminal instance whose focus is `focus`. */
function instanceFocusing(focus: () => void) {
  return { terminal: { focus, scrollToBottom: vi.fn() }, mount: vi.fn(), unmount: vi.fn() }
}

function withRaf(): void {
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    ;(cb as FrameRequestCallback)(0)
    return 0
  })
}

function seedFocusRequest(mockFocus: () => void): void {
  mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
  mockGetActive.mockReturnValue('ses-1')
  mockGetInstance.mockReturnValue({
    terminal: { focus: mockFocus, scrollToBottom: vi.fn() },
    mount: vi.fn(),
    unmount: vi.fn(),
  })
  seedStore(useSessionStore, {
    getSessionsForProject: mockGetSessions,
    getActiveSessionForProject: mockGetActive,
    getTerminalInstance: mockGetInstance,
    clearBellCount: mockClearBell,
    getPaneLayout: mockGetPaneLayout,
    setSplitRatio: mockSetSplitRatio,
    setFocusedSession: mockSetFocusedSession,
    focusRequest: { sessionId: 'ses-1', nonce: 1 },
  })
}

describe('TerminalPane — focusRequest', () => {
  it('focuses the requested instance in single-pane mode', () => {
    withRaf()
    const mockFocus = vi.fn()
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue(instanceFocusing(mockFocus))
    seedWithFocusRequest({ sessionId: 'ses-1', nonce: 1 })
    render(<TerminalPane projectId="proj-1" />)
    expect(mockFocus).toHaveBeenCalled()
  })
})

describe('TerminalPane — focusRequest — sets the focused leaf and focuses its instance in split mode', () => {
  it('sets the focused leaf and focuses its instance in split mode', () => {
    withRaf()
    const mockFocus = vi.fn()
    seedRealSessions({
      sessions: [{ id: 'ses-1' }, { id: 'ses-2' }],
      activeSessionId: 'ses-1',
      paneLayouts: [twoPaneLayout()],
    })
    useSessionStore.setState({
      terminalInstances: new Map([
        [
          'ses-2',
          partialFake<TerminalInstance>({
            terminal: partialFake<TerminalInstance['terminal']>({ focus: mockFocus }),
            mount: vi.fn(),
            unmount: vi.fn(),
          }),
        ],
      ]),
      focusRequest: { sessionId: 'ses-2', nonce: 1 },
    })
    render(<TerminalPane projectId="proj-1" />)
    expect(useSessionStore.getState().getFocusedSession('proj-1')).toBe('ses-2')
    expect(mockFocus).toHaveBeenCalled()
  })
})

/** A modal dialog, open: `:modal` matches it in a browser; the test DOM reads it as `[open]`. */
function openModal(): HTMLDialogElement {
  const dialog = document.createElement('dialog')
  dialog.setAttribute('open', '')
  document.body.appendChild(dialog)
  onTestFinished(() => dialog.remove())
  return dialog
}

describe('TerminalPane — focusRequest — does not focus while a modal is open', () => {
  it('does not focus while a modal is open', () => {
    withRaf()
    openModal()
    const mockFocus = vi.fn()
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue(instanceFocusing(mockFocus))
    seedWithFocusRequest({ sessionId: 'ses-1', nonce: 1 })
    render(<TerminalPane projectId="proj-1" />)
    expect(mockFocus).not.toHaveBeenCalled()
  })
})

describe('TerminalPane — focusRequest — does not take focus from a modal that opened before the frame ran', () => {
  it('does not take focus from a modal that opened before the frame ran', () => {
    let frame: FrameRequestCallback | undefined
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      frame = cb as FrameRequestCallback
      return 0
    })
    const mockFocus = vi.fn()
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue(instanceFocusing(mockFocus))
    seedWithFocusRequest({ sessionId: 'ses-1', nonce: 1 })
    render(<TerminalPane projectId="proj-1" />)
    mockFocus.mockClear()
    openModal()
    frame?.(0)
    expect(mockFocus).not.toHaveBeenCalled()
  })
})

describe('TerminalPane — focusRequest — does not take focus again when a modal closes after the request was met', () => {
  // A modal closing is not a request to focus: an action run from Quick
  // Actions (Edit session note) has just put focus where it wants it.
  it('does not take focus again when a modal closes after the request was met', async () => {
    withRaf()
    const mockFocus = vi.fn()
    seedFocusRequest(mockFocus)
    render(<TerminalPane projectId="proj-1" />)
    expect(mockFocus).toHaveBeenCalledTimes(1)
    const dialog = await act(async () => openModal())
    await act(async () => dialog.remove())
    expect(mockFocus).toHaveBeenCalledTimes(1)
  })

  it('meets a request made while a modal was open once the modal closes', async () => {
    withRaf()
    const dialog = openModal()
    const mockFocus = vi.fn()
    seedFocusRequest(mockFocus)
    render(<TerminalPane projectId="proj-1" />)
    expect(mockFocus).not.toHaveBeenCalled()
    await act(async () => dialog.remove())
    expect(mockFocus).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalPane — split mode (layout present)', () => {
  it("takes a lone tab's terminal down when a split tab comes on screen", () => {
    const lone = { terminal: { focus: vi.fn() }, mount: vi.fn(), unmount: vi.fn() }
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'T1', type: 'human' },
      { id: 'ses-2', tabTitle: 'T2', type: 'human', parentSessionId: 'ses-1' },
      { id: 'ses-3', tabTitle: 'T3', type: 'human' },
    ])
    mockGetActive.mockReturnValue('ses-3')
    mockGetInstance.mockImplementation((id: string) => (id === 'ses-3' ? lone : undefined))
    const { rerender } = render(<TerminalPane projectId="proj-1" />)
    expect(lone.mount).toHaveBeenCalled()
    mockGetActive.mockReturnValue('ses-1')
    mockGetPaneLayout.mockReturnValue({
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      ratio: 0.5,
      first: { type: 'leaf', sessionId: 'ses-1' },
      second: { type: 'leaf', sessionId: 'ses-2' },
    })
    rerender(<TerminalPane projectId="proj-1" />)
    expect(lone.unmount).toHaveBeenCalled()
  })
})

describe('TerminalPane — split mode (layout present) — renders split container instead of single pane when layout exists', () => {
  it('renders split container instead of single pane when layout exists', () => {
    withTwoPaneSplit()
    render(<TerminalPane projectId="proj-1" />)
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(screen.queryByTestId('terminal-pane')).toBeNull()
  })
})

describe('TerminalPane — split mode (layout present) — dragging the divider', () => {
  it('stores the new split ratio of the layout', async () => {
    const user = userEvent.setup()
    seedRealSessions({
      sessions: [{ id: 'ses-1' }, { id: 'ses-2' }],
      activeSessionId: 'ses-1',
      paneLayouts: [twoPaneLayout()],
    })
    render(<TerminalPane projectId="proj-1" />)
    const divider = screen.getByRole('separator')
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 300)
    )
    await user.pointer([
      { keys: '[MouseLeft>]', target: divider, coords: { clientX: 200 } },
      { coords: { clientX: 300 } },
      { keys: '[/MouseLeft]' },
    ])
    expect(useSessionStore.getState().getPaneLayout('proj-1')).toMatchObject({ ratio: 0.75 })
  })
})

/** ses-1 shown alone: a terminal running Claude Code when `runsClaude`, and `login` with a transcript. */
function showSes1({ runsClaude }: { runsClaude: boolean }): ReturnType<typeof vi.fn> {
  const paste = vi.fn()
  mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
  mockGetActive.mockReturnValue('ses-1')
  mockGetInstance.mockReturnValue({
    terminal: { paste, focus: vi.fn() },
    mount: vi.fn(),
    unmount: vi.fn(),
  })
  const session = terminalSessionOf({ id: 'ses-1', projectId: 'proj-1' })
  useSessionStore.setState({
    sessions: new Map([['ses-1', runsClaude ? { ...session, agentTurn: false } : session]]),
  })
  const agent = partialFake<NonNullable<SessionRecordListing['agent']>>({
    agentId: 'claude',
    transcriptPath: '/t/login.jsonl',
  })
  useSessionRecordsStore.setState({
    records: new Map([
      ['login', partialFake<SessionRecordListing>({ tabTitle: 'Login', branch: null, agent })],
    ]),
  })
  return paste
}

describe('TerminalPane — a session dropped on a terminal that runs an agent', () => {
  it.each([
    { runsClaude: true, accepted: true, dropEffect: 'copy' },
    { runsClaude: false, accepted: false, dropEffect: 'none' },
  ])(
    'runs an agent: $runsClaude, takes the session drag: $accepted',
    ({ runsClaude, accepted, dropEffect }) => {
      showSes1({ runsClaude })
      render(<TerminalPane projectId="proj-1" />)
      const event = new Event('dragover', { bubbles: true, cancelable: true })
      const dataTransfer = { types: [SESSION_DRAG_TYPE], dropEffect: 'none' }
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      screen.getByTestId('terminal-pane').dispatchEvent(event)
      expect(event.defaultPrevented).toBe(accepted)
      expect(dataTransfer.dropEffect).toBe(dropEffect)
    }
  )

  it("pastes the dropped session's context into the active terminal", async () => {
    const paste = showSes1({ runsClaude: true })
    render(<TerminalPane projectId="proj-1" />)
    fireEvent.drop(screen.getByTestId('terminal-pane'), {
      dataTransfer: { types: [SESSION_DRAG_TYPE], files: [], getData: () => 'login' },
    })
    await eventually(() =>
      expect(paste).toHaveBeenCalledWith(expect.stringContaining('/t/login.jsonl'))
    )
  })
})
