import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { CreateProjectDialog } from '../../../../src/renderer/components/sidebar/CreateProjectDialog'
import { issueSummaryOf, projectOf, seedStore, workspaceOf } from '../../../support/renderer-stores'
import type { IssueSummary } from '../../../../src/shared/types/index'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { installElectronApi } from '../../../support/electron-api'

const mockCreateProject = vi.fn()

type GitApi = ElectronAPI['git']

/** The repository the dialog asks main about: none, until a spec says otherwise. */
function gitFake() {
  return {
    isRepo: vi.fn<GitApi['isRepo']>(async () => ({ isRepo: false })),
    listBranches: vi.fn<GitApi['listBranches']>(async () => ({ branches: [] })),
    listWorktrees: vi.fn<GitApi['listWorktrees']>(async () => ({ worktrees: [] })),
    suggestWorktreePath: vi.fn<GitApi['suggestWorktreePath']>(async () => ({ path: '/wt/branch' })),
    createWorktree: vi.fn<GitApi['createWorktree']>(async () => ({ success: true })),
    createBranch: vi.fn<GitApi['createBranch']>(async () => ({ success: true })),
    checkout: vi.fn<GitApi['checkout']>(async () => ({ success: true })),
    currentBranch: vi.fn<GitApi['currentBranch']>(async () => ({ branch: 'main' })),
    fetch: vi.fn<GitApi['fetch']>(async () => ({ success: true })),
  }
}

let gitApi: ReturnType<typeof gitFake>

function setupGitAPI(overrides: Partial<ReturnType<typeof gitFake>> = {}): void {
  gitApi = { ...gitFake(), ...overrides }
  installElectronApi({ git: gitApi })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateProject.mockResolvedValue({ project: { id: 'proj-1' } })
  setupGitAPI()
  seedStore(useWorkspaceStore, {
    createProject: mockCreateProject,
    projectsByWorkspaceId: new Map([['ws-1', []]]),
    workspaces: [workspaceOf({ id: 'ws-1', name: 'My WS', folderPath: '' })],
  })
  seedStore(useSettingsStore, {
    resolveSettings: vi.fn().mockReturnValue(DEFAULT_GLOBAL_SETTINGS),
  })
})

function setupGitWorkspace(): void {
  gitApi.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
  gitApi.listBranches.mockResolvedValue({
    branches: [{ name: 'main', isCurrent: true, isRemote: false }],
  })
  seedStore(useWorkspaceStore, {
    createProject: mockCreateProject,
    projectsByWorkspaceId: new Map([['ws-1', []]]),
    workspaces: [workspaceOf({ id: 'ws-1', name: 'My WS', folderPath: '/repo' })],
  })
}

describe('CreateProjectDialog', () => {
  it('renders dialog title', () => {
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    expect(screen.getByText('Create Branch')).toBeTruthy()
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
    await vi.waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', name: 'My App' })
      )
    )
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
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
    seedStore(useWorkspaceStore, {
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([
        ['ws-1', [projectOf({ workspaceId: 'ws-1', id: 'p1', name: 'My App' })]],
      ]),
      workspaces: [workspaceOf({ id: 'ws-1', name: 'My WS', folderPath: '' })],
    })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    const nameInput = screen.getAllByRole('textbox')[0]
    fireEvent.change(nameInput, { target: { value: 'My App' } })
    fireEvent.blur(nameInput)
    expect(screen.getByText('A branch with this name already exists in this repo')).toBeTruthy()
  })

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={onClose} />)
    fireEvent.click(screen.getByText('Create Branch').closest('.tmui-dialog__scrim')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('asks for no name in a repo — the branch is the name (ADR-034)', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    expect(screen.queryByText('Name *')).toBeNull()
  })

  it('still asks for a name where there is no branch to take one from', () => {
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    expect(screen.getByText('Name *')).toBeTruthy()
  })

  it('names the card after the branch it is created on', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'main', gitBranch: 'main' })
      )
    )
  })

  it('refuses to create a nameless card when no branch is chosen', async () => {
    setupGitWorkspace()
    gitApi.listBranches.mockResolvedValue({ branches: [] })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(screen.getByText('Select or enter a branch name')).toBeTruthy())
    expect(mockCreateProject).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(screen.getByText('Enter a branch name')).toBeTruthy())
  })

  it('disables Branch tab and defaults to worktree when non-worktree project exists', async () => {
    setupGitWorkspace()
    seedStore(useWorkspaceStore, {
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([
        ['ws-1', [projectOf({ workspaceId: 'ws-1', id: 'p1', name: 'Main', isWorktree: false })]],
      ]),
      workspaces: [workspaceOf({ id: 'ws-1', name: 'My WS', folderPath: '/repo' })],
    })
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
    seedStore(useWorkspaceStore, {
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([
        [
          'ws-1',
          [projectOf({ workspaceId: 'ws-1', id: 'p1', name: 'Existing', isWorktree: false })],
        ],
      ]),
      workspaces: [workspaceOf({ id: 'ws-1', name: 'My WS', folderPath: '' })],
    })
    rerender(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(screen.getByText('A branch-based entry already exists in this repo')).toBeTruthy()
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
      expect(pathInput.value).toContain('.worktrees')
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
    expect((worktreeInput as HTMLInputElement).value).toBe('/custom/wt/path')
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
    gitApi.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
    gitApi.listBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'develop', isCurrent: false, isRemote: false },
      ],
    })
    seedStore(useWorkspaceStore, {
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([['ws-1', []]]),
      workspaces: [workspaceOf({ id: 'ws-1', name: 'My WS', folderPath: '/repo' })],
    })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('main'))
    fireEvent.click(screen.getByText('main'))
    fireEvent.click(screen.getByText('develop'))
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ gitBranch: 'develop' })
      )
    )
  })

  it('worktree mode selecting existing branch then new branch fires onNewBranch', async () => {
    gitApi.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
    gitApi.listBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'develop', isCurrent: false, isRemote: false },
      ],
    })
    seedStore(useWorkspaceStore, {
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map([['ws-1', []]]),
      workspaces: [workspaceOf({ id: 'ws-1', name: 'My WS', folderPath: '/repo' })],
    })
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
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith(expect.objectContaining({ gitBranch: 'main' }))
    )
  })

  it('shows error when createBranch fails', async () => {
    setupGitWorkspace()
    gitApi.createBranch.mockResolvedValue({ error: 'already exists' })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    fireEvent.click(screen.getByText('main'))
    fireEvent.click(screen.getByText('+ New branch…'))
    fireEvent.change(screen.getByPlaceholderText('feature/my-feature'), {
      target: { value: 'feature/bad' },
    })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(screen.getByText('Could not create branch: already exists')).toBeTruthy()
    )
  })

  it('shows name error when createProject returns DUPLICATE_NAME', async () => {
    mockCreateProject.mockResolvedValue({ error: 'DUPLICATE_NAME' })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'My branch' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(screen.getByText('A branch with this name already exists')).toBeTruthy()
    )
  })

  it('shows generic error when createProject returns other error', async () => {
    mockCreateProject.mockResolvedValue({ error: 'DB_ERROR' })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'My branch' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(screen.getByText('Could not create the branch')).toBeTruthy())
  })

  it('shows error when createWorktree fails', async () => {
    setupGitWorkspace()
    gitApi.createWorktree.mockResolvedValue({ error: 'no space' })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('Worktree'))
    fireEvent.click(screen.getByText('Worktree'))
    await vi.waitFor(() => screen.getByText('Worktree path'))
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[inputs.length - 2], { target: { value: 'feature/wt' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(screen.getByText('Worktree error: no space')).toBeTruthy())
  })

  it('shows empty branch name error in worktree mode', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('Worktree'))
    fireEvent.click(screen.getByText('Worktree'))
    await vi.waitFor(() => screen.getByText('Worktree path'))
    // Switch away from new-branch to an existing branch then clear (so branch = '')
    const triggers = screen.getAllByRole('button')
    const branchTrigger = triggers.find((b) => b.textContent?.includes('+ New branch'))!
    fireEvent.click(branchTrigger)
    fireEvent.click(screen.getByText('main'))
    // Now switch back to new-branch so worktreeIsNewBranch = true, newBranchName = ''
    await vi.waitFor(() => screen.getByText('main'))
    fireEvent.click(screen.getByText('main'))
    fireEvent.click(screen.getAllByText('+ New branch…')[0])
    // Ensure new branch name input is empty then submit
    const newBranchInput = screen.getByPlaceholderText('feature/my-feature')
    fireEvent.change(newBranchInput, { target: { value: '' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(screen.getByText('Select or enter a branch name')).toBeTruthy())
  })
})

// ── Starting from an issue (US5) ────────────────────────────────────────────

describe('CreateProjectDialog — from an issue', () => {
  const ISSUE = issueSummaryOf({
    key: 'TAV-42',
    title: 'Unify Linear connections behind one core service',
    branchName: 'andrew/tav-42-unify-linear',
  })
  const JIRA_ISSUE = issueSummaryOf({ ...ISSUE, tracker: 'jira', key: 'TAV-7', branchName: null })

  const listMine = vi.fn()
  const linkIssue = vi.fn()

  async function openWithIssues(connected = true, issues: IssueSummary[] = [ISSUE]) {
    const { useIntegrationsStore } = await import(
      '../../../../src/renderer/stores/integrations.store'
    )
    listMine.mockResolvedValue({ issues, failures: [] })
    linkIssue.mockResolvedValue(true)
    useIntegrationsStore.setState({
      connections: connected
        ? [
            {
              tracker: 'linear',
              connected: true,
              account: null,
              site: null,
              mine: { kind: 'assignee', email: null },
              lastError: null,
            },
          ]
        : [],
      listMine,
      searchIssues: vi.fn().mockResolvedValue({ issues: [], failures: [] }),
      linkIssue,
    })

    setupGitAPI({
      isRepo: vi.fn().mockResolvedValue({ isRepo: true, root: '/repo' }),
      listBranches: vi
        .fn()
        .mockResolvedValue({ branches: [{ name: 'main', isCurrent: true, isRemote: false }] }),
    })
    seedStore(useWorkspaceStore, {
      createProject: mockCreateProject,
      projectsByWorkspaceId: new Map(),
      workspaces: [workspaceOf({ id: 'w1', name: 'ws', folderPath: '/repo' })],
    })
    seedStore(useSettingsStore, { resolveSettings: () => DEFAULT_GLOBAL_SETTINGS })

    render(<CreateProjectDialog workspaceId="w1" onClose={vi.fn()} />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateProject.mockResolvedValue({ project: { id: 'p-new' } })
  })

  it('does not offer the picker when no tracker is connected', async () => {
    await openWithIssues(false)
    expect(screen.queryByText('Start from an issue')).toBeNull()
  })

  it('offers the picker once a tracker is connected', async () => {
    await openWithIssues(true)
    expect(screen.getByText('Start from an issue')).toBeTruthy()
  })

  it('prefills the branch from the picked issue, and asks for no other name', async () => {
    await openWithIssues()
    fireEvent.focus(screen.getByPlaceholderText(/Search, or type an issue key/))
    fireEvent.click(await screen.findByText('TAV-42'))

    expect(screen.getByDisplayValue('andrew/tav-42-unify-linear')).toBeTruthy()
    // The card is named by its branch, so there is no second name to fill in.
    expect(screen.queryByPlaceholderText('My branch')).toBeNull()
  })

  it('derives a branch when the tracker has no suggestion (Jira)', async () => {
    await openWithIssues(true, [JIRA_ISSUE])
    fireEvent.focus(screen.getByPlaceholderText(/Search, or type an issue key/))
    fireEvent.click(await screen.findByText('TAV-7'))

    expect(screen.getByDisplayValue(/tav-7-unify-linear/)).toBeTruthy()
  })

  it('honours an edit made after prefilling', async () => {
    await openWithIssues()
    fireEvent.focus(screen.getByPlaceholderText(/Search, or type an issue key/))
    fireEvent.click(await screen.findByText('TAV-42'))

    const branch = screen.getByDisplayValue('andrew/tav-42-unify-linear') as HTMLInputElement
    fireEvent.change(branch, { target: { value: 'andrew/my-own-branch' } })
    expect(branch.value).toBe('andrew/my-own-branch')
  })

  it('lets the operator back out of the issue', async () => {
    await openWithIssues()
    fireEvent.focus(screen.getByPlaceholderText(/Search, or type an issue key/))
    fireEvent.click(await screen.findByText('TAV-42'))

    fireEvent.click(screen.getByTitle('Choose a different issue'))
    expect(screen.getByPlaceholderText(/Search, or type an issue key/)).toBeTruthy()
  })

  it('attaches the issue to the project it just created (FR-011)', async () => {
    await openWithIssues()
    fireEvent.focus(screen.getByPlaceholderText(/Search, or type an issue key/))
    fireEvent.click(await screen.findByText('TAV-42'))

    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() => expect(mockCreateProject).toHaveBeenCalled())
    await vi.waitFor(() => expect(linkIssue).toHaveBeenCalledWith('p-new', 'linear', 'TAV-42'))
  })

  it('attaches nothing when no issue was picked', async () => {
    await openWithIssues()
    await vi.waitFor(() => screen.getByRole('button', { name: 'Branch' }))
    fireEvent.click(screen.getByText('Create'))

    await vi.waitFor(() => expect(mockCreateProject).toHaveBeenCalled())
    expect(linkIssue).not.toHaveBeenCalled()
  })

  // Creating a worktree takes seconds of git work. Without a busy state the
  // dialog just sits there, and a second press starts the whole thing again.
  describe('while it is working', () => {
    /** A createWorktree that stays unresolved until the test lets it finish. */
    function pending(): { finish: () => void } {
      let release = (): void => {}
      const gate = new Promise<{ success: true }>((resolve) => {
        release = () => resolve({ success: true })
      })
      gitApi.createWorktree.mockReturnValue(gate)
      return { finish: () => release() }
    }

    async function submitWorktree(): Promise<{ finish: () => void }> {
      setupGitWorkspace()
      render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
      await vi.waitFor(() => screen.getByRole('button', { name: 'Worktree' }))
      fireEvent.click(screen.getByRole('button', { name: 'Worktree' }))
      fireEvent.change(screen.getByPlaceholderText('feature/my-feature'), {
        target: { value: 'feature/x' },
      })
      const gate = pending()
      fireEvent.click(screen.getByText('Create'))
      return gate
    }

    it('says it is working and refuses a second press', async () => {
      const gate = await submitWorktree()
      const button = await screen.findByRole('button', { name: 'Creating…' })
      expect((button as HTMLButtonElement).disabled).toBe(true)

      fireEvent.click(button)

      expect(gitApi.createWorktree).toHaveBeenCalledTimes(1)
      gate.finish()
    })

    it('cannot be dismissed while git is still working', async () => {
      setupGitWorkspace()
      const onClose = vi.fn()
      render(<CreateProjectDialog workspaceId="ws-1" onClose={onClose} />)
      await vi.waitFor(() => screen.getByRole('button', { name: 'Worktree' }))
      fireEvent.click(screen.getByRole('button', { name: 'Worktree' }))
      fireEvent.change(screen.getByPlaceholderText('feature/my-feature'), {
        target: { value: 'feature/x' },
      })
      const gate = pending()
      fireEvent.click(screen.getByText('Create'))
      await screen.findByRole('button', { name: 'Creating…' })

      fireEvent.click(screen.getByText('Cancel'))
      fireEvent.click(document.querySelector('.tmui-dialog__scrim')!)
      expect(onClose).not.toHaveBeenCalled()
      gate.finish()
    })

    it('offers Create again when git refused, so the operator can fix and retry', async () => {
      setupGitWorkspace()
      gitApi.createWorktree.mockResolvedValue({ error: 'already exists' })
      render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
      await vi.waitFor(() => screen.getByRole('button', { name: 'Worktree' }))
      fireEvent.click(screen.getByRole('button', { name: 'Worktree' }))
      fireEvent.change(screen.getByPlaceholderText('feature/my-feature'), {
        target: { value: 'feature/x' },
      })
      fireEvent.click(screen.getByText('Create'))

      await screen.findByText(/already exists/)
      const button = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
    })
  })
})

describe('CreateProjectDialog branch names and fetching', () => {
  function git(): ReturnType<typeof gitFake> {
    return gitApi
  }

  async function openWorktreeMode(): Promise<void> {
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await vi.waitFor(() => screen.getByText('Worktree'))
    fireEvent.click(screen.getByText('Worktree'))
    await vi.waitFor(() => screen.getByText('Worktree path'))
  }

  it('keeps a slash while the new branch name is being typed', async () => {
    setupGitWorkspace()
    await openWorktreeMode()
    const input = screen.getByPlaceholderText('feature/my-feature') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'feature/' } })
    expect(input.value).toBe('feature/')
    fireEvent.change(input, { target: { value: 'feature/login' } })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(git().createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'feature/login', isNewBranch: true })
      )
    )
  })

  it('drops a trailing slash left on submit', async () => {
    setupGitWorkspace()
    await openWorktreeMode()
    fireEvent.change(screen.getByPlaceholderText('feature/my-feature'), {
      target: { value: 'feature/' },
    })
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(git().createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'feature' })
      )
    )
  })

  it('offers a branch that exists only on the remote, by its bare name', async () => {
    setupGitWorkspace()
    git().listBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'teammate/fix', isCurrent: false, isRemote: true },
      ],
    })
    await openWorktreeMode()
    fireEvent.click(screen.getByText('+ New branch…'))
    fireEvent.click(screen.getByText('teammate/fix'))
    fireEvent.click(screen.getByText('Create'))
    await vi.waitFor(() =>
      expect(git().createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'teammate/fix', isNewBranch: false })
      )
    )
  })

  it('fetches and relists the branches when refresh is pressed', async () => {
    setupGitWorkspace()
    git().fetch.mockResolvedValue({ success: true })
    await openWorktreeMode()
    git().listBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'just-pushed', isCurrent: false, isRemote: true },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch branches' }))
    await vi.waitFor(() => expect(git().fetch).toHaveBeenCalledWith('/repo'))
    fireEvent.click(screen.getByText('+ New branch…'))
    await vi.waitFor(() => screen.getByText('just-pushed'))
  })

  it('says so when the fetch fails', async () => {
    setupGitWorkspace()
    git().fetch.mockResolvedValue({ error: 'Could not resolve host: github.com' })
    await openWorktreeMode()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch branches' }))
    await vi.waitFor(() => screen.getByText('Could not fetch: Could not resolve host: github.com'))
  })
})
