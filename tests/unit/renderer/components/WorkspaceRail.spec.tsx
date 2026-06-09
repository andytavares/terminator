import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { WorkspaceRail } from '../../../../src/renderer/components/sidebar/WorkspaceRail'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/sidebar/CreateWorkspaceDialog', () => ({
  CreateWorkspaceDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-ws-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))
vi.mock('../../../../src/renderer/components/sidebar/EditWorkspaceDialog', () => ({
  EditWorkspaceDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="edit-ws-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

const mockReorderWorkspaces = vi.fn()
const mockGetBellForProject = vi.fn()
const mockSetActiveWorkspace = vi.fn()
const mockDeleteWorkspace = vi.fn()

const ws1 = { id: 'ws-1', name: 'Work', color: '#4a90d9' }
const ws2 = { id: 'ws-2', name: 'Personal', color: '#7ed321' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useWorkspaceStore).mockReturnValue({
    workspaces: [ws1, ws2],
    reorderWorkspaces: mockReorderWorkspaces,
    activeWorkspaceId: 'ws-1',
    setActiveWorkspace: mockSetActiveWorkspace,
    deleteWorkspace: mockDeleteWorkspace,
    projectsByWorkspaceId: new Map([
      ['ws-1', []],
      ['ws-2', []],
    ]),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useSessionStore).mockReturnValue({
    getBellCountForProject: mockGetBellForProject,
    isProjectBusy: vi.fn().mockReturnValue(false),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  mockGetBellForProject.mockReturnValue(0)
})

describe('WorkspaceRail', () => {
  it('renders workspace initials', () => {
    render(<WorkspaceRail />)
    expect(screen.getByText('W')).toBeTruthy()
    expect(screen.getByText('P')).toBeTruthy()
  })

  it('renders create button', () => {
    render(<WorkspaceRail />)
    expect(screen.getByTitle('Create workspace')).toBeTruthy()
  })

  it('opens CreateWorkspaceDialog when + is clicked', () => {
    render(<WorkspaceRail />)
    fireEvent.click(screen.getByTitle('Create workspace'))
    expect(screen.getByTestId('create-ws-dialog')).toBeTruthy()
  })

  it('renders empty rail with no workspaces', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [],
      reorderWorkspaces: mockReorderWorkspaces,
      activeWorkspaceId: null,
      setActiveWorkspace: mockSetActiveWorkspace,
      deleteWorkspace: mockDeleteWorkspace,
      projectsByWorkspaceId: new Map(),
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    const { container } = render(<WorkspaceRail />)
    expect(container.querySelector('.ws-rail')).toBeTruthy()
  })

  it('shows active workspace with active class', () => {
    const { container } = render(<WorkspaceRail />)
    expect(container.querySelector('.ws-tile--active')).toBeTruthy()
  })

  it('calls setActiveWorkspace when workspace tile is clicked', () => {
    render(<WorkspaceRail />)
    const tiles = screen.getAllByText(/^(W|P)$/)
    fireEvent.click(tiles[1].closest('.ws-tile')!)
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('ws-2')
  })

  it('shows context menu on right-click', () => {
    render(<WorkspaceRail />)
    const tiles = screen.getAllByText(/^(W|P)$/)
    fireEvent.contextMenu(tiles[0].closest('.ws-tile')!)
    expect(screen.getByText('Edit workspace')).toBeTruthy()
    expect(screen.getByText('Remove workspace')).toBeTruthy()
  })

  it('opens EditWorkspaceDialog from context menu', () => {
    render(<WorkspaceRail />)
    const tiles = screen.getAllByText(/^(W|P)$/)
    fireEvent.contextMenu(tiles[0].closest('.ws-tile')!)
    fireEvent.click(screen.getByText('Edit workspace'))
    expect(screen.getByTestId('edit-ws-dialog')).toBeTruthy()
  })

  it('shows confirm dialog and calls deleteWorkspace on confirm', async () => {
    render(<WorkspaceRail />)
    const tiles = screen.getAllByText(/^(W|P)$/)
    fireEvent.contextMenu(tiles[0].closest('.ws-tile')!)
    fireEvent.click(screen.getByText('Remove workspace'))
    expect(screen.getByText(/Remove workspace "Work"/)).toBeTruthy()
    fireEvent.click(screen.getByText('Remove'))
    expect(mockDeleteWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('closes confirm dialog without deleting on cancel', async () => {
    render(<WorkspaceRail />)
    const tiles = screen.getAllByText(/^(W|P)$/)
    fireEvent.contextMenu(tiles[0].closest('.ws-tile')!)
    fireEvent.click(screen.getByText('Remove workspace'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(mockDeleteWorkspace).not.toHaveBeenCalled()
  })

  it('renders core.overview tab before workspace tiles', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <WorkspaceRail
        globalTabs={[
          {
            id: 'core.overview',
            label: 'Overview',
            icon: '⊞',
            component: () => null,
            permanent: true,
          },
        ]}
        activeGlobalTabId={null}
        onSelectGlobalTab={onSelect}
      />
    )
    const rail = container.querySelector('.ws-rail')!
    const children = Array.from(rail.children)
    const overviewIdx = children.findIndex((el) => el.textContent?.includes('⊞'))
    const firstTileIdx = children.findIndex((el) => el.classList.contains('ws-tile-wrap'))
    expect(overviewIdx).toBeLessThan(firstTileIdx)
  })

  it('renders a divider between overview and workspace tiles', () => {
    const { container } = render(
      <WorkspaceRail
        globalTabs={[
          {
            id: 'core.overview',
            label: 'Overview',
            icon: '⊞',
            component: () => null,
            permanent: true,
          },
        ]}
        activeGlobalTabId={null}
        onSelectGlobalTab={vi.fn()}
      />
    )
    expect(container.querySelector('.ws-rail__divider')).toBeTruthy()
  })

  it('non-overview global tabs stay at the bottom (after spacer)', () => {
    const { container } = render(
      <WorkspaceRail
        globalTabs={[
          {
            id: 'core.overview',
            label: 'Overview',
            icon: '⊞',
            component: () => null,
            permanent: true,
          },
          { id: 'ext.other', label: 'Other', icon: '◉', component: () => null, permanent: false },
        ]}
        activeGlobalTabId={null}
        onSelectGlobalTab={vi.fn()}
      />
    )
    const rail = container.querySelector('.ws-rail')!
    const children = Array.from(rail.children)
    const spacerIdx = children.findIndex((el) => el.classList.contains('ws-rail__spacer'))
    const otherIdx = children.findIndex((el) => el.textContent === '◉')
    expect(otherIdx).toBeGreaterThan(spacerIdx)
  })

  it('calls reorderWorkspaces on drag and drop between tiles', async () => {
    const { container } = render(<WorkspaceRail />)
    const tiles = container.querySelectorAll('.ws-tile-wrap')
    fireEvent.dragStart(tiles[0])
    fireEvent.dragOver(tiles[1], { preventDefault: () => {} })
    fireEvent.drop(tiles[1])
    expect(mockReorderWorkspaces).toHaveBeenCalledWith(['ws-2', 'ws-1'])
  })

  it('does not reorder when dropping on same index', async () => {
    const { container } = render(<WorkspaceRail />)
    const tiles = container.querySelectorAll('.ws-tile-wrap')
    fireEvent.dragStart(tiles[0])
    fireEvent.drop(tiles[0])
    expect(mockReorderWorkspaces).not.toHaveBeenCalled()
  })

  it('shows dnd-over class on drag over', async () => {
    const { container } = render(<WorkspaceRail />)
    const tiles = container.querySelectorAll('.ws-tile-wrap')
    fireEvent.dragStart(tiles[0])
    fireEvent.dragOver(tiles[1])
    expect(tiles[1].classList.contains('ws-tile-wrap--dnd-over')).toBe(true)
  })

  it('clears dnd-over class on drag leave', async () => {
    const { container } = render(<WorkspaceRail />)
    const tiles = container.querySelectorAll('.ws-tile-wrap')
    fireEvent.dragStart(tiles[0])
    fireEvent.dragOver(tiles[1])
    fireEvent.dragLeave(tiles[1])
    expect(tiles[1].classList.contains('ws-tile-wrap--dnd-over')).toBe(false)
  })

  it('clears drag state on dragEnd', () => {
    const { container } = render(<WorkspaceRail />)
    const tiles = container.querySelectorAll('.ws-tile-wrap')
    fireEvent.dragStart(tiles[0])
    fireEvent.dragOver(tiles[1])
    fireEvent.dragEnd(tiles[0])
    expect(tiles[1].classList.contains('ws-tile-wrap--dnd-over')).toBe(false)
  })

  it('shows ActivitySpinner when a project in the workspace is busy', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [ws1],
      reorderWorkspaces: mockReorderWorkspaces,
      activeWorkspaceId: 'ws-1',
      setActiveWorkspace: mockSetActiveWorkspace,
      deleteWorkspace: mockDeleteWorkspace,
      projectsByWorkspaceId: new Map([
        ['ws-1', [{ id: 'proj-1', name: 'Project A', worktreePath: '' }]],
      ]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    vi.mocked(useSessionStore).mockReturnValue({
      getBellCountForProject: vi.fn().mockReturnValue(0),
      isProjectBusy: vi.fn().mockReturnValue(true),
    } as unknown as ReturnType<typeof useSessionStore>)
    const { container } = render(<WorkspaceRail />)
    expect(container.querySelector('.activity-spinner')).toBeTruthy()
  })

  it('does not show ActivitySpinner when no project is busy', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [ws1],
      reorderWorkspaces: mockReorderWorkspaces,
      activeWorkspaceId: 'ws-1',
      setActiveWorkspace: mockSetActiveWorkspace,
      deleteWorkspace: mockDeleteWorkspace,
      projectsByWorkspaceId: new Map([
        ['ws-1', [{ id: 'proj-1', name: 'Project A', worktreePath: '' }]],
      ]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    vi.mocked(useSessionStore).mockReturnValue({
      getBellCountForProject: vi.fn().mockReturnValue(0),
      isProjectBusy: vi.fn().mockReturnValue(false),
    } as unknown as ReturnType<typeof useSessionStore>)
    const { container } = render(<WorkspaceRail />)
    expect(container.querySelector('.activity-spinner')).toBeNull()
  })

  it('calls onSelectGlobalTab with pinned tab id when overview button is clicked', () => {
    const onSelectGlobalTab = vi.fn()
    render(
      <WorkspaceRail
        globalTabs={[{ id: 'core.overview', label: 'Overview', icon: '⊞' }] as never}
        activeGlobalTabId={null}
        onSelectGlobalTab={onSelectGlobalTab}
      />
    )
    const btn = document.querySelector('.ws-rail__global-tab') as HTMLButtonElement
    fireEvent.click(btn)
    expect(onSelectGlobalTab).toHaveBeenCalledWith('core.overview')
  })

  describe('bell button', () => {
    it('renders bell button when onBellClick is provided', () => {
      render(<WorkspaceRail onBellClick={vi.fn()} />)
      expect(screen.getByTitle('Notifications')).toBeTruthy()
    })

    it('does not render bell button when onBellClick is not provided', () => {
      render(<WorkspaceRail />)
      expect(screen.queryByTitle('Notifications')).toBeNull()
    })

    it('calls onBellClick when bell button is clicked', () => {
      const onBellClick = vi.fn()
      render(<WorkspaceRail onBellClick={onBellClick} />)
      fireEvent.click(screen.getByTitle('Notifications'))
      expect(onBellClick).toHaveBeenCalled()
    })

    it('applies active class when notificationPanelOpen is true', () => {
      render(<WorkspaceRail onBellClick={vi.fn()} notificationPanelOpen={true} />)
      const btn = screen.getByTitle('Notifications')
      expect(btn.className).toContain('ws-rail__bell--active')
    })

    it('does not apply active class when notificationPanelOpen is false', () => {
      render(<WorkspaceRail onBellClick={vi.fn()} notificationPanelOpen={false} />)
      const btn = screen.getByTitle('Notifications')
      expect(btn.className).not.toContain('ws-rail__bell--active')
    })

    it('includes unread count in aria-label when unreadNotifications > 0', () => {
      render(<WorkspaceRail onBellClick={vi.fn()} unreadNotifications={3} />)
      const btn = screen.getByTitle('Notifications')
      expect(btn.getAttribute('aria-label')).toContain('3 unread')
    })

    it('omits unread count in aria-label when unreadNotifications is 0', () => {
      render(<WorkspaceRail onBellClick={vi.fn()} unreadNotifications={0} />)
      const btn = screen.getByTitle('Notifications')
      expect(btn.getAttribute('aria-label')).toBe('Notifications')
    })
  })
})
