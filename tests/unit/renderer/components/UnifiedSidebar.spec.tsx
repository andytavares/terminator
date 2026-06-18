import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { UnifiedSidebar } from '../../../../src/renderer/components/sidebar/UnifiedSidebar'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: vi.fn(),
}))

vi.mock('../../../../src/renderer/hooks/useBranchSync', () => ({
  useBranchSync: vi.fn(),
}))

const ws1 = {
  id: 'ws-1',
  name: 'Backend',
  folderPath: '/b',
  color: '#5c6bc0',
  tags: [],
  createdAt: '',
  updatedAt: '',
}
const ws2 = {
  id: 'ws-2',
  name: 'Frontend',
  folderPath: '/f',
  color: '#26a69a',
  tags: [],
  createdAt: '',
  updatedAt: '',
}

const mockWorkspaceStore = {
  workspaces: [ws1, ws2],
  activeWorkspaceId: 'ws-1',
  activeProjectId: null,
  projectsByWorkspaceId: new Map([
    ['ws-1', []],
    ['ws-2', []],
  ]),
  expandedWorkspaceIds: new Set<string>(),
  toggleWorkspaceCollapse: vi.fn(),
  setExpandedWorkspaceIds: vi.fn(),
  setActiveWorkspace: vi.fn(),
  setActiveProject: vi.fn(),
  loadProjects: vi.fn().mockResolvedValue(undefined),
  loadWorkspaces: vi.fn(),
  reorderWorkspaces: vi.fn().mockResolvedValue(undefined),
}

const mockSessionStore = {
  getSessionsForProject: vi.fn().mockReturnValue([]),
  getBellCountForProject: vi.fn().mockReturnValue(0),
  isProjectBusy: vi.fn().mockReturnValue(false),
  activeSessionIdByProject: new Map<string, string>(),
  getScratchSessions: vi.fn().mockReturnValue([]),
}

const mockRegistryState = {
  globalTabs: new Map(),
  workspaceTabs: new Map(),
  activeGlobalTabId: null,
  sidebarButtons: [] as ReturnType<typeof useExtensionRegistry>['sidebarButtons'],
  setActiveGlobalTab: vi.fn(),
}

const defaultProps = {
  globalTabs: [],
  activeGlobalTabId: null as string | null,
  onSelectGlobalTab: vi.fn(),
  activeWorkspaceTabId: null as string | null,
  onSelectWorkspaceTab: vi.fn(),
  unreadNotifications: 0,
  notificationPanelOpen: false,
  onBellClick: vi.fn(),
  scratchActive: false,
  hasScratchSessions: false,
  onNewScratch: vi.fn(),
  activeScratchSessionId: null as string | null,
  onSelectScratchSession: vi.fn(),
  visible: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useWorkspaceStore).mockReturnValue(
    mockWorkspaceStore as unknown as ReturnType<typeof useWorkspaceStore>
  )
  vi.mocked(useSessionStore).mockReturnValue(
    mockSessionStore as unknown as ReturnType<typeof useSessionStore>
  )
  vi.mocked(useExtensionRegistry).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((selector: any) =>
      typeof selector === 'function'
        ? selector(mockRegistryState)
        : mockRegistryState) as unknown as typeof useExtensionRegistry
  )
})

describe('UnifiedSidebar', () => {
  it('renders all workspaces as WorkspaceCard components', () => {
    render(<UnifiedSidebar {...defaultProps} />)
    expect(screen.getByText('Backend')).toBeTruthy()
    expect(screen.getByText('Frontend')).toBeTruthy()
  })

  it('renders SidebarHeader', () => {
    const { container } = render(<UnifiedSidebar {...defaultProps} />)
    expect(container.querySelector('.sidebar-header')).toBeTruthy()
  })

  it('renders ScratchSection at the bottom', () => {
    const { container } = render(<UnifiedSidebar {...defaultProps} />)
    expect(container.querySelector('.scratch-section')).toBeTruthy()
  })

  it('passes isCollapsed=true to a WorkspaceCard whose id is NOT in expandedWorkspaceIds', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      ...mockWorkspaceStore,
      expandedWorkspaceIds: new Set<string>(),
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    const { container } = render(<UnifiedSidebar {...defaultProps} />)
    const cards = container.querySelectorAll('.ws-card')
    expect(cards.length).toBe(2)
    const firstCard = cards[0]
    expect(firstCard.querySelector('.ws-card__projects')).toBeNull()
  })

  it('applies unified-sidebar--hidden class when visible is false', () => {
    const { container } = render(<UnifiedSidebar {...defaultProps} visible={false} />)
    expect(container.querySelector('.unified-sidebar--hidden')).toBeTruthy()
  })

  it('does not apply hidden class when visible is true', () => {
    const { container } = render(<UnifiedSidebar {...defaultProps} visible />)
    expect(container.querySelector('.unified-sidebar--hidden')).toBeNull()
  })

  it('renders a resize handle element', () => {
    const { container } = render(<UnifiedSidebar {...defaultProps} />)
    expect(container.querySelector('.unified-sidebar__resize-handle')).toBeTruthy()
  })

  it('calls onNewScratch when ScratchSection add row is clicked', () => {
    const onNewScratch = vi.fn()
    render(<UnifiedSidebar {...defaultProps} onNewScratch={onNewScratch} />)
    fireEvent.click(screen.getByText(/new scratch terminal/i))
    expect(onNewScratch).toHaveBeenCalledOnce()
  })

  it('calls setActiveWorkspace and setActiveProject when a project is selected', () => {
    const setActiveWorkspace = vi.fn()
    const setActiveProject = vi.fn()
    vi.mocked(useWorkspaceStore).mockReturnValue({
      ...mockWorkspaceStore,
      workspaces: [ws1],
      projectsByWorkspaceId: new Map([
        [
          'ws-1',
          [
            {
              id: 'p1',
              workspaceId: 'ws-1',
              name: 'API',
              isWorktree: false,
              createdAt: '',
              updatedAt: '',
            },
          ],
        ],
      ]),
      setActiveWorkspace,
      setActiveProject,
      expandedWorkspaceIds: new Set<string>(['ws-1']),
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<UnifiedSidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('API'))
    expect(setActiveWorkspace).toHaveBeenCalledWith('ws-1')
    expect(setActiveProject).toHaveBeenCalledWith('p1')
  })

  it('calls onSelectGlobalTab when SidebarHeader tab button is clicked', () => {
    const onSelectGlobalTab = vi.fn()
    const tabs = [
      {
        id: 't1',
        label: 'Overview',
        icon: '⊞',
        component: (() =>
          null) as unknown as import('../../../../src/renderer/extensions/registry').GlobalTabRegistration['component'],
      },
    ]
    render(
      <UnifiedSidebar {...defaultProps} globalTabs={tabs} onSelectGlobalTab={onSelectGlobalTab} />
    )
    fireEvent.click(screen.getByTitle('Overview'))
    expect(onSelectGlobalTab).toHaveBeenCalledWith('t1')
  })

  it('resize handle double-click snaps width to default', () => {
    const { container } = render(<UnifiedSidebar {...defaultProps} />)
    const handle = container.querySelector('.unified-sidebar__resize-handle')!
    fireEvent.dblClick(handle)
    const sidebar = container.querySelector('.unified-sidebar') as HTMLElement
    expect(sidebar.style.width).toBe('260px')
  })

  it('clicking New workspace button opens CreateWorkspaceDialog', () => {
    render(<UnifiedSidebar {...defaultProps} />)
    fireEvent.click(screen.getByTitle('New workspace'))
    expect(
      document.querySelector('.create-workspace-dialog, [role="dialog"]') ??
        screen.queryByText(/create workspace/i)
    ).toBeTruthy()
  })

  it('drag start on workspace wrapper sets drag state', () => {
    const { container } = render(<UnifiedSidebar {...defaultProps} />)
    const wrappers = container.querySelectorAll('.unified-sidebar__list > [draggable]')
    fireEvent.dragStart(wrappers[0])
    // no crash expected
    expect(wrappers.length).toBe(2)
  })

  it('drag over on workspace wrapper applies dnd-over class', () => {
    const { container } = render(<UnifiedSidebar {...defaultProps} />)
    const wrappers = container.querySelectorAll('.unified-sidebar__list > [draggable]')
    fireEvent.dragStart(wrappers[0])
    fireEvent.dragOver(wrappers[1])
    expect(wrappers[1].classList.contains('ws-card--dnd-over')).toBe(true)
  })

  it('drop on workspace wrapper calls reorderWorkspaces', () => {
    const reorderWorkspaces = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useWorkspaceStore).mockReturnValue({
      ...mockWorkspaceStore,
      reorderWorkspaces,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    const { container } = render(<UnifiedSidebar {...defaultProps} />)
    const wrappers = container.querySelectorAll('.unified-sidebar__list > [draggable]')
    fireEvent.dragStart(wrappers[0])
    fireEvent.drop(wrappers[1])
    expect(reorderWorkspaces).toHaveBeenCalled()
  })

  it('drag leave removes dnd-over class', () => {
    const { container } = render(<UnifiedSidebar {...defaultProps} />)
    const wrappers = container.querySelectorAll('.unified-sidebar__list > [draggable]')
    fireEvent.dragStart(wrappers[0])
    fireEvent.dragOver(wrappers[1])
    fireEvent.dragLeave(wrappers[1])
    expect(wrappers[1].classList.contains('ws-card--dnd-over')).toBe(false)
  })

  it('drag end clears drag state without error', () => {
    const { container } = render(<UnifiedSidebar {...defaultProps} />)
    const wrappers = container.querySelectorAll('.unified-sidebar__list > [draggable]')
    fireEvent.dragStart(wrappers[0])
    fireEvent.dragEnd(wrappers[0])
    // no crash expected
    expect(container.querySelector('.unified-sidebar')).toBeTruthy()
  })

  it('toggleWorkspaceCollapse is called when workspace card header is clicked', () => {
    const toggleWorkspaceCollapse = vi.fn()
    vi.mocked(useWorkspaceStore).mockReturnValue({
      ...mockWorkspaceStore,
      toggleWorkspaceCollapse,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<UnifiedSidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Backend'))
    expect(toggleWorkspaceCollapse).toHaveBeenCalledWith('ws-1')
  })

  it('eager-loads projects for workspaces not yet in projectsByWorkspaceId', async () => {
    const loadProjects = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useWorkspaceStore).mockReturnValue({
      ...mockWorkspaceStore,
      projectsByWorkspaceId: new Map(), // neither workspace has been loaded yet
      loadProjects,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<UnifiedSidebar {...defaultProps} />)
    await waitFor(() => {
      expect(loadProjects).toHaveBeenCalledWith('ws-1')
      expect(loadProjects).toHaveBeenCalledWith('ws-2')
    })
  })
})
