import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { MoveSessionDialog } from '../../../../src/renderer/components/sidebar/MoveSessionDialog'
import type { Project, Workspace } from '../../../../src/shared/types/index'
import { seedStore, terminalSessionOf } from '../../../support/renderer-stores'

vi.mock('../../../../src/renderer/components/sidebar/CreateWorkspaceDialog', () => ({
  CreateWorkspaceDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-workspace-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

const SCRATCH = '00000000-0000-0000-0000-000000000000'

const workspace1: Workspace = {
  id: 'ws-1',
  name: 'Alpha',
  color: '#f00',
  tags: [],
  folderPath: '/a',
  createdAt: '',
  updatedAt: '',
}
const project1: Project = {
  id: 'proj-1',
  workspaceId: 'ws-1',
  name: 'Proj One',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}
const project2: Project = {
  id: 'proj-2',
  workspaceId: 'ws-1',
  name: 'Proj Two',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}

const mockMoveSession = vi.fn()
const mockSetActiveWorkspace = vi.fn()
const mockSetActiveProject = vi.fn()
const mockCreateProject = vi.fn()
const mockLoadProjects = vi.fn().mockResolvedValue(undefined)
const mockGetSessionsForProject = vi.fn().mockReturnValue([])
const mockDeleteProject = vi.fn().mockResolvedValue(undefined)
const mockOnClose = vi.fn()
const mockOnMoved = vi.fn()

function setupMocks(sessionProjectId = SCRATCH) {
  seedStore(useWorkspaceStore, {
    workspaces: [workspace1],
    projectsByWorkspaceId: new Map([['ws-1', [project1, project2]]]),
    loadProjects: mockLoadProjects,
    createProject: mockCreateProject,
    setActiveWorkspace: mockSetActiveWorkspace,
    setActiveProject: mockSetActiveProject,
    deleteProject: mockDeleteProject,
  })

  seedStore(useSessionStore, {
    sessions: new Map([
      [
        'sess-1',
        terminalSessionOf({
          id: 'sess-1',
          projectId: sessionProjectId,
          tabTitle: 'Scratch',
          scrollbackLimit: 5000,
        }),
      ],
    ]),
    moveSession: mockMoveSession,
    getSessionsForProject: mockGetSessionsForProject,
  })
}

describe('MoveSessionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('renders workspace and project options', () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Proj One')).toBeTruthy()
    expect(screen.getByText('Proj Two')).toBeTruthy()
  })

  it('calls onClose when clicking overlay', () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(document.querySelector('.tmui-dialog__scrim')!)
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('shows new workspace dialog when new workspace button clicked', () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New workspace'))
    expect(screen.getByTestId('create-workspace-dialog')).toBeTruthy()
  })

  it('shows new project form when new project button clicked', () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    expect(screen.getByPlaceholderText('My branch')).toBeTruthy()
  })

  it('calls moveSession and navigation when a project is selected', async () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} onMoved={mockOnMoved} />)
    fireEvent.click(screen.getByText('Proj One'))
    await waitFor(() => {
      expect(mockMoveSession).toHaveBeenCalledWith('sess-1', 'proj-1')
      expect(mockSetActiveWorkspace).toHaveBeenCalledWith('ws-1')
      expect(mockSetActiveProject).toHaveBeenCalledWith('proj-1')
      expect(mockOnMoved).toHaveBeenCalledWith('proj-1', 'ws-1')
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  it('shows Back button in new project form to return to list', () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    expect(screen.getByText('Back')).toBeTruthy()
    fireEvent.click(screen.getByText('Back'))
    expect(screen.getByText('Proj One')).toBeTruthy()
  })

  it('shows error when creating project with empty name', async () => {
    mockCreateProject.mockResolvedValue({ error: 'VALIDATION' })
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    fireEvent.click(screen.getByText('Create & move'))
    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeTruthy()
    })
  })

  it('creates project and moves session when new project submitted', async () => {
    mockCreateProject.mockResolvedValue({ project: { id: 'proj-new', workspaceId: 'ws-1' } })
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    fireEvent.change(screen.getByPlaceholderText('My branch'), { target: { value: 'New Proj' } })
    fireEvent.click(screen.getByText('Create & move'))
    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith({ workspaceId: 'ws-1', name: 'New Proj' })
      expect(mockMoveSession).toHaveBeenCalledWith('sess-1', 'proj-new')
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  it('shows duplicate name error when createProject returns DUPLICATE_NAME', async () => {
    mockCreateProject.mockResolvedValue({ error: 'DUPLICATE_NAME' })
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    fireEvent.change(screen.getByPlaceholderText('My branch'), {
      target: { value: 'Existing Proj' },
    })
    fireEvent.click(screen.getByText('Create & move'))
    await waitFor(() => {
      expect(screen.getByText('Name already in use')).toBeTruthy()
    })
  })

  it('shows generic error when createProject returns a non-duplicate error', async () => {
    mockCreateProject.mockResolvedValue({ error: 'UNKNOWN' })
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    fireEvent.change(screen.getByPlaceholderText('My branch'), { target: { value: 'My Proj' } })
    fireEvent.click(screen.getByText('Create & move'))
    await waitFor(() => {
      expect(screen.getByText('Could not create the branch')).toBeTruthy()
    })
  })

  it('shows "current" label on the active project button', () => {
    setupMocks('proj-1')
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    expect(screen.getByText('current')).toBeTruthy()
    // The current project button should be disabled
    const btn = screen.getByText('Proj One').closest('button')!
    expect(btn).toHaveProperty('disabled', true)
  })

  it('deletes source project when it becomes empty after move', async () => {
    setupMocks('proj-1')
    mockGetSessionsForProject.mockReturnValue([])
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('Proj Two'))
    await waitFor(() => {
      expect(mockDeleteProject).toHaveBeenCalledWith('proj-1')
    })
  })

  it('submits new project form on Enter key', async () => {
    mockCreateProject.mockResolvedValue({ project: { id: 'proj-new', workspaceId: 'ws-1' } })
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    const input = screen.getByPlaceholderText('My branch')
    fireEvent.change(input, { target: { value: 'Via Enter' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith({ workspaceId: 'ws-1', name: 'Via Enter' })
    })
  })

  it('returns to project list on Escape key in new project form', () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    const input = screen.getByPlaceholderText('My branch')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByText('Proj One')).toBeTruthy()
  })

  it('clears error when name input changes', async () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    fireEvent.click(screen.getByText('Create & move'))
    await waitFor(() => expect(screen.getByText('Name is required')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('My branch'), { target: { value: 'x' } })
    expect(screen.queryByText('Name is required')).toBeNull()
  })
})
