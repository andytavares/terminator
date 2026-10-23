import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { MoveSessionDialog } from '../../../../src/renderer/components/sidebar/MoveSessionDialog'
import type { Project } from '../../../../src/shared/types/index'
import {
  projectFixture,
  terminalSessionOf,
  workspaceFixture,
} from '../../../support/renderer-stores'
import { pressOutside } from '../../../support/modal'

vi.mock('../../../../src/renderer/components/sidebar/CreateWorkspaceDialog', () => ({
  CreateWorkspaceDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-workspace-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

const SCRATCH = '00000000-0000-0000-0000-000000000000'

const workspace1 = workspaceFixture({ id: 'ws-1', name: 'Alpha', folderPath: '/a' })
const project1 = projectFixture({ id: 'proj-1', workspaceId: 'ws-1', name: 'Proj One' })
const project2 = projectFixture({ id: 'proj-2', workspaceId: 'ws-1', name: 'Proj Two' })

type ProjectInput = Pick<Project, 'workspaceId' | 'name'>

// The main process's side of the project calls the real workspace store makes,
// over the projects it holds.
let stored: Project[] = []
const mockCreateProject = vi.fn(
  async (input: ProjectInput): Promise<{ project: Project } | { error: string }> => {
    const project = projectFixture({ id: 'proj-new', ...input })
    stored = [...stored, project]
    return { project }
  }
)
const projectApi = {
  create: mockCreateProject,
  delete: vi.fn(async (id: string) => {
    stored = stored.filter((p) => p.id !== id)
    return { ok: true }
  }),
  list: vi.fn(async (workspaceId: string) => ({
    projects: stored.filter((p) => p.workspaceId === workspaceId),
  })),
}
const mockOnClose = vi.fn()
const mockOnMoved = vi.fn()

const projectOfSession = (): string | undefined =>
  useSessionStore.getState().sessions.get('sess-1')?.projectId
const projectIds = (): string[] =>
  (useWorkspaceStore.getState().projectsByWorkspaceId.get('ws-1') ?? []).map((p) => p.id)

function setupMocks(sessionProjectId = SCRATCH) {
  stored = [project1, project2]
  Object.defineProperty(window, 'electronAPI', {
    value: { project: projectApi },
    writable: true,
    configurable: true,
  })
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [workspace1],
    projectsByWorkspaceId: new Map([['ws-1', [project1, project2]]]),
  })
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
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
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupMocks()
})

describe('MoveSessionDialog', () => {
  it('renders workspace and project options', () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Proj One')).toBeTruthy()
    expect(screen.getByText('Proj Two')).toBeTruthy()
  })

  it('calls onClose when clicking overlay', () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    pressOutside(screen.getByRole('dialog'))
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
})

describe('MoveSessionDialog — moves the session to the chosen branch and shows it there', () => {
  it('moves the session to the chosen branch and shows it there', async () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} onMoved={mockOnMoved} />)
    fireEvent.click(screen.getByText('Proj One'))
    await waitFor(() => expect(mockOnClose).toHaveBeenCalled())
    expect(projectOfSession()).toBe('proj-1')
    expect(useSessionStore.getState().getActiveSessionForProject('proj-1')).toBe('sess-1')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1')
    expect(useWorkspaceStore.getState().activeProjectId).toBe('proj-1')
    expect(mockOnMoved).toHaveBeenCalledWith('proj-1', 'ws-1')
  })

  it('shows Back button in new project form to return to list', () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    expect(screen.getByText('Back')).toBeTruthy()
    fireEvent.click(screen.getByText('Back'))
    expect(screen.getByText('Proj One')).toBeTruthy()
  })

  it('shows error when creating project with empty name', async () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    fireEvent.click(screen.getByText('Create & move'))
    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeTruthy()
    })
  })
})

describe('MoveSessionDialog — creates the branch and moves the session into it', () => {
  it('creates the branch and moves the session into it', async () => {
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('+ New branch in Alpha'))
    fireEvent.change(screen.getByPlaceholderText('My branch'), { target: { value: 'New Proj' } })
    fireEvent.click(screen.getByText('Create & move'))
    await waitFor(() => expect(mockOnClose).toHaveBeenCalled())
    expect(projectIds()).toContain('proj-new')
    expect(projectOfSession()).toBe('proj-new')
  })

  it('shows duplicate name error when createProject returns DUPLICATE_NAME', async () => {
    mockCreateProject.mockResolvedValueOnce({ error: 'DUPLICATE_NAME' })
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
})

describe('MoveSessionDialog — shows generic error when createProject returns a non-duplicate error', () => {
  it('shows generic error when createProject returns a non-duplicate error', async () => {
    mockCreateProject.mockResolvedValueOnce({ error: 'UNKNOWN' })
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

  it('removes the branch it left once nothing is open there', async () => {
    setupMocks('proj-1')
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('Proj Two'))
    await waitFor(() => expect(projectIds()).toEqual(['proj-2']))
    expect(projectOfSession()).toBe('proj-2')
  })
})

describe('MoveSessionDialog — submits new project form on Enter key', () => {
  it('submits new project form on Enter key', async () => {
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
    expect(await screen.findByText('Name is required')).toBeTruthy()
    fireEvent.change(await screen.findByPlaceholderText('My branch'), { target: { value: 'x' } })
    expect(screen.queryByText('Name is required')).toBeNull()
  })
})

describe('MoveSessionDialog — branches it has to load or keep', () => {
  it('loads the branches of a workspace not loaded yet', async () => {
    const workspace2 = workspaceFixture({ id: 'ws-2', name: 'Beta', folderPath: '/b' })
    stored = [...stored, projectFixture({ id: 'proj-b', workspaceId: 'ws-2', name: 'Beta One' })]
    useWorkspaceStore.setState({ workspaces: [workspace1, workspace2] })
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    expect(screen.getByText('+ New branch in Beta')).toBeTruthy()
    expect(await screen.findByText('Beta One')).toBeTruthy()
    expect(projectApi.list).toHaveBeenCalledWith('ws-2')
    expect(projectApi.list).not.toHaveBeenCalledWith('ws-1')
  })

  it('keeps the branch it left while another terminal is open there', async () => {
    setupMocks('proj-1')
    const other = terminalSessionOf({ id: 'sess-2', projectId: 'proj-1', tabTitle: 'Other' })
    const sessions = new Map(useSessionStore.getState().sessions).set('sess-2', other)
    useSessionStore.setState({ sessions })
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    fireEvent.click(screen.getByText('Proj Two'))
    await waitFor(() => expect(mockOnClose).toHaveBeenCalled())
    expect(projectOfSession()).toBe('proj-2')
    expect(projectIds()).toEqual(['proj-1', 'proj-2'])
    expect(projectApi.delete).not.toHaveBeenCalled()
  })
})
