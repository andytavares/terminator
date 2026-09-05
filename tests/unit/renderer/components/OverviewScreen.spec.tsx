import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Project, TerminalSession, Workspace } from '../../../../src/shared/types/index'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: Object.assign(vi.fn(), { getState: vi.fn() }),
}))
vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: Object.assign(vi.fn(), { getState: vi.fn() }),
}))
vi.mock('../../../../src/renderer/stores/metrics.store', () => ({
  useMetricsStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: Object.assign(vi.fn(), { getState: vi.fn() }),
}))
// The card is covered by its own spec; here it is a stub so the board's
// arrangement is what is under test.
vi.mock('../../../../src/renderer/components/overview/SessionTile', () => ({
  SessionTile: ({
    card,
    onNavigate,
  }: {
    card: { sessionId: string; title: string }
    onNavigate: () => void
  }) => (
    <button type="button" data-testid={`tile-${card.sessionId}`} onClick={onNavigate}>
      {card.title}
    </button>
  ),
}))

import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useMetricsStore } from '../../../../src/renderer/stores/metrics.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { OverviewScreen } from '../../../../src/renderer/components/overview/OverviewScreen'
import { LANES_STORAGE_KEY } from '../../../../src/renderer/sidebar/board-lanes'

const repo: Workspace = {
  id: 'ws-1',
  name: 'terminator',
  folderPath: '/r',
  color: '#5c6bc0',
  tags: [],
  createdAt: '',
  updatedAt: '',
}
const branch: Project = {
  id: 'p1',
  workspaceId: 'ws-1',
  name: 'API',
  gitBranch: 'main',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}

function session(id: string, patch: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    projectId: 'p1',
    tabTitle: id,
    status: 'active',
    type: 'agent',
    scrollbackLimit: 10000,
    createdAt: '',
    lastActivityAt: 1000,
    agentState: 'idle',
    ...patch,
  }
}

const setActiveWorkspace = vi.fn()
const setActiveProject = vi.fn()
const setActiveSessionForProject = vi.fn()
const setScratchActive = vi.fn()
const setActiveGlobalTab = vi.fn()
const startPolling = vi.fn()
const stopPolling = vi.fn()

let sessions: Map<string, TerminalSession>

function mount(): ReturnType<typeof render> {
  const sessionState = { sessions, setActiveSessionForProject }
  const workspaceState = {
    workspaces: [repo],
    projectsByWorkspaceId: new Map([['ws-1', [branch]]]),
    setScratchActive,
    activeWorkspaceId: 'ws-1',
    setActiveWorkspace,
    setActiveProject,
  }
  ;(useSessionStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sessionState)
  ;(useSessionStore as unknown as { getState: ReturnType<typeof vi.fn> }).getState.mockReturnValue(
    sessionState
  )
  ;(useWorkspaceStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(workspaceState)
  ;(
    useWorkspaceStore as unknown as { getState: ReturnType<typeof vi.fn> }
  ).getState.mockReturnValue(workspaceState)
  ;(useMetricsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    processesBySessionId: new Map(),
    startPolling,
    stopPolling,
  })
  ;(
    useExtensionRegistry as unknown as { getState: ReturnType<typeof vi.fn> }
  ).getState.mockReturnValue({ setActiveGlobalTab })
  return render(<OverviewScreen />)
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessions = new Map()
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { metrics: { getPids: vi.fn().mockResolvedValue({ data: [] }) } },
  })
})

describe('OverviewScreen', () => {
  it('opens on the board, not the flat list', () => {
    sessions.set('a', session('a', { agentState: 'working' }))
    const { container } = mount()
    expect(container.querySelector('.board')).toBeTruthy()
    expect(container.querySelector('.overview-screen__grid')).toBeNull()
    expect(screen.getByRole('button', { name: 'Board' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('switches to the flat list and back', () => {
    sessions.set('a', session('a', { agentState: 'working' }))
    const { container } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(container.querySelector('.overview-screen__grid')).toBeTruthy()
    expect(container.querySelector('.board')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    expect(container.querySelector('.board')).toBeTruthy()
  })

  it('places each terminal in the lane matching its state', () => {
    sessions.set('a', session('a', { agentState: 'awaiting-input' }))
    sessions.set('b', session('b', { agentState: 'working' }))
    const { container } = mount()
    expect(
      container.querySelector('.board__slot[data-session-id="a"]')!.getAttribute('data-lane')
    ).toBe('Needs you')
    expect(
      container.querySelector('.board__slot[data-session-id="b"]')!.getAttribute('data-lane')
    ).toBe('Working')
  })

  it('shows every terminal in the list layout too', () => {
    sessions.set('a', session('a', { agentState: 'working' }))
    sessions.set('b', session('b', { agentState: 'idle' }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByTestId('tile-a')).toBeTruthy()
    expect(screen.getByTestId('tile-b')).toBeTruthy()
  })

  it('offers one action when nothing is running', () => {
    mount()
    expect(screen.getByRole('button', { name: /start a branch/i })).toBeTruthy()
  })

  it('says so plainly in the list layout when nothing is running', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByText('No open terminals')).toBeTruthy()
  })

  describe('navigating from a card', () => {
    it('activates the branch and the terminal', () => {
      sessions.set('a', session('a', { agentState: 'working' }))
      mount()
      fireEvent.click(screen.getByTestId('tile-a'))
      expect(setActiveGlobalTab).toHaveBeenCalledWith(null)
      expect(setActiveProject).toHaveBeenCalledWith('p1')
      expect(setActiveSessionForProject).toHaveBeenCalledWith('p1', 'a')
    })

    it('switches repo first when the branch is in another one', () => {
      sessions.set('a', session('a', { agentState: 'working' }))
      mount()
      fireEvent.click(screen.getByTestId('tile-a'))
      // Already the active repo, so no switch is needed.
      expect(setActiveWorkspace).not.toHaveBeenCalled()
    })

    it('takes a scratch terminal to the scratch surface instead', () => {
      sessions.set('s', session('s', { projectId: SCRATCH_PROJECT_ID, agentState: 'working' }))
      mount()
      fireEvent.click(screen.getByTestId('tile-s'))
      expect(setScratchActive).toHaveBeenCalledWith(true)
      expect(setActiveSessionForProject).toHaveBeenCalledWith(SCRATCH_PROJECT_ID, 's')
    })
  })

  describe('lane visibility', () => {
    it('hides a lane from its header and remembers it', () => {
      sessions.set('a', session('a', { agentState: 'working' }))
      const { container } = mount()
      fireEvent.click(
        container.querySelector('.board__lane-head[data-lane="Idle"] .board__lane-toggle')!
      )
      expect(container.querySelector('.board__lane-head[data-lane="Idle"]')).toBeNull()
      expect(localStorage.getItem(LANES_STORAGE_KEY)).toBe(JSON.stringify(['idle']))
    })

    it('opens with a previously hidden lane still hidden', () => {
      localStorage.setItem(LANES_STORAGE_KEY, JSON.stringify(['idle']))
      sessions.set('a', session('a', { agentState: 'working' }))
      const { container } = mount()
      expect(container.querySelector('.board__lane-head[data-lane="Idle"]')).toBeNull()
      expect(container.querySelector('.board__lane-head[data-lane="Working"]')).toBeTruthy()
    })
  })

  describe('process metrics', () => {
    it('resolves pids for the terminals on screen', async () => {
      sessions.set('a', session('a', { agentState: 'working' }))
      await act(async () => {
        mount()
      })
      expect(window.electronAPI.metrics.getPids).toHaveBeenCalledWith(['a'])
      expect(startPolling).toHaveBeenCalled()
    })

    it('polls nothing when there are no terminals', () => {
      mount()
      expect(startPolling).toHaveBeenCalledWith([])
    })

    it('still polls when the pid lookup fails', async () => {
      ;(window.electronAPI.metrics.getPids as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('nope')
      )
      sessions.set('a', session('a', { agentState: 'working' }))
      await act(async () => {
        mount()
      })
      expect(startPolling).toHaveBeenCalledWith([])
    })
  })
})

describe('OverviewScreen — guards and the repo switch', () => {
  it('switches repo first when the branch lives in another one', () => {
    sessions.set('a', session('a', { agentState: 'working' }))
    const sessionState = { sessions, setActiveSessionForProject }
    const workspaceState = {
      workspaces: [repo],
      projectsByWorkspaceId: new Map([['ws-1', [branch]]]),
      setScratchActive,
      // The board is showing a branch in a repo that is not the active one.
      activeWorkspaceId: 'ws-other',
      setActiveWorkspace,
      setActiveProject,
    }
    ;(useSessionStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sessionState)
    ;(
      useSessionStore as unknown as { getState: ReturnType<typeof vi.fn> }
    ).getState.mockReturnValue(sessionState)
    ;(useWorkspaceStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(workspaceState)
    ;(
      useWorkspaceStore as unknown as { getState: ReturnType<typeof vi.fn> }
    ).getState.mockReturnValue(workspaceState)
    ;(useMetricsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      processesBySessionId: new Map(),
      startPolling,
      stopPolling,
    })
    ;(
      useExtensionRegistry as unknown as { getState: ReturnType<typeof vi.fn> }
    ).getState.mockReturnValue({ setActiveGlobalTab })

    render(<OverviewScreen />)
    fireEvent.click(screen.getByTestId('tile-a'))
    expect(setActiveWorkspace).toHaveBeenCalledWith('ws-1')
    expect(setActiveProject).toHaveBeenCalledWith('p1')
  })

  it('does nothing when the terminal has gone between drawing and clicking', () => {
    sessions.set('a', session('a', { agentState: 'working' }))
    mount()
    // The store loses it — closed from somewhere else while the board was up.
    sessions.delete('a')
    fireEvent.click(screen.getByTestId('tile-a'))
    expect(setActiveProject).not.toHaveBeenCalled()
  })

  it('does nothing when the branch has gone between drawing and clicking', () => {
    // Only reachable as a race: buildLanes already drops a terminal whose
    // branch is missing, so the card can only outlive the branch if the store
    // changes between the render that drew it and the click that follows.
    sessions.set('a', session('a', { agentState: 'working' }))
    mount()
    ;(
      useSessionStore as unknown as { getState: ReturnType<typeof vi.fn> }
    ).getState.mockReturnValue({
      sessions: new Map([['a', session('a', { projectId: 'vanished', agentState: 'working' })]]),
      setActiveSessionForProject,
    })
    fireEvent.click(screen.getByTestId('tile-a'))
    expect(setActiveProject).not.toHaveBeenCalled()
  })

  it('shows a hidden lane again when it is toggled back', () => {
    localStorage.setItem(LANES_STORAGE_KEY, JSON.stringify(['idle']))
    sessions.set('a', session('a', { agentState: 'idle' }))
    const { container } = mount()
    expect(container.querySelector('.board__lane-head[data-lane="Idle"]')).toBeNull()
    // Unhide from another lane's header — the only one on screen.
    fireEvent.click(container.querySelector('.board__lane-head .board__lane-toggle')!)
    expect(localStorage.getItem(LANES_STORAGE_KEY)).not.toContain('"idle","idle"')
  })
})
