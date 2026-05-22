import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { CreateProjectDialog } from '../../../../src/renderer/components/sidebar/CreateProjectDialog'

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: vi.fn(),
}))

const mockCreateProject = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateProject.mockResolvedValue({ project: { id: 'proj-1' } })
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    git: {
      isRepo: vi.fn().mockResolvedValue({ isRepo: false }),
      listBranches: vi.fn().mockResolvedValue({ branches: [] }),
      listWorktrees: vi.fn().mockResolvedValue({ worktrees: [] }),
      suggestWorktreePath: vi.fn().mockResolvedValue({ path: '/wt/branch' }),
      createWorktree: vi.fn().mockResolvedValue({ success: true }),
    },
  }
  vi.mocked(useWorkspaceStore).mockReturnValue({
    createProject: mockCreateProject,
    projectsByWorkspaceId: new Map([['ws-1', []]]),
    workspaces: [{ id: 'ws-1', name: 'My WS', folderPath: '' }],
  } as unknown as ReturnType<typeof useWorkspaceStore>)
  vi.mocked(useSettingsStore).mockReturnValue({
    resolveSettings: vi.fn().mockReturnValue({ git: { worktreeBaseDir: '' } }),
  } as unknown as ReturnType<typeof useWorkspaceStore>)
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('CreateProjectDialog', () => {
  it('renders dialog title', () => {
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    expect(screen.getByText('Create Project')).toBeTruthy()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows name validation error when empty', async () => {
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Create'))
    expect(screen.getByText('Name is required')).toBeTruthy()
  })

  it('submits with valid name for simple project', async () => {
    const onClose = vi.fn()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={onClose} />)
    const nameInput = screen.getAllByRole('textbox')[0]
    fireEvent.change(nameInput, { target: { value: 'My App' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(mockCreateProject).toHaveBeenCalled())
  })

  it('renders Create button', () => {
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    expect(screen.getByText('Create')).toBeTruthy()
  })

  it('sets name error on blur when name is empty', () => {
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    const nameInput = screen.getAllByRole('textbox')[0]
    fireEvent.blur(nameInput)
    expect(screen.getByText('Name is required')).toBeTruthy()
  })

  it('clears name error when name is changed', () => {
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    const nameInput = screen.getAllByRole('textbox')[0]
    fireEvent.blur(nameInput) // triggers "Name is required"
    expect(screen.getByText('Name is required')).toBeTruthy()
    fireEvent.change(nameInput, { target: { value: 'Something' } })
    expect(screen.queryByText('Name is required')).toBeNull()
  })

  it('shows duplicate project name error on blur', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([['ws-1', [{ id: 'p1', name: 'My App' }]]]),
      workspaces: [{ id: 'ws-1', name: 'My WS', folderPath: '' }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    const nameInput = screen.getAllByRole('textbox')[0]
    fireEvent.change(nameInput, { target: { value: 'My App' } })
    fireEvent.blur(nameInput)
    expect(
      screen.getByText('A project with this name already exists in this workspace')
    ).toBeTruthy()
  })

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={onClose} />)
    fireEvent.click(screen.getByText('Create Project').closest('.dialog-overlay')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('shows worktree mode when workspace has a git repo folder', async () => {
    ;(
      window.electronAPI as unknown as { git: { isRepo: ReturnType<typeof vi.fn> } }
    ).git.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
    ;(
      window.electronAPI as unknown as { git: { listBranches: ReturnType<typeof vi.fn> } }
    ).git.listBranches.mockResolvedValue({
      branches: [{ name: 'main', isCurrent: true, isRemote: false }],
    })
    ;(
      window.electronAPI as unknown as { git: { listWorktrees: ReturnType<typeof vi.fn> } }
    ).git.listWorktrees = vi.fn().mockResolvedValue({ worktrees: [] })
    vi.mocked(useWorkspaceStore).mockReturnValue({
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([['ws-1', []]]),
      workspaces: [{ id: 'ws-1', name: 'My WS', folderPath: '/repo' }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => expect(screen.getByText('Create as git worktree')).toBeTruthy())
  })

  it('toggles worktree mode checkbox', async () => {
    const gitAPI = window.electronAPI as unknown as {
      git: {
        isRepo: ReturnType<typeof vi.fn>
        listBranches: ReturnType<typeof vi.fn>
        listWorktrees: ReturnType<typeof vi.fn>
        suggestWorktreePath: ReturnType<typeof vi.fn>
      }
    }
    gitAPI.git.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
    gitAPI.git.listBranches.mockResolvedValue({ branches: [] })
    gitAPI.git.listWorktrees = vi.fn().mockResolvedValue({ worktrees: [] })
    vi.mocked(useWorkspaceStore).mockReturnValue({
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([['ws-1', []]]),
      workspaces: [{ id: 'ws-1', name: 'My WS', folderPath: '/repo' }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('Create as git worktree'))
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    await vi.waitFor(() => expect(screen.getByText('New branch name')).toBeTruthy())
  })

  it('changes worktree path input', async () => {
    const gitAPI = window.electronAPI as unknown as {
      git: {
        isRepo: ReturnType<typeof vi.fn>
        listBranches: ReturnType<typeof vi.fn>
        listWorktrees: ReturnType<typeof vi.fn>
        suggestWorktreePath: ReturnType<typeof vi.fn>
      }
    }
    gitAPI.git.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
    gitAPI.git.listBranches.mockResolvedValue({ branches: [] })
    gitAPI.git.listWorktrees = vi.fn().mockResolvedValue({ worktrees: [] })
    vi.mocked(useWorkspaceStore).mockReturnValue({
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([['ws-1', []]]),
      workspaces: [{ id: 'ws-1', name: 'My WS', folderPath: '/repo' }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('Create as git worktree'))
    fireEvent.click(screen.getByRole('checkbox'))
    await vi.waitFor(() => screen.getByText('Worktree path'))
    const inputs = screen.getAllByRole('textbox')
    const worktreeInput = inputs[inputs.length - 1]
    fireEvent.change(worktreeInput, { target: { value: '/custom/wt/path' } })
    expect(worktreeInput).toBeTruthy()
  })

  it('changes new branch name input in worktree mode', async () => {
    const gitAPI = window.electronAPI as unknown as {
      git: {
        isRepo: ReturnType<typeof vi.fn>
        listBranches: ReturnType<typeof vi.fn>
        listWorktrees: ReturnType<typeof vi.fn>
        suggestWorktreePath: ReturnType<typeof vi.fn>
      }
    }
    gitAPI.git.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
    gitAPI.git.listBranches.mockResolvedValue({ branches: [] })
    gitAPI.git.listWorktrees = vi.fn().mockResolvedValue({ worktrees: [] })
    vi.mocked(useWorkspaceStore).mockReturnValue({
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([['ws-1', []]]),
      workspaces: [{ id: 'ws-1', name: 'My WS', folderPath: '/repo' }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('Create as git worktree'))
    fireEvent.click(screen.getByRole('checkbox'))
    await vi.waitFor(() => screen.getByPlaceholderText('feature/my-feature'))
    fireEvent.change(screen.getByPlaceholderText('feature/my-feature'), {
      target: { value: 'feature/new' },
    })
    expect(screen.getByDisplayValue('feature/new')).toBeTruthy()
  })
})
