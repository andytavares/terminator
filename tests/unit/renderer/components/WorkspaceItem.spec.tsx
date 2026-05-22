import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { WorkspaceItem } from '../../../../src/renderer/components/sidebar/WorkspaceItem'
import type { Workspace } from '../../../../src/shared/types/index'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/sidebar/EditWorkspaceDialog', () => ({
  EditWorkspaceDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="edit-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))
vi.mock('../../../../src/renderer/components/sidebar/CreateProjectDialog', () => ({
  CreateProjectDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-project-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))
vi.mock('../../../../src/renderer/components/sidebar/ProjectItem', () => ({
  ProjectItem: ({ project }: { project: { name: string } }) => (
    <div data-testid="project-item">{project.name}</div>
  ),
}))

const mockGetContextMenuItems = vi.fn()
const mockSetActiveWorkspace = vi.fn()
const mockDeleteWorkspace = vi.fn()

const ws: Workspace = {
  id: 'ws-1',
  name: 'My Work',
  color: '#4a90d9',
  folderPath: '/ws1',
  tags: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetContextMenuItems.mockResolvedValue({ items: [] })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extension: { getContextMenuItems: mockGetContextMenuItems, contextMenuClick: vi.fn() },
  }
  vi.mocked(useWorkspaceStore).mockReturnValue({
    activeWorkspaceId: 'ws-1',
    setActiveWorkspace: mockSetActiveWorkspace,
    deleteWorkspace: mockDeleteWorkspace,
    projectsByWorkspaceId: new Map([['ws-1', [{ id: 'proj-1', name: 'App' }]]]),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('WorkspaceItem', () => {
  it('renders workspace name', () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    expect(screen.getByText('My Work')).toBeTruthy()
  })

  it('renders collapsed initials (MW for "My Work")', () => {
    render(<WorkspaceItem workspace={ws} collapsed={true} />)
    expect(screen.getByText('MW')).toBeTruthy()
  })

  it('toggles expanded and shows projects when active workspace clicked', async () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.click(screen.getByText('My Work'))
    await waitFor(() => expect(screen.getByTestId('project-item')).toBeTruthy())
  })

  it('shows Add Project button when expanded and active', async () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.click(screen.getByText('My Work'))
    await waitFor(() => expect(screen.getByText('+ Add Project')).toBeTruthy())
  })

  it('shows context menu on right-click with Edit and Remove buttons', () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    expect(screen.getByText('Edit')).toBeTruthy()
    expect(screen.getByText('Remove')).toBeTruthy()
  })

  it('opens EditWorkspaceDialog when Edit is clicked from context menu', () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByTestId('edit-dialog')).toBeTruthy()
  })

  it('context menu has Remove option for dangerous action', () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    const removeBtn = document.querySelector('.context-menu__item--danger')
    expect(removeBtn).not.toBeNull()
    expect(removeBtn?.textContent).toBe('Remove')
  })

  it('shows confirm dialog then calls deleteWorkspace on confirm', async () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    fireEvent.click(screen.getByText('Remove'))
    // ConfirmDialog not mocked so it renders inline; check deleteWorkspace called via onConfirm
    await waitFor(() => expect(screen.getByText(/Remove workspace/)).toBeTruthy())
    fireEvent.click(screen.getByText('Remove')) // click the confirm button
    expect(mockDeleteWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('closes confirm dialog without deleting on cancel', async () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    fireEvent.click(screen.getByText('Remove'))
    await waitFor(() => expect(screen.getByText(/Remove workspace/)).toBeTruthy())
    fireEvent.click(screen.getByText('Cancel'))
    expect(mockDeleteWorkspace).not.toHaveBeenCalled()
  })

  it('opens CreateProjectDialog when Add Project is clicked', async () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.click(screen.getByText('My Work'))
    await waitFor(() => screen.getByText('+ Add Project'))
    fireEvent.click(screen.getByText('+ Add Project'))
    expect(screen.getByTestId('create-project-dialog')).toBeTruthy()
  })

  it('shows context menu on right-click in collapsed mode', () => {
    render(<WorkspaceItem workspace={ws} collapsed={true} />)
    fireEvent.contextMenu(screen.getByText('MW'))
    expect(screen.getByText('Edit')).toBeTruthy()
    expect(screen.getByText('Remove')).toBeTruthy()
  })

  it('opens edit dialog from collapsed context menu', () => {
    render(<WorkspaceItem workspace={ws} collapsed={true} />)
    fireEvent.contextMenu(screen.getByText('MW'))
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByTestId('edit-dialog')).toBeTruthy()
  })

  it('renders extension context menu items when provided', async () => {
    mockGetContextMenuItems.mockResolvedValue({
      items: [{ id: 'ext-1', label: 'Open in VS Code' }],
    })
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    await waitFor(() => {})
    fireEvent.contextMenu(screen.getByText('My Work'))
    expect(screen.getByText('Open in VS Code')).toBeTruthy()
  })

  it('calls contextMenuClick when extension item clicked', async () => {
    const mockContextMenuClick = vi.fn()
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      ...((globalThis as unknown as Record<string, unknown>).electronAPI as Record<
        string,
        unknown
      >),
      extension: {
        ...(
          (globalThis as unknown as Record<string, unknown>).electronAPI as Record<
            string,
            Record<string, unknown>
          >
        ).extension,
        contextMenuClick: mockContextMenuClick,
      },
    }
    mockGetContextMenuItems.mockResolvedValue({ items: [{ id: 'ext-1', label: 'Open VS Code' }] })
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    await waitFor(() => {})
    fireEvent.contextMenu(screen.getByText('My Work'))
    fireEvent.click(screen.getByText('Open VS Code'))
    expect(mockContextMenuClick).toHaveBeenCalledWith('workspace', 'ext-1', 'ws-1')
  })

  it('context menu closes when a window click fires (expanded mode)', () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    expect(screen.getByText('Edit')).toBeTruthy()
    fireEvent.click(window)
    expect(screen.queryByText('Edit')).toBeNull()
  })

  it('context menu closes when a window click fires (collapsed mode)', () => {
    render(<WorkspaceItem workspace={ws} collapsed={true} />)
    fireEvent.contextMenu(screen.getByText('MW'))
    expect(screen.getByText('Edit')).toBeTruthy()
    fireEvent.click(window)
    expect(screen.queryByText('Edit')).toBeNull()
  })

  it('closes EditWorkspaceDialog when onClose is called (expanded)', () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.contextMenu(screen.getByText('My Work'))
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByTestId('edit-dialog')).toBeTruthy()
    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByTestId('edit-dialog')).toBeNull()
  })

  it('closes EditWorkspaceDialog when onClose is called (collapsed)', () => {
    render(<WorkspaceItem workspace={ws} collapsed={true} />)
    fireEvent.contextMenu(screen.getByText('MW'))
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByTestId('edit-dialog')).toBeTruthy()
    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByTestId('edit-dialog')).toBeNull()
  })

  it('closes CreateProjectDialog when onClose is called', async () => {
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.click(screen.getByText('My Work'))
    await waitFor(() => screen.getByText('+ Add Project'))
    fireEvent.click(screen.getByText('+ Add Project'))
    expect(screen.getByTestId('create-project-dialog')).toBeTruthy()
    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByTestId('create-project-dialog')).toBeNull()
  })

  it('calls contextMenuClick when collapsed extension item clicked and closes menu', async () => {
    const mockContextMenuClick = vi.fn()
    ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
      extension: {
        getContextMenuItems: mockGetContextMenuItems,
        contextMenuClick: mockContextMenuClick,
      },
    }
    mockGetContextMenuItems.mockResolvedValue({
      items: [{ id: 'ext-collapsed', label: 'Open In Browser' }],
    })
    render(<WorkspaceItem workspace={ws} collapsed={true} />)
    await waitFor(() => {})
    fireEvent.contextMenu(screen.getByText('MW'))
    fireEvent.click(screen.getByText('Open In Browser'))
    expect(mockContextMenuClick).toHaveBeenCalledWith('workspace', 'ext-collapsed', 'ws-1')
    // Menu should be closed after click
    expect(screen.queryByText('Open In Browser')).toBeNull()
  })

  it('renders workspace tags when present', () => {
    const wsWithTags = { ...ws, tags: ['frontend', 'react'] }
    render(<WorkspaceItem workspace={wsWithTags} collapsed={false} />)
    expect(screen.getByText('frontend')).toBeTruthy()
    expect(screen.getByText('react')).toBeTruthy()
  })

  it('shows projects list when expanded and active with multiple projects', async () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      activeWorkspaceId: 'ws-1',
      setActiveWorkspace: mockSetActiveWorkspace,
      deleteWorkspace: mockDeleteWorkspace,
      projectsByWorkspaceId: new Map([
        [
          'ws-1',
          [
            { id: 'proj-1', name: 'App' },
            { id: 'proj-2', name: 'Docs' },
          ],
        ],
      ]),
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<WorkspaceItem workspace={ws} collapsed={false} />)
    fireEvent.click(screen.getByText('My Work'))
    await waitFor(() => {
      const items = screen.getAllByTestId('project-item')
      expect(items).toHaveLength(2)
    })
  })
})
