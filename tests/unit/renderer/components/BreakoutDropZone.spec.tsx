import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import { BreakoutDropZone } from '../../../../src/renderer/components/terminal/BreakoutDropZone'
import { useBreakoutStore } from '../../../../src/renderer/stores/breakout.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { endSessionDrag, startSessionDrag } from '../../../../src/renderer/terminal/session-drag'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'
import {
  projectFixture,
  resetStore,
  terminalSessionOf,
  workspaceFixture,
} from '../../../support/renderer-stores'

const dockBack = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/breakout', () => ({ dockBack }))

function fire(type: 'dragenter' | 'dragover' | 'dragleave' | 'drop'): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  act(() => {
    document.dispatchEvent(event)
  })
  return event
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
  endSessionDrag()
  cleanup()
})

describe('BreakoutDropZone', () => {
  it('is not drawn when nothing is being dragged', () => {
    render(<BreakoutDropZone />)
    fire('dragenter')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('is not drawn for a tab whose terminal is not in its own window', () => {
    render(<BreakoutDropZone />)
    startSessionDrag('s3')
    fire('dragenter')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('names the terminal, its workspace and its branch while one is dragged in', () => {
    render(<BreakoutDropZone />)
    startSessionDrag('s1')
    fire('dragenter')
    const region = screen.getByRole('region', { name: 'Return Terminal 2 to its tabs' })
    expect(region.textContent).toContain('Drop to return Terminal 2')
    expect(region.textContent).toContain('to Terminator · feat/breakout')
  })

  it('names Scratch for a scratch terminal', () => {
    render(<BreakoutDropZone />)
    startSessionDrag('s2')
    fire('dragenter')
    expect(screen.getByRole('region').textContent).toContain('to Scratch')
  })
})

describe('BreakoutDropZone — dropping', () => {
  it('allows the drop only while it is showing', () => {
    render(<BreakoutDropZone />)
    expect(fire('dragover').defaultPrevented).toBe(false)
    startSessionDrag('s1')
    fire('dragenter')
    expect(fire('dragover').defaultPrevented).toBe(true)
  })

  it('goes away when the drag leaves the window', () => {
    render(<BreakoutDropZone />)
    startSessionDrag('s1')
    fire('dragenter')
    fire('dragleave')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('docks the terminal on a drop and goes away', () => {
    render(<BreakoutDropZone />)
    startSessionDrag('s1')
    fire('dragenter')
    fire('drop')
    expect(dockBack).toHaveBeenCalledWith('s1')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('docks nothing on a drop that carries no breakout terminal', () => {
    render(<BreakoutDropZone />)
    fire('drop')
    expect(dockBack).not.toHaveBeenCalled()
  })
})
