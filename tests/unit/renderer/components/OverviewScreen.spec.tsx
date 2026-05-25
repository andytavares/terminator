import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import type { TerminalSession, Workspace, Project } from '../../../../src/shared/types/index'

const mockStartPolling = vi.fn()
const mockStopPolling = vi.fn()
const mockSetActiveGlobalTab = vi.fn()
const mockSetActiveWorkspace = vi.fn()
const mockSetActiveProject = vi.fn()

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: Object.assign(vi.fn(), {
    getState: vi.fn(),
  }),
}))

vi.mock('../../../../src/renderer/stores/metrics.store', () => ({
  useMetricsStore: vi.fn(),
}))

vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: {
    getState: vi.fn(),
  },
}))

vi.mock('../../../../src/renderer/components/overview/MetricsBar', () => ({
  MetricsBar: ({ system }: { system: unknown }) => (
    <div data-testid="metrics-bar" data-has-system={system !== null ? 'true' : 'false'} />
  ),
}))

vi.mock('../../../../src/renderer/components/overview/SessionTile', () => ({
  SessionTile: ({ session, onNavigate }: { session: TerminalSession; onNavigate: () => void }) => (
    <div data-testid={`tile-${session.id}`} role="button" onClick={onNavigate}>
      {session.tabTitle}
    </div>
  ),
}))

import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useMetricsStore } from '../../../../src/renderer/stores/metrics.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { OverviewScreen } from '../../../../src/renderer/components/overview/OverviewScreen'

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    tabTitle: 'bash',
    status: 'active',
    type: 'human',
    bellCount: 0,
    ...overrides,
  }
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'Alpha Workspace',
    path: '/alpha',
    color: '#4a9eff',
    theme: 'dark',
    tags: [],
    ...overrides,
  }
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'My Project',
    activeSessionId: 'sess-1',
    ...overrides,
  }
}

const mockGetPids = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(useSessionStore).mockReturnValue({
    sessions: new Map(),
  } as unknown as ReturnType<typeof useSessionStore>)

  vi.mocked(useWorkspaceStore).mockReturnValue({
    workspaces: [],
    projectsByWorkspaceId: new Map(),
  } as unknown as ReturnType<typeof useWorkspaceStore>)

  vi.mocked(useWorkspaceStore).getState = vi.fn().mockReturnValue({
    activeWorkspaceId: 'ws-1',
    setActiveWorkspace: mockSetActiveWorkspace,
    setActiveProject: mockSetActiveProject,
  })

  vi.mocked(useMetricsStore).mockReturnValue({
    system: null,
    processesBySessionId: new Map(),
    startPolling: mockStartPolling,
    stopPolling: mockStopPolling,
  } as unknown as ReturnType<typeof useMetricsStore>)

  vi.mocked(useExtensionRegistry).getState = vi.fn().mockReturnValue({
    setActiveGlobalTab: mockSetActiveGlobalTab,
  })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    metrics: { getPids: mockGetPids },
  }

  mockGetPids.mockResolvedValue({ data: [] })
})

describe('OverviewScreen', () => {
  it('renders empty state when no sessions', async () => {
    await act(async () => {
      render(<OverviewScreen />)
    })
    expect(screen.getByText('No open terminals')).toBeTruthy()
  })

  it('renders tile for each active session', async () => {
    const session = makeSession()
    const workspace = makeWorkspace()
    const project = makeProject()

    vi.mocked(useSessionStore).mockReturnValue({
      sessions: new Map([['sess-1', session]]),
    } as unknown as ReturnType<typeof useSessionStore>)

    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [workspace],
      projectsByWorkspaceId: new Map([['ws-1', [project]]]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)

    await act(async () => {
      render(<OverviewScreen />)
    })

    expect(screen.getByTestId('tile-sess-1')).toBeTruthy()
  })

  it('excludes closed sessions from tiles', async () => {
    const session = makeSession({ status: 'closed' })
    const workspace = makeWorkspace()
    const project = makeProject()

    vi.mocked(useSessionStore).mockReturnValue({
      sessions: new Map([['sess-1', session]]),
    } as unknown as ReturnType<typeof useSessionStore>)

    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [workspace],
      projectsByWorkspaceId: new Map([['ws-1', [project]]]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)

    await act(async () => {
      render(<OverviewScreen />)
    })

    expect(screen.queryByTestId('tile-sess-1')).toBeNull()
    expect(screen.getByText('No open terminals')).toBeTruthy()
  })

  it('calls startPolling with resolved PIDs', async () => {
    const session = makeSession()
    const workspace = makeWorkspace()
    const project = makeProject()

    vi.mocked(useSessionStore).mockReturnValue({
      sessions: new Map([['sess-1', session]]),
    } as unknown as ReturnType<typeof useSessionStore>)

    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [workspace],
      projectsByWorkspaceId: new Map([['ws-1', [project]]]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)

    mockGetPids.mockResolvedValue({ data: [{ sessionId: 'sess-1', pid: 1234 }] })

    await act(async () => {
      render(<OverviewScreen />)
    })

    expect(mockGetPids).toHaveBeenCalledWith(['sess-1'])
    expect(mockStartPolling).toHaveBeenCalledWith([{ sessionId: 'sess-1', pid: 1234 }])
  })

  it('calls startPolling with empty array when getPids returns error', async () => {
    const session = makeSession()
    const workspace = makeWorkspace()
    const project = makeProject()

    vi.mocked(useSessionStore).mockReturnValue({
      sessions: new Map([['sess-1', session]]),
    } as unknown as ReturnType<typeof useSessionStore>)

    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [workspace],
      projectsByWorkspaceId: new Map([['ws-1', [project]]]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)

    mockGetPids.mockRejectedValue(new Error('IPC fail'))

    await act(async () => {
      render(<OverviewScreen />)
    })

    expect(mockStartPolling).toHaveBeenCalledWith([])
  })

  it('calls startPolling immediately with empty array when no sessions', async () => {
    await act(async () => {
      render(<OverviewScreen />)
    })
    expect(mockStartPolling).toHaveBeenCalledWith([])
  })

  it('navigates to the correct project when a tile is clicked', async () => {
    const session = makeSession()
    const workspace = makeWorkspace()
    const project = makeProject()

    vi.mocked(useSessionStore).mockReturnValue({
      sessions: new Map([['sess-1', session]]),
    } as unknown as ReturnType<typeof useSessionStore>)

    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [workspace],
      projectsByWorkspaceId: new Map([['ws-1', [project]]]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)

    await act(async () => {
      render(<OverviewScreen />)
    })

    await act(async () => {
      screen.getByTestId('tile-sess-1').click()
    })

    expect(mockSetActiveProject).toHaveBeenCalledWith('proj-1')
    expect(mockSetActiveGlobalTab).toHaveBeenCalledWith(null)
  })

  it('switches workspace when navigating to a tile in a different workspace', async () => {
    const session = makeSession({ projectId: 'proj-2' })
    const workspace1 = makeWorkspace({ id: 'ws-1' })
    const workspace2 = makeWorkspace({ id: 'ws-2', name: 'Beta' })
    const project = makeProject({ id: 'proj-2', workspaceId: 'ws-2' })

    vi.mocked(useSessionStore).mockReturnValue({
      sessions: new Map([['sess-1', session]]),
    } as unknown as ReturnType<typeof useSessionStore>)

    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [workspace1, workspace2],
      projectsByWorkspaceId: new Map([['ws-2', [project]]]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)

    vi.mocked(useWorkspaceStore).getState = vi.fn().mockReturnValue({
      activeWorkspaceId: 'ws-1',
      setActiveWorkspace: mockSetActiveWorkspace,
      setActiveProject: mockSetActiveProject,
    })

    await act(async () => {
      render(<OverviewScreen />)
    })

    await act(async () => {
      screen.getByTestId('tile-sess-1').click()
    })

    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('ws-2')
    expect(mockSetActiveProject).toHaveBeenCalledWith('proj-2')
  })

  it('does not switch workspace when already in the correct one', async () => {
    const session = makeSession()
    const workspace = makeWorkspace()
    const project = makeProject()

    vi.mocked(useSessionStore).mockReturnValue({
      sessions: new Map([['sess-1', session]]),
    } as unknown as ReturnType<typeof useSessionStore>)

    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [workspace],
      projectsByWorkspaceId: new Map([['ws-1', [project]]]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)

    vi.mocked(useWorkspaceStore).getState = vi.fn().mockReturnValue({
      activeWorkspaceId: 'ws-1',
      setActiveWorkspace: mockSetActiveWorkspace,
      setActiveProject: mockSetActiveProject,
    })

    await act(async () => {
      render(<OverviewScreen />)
    })

    await act(async () => {
      screen.getByTestId('tile-sess-1').click()
    })

    expect(mockSetActiveWorkspace).not.toHaveBeenCalled()
  })

  it('sorts tiles by workspace name, then project name, then tab title', async () => {
    const ws1 = makeWorkspace({ id: 'ws-a', name: 'Alpha' })
    const ws2 = makeWorkspace({ id: 'ws-b', name: 'Beta' })
    const proj1 = makeProject({ id: 'p-1', workspaceId: 'ws-b', name: 'Project' })
    const proj2 = makeProject({ id: 'p-2', workspaceId: 'ws-a', name: 'Project' })
    const sess1 = makeSession({ id: 's-1', projectId: 'p-1' })
    const sess2 = makeSession({ id: 's-2', projectId: 'p-2' })

    vi.mocked(useSessionStore).mockReturnValue({
      sessions: new Map([
        ['s-1', sess1],
        ['s-2', sess2],
      ]),
    } as unknown as ReturnType<typeof useSessionStore>)

    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [ws1, ws2],
      projectsByWorkspaceId: new Map([
        ['ws-b', [proj1]],
        ['ws-a', [proj2]],
      ]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)

    await act(async () => {
      render(<OverviewScreen />)
    })

    const tiles = screen.getAllByRole('button')
    // Alpha workspace (ws-a) should come before Beta workspace (ws-b)
    expect(tiles[0].getAttribute('data-testid')).toBe('tile-s-2')
    expect(tiles[1].getAttribute('data-testid')).toBe('tile-s-1')
  })
})
