import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { LeafPane } from '../../../../src/renderer/components/terminal/LeafPane'
import type { TerminalInstance } from '../../../../src/renderer/components/terminal/TerminalSession'
import { terminalSessionOf } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'
import { partialFake } from '../../../support/fakes'
import type { Terminal } from '@xterm/xterm'
import { eventually } from '../../../support/eventually'

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
    const { getByText } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(getByText('Terminal 1')).toBeTruthy()
  })

  it('falls back to sessionId in title bar when session not found', () => {
    const { getByText } = render(<LeafPane sessionId="unknown-sess" projectId="proj-1" />)
    expect(getByText('unknown-sess')).toBeTruthy()
  })

  it('adds focused class when session is focused', () => {
    useSessionStore.getState().setFocusedSession('proj-1', 'sess-1')
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(container.querySelector('.leaf-pane--focused')).toBeTruthy()
  })

  it('does not add focused class when session is not focused', () => {
    useSessionStore.getState().setFocusedSession('proj-1', 'sess-2')
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(container.querySelector('.leaf-pane--focused')).toBeNull()
  })

  it('becomes the focused pane and focuses its terminal on click', () => {
    const instance = makeInstance()
    withInstance(instance)
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    fireEvent.mouseDown(container.querySelector('.leaf-pane')!, { button: 0 })
    expect(focusedIn('proj-1')).toBe('sess-1')
    expect(container.querySelector('.leaf-pane--focused')).toBeTruthy()
    expect(instance.terminal.focus).toHaveBeenCalled()
  })
})

describe('LeafPane — clears the unseen bells on mousedown', () => {
  it('clears the unseen bells on mousedown', () => {
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    fireEvent.mouseDown(container.querySelector('.leaf-pane')!, { button: 0 })
    expect(useSessionStore.getState().getBellCountForSession('sess-1')).toBe(0)
  })

  it('does not throw on mousedown when no terminal instance', () => {
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(() =>
      fireEvent.mouseDown(container.querySelector('.leaf-pane')!, { button: 0 })
    ).not.toThrow()
  })

  it('pastes file paths into terminal on drop', () => {
    const instance = makeInstance()
    withInstance(instance)
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const file = new File([], 'report.pdf')
    fireEvent.drop(container.querySelector('.leaf-pane')!, {
      dataTransfer: { files: [file], types: ['Files'] },
    })
    expect(instance.terminal.paste).toHaveBeenCalledWith('/Users/me/report.pdf')
  })
})

describe('LeafPane — quotes paths with spaces on drop', () => {
  it('quotes paths with spaces on drop', () => {
    const instance = makeInstance()
    withInstance(instance)
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const file = new File([], 'my file.txt')
    fireEvent.drop(container.querySelector('.leaf-pane')!, {
      dataTransfer: { files: [file], types: ['Files'] },
    })
    expect(instance.terminal.paste).toHaveBeenCalledWith("'/my file.txt'")
  })

  it('prevents default on dragover when files are dragged', () => {
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } })
    const spy = vi.spyOn(event, 'preventDefault')
    container.querySelector('.leaf-pane')!.dispatchEvent(event)
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

  it('ignores non-left-button mousedown (button !== 0)', () => {
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    fireEvent.mouseDown(container.querySelector('.leaf-pane')!, { button: 2 })
    expect(focusedIn('proj-1')).toBe('sess-2')
    expect(useSessionStore.getState().getBellCountForSession('sess-1')).toBe(2)
  })

  it('does not throw on drop when no terminal instance', () => {
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const file = new File([], 'file.txt')
    expect(() =>
      fireEvent.drop(container.querySelector('.leaf-pane')!, {
        dataTransfer: { files: [file], types: ['Files'] },
      })
    ).not.toThrow()
  })
})

describe('LeafPane — closing one pane', () => {
  it('closes this pane alone: it leaves the split and its terminal ends', async () => {
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
    const { getByRole } = render(<LeafPane sessionId="sess-2" projectId="proj-1" />)
    fireEvent.click(getByRole('button', { name: 'Close Terminal 2' }))
    expect(useSessionStore.getState().getPaneLayout('proj-1')).toBeNull()
    await eventually(() => expect(useSessionStore.getState().sessions.has('sess-2')).toBe(false))
    expect(useSessionStore.getState().sessions.has('sess-1')).toBe(true)
  })
})

describe('LeafPane — closing one pane — leaves a drag of something other than files to the browser', () => {
  it('leaves a drag of something other than files to the browser', () => {
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.assign(event, { dataTransfer: { types: ['text/plain'] } })
    container.querySelector('.leaf-pane')!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
