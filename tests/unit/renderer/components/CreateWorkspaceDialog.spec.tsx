import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { CreateWorkspaceDialog } from '../../../../src/renderer/components/sidebar/CreateWorkspaceDialog'
import { projectFixture, workspaceFixture } from '../../../support/renderer-stores'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import {
  CreateProjectInputSchema,
  CreateWorkspaceInputSchema,
} from '../../../../src/shared/schemas/workspace.schema'
import { installElectronApi } from '../../../support/electron-api'

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

const storedWorkspaceNames = (): string[] =>
  useWorkspaceStore.getState().workspaces.map((w) => w.name)

function withApi(
  repo: Partial<ElectronAPI['git']> = { isRepo: async () => ({ isRepo: false }) }
): void {
  installElectronApi({
    dialog: { openDirectory: mockOpenDirectory },
    workspace: { create: mockCreateWorkspace },
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

describe('CreateWorkspaceDialog', () => {
  it('renders dialog with title and form fields', () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    expect(screen.getByText('Create Workspace')).toBeTruthy()
    expect(screen.getByPlaceholderText('My Workspace')).toBeTruthy()
    expect(screen.getByText('Create')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows validation error when name is empty on blur', () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My Workspace')
    fireEvent.blur(nameInput)
    expect(screen.getByText('Name is required')).toBeTruthy()
  })

  it('shows duplicate name error', () => {
    useWorkspaceStore.setState({ workspaces: [workspaceFixture({ id: 'ws-1', name: 'Existing' })] })
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My Workspace')
    fireEvent.change(nameInput, { target: { value: 'existing' } })
    fireEvent.blur(nameInput)
    expect(screen.getByText('A workspace with this name already exists')).toBeTruthy()
  })
})

describe('CreateWorkspaceDialog — adds the workspace it creates to the list', () => {
  it('adds the workspace it creates to the list', async () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'My WS' } })
    fireEvent.change(screen.getByPlaceholderText('/path/to/folder'), {
      target: { value: '/repos/my-ws' },
    })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(storedWorkspaceNames()).toEqual(['My WS']))
  })

  it('renders folder path input', () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText('/path/to/folder')).toBeTruthy()
  })

  it('does not submit with empty name', async () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Create'))
    await new Promise((r) => setTimeout(r, 10))
    expect(mockCreateWorkspace).not.toHaveBeenCalled()
  })

  it('calls openDirectory when Browse is clicked and updates folder path', async () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Browse'))
    await vi.waitFor(() => expect(screen.getByDisplayValue('/selected/path')).toBeTruthy())
    expect(mockOpenDirectory).toHaveBeenCalled()
  })
})

describe('CreateWorkspaceDialog — does not update folder path when Browse is cancelled', () => {
  it('does not update folder path when Browse is cancelled', async () => {
    mockOpenDirectory.mockResolvedValue({ cancelled: true })
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Browse'))
    await new Promise((r) => setTimeout(r, 50))
    // folder path input should remain at placeholder with empty value
    expect(screen.getByPlaceholderText('/path/to/folder')).toBeTruthy()
    expect((screen.getByPlaceholderText('/path/to/folder') as HTMLInputElement).value).toBe('')
  })

  it('updates folder path input when typed', () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const folderInput = screen.getByPlaceholderText('/path/to/folder')
    fireEvent.change(folderInput, { target: { value: '/my/custom/path' } })
    expect(screen.getByDisplayValue('/my/custom/path')).toBeTruthy()
  })

  it('selects a color swatch on click', () => {
    const { container } = render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const swatches = container.querySelectorAll('.dialog__color-swatch')
    // Click second color swatch (index 1 = #7B68EE)
    fireEvent.click(swatches[1])
    expect(swatches[1].classList.contains('dialog__color-swatch--selected')).toBe(true)
  })

  it('updates tags input when typed', () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const tagsInput = screen.getByPlaceholderText('frontend, work, personal')
    fireEvent.change(tagsInput, { target: { value: 'a, b' } })
    expect(screen.getByDisplayValue('a, b')).toBeTruthy()
  })
})

describe('CreateWorkspaceDialog — clears nameError when name input changes', () => {
  it('clears nameError when name input changes', () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My Workspace')
    fireEvent.blur(nameInput) // sets "Name is required"
    expect(screen.getByText('Name is required')).toBeTruthy()
    fireEvent.change(nameInput, { target: { value: 'New WS' } })
    expect(screen.queryByText('Name is required')).toBeNull()
  })

  // Main refuses a workspace without a folder (CreateWorkspaceInputSchema), and
  // "Failed to create workspace" did not say why.
  it('asks for a folder rather than sending a workspace without one', async () => {
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'WS A' } })
    fireEvent.click(screen.getByText('Create'))
    await screen.findByText('Choose a folder for the workspace')
    expect(mockCreateWorkspace).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.click(screen.getByText('Create Workspace').closest('.tmui-dialog__scrim')!)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('CreateWorkspaceDialog — surfaces a name error when createWorkspace reports DUPLICATE_NAME', () => {
  it('surfaces a name error when createWorkspace reports DUPLICATE_NAME', async () => {
    mockCreateWorkspace.mockResolvedValueOnce({ error: 'DUPLICATE_NAME' })
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'Dupe' } })
    fireEvent.change(screen.getByPlaceholderText('/path/to/folder'), {
      target: { value: '/repos/x' },
    })
    fireEvent.click(screen.getByText('Create'))
    await screen.findByText('A workspace with this name already exists')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('surfaces a generic error when createWorkspace fails for another reason', async () => {
    mockCreateWorkspace.mockResolvedValueOnce({ error: 'BACKEND_DOWN' })
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'WS X' } })
    fireEvent.change(screen.getByPlaceholderText('/path/to/folder'), {
      target: { value: '/repos/x' },
    })
    fireEvent.click(screen.getByText('Create'))
    await screen.findByText('Failed to create workspace')
  })
})

describe('CreateWorkspaceDialog — auto-creates a branch project when the chosen folder is a git repo', () => {
  it('auto-creates a branch project when the chosen folder is a git repo', async () => {
    nextWorkspaceId = REPO_WORKSPACE
    withApi({
      isRepo: async () => ({ isRepo: true, root: '/repo/root' }),
      currentBranch: async () => ({ branch: 'develop' }),
    })
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'Repo WS' } })
    fireEvent.change(screen.getByPlaceholderText('/path/to/folder'), {
      target: { value: '/repo/root' },
    })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useWorkspaceStore.getState().projectsByWorkspaceId.get(REPO_WORKSPACE)).toEqual([
      expect.objectContaining({
        name: 'develop',
        gitBranch: 'develop',
        worktreePath: '/repo/root',
      }),
    ])
  })
})

describe('CreateWorkspaceDialog — a repo whose root or branch is unknown', () => {
  it('uses the folder as the root and names the branch main', async () => {
    nextWorkspaceId = REPO_WORKSPACE
    withApi({
      isRepo: async () => ({ isRepo: true }),
      currentBranch: async () => ({ error: 'NOT_A_REPO', message: 'detached' }),
    })
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'Repo WS' } })
    fireEvent.change(screen.getByPlaceholderText('/path/to/folder'), {
      target: { value: '/picked' },
    })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useWorkspaceStore.getState().projectsByWorkspaceId.get(REPO_WORKSPACE)).toEqual([
      expect.objectContaining({ name: 'main', gitBranch: 'main', worktreePath: '/picked' }),
    ])
  })
})
