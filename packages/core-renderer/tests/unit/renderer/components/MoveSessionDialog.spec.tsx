import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspaceStore } from '../../../../src/stores/workspace.store'
import { useSessionStore } from '../../../../src/stores/session.store'
import { MoveSessionDialog } from '../../../../src/components/sidebar/MoveSessionDialog'
import type { Project } from '../../../../../core-shared/src/types/index'
import {
  projectFixture,
  terminalSessionOf,
  workspaceFixture,
} from '../../../../../test-support/src/renderer-stores'
import { pressOutside } from '../../../../../test-support/src/modal'

type User = ReturnType<typeof userEvent.setup>

vi.mock('../../../../src/components/sidebar/CreateWorkspaceDialog', () => ({
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
  vi.stubGlobal('electronAPI', { project: projectApi })
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

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/usage/record', () => ({ recordUse }))

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

  it('shows new workspace dialog when new workspace button clicked', async () => {
    const user = userEvent.setup()
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    await user.click(screen.getByText('+ New workspace'))
    expect(screen.getByTestId('create-workspace-dialog')).toBeTruthy()
  })
})

describe('MoveSessionDialog — moves the session to the chosen branch and shows it there', () => {
  it('moves the session to the chosen branch and shows it there', async () => {
    const user = userEvent.setup()
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} onMoved={mockOnMoved} />)
    await user.click(screen.getByText('Proj One'))
    await waitFor(() => expect(mockOnClose).toHaveBeenCalled())
    expect(projectOfSession()).toBe('proj-1')
    expect(useSessionStore.getState().getActiveSessionForProject('proj-1')).toBe('sess-1')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1')
    expect(useWorkspaceStore.getState().activeProjectId).toBe('proj-1')
    expect(mockOnMoved).toHaveBeenCalledWith('proj-1', 'ws-1')
  })

  it.each([
    ['Back is clicked', (user: User) => user.click(screen.getByText('Back'))],
    [
      'Escape is pressed',
      (user: User) => user.type(screen.getByPlaceholderText('My branch'), '{Escape}'),
    ],
  ])('returns to the branch list when %s in the new branch form', async (_case, leaveForm) => {
    const user = userEvent.setup()
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    await user.click(screen.getByText('+ New branch in Alpha'))
    await leaveForm(user)
    expect(screen.getByText('Proj One')).toBeTruthy()
  })
})

describe('MoveSessionDialog — creates the branch and moves the session into it', () => {
  it('creates the branch and moves the session into it', async () => {
    const user = userEvent.setup()
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    await user.click(screen.getByText('+ New branch in Alpha'))
    await user.type(screen.getByPlaceholderText('My branch'), 'New Proj')
    await user.click(screen.getByText('Create & move'))
    await waitFor(() => expect(mockOnClose).toHaveBeenCalled())
    expect(projectIds()).toContain('proj-new')
    expect(projectOfSession()).toBe('proj-new')
  })

  it.each([
    ['DUPLICATE_NAME', 'Name already in use'],
    ['UNKNOWN', 'Could not create the branch'],
  ])('shows "%s" from createProject as "%s"', async (error, message) => {
    const user = userEvent.setup()
    mockCreateProject.mockResolvedValueOnce({ error })
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    await user.click(screen.getByText('+ New branch in Alpha'))
    await user.type(screen.getByPlaceholderText('My branch'), 'Existing Proj')
    await user.click(screen.getByText('Create & move'))
    expect(await screen.findByText(message)).toBeTruthy()
  })
})

describe('MoveSessionDialog — the branch the session is in', () => {
  it('shows "current" label on the active project button', () => {
    setupMocks('proj-1')
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    expect(screen.getByText('current')).toBeTruthy()
    // The current project button should be disabled
    const btn = screen.getByRole('button', { name: /Proj One/ })
    expect(btn).toHaveProperty('disabled', true)
  })

  it('removes the branch it left once nothing is open there', async () => {
    const user = userEvent.setup()
    setupMocks('proj-1')
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    await user.click(screen.getByText('Proj Two'))
    await waitFor(() => expect(projectIds()).toEqual(['proj-2']))
    expect(projectOfSession()).toBe('proj-2')
  })
})

describe('MoveSessionDialog — creates the branch on Enter', () => {
  it('creates the branch on Enter and moves the session into it', async () => {
    const user = userEvent.setup()
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    await user.click(screen.getByText('+ New branch in Alpha'))
    const input = screen.getByPlaceholderText('My branch')
    await user.type(input, 'Via Enter{Enter}')
    await waitFor(() => expect(mockOnClose).toHaveBeenCalled())
    expect(projectOfSession()).toBe('proj-new')
  })

  it('clears error when name input changes', async () => {
    const user = userEvent.setup()
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    await user.click(screen.getByText('+ New branch in Alpha'))
    await user.click(screen.getByText('Create & move'))
    await screen.findByText('Name is required')
    await user.type(await screen.findByPlaceholderText('My branch'), 'x')
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
    const user = userEvent.setup()
    setupMocks('proj-1')
    const other = terminalSessionOf({ id: 'sess-2', projectId: 'proj-1', tabTitle: 'Other' })
    const sessions = new Map(useSessionStore.getState().sessions).set('sess-2', other)
    useSessionStore.setState({ sessions })
    render(<MoveSessionDialog sessionId="sess-1" onClose={mockOnClose} />)
    await user.click(screen.getByText('Proj Two'))
    await waitFor(() => expect(mockOnClose).toHaveBeenCalled())
    expect(projectOfSession()).toBe('proj-2')
    expect(projectIds()).toEqual(['proj-1', 'proj-2'])
    expect(projectApi.delete).not.toHaveBeenCalled()
  })
})
