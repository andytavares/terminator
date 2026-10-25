import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, cleanup } from '@testing-library/react'
import { BreakoutWindows } from '../../../../src/renderer/components/terminal/BreakoutWindowView'
import { useBreakoutStore } from '../../../../src/renderer/stores/breakout.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useTabDragStore } from '../../../../src/renderer/terminal/tab-drag'
import type { TerminalInstance } from '../../../../src/renderer/components/terminal/TerminalSession'
import { partialFake } from '../../../support/fakes'
import {
  projectFixture,
  resetStore,
  terminalSessionOf,
  workspaceFixture,
} from '../../../support/renderer-stores'

const mount = vi.fn()
const unmount = vi.fn()

function fakeChildWindow(): Window {
  return partialFake<Window>({ document: document.implementation.createHTMLDocument('child') })
}

const dockBack = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/breakout', () => ({ dockBack }))

/** The child document has no window of its own, so testing-library cannot fire into it. */
function pointerAt(target: EventTarget, type: string, at: { x: number; y: number }): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId: 1,
        screenX: at.x,
        screenY: at.y,
      })
    )
  })
}

/** Drags the window's tab from its header to `to`, a point on the screen. */
function dragTabTo(child: Window, to: { x: number; y: number }): void {
  const tab = child.document.querySelector<HTMLElement>('[role="tab"]')!
  child.document.elementFromPoint = () => null
  tab.setPointerCapture = vi.fn()
  pointerAt(tab, 'pointerdown', { x: 1500, y: 20 })
  pointerAt(child.document, 'pointermove', { x: 1400, y: 60 })
  pointerAt(child.document, 'pointerup', to)
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore(useBreakoutStore)
  resetStore(useWorkspaceStore, {
    workspaces: [workspaceFixture({ id: 'w1', name: 'Terminator', color: '#4A90E2' })],
    projectsByWorkspaceId: new Map([
      ['w1', [projectFixture({ id: 'p1', workspaceId: 'w1', gitBranch: 'feat/breakout' })]],
    ]),
  })
  resetStore(useSessionStore, {
    sessions: new Map([
      ['s1', terminalSessionOf({ id: 's1', projectId: 'p1', tabTitle: 'build' })],
    ]),
    terminalInstances: new Map([['s1', partialFake<TerminalInstance>({ mount, unmount })]]),
  })
})

afterEach(cleanup)

describe('BreakoutWindows', () => {
  it('mounts the terminal into a container in the child window document', () => {
    const child = fakeChildWindow()
    render(<BreakoutWindows />)
    act(() => useBreakoutStore.getState().add('s1', child))
    const container = mount.mock.calls[0]?.[0] as HTMLElement
    expect(container.ownerDocument).toBe(child.document)
    expect(child.document.body.contains(container)).toBe(true)
  })

  it('shows the tab by role with its title, and the workspace and branch', () => {
    const child = fakeChildWindow()
    render(<BreakoutWindows />)
    act(() => useBreakoutStore.getState().add('s1', child))
    const tab = child.document.querySelector('[role="tab"]')
    expect(tab?.getAttribute('aria-label')).toBe('build, in its own window')
    expect(tab?.textContent).toContain('build')
    expect(child.document.querySelector('.breakout-window__place')?.textContent).toBe(
      'Terminator · feat/breakout'
    )
  })
})

describe('BreakoutWindows — leaving', () => {
  it('lets go of the terminal in that container when the window is removed', () => {
    const child = fakeChildWindow()
    render(<BreakoutWindows />)
    act(() => useBreakoutStore.getState().add('s1', child))
    const container = mount.mock.calls[0]?.[0]
    act(() => useBreakoutStore.getState().remove('s1'))
    expect(unmount).toHaveBeenCalledWith(container)
  })

  it('renders nothing for a session that is gone', () => {
    const child = fakeChildWindow()
    render(<BreakoutWindows />)
    act(() => useBreakoutStore.getState().add('missing', child))
    expect(mount).not.toHaveBeenCalled()
  })
})

describe('BreakoutWindows — dragging the tab back', () => {
  // jsdom's main window sits at 0,0 and is 1024x768.
  it('docks the terminal the moment its tab is let go over the main window', () => {
    const child = fakeChildWindow()
    render(<BreakoutWindows />)
    act(() => useBreakoutStore.getState().add('s1', child))
    dragTabTo(child, { x: 500, y: 300 })
    expect(dockBack).toHaveBeenCalledWith('s1')
    expect(useTabDragStore.getState().sessionId).toBeNull()
  })

  it('keeps it in its own window when let go anywhere else', () => {
    const child = fakeChildWindow()
    render(<BreakoutWindows />)
    act(() => useBreakoutStore.getState().add('s1', child))
    dragTabTo(child, { x: 1300, y: 300 })
    expect(dockBack).not.toHaveBeenCalled()
  })
})
