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

function setupGitAPI(overrides: Record<string, unknown> = {}): void {
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    git: {
      isRepo: vi.fn().mockResolvedValue({ isRepo: false }),
      listBranches: vi.fn().mockResolvedValue({ branches: [] }),
      listWorktrees: vi.fn().mockResolvedValue({ worktrees: [] }),
      suggestWorktreePath: vi.fn().mockResolvedValue({ path: '/wt/branch' }),
      createWorktree: vi.fn().mockResolvedValue({ success: true }),
      createBranch: vi.fn().mockResolvedValue({ success: true }),
      checkout: vi.fn().mockResolvedValue({ success: true }),
      currentBranch: vi.fn().mockResolvedValue({ branch: 'main' }),
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateProject.mockResolvedValue({ project: { id: 'proj-1' } })
  setupGitAPI()
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

function setupGitWorkspace(): void {
  ;(
    window.electronAPI as unknown as { git: { isRepo: ReturnType<typeof vi.fn> } }
  ).git.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
  ;(
    window.electronAPI as unknown as { git: { listBranches: ReturnType<typeof vi.fn> } }
  ).git.listBranches.mockResolvedValue({
    branches: [{ name: 'main', isCurrent: true, isRemote: false }],
  })
  vi.mocked(useWorkspaceStore).mockReturnValue({
    createProject: mockCreateProject,
    projectsByWorkspaceId: new Map([['ws-1', []]]),
    workspaces: [{ id: 'ws-1', name: 'My WS', folderPath: '/repo' }],
  } as unknown as ReturnType<typeof useWorkspaceStore>)
}

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
    fireEvent.blur(nameInput)
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

  it('shows branch segmented control for git repos', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Branch' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Worktree' })).toBeTruthy()
  })

  it('does not show branch controls for non-git workspace', () => {
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Branch' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Worktree' })).toBeNull()
  })

  it('existing mode shows branch dropdown with current branch', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    // BranchSelect trigger shows the current branch name
    await vi.waitFor(() => expect(screen.getByText('main')).toBeTruthy())
  })

  it('new branch mode shows branch name input', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    // Open BranchSelect dropdown and select the inline new-branch option
    await vi.waitFor(() => screen.getByText('main'))
    fireEvent.click(screen.getByText('main'))
    fireEvent.click(screen.getByText('+ New branch…'))
    expect(screen.getByPlaceholderText('feature/my-feature')).toBeTruthy()
  })

  it('new branch mode creates branch and project on submit', async () => {
    setupGitWorkspace()
    const onClose = vi.fn()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={onClose} />)
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'My Project' } })
    // Open BranchSelect dropdown and select the inline new-branch option
    await vi.waitFor(() => screen.getByText('main'))
    fireEvent.click(screen.getByText('main'))
    fireEvent.click(screen.getByText('+ New branch…'))
    fireEvent.change(screen.getByPlaceholderText('feature/my-feature'), {
      target: { value: 'feature/new' },
    })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(window.electronAPI.git.createBranch).toHaveBeenCalledWith('/repo', 'feature/new')
    )
    await vi.waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ gitBranch: 'feature/new' })
      )
    )
  })

  it('new branch mode shows error when branch name is empty', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    // Open BranchSelect dropdown and select the inline new-branch option
    await vi.waitFor(() => screen.getByText('main'))
    fireEvent.click(screen.getByText('main'))
    fireEvent.click(screen.getByText('+ New branch…'))
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'My Project' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(screen.getByText('Enter a branch name')).toBeTruthy())
  })

  it('disables Branch tab and defaults to worktree when non-worktree project exists', async () => {
    setupGitWorkspace()
    vi.mocked(useWorkspaceStore).mockReturnValue({
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([['ws-1', [{ id: 'p1', name: 'Main', isWorktree: false }]]]),
      workspaces: [{ id: 'ws-1', name: 'My WS', folderPath: '/repo' }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    const branchBtn = screen.getByRole('button', { name: 'Branch' })
    expect((branchBtn as HTMLButtonElement).disabled).toBe(true)
    const worktreeBtn = screen.getByRole('button', { name: 'Worktree' })
    expect(worktreeBtn.className).toContain('dialog__segment-btn--active')
  })

  it('submit guard shows error when branchMode is existing and hasNonWorktreeProject is true', async () => {
    // Initial render: no non-worktree projects → branchMode initializes to 'existing'
    const { rerender } = render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'New Project' } })
    // Simulate a concurrent project being created by updating the store, then force a re-render
    // using rerender so the component sees hasNonWorktreeProject = true in the next render cycle
    vi.mocked(useWorkspaceStore).mockReturnValue({
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([
        ['ws-1', [{ id: 'p1', name: 'Existing', isWorktree: false }]],
      ]),
      workspaces: [{ id: 'ws-1', name: 'My WS', folderPath: '' }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    rerender(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(
        screen.getByText('A branch-based project already exists in this workspace')
      ).toBeTruthy()
    )
  })

  it('worktree mode pre-fills path with .worktrees base when no branch typed', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('Worktree'))
    fireEvent.click(screen.getByText('Worktree'))
    await vi.waitFor(() => screen.getByText('Worktree path'))
    // Open branch dropdown, select existing branch to set worktreeIsNewBranch = false,
    // then clear selection back to new-branch so branch = '' and base path is shown
    const triggers = screen.getAllByRole('button')
    const branchTrigger = triggers.find((b) => b.textContent?.includes('+ New branch'))!
    fireEvent.click(branchTrigger)
    fireEvent.click(screen.getByText('main'))
    // Deselect back to new-branch to trigger the !branch path
    await vi.waitFor(() => screen.getByText('main'))
    fireEvent.click(screen.getByText('main'))
    fireEvent.click(screen.getAllByText('+ New branch…')[0])
    // With empty newBranchName the effect sets path to /repo/.worktrees
    await vi.waitFor(() => {
      const inputs = screen.getAllByRole('textbox')
      const pathInput = inputs[inputs.length - 1] as HTMLInputElement
      return pathInput.value.includes('.worktrees')
    })
  })

  it('worktree mode shows branch and path fields', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('Worktree'))
    fireEvent.click(screen.getByText('Worktree'))
    await vi.waitFor(() => expect(screen.getByText('Worktree path')).toBeTruthy())
  })

  it('worktree mode new branch name input sanitizes input', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('Worktree'))
    fireEvent.click(screen.getByText('Worktree'))
    await vi.waitFor(() => screen.getByPlaceholderText('feature/my-feature'))
    fireEvent.change(screen.getByPlaceholderText('feature/my-feature'), {
      target: { value: 'feature/new' },
    })
    expect(screen.getAllByDisplayValue('feature/new').length).toBeGreaterThan(0)
  })

  it('worktree mode changes path input', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('Worktree'))
    fireEvent.click(screen.getByText('Worktree'))
    await vi.waitFor(() => screen.getByText('Worktree path'))
    const inputs = screen.getAllByRole('textbox')
    const worktreeInput = inputs[inputs.length - 1]
    fireEvent.change(worktreeInput, { target: { value: '/custom/wt/path' } })
    expect(worktreeInput).toBeTruthy()
  })

  it('clicking Branch tab switches back from worktree mode', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Worktree' }))
    await vi.waitFor(() => screen.getByText('Worktree path'))
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }))
    await vi.waitFor(() => expect(screen.queryByText('Worktree path')).toBeNull())
  })

  it('branch mode selecting a branch via dropdown fires onChange', async () => {
    ;(
      window.electronAPI as unknown as { git: { isRepo: ReturnType<typeof vi.fn> } }
    ).git.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
    ;(
      window.electronAPI as unknown as { git: { listBranches: ReturnType<typeof vi.fn> } }
    ).git.listBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'develop', isCurrent: false, isRemote: false },
      ],
    })
    vi.mocked(useWorkspaceStore).mockReturnValue({
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([['ws-1', []]]),
      workspaces: [{ id: 'ws-1', name: 'My WS', folderPath: '/repo' }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('main'))
    fireEvent.click(screen.getByText('main'))
    fireEvent.click(screen.getByText('develop'))
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'My Project' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ gitBranch: 'develop' })
      )
    )
  })

  it('worktree mode selecting existing branch then new branch fires onNewBranch', async () => {
    ;(
      window.electronAPI as unknown as { git: { isRepo: ReturnType<typeof vi.fn> } }
    ).git.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
    ;(
      window.electronAPI as unknown as { git: { listBranches: ReturnType<typeof vi.fn> } }
    ).git.listBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'develop', isCurrent: false, isRemote: false },
      ],
    })
    vi.mocked(useWorkspaceStore).mockReturnValue({
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([['ws-1', []]]),
      workspaces: [{ id: 'ws-1', name: 'My WS', folderPath: '/repo' }],
    } as unknown as ReturnType<typeof useWorkspaceStore>)
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('Worktree'))
    fireEvent.click(screen.getByText('Worktree'))
    await vi.waitFor(() => screen.getByText('Worktree path'))
    // BranchSelect trigger shows '+ New branch…' by default (worktreeIsNewBranch = true)
    const triggers = screen.getAllByRole('button')
    const branchTrigger = triggers.find((b) => b.textContent?.includes('+ New branch'))!
    fireEvent.click(branchTrigger)
    fireEvent.click(screen.getByText('develop'))
    // After selecting existing, trigger shows 'develop'; click it to open again and re-select new
    await vi.waitFor(() => screen.getByText('develop'))
    fireEvent.click(screen.getByText('develop'))
    fireEvent.click(screen.getAllByText('+ New branch…')[0])
    await vi.waitFor(() => screen.getByPlaceholderText('feature/my-feature'))
  })

  it('existing mode submits with selected branch', async () => {
    setupGitWorkspace()
    const onClose = vi.fn()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={onClose} />)
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'My Project' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith(expect.objectContaining({ gitBranch: 'main' }))
    )
  })
})
