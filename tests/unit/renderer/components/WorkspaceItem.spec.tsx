import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { WorkspaceItem } from '../../../../src/renderer/components/sidebar/WorkspaceItem'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/sidebar/EditWorkspaceDialog', () => ({
  EditWorkspaceDialog: ({ onClose }: any) => (
    <div data-testid="edit-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))
vi.mock('../../../../src/renderer/components/sidebar/CreateProjectDialog', () => ({
  CreateProjectDialog: ({ onClose }: any) => (
    <div data-testid="create-project-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))
vi.mock('../../../../src/renderer/components/sidebar/ProjectItem', () => ({
  ProjectItem: ({ project }: any) => <div data-testid="project-item">{project.name}</div>,
}))

const mockGetContextMenuItems = vi.fn()
const mockSetActiveWorkspace = vi.fn()
const mockDeleteWorkspace = vi.fn()

const ws = { id: 'ws-1', name: 'My Work', color: '#4a90d9', tags: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetContextMenuItems.mockResolvedValue({ items: [] })
  ;(globalThis as any).electronAPI = {
    extension: { getContextMenuItems: mockGetContextMenuItems, contextMenuClick: vi.fn() },
  }
  vi.mocked(useWorkspaceStore).mockReturnValue({
    activeWorkspaceId: 'ws-1',
    setActiveWorkspace: mockSetActiveWorkspace,
    deleteWorkspace: mockDeleteWorkspace,
    projectsByWorkspaceId: new Map([['ws-1', [{ id: 'proj-1', name: 'App' }]]]),
  } as any)
})

afterEach(() => {
  delete (globalThis as any).electronAPI
})

describe('WorkspaceItem', () => {
  it('renders workspace name', () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={false} />)
    expect(screen.getByText('My Work')).toBeTruthy()
  })

  it('renders collapsed initials (MW for "My Work")', () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={true} />)
    expect(screen.getByText('MW')).toBeTruthy()
  })

  it('toggles expanded and shows projects when active workspace clicked', async () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={false} />)
    fireEvent.click(screen.getByText('My Work'))
    await waitFor(() => expect(screen.getByTestId('project-item')).toBeTruthy())
  })

  it('shows Add Project button when expanded and active', async () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={false} />)
    fireEvent.click(screen.getByText('My Work'))
    await waitFor(() => expect(screen.getByText('+ Add Project')).toBeTruthy())
  })

  it('shows context menu on right-click with Edit and Remove buttons', () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    expect(screen.getByText('Edit')).toBeTruthy()
    expect(screen.getByText('Remove')).toBeTruthy()
  })

  it('opens EditWorkspaceDialog when Edit is clicked from context menu', () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByTestId('edit-dialog')).toBeTruthy()
  })

  it('context menu has Remove option for dangerous action', () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    const removeBtn = document.querySelector('.context-menu__item--danger')
    expect(removeBtn).not.toBeNull()
    expect(removeBtn?.textContent).toBe('Remove')
  })

  it('shows confirm dialog then calls deleteWorkspace on confirm', async () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    fireEvent.click(screen.getByText('Remove'))
    // ConfirmDialog not mocked so it renders inline; check deleteWorkspace called via onConfirm
    await waitFor(() => expect(screen.getByText(/Remove workspace/)).toBeTruthy())
    fireEvent.click(screen.getByText('Remove')) // click the confirm button
    expect(mockDeleteWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('closes confirm dialog without deleting on cancel', async () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    fireEvent.click(screen.getByText('Remove'))
    await waitFor(() => expect(screen.getByText(/Remove workspace/)).toBeTruthy())
    fireEvent.click(screen.getByText('Cancel'))
    expect(mockDeleteWorkspace).not.toHaveBeenCalled()
  })

  it('opens CreateProjectDialog when Add Project is clicked', async () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={false} />)
    fireEvent.click(screen.getByText('My Work'))
    await waitFor(() => screen.getByText('+ Add Project'))
    fireEvent.click(screen.getByText('+ Add Project'))
    expect(screen.getByTestId('create-project-dialog')).toBeTruthy()
  })

  it('shows context menu on right-click in collapsed mode', () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={true} />)
    fireEvent.contextMenu(screen.getByText('MW'))
    expect(screen.getByText('Edit')).toBeTruthy()
    expect(screen.getByText('Remove')).toBeTruthy()
  })

  it('opens edit dialog from collapsed context menu', () => {
    render(<WorkspaceItem workspace={ws as any} collapsed={true} />)
    fireEvent.contextMenu(screen.getByText('MW'))
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByTestId('edit-dialog')).toBeTruthy()
  })

  it('renders extension context menu items when provided', async () => {
    mockGetContextMenuItems.mockResolvedValue({
      items: [{ id: 'ext-1', label: 'Open in VS Code' }],
    })
    render(<WorkspaceItem workspace={ws as any} collapsed={false} />)
    await waitFor(() => {})
    fireEvent.contextMenu(screen.getByText('My Work'))
    expect(screen.getByText('Open in VS Code')).toBeTruthy()
  })

  it('calls contextMenuClick when extension item clicked', async () => {
    const mockContextMenuClick = vi.fn()
    ;(globalThis as any).electronAPI.extension.contextMenuClick = mockContextMenuClick
    mockGetContextMenuItems.mockResolvedValue({ items: [{ id: 'ext-1', label: 'Open VS Code' }] })
    render(<WorkspaceItem workspace={ws as any} collapsed={false} />)
    await waitFor(() => {})
    fireEvent.contextMenu(screen.getByText('My Work'))
    fireEvent.click(screen.getByText('Open VS Code'))
    expect(mockContextMenuClick).toHaveBeenCalledWith('workspace', 'ext-1', 'ws-1')
  })
})
