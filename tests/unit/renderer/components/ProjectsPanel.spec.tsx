import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { ProjectsPanel } from '../../../../src/renderer/components/sidebar/ProjectsPanel'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/sidebar/CreateProjectDialog', () => ({
  CreateProjectDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-project-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))
vi.mock('../../../../src/renderer/components/sidebar/BranchSwitcher', () => ({
  BranchSwitcher: () => <div data-testid="branch-switcher" />,
}))

const mockSetActiveProject = vi.fn()
const mockDeleteProject = vi.fn()
const mockRenameProject = vi.fn()
const mockReorderProjects = vi.fn()
const mockGetBellCountForProject = vi.fn().mockReturnValue(0)

const workspace = {
  id: 'ws-1',
  name: 'My Workspace',
  folderPath: '/home/user/projects',
  color: '#4A90E2',
  tags: [],
}

const project = {
  id: 'proj-1',
  workspaceId: 'ws-1',
  name: 'My Project',
  gitBranch: null,
  worktreePath: null,
  isWorktree: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDeleteProject.mockResolvedValue({ success: true })
  mockRenameProject.mockResolvedValue({ project: { ...project, name: 'Renamed' } })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    git: {
      isRepo: vi.fn().mockResolvedValue({ isRepo: false }),
      listBranches: vi.fn().mockResolvedValue({ branches: [] }),
      suggestWorktreePath: vi.fn().mockResolvedValue({ path: '' }),
      createWorktree: vi.fn().mockResolvedValue({ success: true }),
    },
  }
  vi.mocked(useWorkspaceStore).mockReturnValue({
    workspaces: [workspace],
    projectsByWorkspaceId: new Map([['ws-1', [project]]]),
    activeProjectId: null,
    setActiveProject: mockSetActiveProject,
    deleteProject: mockDeleteProject,
    renameProject: mockRenameProject,
    reorderProjects: mockReorderProjects,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useSessionStore).mockReturnValue({
    getBellCountForProject: mockGetBellCountForProject,
  } as unknown as ReturnType<typeof useWorkspaceStore>)
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('ProjectsPanel', () => {
  it('renders workspace name in header', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    expect(screen.getByText('My Workspace')).toBeTruthy()
  })

  it('shows project count', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    expect(screen.getByText('1 project')).toBeTruthy()
  })

  it('shows plural projects count', () => {
    const project2 = { ...project, id: 'proj-2', name: 'Second Project' }
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [workspace],
      projectsByWorkspaceId: new Map([['ws-1', [project, project2]]]),
      activeProjectId: null,
      setActiveProject: mockSetActiveProject,
      deleteProject: mockDeleteProject,
      renameProject: mockRenameProject,
      reorderProjects: mockReorderProjects,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<ProjectsPanel workspaceId="ws-1" />)
    expect(screen.getByText('2 projects')).toBeTruthy()
  })

  it('renders project name', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    expect(screen.getByText('My Project')).toBeTruthy()
  })

  it('renders New project button', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    expect(screen.getByText('New project')).toBeTruthy()
  })

  it('opens CreateProjectDialog when New project is clicked', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    fireEvent.click(screen.getByText('New project'))
    expect(screen.getByTestId('create-project-dialog')).toBeTruthy()
  })

  it('closes CreateProjectDialog when onClose is called', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    fireEvent.click(screen.getByText('New project'))
    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByTestId('create-project-dialog')).toBeNull()
  })

  it('returns empty fragment when workspace not found', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [],
      projectsByWorkspaceId: new Map(),
      activeProjectId: null,
      setActiveProject: mockSetActiveProject,
      deleteProject: mockDeleteProject,
      renameProject: mockRenameProject,
      reorderProjects: mockReorderProjects,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    const { container } = render(<ProjectsPanel workspaceId="ws-unknown" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders workspace tags when present', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [{ ...workspace, tags: ['frontend', 'react'] }],
      projectsByWorkspaceId: new Map([['ws-1', []]]),
      activeProjectId: null,
      setActiveProject: mockSetActiveProject,
      deleteProject: mockDeleteProject,
      renameProject: mockRenameProject,
      reorderProjects: mockReorderProjects,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<ProjectsPanel workspaceId="ws-1" />)
    expect(screen.getByText('frontend')).toBeTruthy()
    expect(screen.getByText('react')).toBeTruthy()
  })

  it('sets active project when project card is clicked', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    fireEvent.click(screen.getByText('My Project'))
    expect(mockSetActiveProject).toHaveBeenCalledWith('proj-1')
  })

  it('opens context menu when options button is clicked', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    const menuBtn = screen.getByTitle('Options')
    fireEvent.click(menuBtn)
    expect(screen.getByText('Rename')).toBeTruthy()
    expect(screen.getByText('Remove project')).toBeTruthy()
  })

  it('shows confirm dialog when Remove project is clicked', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    fireEvent.click(screen.getByTitle('Options'))
    fireEvent.click(screen.getByText('Remove project'))
    expect(screen.getByText(/Remove project "My Project"/)).toBeTruthy()
  })

  it('starts rename mode on double-click of project name', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    fireEvent.dblClick(screen.getByText('My Project'))
    expect(screen.getByDisplayValue('My Project')).toBeTruthy()
  })

  it('cancels rename on Escape key', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    fireEvent.dblClick(screen.getByText('My Project'))
    const input = screen.getByDisplayValue('My Project')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByDisplayValue('My Project')).toBeNull()
  })

  it('commits rename on Enter key', async () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    fireEvent.dblClick(screen.getByText('My Project'))
    const input = screen.getByDisplayValue('My Project')
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() => expect(mockRenameProject).toHaveBeenCalledWith('proj-1', 'New Name'))
  })

  it('shows Projects section label when projects exist', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    expect(screen.getByText('Projects')).toBeTruthy()
  })

  it('does not show Projects label when no projects', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaces: [workspace],
      projectsByWorkspaceId: new Map([['ws-1', []]]),
      activeProjectId: null,
      setActiveProject: mockSetActiveProject,
      deleteProject: mockDeleteProject,
      renameProject: mockRenameProject,
      reorderProjects: mockReorderProjects,
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<ProjectsPanel workspaceId="ws-1" />)
    expect(screen.queryByText('Projects')).toBeNull()
  })

  it('deletes project when confirm dialog is confirmed', () => {
    render(<ProjectsPanel workspaceId="ws-1" />)
    fireEvent.click(screen.getByTitle('Options'))
    fireEvent.click(screen.getByText('Remove project'))
    fireEvent.click(screen.getByText('Remove'))
    expect(mockDeleteProject).toHaveBeenCalledWith('proj-1')
  })
})
