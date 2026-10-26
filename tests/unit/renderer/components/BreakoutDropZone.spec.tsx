import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import { BreakoutDropZone } from '../../../../src/renderer/components/terminal/BreakoutDropZone'
import { useBreakoutStore } from '../../../../src/renderer/stores/breakout.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useTabDragStore } from '../../../../src/renderer/terminal/tab-drag'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'
import {
  projectFixture,
  resetStore,
  terminalSessionOf,
  workspaceFixture,
} from '../../../support/renderer-stores'

/** A tab of this session being dragged, over the main window or not. */
function dragging(sessionId: string, overMainWindow = true): void {
  act(() => useTabDragStore.setState({ sessionId, overSessionId: null, overMainWindow }))
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore(useBreakoutStore, {
    windows: new Map([
      ['s1', window],
      ['s2', window],
    ]),
  })
  resetStore(useWorkspaceStore, {
    workspaces: [workspaceFixture({ id: 'w1', name: 'Terminator' })],
    projectsByWorkspaceId: new Map([
      ['w1', [projectFixture({ id: 'p1', workspaceId: 'w1', gitBranch: 'feat/breakout' })]],
    ]),
  })
  resetStore(useSessionStore, {
    sessions: new Map([
      ['s1', terminalSessionOf({ id: 's1', projectId: 'p1', tabTitle: 'Terminal 2' })],
      ['s2', terminalSessionOf({ id: 's2', projectId: SCRATCH_PROJECT_ID, tabTitle: 'notes' })],
      ['s3', terminalSessionOf({ id: 's3', projectId: 'p1', tabTitle: 'docked' })],
    ]),
  })
})

afterEach(() => {
  useTabDragStore.setState({ sessionId: null, overSessionId: null, overMainWindow: false })
  cleanup()
})

describe('BreakoutDropZone', () => {
  it('is not drawn when nothing is being dragged', () => {
    render(<BreakoutDropZone />)
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('is not drawn for a tab whose terminal is not in its own window', () => {
    render(<BreakoutDropZone />)
    dragging('s3')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('names the terminal, its workspace and its branch while one is dragged over the window', () => {
    render(<BreakoutDropZone />)
    dragging('s1')
    const region = screen.getByRole('region', { name: 'Return Terminal 2 to its tabs' })
    expect(region.textContent).toContain('Drop to return Terminal 2')
    expect(region.textContent).toContain('to Terminator · feat/breakout')
  })
})

describe('BreakoutDropZone — the prompt', () => {
  it('names Scratch for a scratch terminal', () => {
    render(<BreakoutDropZone />)
    dragging('s2')
    expect(screen.getByRole('region').textContent).toContain('to Scratch')
  })

  it('goes away when the drag leaves the window, and when it ends', () => {
    render(<BreakoutDropZone />)
    dragging('s1')
    dragging('s1', false)
    expect(screen.queryByRole('region')).toBeNull()
    dragging('s1')
    act(() => useTabDragStore.setState({ sessionId: null, overMainWindow: false }))
    expect(screen.queryByRole('region')).toBeNull()
  })
})
