import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { WorkspaceCard } from '../../../../src/renderer/components/sidebar/WorkspaceCard'
import type { Workspace, Project } from '../../../../src/shared/types/index'

vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: vi.fn(),
}))

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn().mockReturnValue({
    getSessionsForProject: vi.fn().mockReturnValue([]),
    getBellCountForProject: vi.fn().mockReturnValue(0),
    isProjectBusy: vi.fn().mockReturnValue(false),
    activeSessionIdByProject: new Map(),
  }),
}))

const mockWorkspaceStore = {
  deleteWorkspace: vi.fn().mockResolvedValue(undefined),
  reorderProjects: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn().mockImplementation(() => mockWorkspaceStore),
}))

vi.mock('../../../../src/renderer/components/sidebar/CreateProjectDialog', () => ({
  CreateProjectDialog: ({ onClose }: { workspaceId: string; onClose: () => void }) =>
    React.createElement(
      'div',
      { 'data-testid': 'create-project-dialog' },
      React.createElement('button', { onClick: onClose }, 'close-dialog')
    ),
}))

vi.mock('../../../../src/renderer/components/sidebar/EditWorkspaceDialog', () => ({
  EditWorkspaceDialog: ({ onClose }: { workspace: unknown; onClose: () => void }) =>
    React.createElement(
      'div',
      { 'data-testid': 'edit-workspace-dialog' },
      React.createElement('button', { onClick: onClose }, 'close-edit')
    ),
}))

const makeWorkspace = (): Workspace => ({
  id: 'ws-1',
  name: 'Backend',
  folderPath: '/projects/backend',
  color: '#5c6bc0',
  tags: [],
  createdAt: '',
  updatedAt: '',
})

const makeProject = (id: string, name: string): Project => ({
  id,
  workspaceId: 'ws-1',
  name,
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
})

const mockRegistryState = {
  sidebarButtons: [] as ReturnType<typeof useExtensionRegistry>['sidebarButtons'],
  workspaceTabs: new Map(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useExtensionRegistry).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((selector: any) =>
      typeof selector === 'function'
        ? selector(mockRegistryState)
        : mockRegistryState) as unknown as typeof useExtensionRegistry
  )
})

describe('WorkspaceCard', () => {
  const defaultProps = {
    workspace: makeWorkspace(),
    projects: [makeProject('p1', 'Auth Service'), makeProject('p2', 'API Gateway')],
    isCollapsed: false,
    onToggleCollapse: vi.fn(),
    activeProjectId: null as string | null,
    onSelectProject: vi.fn(),
  }

  it('renders the workspace name', () => {
    render(<WorkspaceCard {...defaultProps} />)
    expect(screen.getByText('Backend')).toBeTruthy()
  })

  it('renders a color band element', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    expect(container.querySelector('.ws-card__band')).toBeTruthy()
  })

  it('renders all projects as ProjectRow children when not collapsed', () => {
    render(<WorkspaceCard {...defaultProps} />)
    expect(screen.getByText('Auth Service')).toBeTruthy()
    expect(screen.getByText('API Gateway')).toBeTruthy()
  })

  it('hides project list when isCollapsed is true', () => {
    render(<WorkspaceCard {...defaultProps} isCollapsed />)
    expect(screen.queryByText('Auth Service')).toBeNull()
    expect(screen.queryByText('API Gateway')).toBeNull()
  })

  it('calls onToggleCollapse when header is clicked', () => {
    const onToggleCollapse = vi.fn()
    render(<WorkspaceCard {...defaultProps} onToggleCollapse={onToggleCollapse} />)
    fireEvent.click(screen.getByText('Backend'))
    expect(onToggleCollapse).toHaveBeenCalledOnce()
  })

  it('sets --ws-color CSS variable on root element', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue('--ws-color')).toBe('#5c6bc0')
  })

  it('renders + New project button when not collapsed', () => {
    render(<WorkspaceCard {...defaultProps} />)
    expect(screen.getByText('New project')).toBeTruthy()
  })

  it('does not render + New project when collapsed', () => {
    render(<WorkspaceCard {...defaultProps} isCollapsed />)
    expect(screen.queryByText('New project')).toBeNull()
  })

  it('shows workspace context menu on right-click of header', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.ws-card__header')!)
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
  })

  it('context menu has Edit workspace and Remove workspace options', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.ws-card__header')!)
    expect(document.querySelector('.ctx-menu')?.textContent).toContain('Edit workspace')
    expect(document.querySelector('.ctx-menu')?.textContent).toContain('Remove workspace')
  })

  it('clicking Edit workspace in context menu opens edit dialog', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.ws-card__header')!)
    const editBtn = Array.from(document.querySelectorAll('.ctx-menu__item')).find(
      (b) => b.textContent === 'Edit workspace'
    ) as HTMLElement
    fireEvent.click(editBtn)
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })

  it('clicking Remove workspace in context menu opens confirm dialog', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.ws-card__header')!)
    const removeBtn = Array.from(document.querySelectorAll('.ctx-menu__item')).find(
      (b) => b.textContent === 'Remove workspace'
    ) as HTMLElement
    fireEvent.click(removeBtn)
    expect(screen.getByText(/Remove workspace/i)).toBeTruthy()
  })

  it('window click closes context menu', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.ws-card__header')!)
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
    fireEvent.click(window)
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })

  it('+ New project button click opens CreateProjectDialog', () => {
    render(<WorkspaceCard {...defaultProps} />)
    fireEvent.click(screen.getByText('New project'))
    expect(screen.getByTestId('create-project-dialog')).toBeTruthy()
  })

  it('confirm dialog Remove calls deleteWorkspace', async () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.ws-card__header')!)
    const removeBtn = Array.from(document.querySelectorAll('.ctx-menu__item')).find(
      (b) => b.textContent === 'Remove workspace'
    ) as HTMLElement
    fireEvent.click(removeBtn)
    const confirmBtn = screen.getByText('Remove')
    await act(async () => {
      fireEvent.click(confirmBtn)
    })
    expect(mockWorkspaceStore.deleteWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('confirm dialog Cancel dismisses dialog without deleting', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    fireEvent.contextMenu(container.querySelector('.ws-card__header')!)
    const removeBtn = Array.from(document.querySelectorAll('.ctx-menu__item')).find(
      (b) => b.textContent === 'Remove workspace'
    ) as HTMLElement
    fireEvent.click(removeBtn)
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Cancel')).toBeNull()
    expect(mockWorkspaceStore.deleteWorkspace).not.toHaveBeenCalled()
  })

  it('project drag start sets drag index', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    // Direct children of ws-card__projects are the project wrapper divs
    const projectWrappers = Array.from(
      container.querySelector('.ws-card__projects')!.children
    ).filter((el) => el.getAttribute('draggable') === 'true')
    expect(projectWrappers.length).toBe(2)
    fireEvent.dragStart(projectWrappers[0])
  })

  it('project drag over sets drag-over highlight', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    const projectWrappers = Array.from(
      container.querySelector('.ws-card__projects')!.children
    ).filter((el) => el.getAttribute('draggable') === 'true')
    fireEvent.dragStart(projectWrappers[0])
    fireEvent.dragOver(projectWrappers[1])
    expect(container.querySelector('.proj-dnd-target')).toBeTruthy()
  })

  it('project drag leave clears drag-over highlight', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    const projectWrappers = Array.from(
      container.querySelector('.ws-card__projects')!.children
    ).filter((el) => el.getAttribute('draggable') === 'true')
    fireEvent.dragStart(projectWrappers[0])
    fireEvent.dragOver(projectWrappers[1])
    fireEvent.dragLeave(projectWrappers[1])
    expect(container.querySelector('.proj-dnd-target')).toBeNull()
  })

  it('project drop calls reorderProjects when indices differ', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    const projectWrappers = Array.from(
      container.querySelector('.ws-card__projects')!.children
    ).filter((el) => el.getAttribute('draggable') === 'true')
    fireEvent.dragStart(projectWrappers[0])
    fireEvent.dragOver(projectWrappers[1])
    fireEvent.drop(projectWrappers[1])
    expect(mockWorkspaceStore.reorderProjects).toHaveBeenCalledWith('ws-1', ['p2', 'p1'])
  })

  it('project drag end clears state', () => {
    const { container } = render(<WorkspaceCard {...defaultProps} />)
    const projectWrappers = Array.from(
      container.querySelector('.ws-card__projects')!.children
    ).filter((el) => el.getAttribute('draggable') === 'true')
    fireEvent.dragStart(projectWrappers[0])
    fireEvent.dragOver(projectWrappers[1])
    fireEvent.dragEnd(projectWrappers[0])
    expect(container.querySelector('.proj-dnd-target')).toBeNull()
  })
})
