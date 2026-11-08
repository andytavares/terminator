import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { CreateWorkspaceDialog } from '../../../../src/renderer/components/sidebar/CreateWorkspaceDialog'
import { projectFixture, workspaceFixture } from '../../../support/renderer-stores'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import {
  CreateProjectInputSchema,
  CreateWorkspaceInputSchema,
} from '../../../../src/shared/schemas/workspace.schema'
import { installElectronApi } from '../../../support/electron-api'
import { eventually } from '../../../support/eventually'

// The main process's side of the two writes the real store makes, each payload
// read by the schema main reads it with.
const NEW_WORKSPACE = '00000000-0000-4000-8000-0000000000a1'
const REPO_WORKSPACE = '00000000-0000-4000-8000-0000000000a2'
let nextWorkspaceId = NEW_WORKSPACE
const mockCreateWorkspace = vi.fn<ElectronAPI['workspace']['create']>(async (payload) => {
  const input = CreateWorkspaceInputSchema.safeParse(payload)
  if (!input.success) return { error: 'VALIDATION_ERROR', message: input.error.message }
  return { workspace: workspaceFixture({ id: nextWorkspaceId, ...input.data }) }
})
const mockCreateProject = vi.fn<ElectronAPI['project']['create']>(async (payload) => ({
  project: projectFixture({ id: 'proj-new', ...CreateProjectInputSchema.parse(payload) }),
}))
const mockOpenDirectory = vi.fn<ElectronAPI['dialog']['openDirectory']>()
const mockDeleteWorkspace = vi.fn<ElectronAPI['workspace']['delete']>(async () => ({
  success: true,
}))

const storedWorkspaceNames = (): string[] =>
  useWorkspaceStore.getState().workspaces.map((w) => w.name)

function withApi(
  repo: Partial<ElectronAPI['git']> = { isRepo: async () => ({ isRepo: false }) }
): void {
  installElectronApi({
    dialog: { openDirectory: mockOpenDirectory },
    workspace: { create: mockCreateWorkspace, delete: mockDeleteWorkspace },
    project: { create: mockCreateProject },
    git: repo,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  nextWorkspaceId = NEW_WORKSPACE
  mockOpenDirectory.mockResolvedValue({ filePath: '/selected/path' })
  withApi()
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), workspaces: [] })
})

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('CreateWorkspaceDialog', () => {
  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    await user.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows validation error when name is empty on blur', async () => {
    const user = userEvent.setup()
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    await user.click(screen.getByPlaceholderText('My Workspace'))
    await user.tab()
    expect(screen.getByText('Name is required')).toBeTruthy()
  })

  it('shows duplicate name error', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ workspaces: [workspaceFixture({ id: 'ws-1', name: 'Existing' })] })
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My Workspace')
    await user.type(nameInput, 'existing')
    await user.tab()
    expect(screen.getByText('A workspace with this name already exists')).toBeTruthy()
  })
})

describe('CreateWorkspaceDialog — adds the workspace it creates to the list', () => {
  it('adds the workspace it creates to the list', async () => {
    const user = userEvent.setup()
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('My Workspace'), 'My WS')
    await user.type(screen.getByPlaceholderText('/path/to/folder'), '/repos/my-ws')
    await user.click(screen.getByText('Create'))
    await eventually(() => expect(storedWorkspaceNames()).toEqual(['My WS']))
  })

  it('does not submit with empty name', async () => {
    const user = userEvent.setup()
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    // The name check returns before the handler's first await, so the click has decided by now.
    await user.click(screen.getByText('Create'))
    expect(mockCreateWorkspace).not.toHaveBeenCalled()
  })

  it('calls openDirectory when Browse is clicked and updates folder path', async () => {
    const user = userEvent.setup()
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    await user.click(screen.getByText('Browse'))
    await eventually(() => expect(screen.getByDisplayValue('/selected/path')).toBeTruthy())
    expect(mockOpenDirectory).toHaveBeenCalled()
  })
})

describe('CreateWorkspaceDialog — does not update folder path when Browse is cancelled', () => {
  it('does not update folder path when Browse is cancelled', async () => {
    const user = userEvent.setup()
    mockOpenDirectory.mockResolvedValue({ cancelled: true })
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    await user.click(screen.getByText('Browse'))
    await act(async () => {
      await mockOpenDirectory.mock.results[0].value
    })
    // folder path input should remain at placeholder with empty value
    expect(screen.getByPlaceholderText('/path/to/folder')).toBeTruthy()
    expect((screen.getByPlaceholderText('/path/to/folder') as HTMLInputElement).value).toBe('')
  })

  it('selects a color swatch on click', async () => {
    const user = userEvent.setup()
    const { container } = render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const swatches = container.querySelectorAll('.dialog__color-swatch')
    // Click second color swatch (index 1 = #7B68EE)
    await user.click(swatches[1])
    expect(swatches[1].classList.contains('dialog__color-swatch--selected')).toBe(true)
  })
})

describe('CreateWorkspaceDialog — tags', () => {
  it('saves the typed comma-separated tags on the workspace it creates', async () => {
    const user = userEvent.setup()
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('My Workspace'), 'Tagged')
    await user.type(screen.getByPlaceholderText('/path/to/folder'), '/repos/tagged')
    await user.type(screen.getByPlaceholderText('frontend, work, personal'), 'a, b')
    await user.click(screen.getByText('Create'))
    await eventually(() =>
      expect(useWorkspaceStore.getState().workspaces.map((w) => w.tags)).toEqual([['a', 'b']])
    )
  })
})

describe('CreateWorkspaceDialog — clears nameError when name input changes', () => {
  it('clears nameError when name input changes', async () => {
    const user = userEvent.setup()
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My Workspace')
    await user.click(nameInput)
    await user.tab() // sets "Name is required"
    expect(screen.getByText('Name is required')).toBeTruthy()
    await user.type(nameInput, 'New WS')
    expect(screen.queryByText('Name is required')).toBeNull()
  })

  // Main refuses a workspace without a folder (CreateWorkspaceInputSchema), and
  // "Failed to create workspace" did not say why.
  it('asks for a folder rather than sending a workspace without one', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    await user.type(screen.getByPlaceholderText('My Workspace'), 'WS A')
    await user.click(screen.getByText('Create'))
    await screen.findByText('Choose a folder for the workspace')
    expect(mockCreateWorkspace).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('CreateWorkspaceDialog — surfaces a name error when createWorkspace reports DUPLICATE_NAME', () => {
  it('surfaces a name error when createWorkspace reports DUPLICATE_NAME', async () => {
    const user = userEvent.setup()
    mockCreateWorkspace.mockResolvedValueOnce({ error: 'DUPLICATE_NAME' })
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    await user.type(screen.getByPlaceholderText('My Workspace'), 'Dupe')
    await user.type(screen.getByPlaceholderText('/path/to/folder'), '/repos/x')
    await user.click(screen.getByText('Create'))
    await screen.findByText('A workspace with this name already exists')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('surfaces a generic error when createWorkspace fails for another reason', async () => {
    const user = userEvent.setup()
    mockCreateWorkspace.mockResolvedValueOnce({ error: 'BACKEND_DOWN' })
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('My Workspace'), 'WS X')
    await user.type(screen.getByPlaceholderText('/path/to/folder'), '/repos/x')
    await user.click(screen.getByText('Create'))
    await screen.findByText('Failed to create workspace')
  })
})

describe('CreateWorkspaceDialog — auto-creates a branch project when the chosen folder is a git repo', () => {
  it('auto-creates a branch project when the chosen folder is a git repo', async () => {
    const user = userEvent.setup()
    nextWorkspaceId = REPO_WORKSPACE
    withApi({
      isRepo: async () => ({ isRepo: true, root: '/repo/root' }),
      currentBranch: async () => ({ branch: 'develop' }),
    })
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    await user.type(screen.getByPlaceholderText('My Workspace'), 'Repo WS')
    await user.type(screen.getByPlaceholderText('/path/to/folder'), '/repo/root')
    await user.click(screen.getByText('Create'))
    await eventually(() => expect(onClose).toHaveBeenCalled())
    expect(recordUse).toHaveBeenCalledWith('core.sidebar.workspace-create')
    expect(useWorkspaceStore.getState().projectsByWorkspaceId.get(REPO_WORKSPACE)).toEqual([
      expect.objectContaining({
        name: 'develop',
        gitBranch: 'develop',
        worktreePath: '/repo/root',
      }),
    ])
  })
})

async function submitRepoWorkspace(onClose: () => void, folder = '/picked'): Promise<void> {
  const user = userEvent.setup()
  render(<CreateWorkspaceDialog onClose={onClose} />)
  await user.type(screen.getByPlaceholderText('My Workspace'), 'Repo WS')
  await user.type(screen.getByPlaceholderText('/path/to/folder'), folder)
  await user.click(screen.getByText('Create'))
}

describe('CreateWorkspaceDialog — git could not say whether the folder is a repository', () => {
  it('keeps the dialog open and says so, rather than leaving a workspace with no branches', async () => {
    nextWorkspaceId = REPO_WORKSPACE
    withApi({ isRepo: async () => ({ error: 'git rev-parse timed out' }) })
    const onClose = vi.fn()
    await submitRepoWorkspace(onClose)
    await screen.findByText(/could not read the git repository/i)
    expect(onClose).not.toHaveBeenCalled()
    expect(mockCreateProject).not.toHaveBeenCalled()
    expect(mockDeleteWorkspace).toHaveBeenCalledWith(REPO_WORKSPACE)
  })
})

describe('CreateWorkspaceDialog — git could not say which branch is checked out', () => {
  it('does not name the card main; it keeps the dialog open and says so', async () => {
    nextWorkspaceId = REPO_WORKSPACE
    withApi({
      isRepo: async () => ({ isRepo: true, root: '/picked' }),
      currentBranch: async () => ({ error: 'git branch timed out' }),
    })
    const onClose = vi.fn()
    await submitRepoWorkspace(onClose)
    await screen.findByText(/could not read the git repository/i)
    expect(onClose).not.toHaveBeenCalled()
    expect(mockCreateProject).not.toHaveBeenCalled()
    expect(mockDeleteWorkspace).toHaveBeenCalledWith(REPO_WORKSPACE)
  })
})

describe('CreateWorkspaceDialog — the branch project could not be created', () => {
  it('says so instead of closing on a workspace with no branches', async () => {
    nextWorkspaceId = REPO_WORKSPACE
    withApi({
      isRepo: async () => ({ isRepo: true, root: '/picked' }),
      currentBranch: async () => ({ branch: 'develop' }),
    })
    mockCreateProject.mockResolvedValueOnce({ error: 'DUPLICATE_NAME' })
    const onClose = vi.fn()
    await submitRepoWorkspace(onClose)
    await screen.findByText(/could not add the branch/i)
    expect(onClose).not.toHaveBeenCalled()
    expect(mockDeleteWorkspace).toHaveBeenCalledWith(REPO_WORKSPACE)
  })
})
