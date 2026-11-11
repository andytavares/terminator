import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { useSessionStore } from '../../../../src/stores/session.store'
import { LeafPane } from '../../../../src/components/terminal/LeafPane'
import type { TerminalInstance } from '../../../../src/components/terminal/TerminalSession'
import { terminalSessionOf } from '../../../../../test-support/src/renderer-stores'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import { partialFake } from '../../../../../test-support/src/fakes'
import type { Terminal } from '@xterm/xterm'
import { eventually } from '../../../../../test-support/src/eventually'
import { useSessionRecordsStore } from '../../../../src/stores/session-records.store'
import { SESSION_DRAG_TYPE } from '../../../../src/components/agent/session-drag'
import type { SessionRecordListing } from '../../../../../core-shared/src/types/index'

const mockTerminalInput = vi.fn()

// xterm does not run in jsdom: the instance is faked down to what LeafPane calls.
function makeInstance(overrides: Partial<TerminalInstance> = {}): TerminalInstance {
  return partialFake<TerminalInstance>({
    mount: vi.fn(),
    unmount: vi.fn(),
    terminal: partialFake<Terminal>({ focus: vi.fn(), paste: vi.fn() }),
    ...overrides,
  })
}

/** The live terminal the session store holds for sess-1. */
function withInstance(instance: TerminalInstance): void {
  useSessionStore.setState({ terminalInstances: new Map([['sess-1', instance]]) })
}

/** sess-1's pane, named by its tab title. */
const pane = (): HTMLElement => screen.getByRole('group', { name: 'Terminal 1' })

const focusedIn = (projectId: string): string | null =>
  useSessionStore.getState().getFocusedSession(projectId)

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.setState(useSessionStore.getInitialState())
  // A pane is drawn only for the split on screen: sess-1 and its pane sess-2.
  useSessionStore.getState().setActiveSessionForProject('proj-1', 'sess-1')
  useSessionStore
    .getState()
    .activateSplit('proj-1', { targetId: 'sess-1', newId: 'sess-2', direction: 'vertical' })
  useSessionStore.setState({
    sessions: new Map([
      [
        'sess-1',
        terminalSessionOf({
          id: 'sess-1',
          projectId: 'proj-1',
          tabTitle: 'Terminal 1',
          bellCount: 2,
        }),
      ],
    ]),
  })
  installElectronApi({
    terminal: { input: mockTerminalInput },
    // Electron 32+ removed File.path; the path is only available through the preload.
    getFilePath: (file: File) => pathsByFileName[file.name] ?? '',
  })
})

const pathsByFileName: Record<string, string> = {
  'report.pdf': '/Users/me/report.pdf',
  'my file.txt': '/my file.txt',
  'file.txt': '/tmp/file.txt',
}

describe('LeafPane', () => {
  it('shows the session tab title in the title bar', () => {
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(screen.getByText('Terminal 1')).toBeTruthy()
  })

  it('falls back to sessionId in title bar when session not found', () => {
    render(<LeafPane sessionId="unknown-sess" projectId="proj-1" />)
    expect(screen.getByText('unknown-sess')).toBeTruthy()
  })

  it('marks the pane current when its session is focused', () => {
    useSessionStore.getState().setFocusedSession('proj-1', 'sess-1')
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(pane().getAttribute('aria-current')).toBe('true')
  })

  it('does not mark the pane current when its session is not focused', () => {
    useSessionStore.getState().setFocusedSession('proj-1', 'sess-2')
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(pane().getAttribute('aria-current')).toBeNull()
  })

  it('becomes the focused pane and focuses its terminal on click', async () => {
    const user = userEvent.setup()
    const instance = makeInstance()
    withInstance(instance)
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    await user.click(pane())
    expect(focusedIn('proj-1')).toBe('sess-1')
    expect(pane().getAttribute('aria-current')).toBe('true')
    expect(instance.terminal.focus).toHaveBeenCalled()
  })
})

describe('LeafPane — clears the unseen bells on mousedown', () => {
  it('clears the unseen bells on mousedown', async () => {
    const user = userEvent.setup()
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    await user.click(pane())
    expect(useSessionStore.getState().getBellCountForSession('sess-1')).toBe(0)
  })

  it('pastes file paths into terminal on drop', () => {
    const instance = makeInstance()
    withInstance(instance)
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const file = new File([], 'report.pdf')
    fireEvent.drop(pane(), {
      dataTransfer: { files: [file], types: ['Files'] },
    })
    expect(instance.terminal.paste).toHaveBeenCalledWith('/Users/me/report.pdf')
  })
})

describe('LeafPane — quotes paths with spaces on drop', () => {
  it('quotes paths with spaces on drop', () => {
    const instance = makeInstance()
    withInstance(instance)
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const file = new File([], 'my file.txt')
    fireEvent.drop(pane(), {
      dataTransfer: { files: [file], types: ['Files'] },
    })
    expect(instance.terminal.paste).toHaveBeenCalledWith("'/my file.txt'")
  })

  it('prevents default on dragover when files are dragged', () => {
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } })
    const spy = vi.spyOn(event, 'preventDefault')
    pane().dispatchEvent(event)
    expect(spy).toHaveBeenCalled()
  })

  it('unmounts the terminal instance on unmount', () => {
    const instance = makeInstance()
    withInstance(instance)
    const { unmount } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    unmount()
    expect(instance.unmount).toHaveBeenCalled()
  })
})

describe('LeafPane — calls mount with just the container element', () => {
  it('calls mount with just the container element', () => {
    const instance = makeInstance()
    withInstance(instance)
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(instance.mount).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    expect(instance.mount).toHaveBeenCalledTimes(1)
  })

  it('ignores non-left-button mousedown (button !== 0)', async () => {
    const user = userEvent.setup()
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    await user.pointer({ keys: '[MouseRight]', target: pane() })
    expect(focusedIn('proj-1')).toBe('sess-2')
    expect(useSessionStore.getState().getBellCountForSession('sess-1')).toBe(2)
  })

  it('does not throw on drop when no terminal instance', () => {
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const file = new File([], 'file.txt')
    expect(() =>
      fireEvent.drop(pane(), {
        dataTransfer: { files: [file], types: ['Files'] },
      })
    ).not.toThrow()
  })
})

describe('LeafPane — closing one pane', () => {
  it('closes this pane alone: it leaves the split and its terminal ends', async () => {
    const user = userEvent.setup()
    installElectronApi({
      terminal: { input: mockTerminalInput, close: vi.fn(async () => ({ success: true })) },
    })
    useSessionStore.setState({
      sessions: new Map([
        [
          'sess-1',
          terminalSessionOf({ id: 'sess-1', projectId: 'proj-1', tabTitle: 'Terminal 1' }),
        ],
        [
          'sess-2',
          terminalSessionOf({ id: 'sess-2', projectId: 'proj-1', tabTitle: 'Terminal 2' }),
        ],
      ]),
    })
    render(<LeafPane sessionId="sess-2" projectId="proj-1" />)
    await user.click(screen.getByRole('button', { name: 'Close Terminal 2' }))
    expect(useSessionStore.getState().getPaneLayout('proj-1')).toBeNull()
    await eventually(() => expect(useSessionStore.getState().sessions.has('sess-2')).toBe(false))
    expect(useSessionStore.getState().sessions.has('sess-1')).toBe(true)
  })
})

describe('LeafPane — closing one pane — leaves a drag of something other than files to the browser', () => {
  it('leaves a drag of something other than files to the browser', () => {
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.assign(event, { dataTransfer: { types: ['text/plain'] } })
    pane().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

/** A dragover carrying sessions, as an Inbox card or a sidebar row starts it. */
function sessionDragOver(): Event & { dataTransfer: { types: string[]; dropEffect: string } } {
  const event = new Event('dragover', { bubbles: true, cancelable: true })
  return Object.assign(event, { dataTransfer: { types: [SESSION_DRAG_TYPE], dropEffect: 'none' } })
}

/** sess-1 as a terminal running Claude Code, and `login` as a session with a transcript. */
function sess1RunsClaude(): void {
  useSessionStore.setState((s) => ({
    sessions: new Map(s.sessions).set(
      'sess-1',
      terminalSessionOf({
        id: 'sess-1',
        projectId: 'proj-1',
        tabTitle: 'Terminal 1',
        agentTurn: false,
      })
    ),
  }))
  const agent = partialFake<NonNullable<SessionRecordListing['agent']>>({
    agentId: 'claude',
    transcriptPath: '/t/login.jsonl',
  })
  useSessionRecordsStore.setState({
    records: new Map([
      ['login', partialFake<SessionRecordListing>({ tabTitle: 'Login', branch: null, agent })],
    ]),
  })
}

describe('LeafPane — a session dropped on a terminal that runs an agent', () => {
  beforeEach(() => useSessionRecordsStore.setState({ records: new Map() }))

  it('takes a session drag as a copy when the terminal runs an agent', () => {
    sess1RunsClaude()
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const event = sessionDragOver()
    pane().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(event.dataTransfer.dropEffect).toBe('copy')
  })

  it('refuses a session drag on a plain shell', () => {
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const event = sessionDragOver()
    pane().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('LeafPane — a session dropped on a terminal that runs an agent — pasting', () => {
  beforeEach(() => useSessionRecordsStore.setState({ records: new Map() }))

  it("pastes the dropped session's context into the terminal", async () => {
    sess1RunsClaude()
    const instance = makeInstance()
    withInstance(instance)
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    fireEvent.drop(pane(), {
      dataTransfer: { types: [SESSION_DRAG_TYPE], files: [], getData: () => 'login' },
    })
    await eventually(() =>
      expect(instance.terminal.paste).toHaveBeenCalledWith(
        expect.stringContaining('/t/login.jsonl')
      )
    )
  })
})
