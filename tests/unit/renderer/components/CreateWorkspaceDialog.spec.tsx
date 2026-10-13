import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { CreateWorkspaceDialog } from '../../../../src/renderer/components/sidebar/CreateWorkspaceDialog'
import { projectOf, workspaceOf } from '../../../support/renderer-stores'
import type { Project, Workspace } from '../../../../src/shared/types/index'

type WorkspaceInput = Pick<Workspace, 'name' | 'folderPath' | 'color' | 'tags'>
type ProjectInput = Pick<Project, 'workspaceId' | 'name'> & Partial<Project>

// The main process's side of the two writes the real store makes.
let nextWorkspaceId = 'ws-new'
const mockCreateWorkspace = vi.fn(
  async (input: WorkspaceInput): Promise<{ workspace: Workspace } | { error: string }> => ({
    workspace: workspaceOf({ id: nextWorkspaceId, ...input }),
  })
)
const mockCreateProject = vi.fn(async (input: ProjectInput) => ({
  project: projectOf({ id: 'proj-new', ...input }),
}))
const mockOpenDirectory = vi.fn()

const workspaceNames = (): string[] => useWorkspaceStore.getState().workspaces.map((w) => w.name)

function withApi(
  repo: Record<string, unknown> = { isRepo: vi.fn().mockResolvedValue({ isRepo: false }) }
): void {
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    dialog: { openDirectory: mockOpenDirectory },
    workspace: { create: mockCreateWorkspace },
    project: { create: mockCreateProject },
    git: repo,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  nextWorkspaceId = 'ws-new'
  mockOpenDirectory.mockResolvedValue({ filePath: '/selected/path' })
  withApi()
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), workspaces: [] })
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
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
    useWorkspaceStore.setState({ workspaces: [workspaceOf({ id: 'ws-1', name: 'Existing' })] })
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My Workspace')
    fireEvent.change(nameInput, { target: { value: 'existing' } })
    fireEvent.blur(nameInput)
    expect(screen.getByText('A workspace with this name already exists')).toBeTruthy()
  })

  it('adds the workspace it creates to the list', async () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'My WS' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(workspaceNames()).toEqual(['My WS']))
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

  it('clears nameError when name input changes', () => {
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My Workspace')
    fireEvent.blur(nameInput) // sets "Name is required"
    expect(screen.getByText('Name is required')).toBeTruthy()
    fireEvent.change(nameInput, { target: { value: 'New WS' } })
    expect(screen.queryByText('Name is required')).toBeNull()
  })

  it('closes after successful create with no folder path', async () => {
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'WS A' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.click(screen.getByText('Create Workspace').closest('.tmui-dialog__scrim')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('surfaces a name error when createWorkspace reports DUPLICATE_NAME', async () => {
    mockCreateWorkspace.mockResolvedValueOnce({ error: 'DUPLICATE_NAME' })
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'Dupe' } })
    fireEvent.click(screen.getByText('Create'))
    await screen.findByText('A workspace with this name already exists')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('surfaces a generic error when createWorkspace fails for another reason', async () => {
    mockCreateWorkspace.mockResolvedValueOnce({ error: 'BACKEND_DOWN' })
    render(<CreateWorkspaceDialog onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'WS X' } })
    fireEvent.click(screen.getByText('Create'))
    await screen.findByText('Failed to create workspace')
  })

  it('auto-creates a branch project when the chosen folder is a git repo', async () => {
    nextWorkspaceId = 'ws-repo'
    withApi({
      isRepo: vi.fn().mockResolvedValue({ isRepo: true, root: '/repo/root' }),
      currentBranch: vi.fn().mockResolvedValue({ branch: 'develop' }),
    })
    const onClose = vi.fn()
    render(<CreateWorkspaceDialog onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('My Workspace'), { target: { value: 'Repo WS' } })
    fireEvent.change(screen.getByPlaceholderText('/path/to/folder'), {
      target: { value: '/repo/root' },
    })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useWorkspaceStore.getState().projectsByWorkspaceId.get('ws-repo')).toEqual([
      expect.objectContaining({
        name: 'develop',
        gitBranch: 'develop',
        worktreePath: '/repo/root',
      }),
    ])
  })
})
