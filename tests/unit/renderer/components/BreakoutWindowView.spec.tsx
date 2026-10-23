import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, cleanup } from '@testing-library/react'
import { BreakoutWindows } from '../../../../src/renderer/components/terminal/BreakoutWindowView'
import { useBreakoutStore } from '../../../../src/renderer/stores/breakout.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
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
