import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { useWorkspaceStore } from '../../../../src/stores/workspace.store'
import { useSettingsStore } from '../../../../src/stores/settings.store'
import { useIntegrationsStore } from '../../../../src/stores/integrations.store'
import { CreateProjectDialog } from '../../../../src/components/sidebar/CreateProjectDialog'
import {
  issueSummaryOf,
  projectFixture,
  resetStore,
  seedStore,
  workspaceFixture,
} from '../../../../../test-support/src/renderer-stores'
import type { IssueSummary } from '../../../../../core-shared/src/types/index'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../../core-shared/src/schemas/settings.schema'
import type { ElectronAPI } from '../../../../../core-shared/src/electron-api/api-type'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import { pressOutside } from '../../../../../test-support/src/modal'
import { eventually } from '../../../../../test-support/src/eventually'

/** Main's answer to project.create: the card it stored, unless a spec makes it refuse. */
const projectCreate = vi.fn<ElectronAPI['project']['create']>()
/** Main's answers to linking an issue to a project, and to reading that link back. */
const linkSet = vi.fn<ElectronAPI['integrations']['linkSet']>()
const linkGet = vi.fn<ElectronAPI['integrations']['linkGet']>()

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
  installElectronApi({
    git: gitApi,
    project: { create: projectCreate },
    integrations: { linkSet, linkGet },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  projectCreate.mockResolvedValue({
    project: projectFixture({ workspaceId: 'ws-1', id: 'proj-1' }),
  })
  setupGitAPI()
  // A spec that connects a tracker must not show its issue picker to the next one.
  useIntegrationsStore.setState(useIntegrationsStore.getInitialState(), true)
  resetStore(useWorkspaceStore, {
    projectsByWorkspaceId: new Map([['ws-1', []]]),
    workspaces: [workspaceFixture({ id: 'ws-1', name: 'My WS', folderPath: '' })],
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
  resetStore(useWorkspaceStore, {
    projectsByWorkspaceId: new Map([['ws-1', []]]),
    workspaces: [workspaceFixture({ id: 'ws-1', name: 'My WS', folderPath: '/repo' })],
  })
}

/** A worktree git still has a checkout for. */
const NOT_DETACHED = { detached: false, prunable: false }

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/usage/record', () => ({ recordUse }))

describe('CreateProjectDialog', () => {
  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={onClose} />)
    await user.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows name validation error when empty', async () => {
    const user = userEvent.setup()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await user.click(screen.getByText('Create'))
    expect(screen.getByText('Name is required')).toBeTruthy()
  })
})

describe('CreateProjectDialog — submits with valid name for simple project', () => {
  it('submits with valid name for simple project', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={onClose} />)
    await user.type(screen.getByPlaceholderText('My branch'), 'My App')
    await user.click(screen.getByText('Create'))
    await eventually(() => expect(onClose).toHaveBeenCalled())
    expect(projectCreate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', name: 'My App' })
    )
    const stored = useWorkspaceStore.getState().projectsByWorkspaceId.get('ws-1')
    expect(stored?.map((project) => project.id)).toEqual(['proj-1'])
  })
})

describe('CreateProjectDialog — the name error', () => {
  it('sets name error on blur when name is empty', async () => {
    const user = userEvent.setup()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My branch')
    await user.click(nameInput)
    await user.tab()
    expect(screen.getByText('Name is required')).toBeTruthy()
  })

  it('clears name error when name is changed', async () => {
    const user = userEvent.setup()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My branch')
    await user.click(nameInput)
    await user.tab()
    expect(screen.getByText('Name is required')).toBeTruthy()
    await user.type(nameInput, 'Something')
    expect(screen.queryByText('Name is required')).toBeNull()
  })
})

describe('CreateProjectDialog — shows duplicate project name error on blur', () => {
  it('shows duplicate project name error on blur', async () => {
    const user = userEvent.setup()
    resetStore(useWorkspaceStore, {
      projectsByWorkspaceId: new Map([
        ['ws-1', [projectFixture({ workspaceId: 'ws-1', id: 'p1', name: 'My App' })]],
      ]),
      workspaces: [workspaceFixture({ id: 'ws-1', name: 'My WS', folderPath: '' })],
    })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    const nameInput = screen.getByPlaceholderText('My branch')
    await user.type(nameInput, 'My App')
    await user.click(nameInput)
    await user.tab()
    expect(screen.getByText('A branch with this name already exists in this repo')).toBeTruthy()
  })

  it('asks for no name in a repo — the branch is the name (ADR-034)', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Branch' })
    expect(screen.queryByText('Name *')).toBeNull()
  })
})

describe('CreateProjectDialog — still asks for a name where there is no branch to take one from', () => {
  it('still asks for a name where there is no branch to take one from', () => {
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    expect(screen.getByText('Name *')).toBeTruthy()
  })

  it('names the card after the branch it is created on', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Branch' })
    await user.click(screen.getByText('Create'))
    await eventually(() =>
      expect(projectCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'main', gitBranch: 'main' })
      )
    )
  })

  it('refuses to create a nameless card when no branch is chosen', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    gitApi.listBranches.mockResolvedValue({ branches: [] })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Branch' })
    await user.click(screen.getByText('Create'))
    await screen.findByText('Select or enter a branch name')
    expect(projectCreate).not.toHaveBeenCalled()
  })
})

describe('CreateProjectDialog — does not show branch controls for non-git workspace', () => {
  it('does not show branch controls for non-git workspace', () => {
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Branch' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Worktree' })).toBeNull()
  })

  it('existing mode shows branch dropdown with current branch', async () => {
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Branch' })
    // BranchSelect trigger shows the current branch name
    await screen.findByText('main')
  })
})

describe('CreateProjectDialog — new branch mode creates branch and project on submit', () => {
  it('new branch mode creates branch and project on submit', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    const onClose = vi.fn()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={onClose} />)
    await screen.findByRole('button', { name: 'Branch' })
    // Open BranchSelect dropdown and select the inline new-branch option
    await screen.findByText('main')
    await user.click(screen.getByText('main'))
    await user.click(screen.getByText('+ New branch…'))
    await user.type(screen.getByPlaceholderText('feature/my-feature'), 'feature/new')
    await user.click(screen.getByText('Create'))
    await eventually(() =>
      expect(window.electronAPI.git.createBranch).toHaveBeenCalledWith('/repo', 'feature/new')
    )
    await eventually(() =>
      expect(projectCreate).toHaveBeenCalledWith(
        expect.objectContaining({ gitBranch: 'feature/new' })
      )
    )
  })
})

describe('CreateProjectDialog — new branch mode shows error when branch name is empty', () => {
  it('new branch mode shows error when branch name is empty', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Branch' })
    // Open BranchSelect dropdown and select the inline new-branch option
    await screen.findByText('main')
    await user.click(screen.getByText('main'))
    await user.click(screen.getByText('+ New branch…'))
    await user.click(screen.getByText('Create'))
    await screen.findByText('Enter a branch name')
  })

  it('disables Branch tab and defaults to worktree when non-worktree project exists', async () => {
    setupGitWorkspace()
    const main = projectFixture({ workspaceId: 'ws-1', id: 'p1', name: 'Main', isWorktree: false })
    resetStore(useWorkspaceStore, {
      projectsByWorkspaceId: new Map([['ws-1', [main]]]),
      workspaces: [workspaceFixture({ id: 'ws-1', name: 'My WS', folderPath: '/repo' })],
    })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Branch' })
    const branchBtn = screen.getByRole('button', { name: 'Branch' })
    expect((branchBtn as HTMLButtonElement).disabled).toBe(true)
    const worktreeBtn = screen.getByRole('button', { name: 'Worktree' })
    expect(worktreeBtn.className).toContain('dialog__segment-btn--active')
  })
})

describe('CreateProjectDialog — submit guard shows error when branchMode is existing and hasNonWorktreeProject is true', () => {
  it('submit guard shows error when branchMode is existing and hasNonWorktreeProject is true', async () => {
    const user = userEvent.setup()
    // Initial render: no non-worktree projects → branchMode initializes to 'existing'
    const { rerender } = render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('My branch'), 'New Project')
    // Simulate a concurrent project being created by updating the store, then force a re-render
    // using rerender so the component sees hasNonWorktreeProject = true in the next render cycle
    resetStore(useWorkspaceStore, {
      projectsByWorkspaceId: new Map([
        [
          'ws-1',
          [projectFixture({ workspaceId: 'ws-1', id: 'p1', name: 'Existing', isWorktree: false })],
        ],
      ]),
      workspaces: [workspaceFixture({ id: 'ws-1', name: 'My WS', folderPath: '' })],
    })
    rerender(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await user.click(screen.getByText('Create'))
    await screen.findByText('A branch-based entry already exists in this repo')
  })
})

describe('CreateProjectDialog — worktree mode pre-fills path with .worktrees base when no branch typed', () => {
  it('worktree mode pre-fills path with .worktrees base when no branch typed', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Worktree' }))
    // Pick an existing branch, then go back to a new one, so the branch is empty again.
    await user.click(screen.getByRole('button', { name: /New branch/ }))
    await user.click(screen.getByText('main'))
    await user.click(screen.getByRole('button', { name: /main/ }))
    await user.click(screen.getAllByText('+ New branch…')[0])
    const path = screen.getByPlaceholderText<HTMLInputElement>('/path/to/worktree')
    await eventually(() => expect(path.value).toBe('/repo/.worktrees'))
  })
})

describe('CreateProjectDialog — worktree mode changes path input', () => {
  it('creates the worktree at a path the operator typed over the suggestion', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    await openWorktreeMode(user)
    await user.type(screen.getByPlaceholderText('feature/my-feature'), 'feature/wt')
    const path = await screen.findByDisplayValue('/wt/branch')
    await user.clear(path)
    await user.type(path, '/custom/wt/path')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await eventually(() =>
      expect(gitApi.createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'feature/wt', worktreePath: '/custom/wt/path' })
      )
    )
  })
})

describe('CreateProjectDialog — clicking Branch tab switches back from worktree mode', () => {
  it('clicking Branch tab switches back from worktree mode', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Branch' })
    await user.click(screen.getByRole('button', { name: 'Worktree' }))
    await screen.findByText('Worktree path')
    await user.click(screen.getByRole('button', { name: 'Branch' }))
    await eventually(() => expect(screen.queryByText('Worktree path')).toBeNull())
  })
})

describe('CreateProjectDialog — branch mode selecting a branch via dropdown fires onChange', () => {
  it('branch mode selecting a branch via dropdown fires onChange', async () => {
    const user = userEvent.setup()
    gitApi.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
    gitApi.listBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'develop', isCurrent: false, isRemote: false },
      ],
    })
    resetStore(useWorkspaceStore, {
      projectsByWorkspaceId: new Map([['ws-1', []]]),
      workspaces: [workspaceFixture({ id: 'ws-1', name: 'My WS', folderPath: '/repo' })],
    })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByText('main')
    await user.click(screen.getByText('main'))
    await user.click(screen.getByText('develop'))
    await user.click(screen.getByText('Create'))
    await eventually(() =>
      expect(projectCreate).toHaveBeenCalledWith(expect.objectContaining({ gitBranch: 'develop' }))
    )
  })
})

describe('CreateProjectDialog — shows error when createBranch fails', () => {
  it('shows error when createBranch fails', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    gitApi.createBranch.mockResolvedValue({ error: 'already exists' })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Branch' })
    await user.click(screen.getByText('main'))
    await user.click(screen.getByText('+ New branch…'))
    await user.type(screen.getByPlaceholderText('feature/my-feature'), 'feature/bad')
    await user.click(screen.getByText('Create'))
    await screen.findByText('Could not create branch: already exists')
  })
})

describe('CreateProjectDialog — shows name error when createProject returns DUPLICATE_NAME', () => {
  it('shows name error when createProject returns DUPLICATE_NAME', async () => {
    const user = userEvent.setup()
    projectCreate.mockResolvedValue({ error: 'DUPLICATE_NAME' })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('My branch'), 'My branch')
    await user.click(screen.getByText('Create'))
    await screen.findByText('A branch with this name already exists')
  })

  it('shows generic error when createProject returns other error', async () => {
    const user = userEvent.setup()
    projectCreate.mockResolvedValue({ error: 'DB_ERROR' })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('My branch'), 'My branch')
    await user.click(screen.getByText('Create'))
    await screen.findByText('Could not create the branch')
  })
})

describe('CreateProjectDialog — shows error when createWorktree fails', () => {
  it('shows error when createWorktree fails', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    gitApi.createWorktree.mockResolvedValue({ error: 'no space' })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByText('Worktree')
    await user.click(screen.getByText('Worktree'))
    await screen.findByText('Worktree path')
    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[inputs.length - 2], 'feature/wt')
    await user.click(screen.getByText('Create'))
    await screen.findByText('Worktree error: no space')
  })
})

describe('CreateProjectDialog — shows empty branch name error in worktree mode', () => {
  it('shows empty branch name error in worktree mode', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByText('Worktree')
    await user.click(screen.getByText('Worktree'))
    await screen.findByText('Worktree path')
    // Switch away from new-branch to an existing branch then clear (so branch = '')
    const triggers = screen.getAllByRole('button')
    const branchTrigger = triggers.find((b) => b.textContent?.includes('+ New branch'))!
    await user.click(branchTrigger)
    await user.click(screen.getByText('main'))
    // Now switch back to new-branch so worktreeIsNewBranch = true, newBranchName = ''
    await screen.findByText('main')
    await user.click(screen.getByText('main'))
    await user.click(screen.getAllByText('+ New branch…')[0])
    // Ensure new branch name input is empty then submit
    const newBranchInput = screen.getByPlaceholderText('feature/my-feature')
    await user.clear(newBranchInput)
    await user.click(screen.getByText('Create'))
    await screen.findByText('Select or enter a branch name')
  })
})

// ── Starting from an issue (US5) ────────────────────────────────────────────

const ISSUE = issueSummaryOf({
  key: 'TAV-42',
  title: 'Unify Linear connections behind one core service',
  branchName: 'andrew/tav-42-unify-linear',
})

const UNSUGGESTED_ISSUE = issueSummaryOf({ ...ISSUE, key: 'TAV-7', branchName: null })

const listMine = vi.fn()

const LINEAR = {
  tracker: 'linear' as const,
  connected: true,
  account: null,
  mine: { kind: 'assignee' as const, email: null },
  lastError: null,
}

const LINK = {
  projectId: 'p-new',
  tracker: 'linear' as const,
  key: 'TAV-42',
  injectContext: true,
  linkedAt: '2026-08-22T00:00:00.000Z',
}

async function openWithIssues(connected = true, issues: IssueSummary[] = [ISSUE]) {
  listMine.mockResolvedValue({ issues, failures: [] })
  linkSet.mockResolvedValue({ link: LINK })
  linkGet.mockResolvedValue({ link: LINK, issue: null })
  useIntegrationsStore.setState({
    connections: connected ? [LINEAR] : [],
    listMine,
    searchIssues: vi.fn().mockResolvedValue({ issues: [], failures: [] }),
  })

  setupGitAPI({
    isRepo: vi.fn().mockResolvedValue({ isRepo: true, root: '/repo' }),
    listBranches: vi
      .fn()
      .mockResolvedValue({ branches: [{ name: 'main', isCurrent: true, isRemote: false }] }),
  })
  resetStore(useWorkspaceStore, {
    projectsByWorkspaceId: new Map(),
    workspaces: [workspaceFixture({ id: 'w1', name: 'ws', folderPath: '/repo' })],
  })
  seedStore(useSettingsStore, { resolveSettings: () => DEFAULT_GLOBAL_SETTINGS })

  render(<CreateProjectDialog workspaceId="w1" onClose={vi.fn()} />)
}

/** The hooks every "CreateProjectDialog — from an issue" describe registers. */
function setUpCreateProjectDialogFromAnIssue(): void {
  beforeEach(() => {
    vi.clearAllMocks()
    projectCreate.mockResolvedValue({ project: projectFixture({ workspaceId: 'w1', id: 'p-new' }) })
  })
}

describe('CreateProjectDialog — from an issue', () => {
  setUpCreateProjectDialogFromAnIssue()

  it('does not offer the picker when no tracker is connected', async () => {
    await openWithIssues(false)
    expect(screen.queryByText('Start from an issue')).toBeNull()
  })

  it('offers the picker once a tracker is connected', async () => {
    await openWithIssues(true)
    expect(screen.getByText('Start from an issue')).toBeTruthy()
  })

  it('prefills the branch from the picked issue, and asks for no other name', async () => {
    const user = userEvent.setup()
    await openWithIssues()
    await user.click(screen.getByPlaceholderText(/Search, or type an issue key/))
    await user.click(await screen.findByText('TAV-42'))

    expect(screen.getByDisplayValue('andrew/tav-42-unify-linear')).toBeTruthy()
    // The card is named by its branch, so there is no second name to fill in.
    expect(screen.queryByPlaceholderText('My branch')).toBeNull()
  })

  it('derives a branch when the issue has no suggested branch', async () => {
    const user = userEvent.setup()
    await openWithIssues(true, [UNSUGGESTED_ISSUE])
    await user.click(screen.getByPlaceholderText(/Search, or type an issue key/))
    await user.click(await screen.findByText('TAV-7'))

    expect(screen.getByDisplayValue(/tav-7-unify-linear/)).toBeTruthy()
  })
})

describe('CreateProjectDialog — from an issue — honours an edit made after prefilling', () => {
  setUpCreateProjectDialogFromAnIssue()

  it('honours an edit made after prefilling', async () => {
    const user = userEvent.setup()
    await openWithIssues()
    await user.click(screen.getByPlaceholderText(/Search, or type an issue key/))
    await user.click(await screen.findByText('TAV-42'))

    const branch = screen.getByDisplayValue('andrew/tav-42-unify-linear')
    await user.clear(branch)
    await user.type(branch, 'andrew/my-own-branch')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await eventually(() =>
      expect(projectCreate).toHaveBeenCalledWith(
        expect.objectContaining({ gitBranch: 'andrew/my-own-branch' })
      )
    )
  })

  it('lets the operator back out of the issue', async () => {
    const user = userEvent.setup()
    await openWithIssues()
    await user.click(screen.getByPlaceholderText(/Search, or type an issue key/))
    await user.click(await screen.findByText('TAV-42'))

    await user.click(await screen.findByTitle('Choose a different issue'))
    expect(screen.getByPlaceholderText(/Search, or type an issue key/)).toBeTruthy()
  })
})

describe('CreateProjectDialog — from an issue — attaches the issue', () => {
  setUpCreateProjectDialogFromAnIssue()

  it('attaches the issue to the project it just created (FR-011)', async () => {
    const user = userEvent.setup()
    await openWithIssues()
    await user.click(screen.getByPlaceholderText(/Search, or type an issue key/))
    await user.click(await screen.findByText('TAV-42'))

    await user.click(await screen.findByText('Create'))
    await eventually(() =>
      expect(useIntegrationsStore.getState().linkFor('p-new')?.key).toBe('TAV-42')
    )
    expect(linkSet).toHaveBeenCalledWith({ projectId: 'p-new', tracker: 'linear', key: 'TAV-42' })
  })
})

describe('CreateProjectDialog — from an issue — attaches nothing when no issue was picked', () => {
  setUpCreateProjectDialogFromAnIssue()

  it('attaches nothing when no issue was picked', async () => {
    const user = userEvent.setup()
    await openWithIssues()
    await screen.findByRole('button', { name: 'Branch' })
    await user.click(screen.getByText('Create'))

    await eventually(() => expect(projectCreate).toHaveBeenCalled())
    expect(linkSet).not.toHaveBeenCalled()
  })
})

/** A createWorktree that stays unresolved until the test lets it finish. */
function pending(): { finish: () => void } {
  let release = (): void => {}
  const gate = new Promise<{ success: true }>((resolve) => {
    release = () => resolve({ success: true })
  })
  gitApi.createWorktree.mockReturnValue(gate)
  return { finish: () => release() }
}

async function submitWorktree(user: UserEvent): Promise<{ finish: () => void }> {
  setupGitWorkspace()
  render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
  await screen.findByRole('button', { name: 'Worktree' })
  await user.click(screen.getByRole('button', { name: 'Worktree' }))
  await user.type(screen.getByPlaceholderText('feature/my-feature'), 'feature/x')
  const gate = pending()
  await user.click(screen.getByText('Create'))
  return gate
}

describe('CreateProjectDialog — from an issue — while it is working', () => {
  setUpCreateProjectDialogFromAnIssue()

  it('says it is working and refuses a second press', async () => {
    const user = userEvent.setup()
    const gate = await submitWorktree(user)
    const button = await screen.findByRole('button', { name: 'Creating…' })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    await user.click(button)

    expect(gitApi.createWorktree).toHaveBeenCalledTimes(1)
    gate.finish()
  })

  it('cannot be dismissed while git is still working', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    const onClose = vi.fn()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={onClose} />)
    await screen.findByRole('button', { name: 'Worktree' })
    await user.click(screen.getByRole('button', { name: 'Worktree' }))
    await user.type(screen.getByPlaceholderText('feature/my-feature'), 'feature/x')
    const gate = pending()
    await user.click(screen.getByText('Create'))
    await screen.findByRole('button', { name: 'Creating…' })

    await user.click(await screen.findByText('Cancel'))
    pressOutside(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    gate.finish()
  })
})

describe('CreateProjectDialog — from an issue — while it is working — offers Create again when git refused, so the operator can fix and retry', () => {
  setUpCreateProjectDialogFromAnIssue()

  it('offers Create again when git refused, so the operator can fix and retry', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    gitApi.createWorktree.mockResolvedValue({ error: 'already exists' })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Worktree' })
    await user.click(screen.getByRole('button', { name: 'Worktree' }))
    await user.type(screen.getByPlaceholderText('feature/my-feature'), 'feature/x')
    await user.click(screen.getByText('Create'))

    await screen.findByText(/already exists/)
    const button = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })
})

function git(): ReturnType<typeof gitFake> {
  return gitApi
}

async function openWorktreeMode(user: UserEvent): Promise<void> {
  render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
  await screen.findByText('Worktree')
  await user.click(screen.getByText('Worktree'))
  await screen.findByText('Worktree path')
}

describe('CreateProjectDialog branch names and fetching', () => {
  it('keeps a slash while the new branch name is being typed', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    await openWorktreeMode(user)
    const input = screen.getByPlaceholderText('feature/my-feature') as HTMLInputElement
    await user.type(input, 'feature/')
    expect(input.value).toBe('feature/')
    await user.type(input, 'login')
    await user.click(screen.getByText('Create'))
    await eventually(() =>
      expect(git().createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'feature/login', isNewBranch: true })
      )
    )
  })

  it('drops a trailing slash left on submit', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    await openWorktreeMode(user)
    await user.type(screen.getByPlaceholderText('feature/my-feature'), 'feature/')
    await user.click(screen.getByText('Create'))
    await eventually(() =>
      expect(git().createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'feature' })
      )
    )
  })
})

describe('CreateProjectDialog branch names and fetching — offers a branch that exists only on the remote, by its bare name', () => {
  it('offers a branch that exists only on the remote, by its bare name', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    git().listBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'teammate/fix', isCurrent: false, isRemote: true },
      ],
    })
    await openWorktreeMode(user)
    await user.click(screen.getByText('+ New branch…'))
    await user.click(screen.getByText('teammate/fix'))
    await user.click(screen.getByText('Create'))
    await eventually(() =>
      expect(git().createWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'teammate/fix', isNewBranch: false })
      )
    )
  })
})

describe('CreateProjectDialog branch names and fetching — fetches and relists the branches when refresh is pressed', () => {
  it('fetches and relists the branches when refresh is pressed', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    git().fetch.mockResolvedValue({ success: true })
    await openWorktreeMode(user)
    git().listBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'just-pushed', isCurrent: false, isRemote: true },
      ],
    })
    await user.click(screen.getByRole('button', { name: 'Fetch branches' }))
    await eventually(() => expect(git().fetch).toHaveBeenCalledWith('/repo'))
    await user.click(screen.getByText('+ New branch…'))
    await screen.findByText('just-pushed')
  })

  it('says so when the fetch fails', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    git().fetch.mockResolvedValue({ error: 'Could not resolve host: github.com' })
    await openWorktreeMode(user)
    await user.click(screen.getByRole('button', { name: 'Fetch branches' }))
    expect(
      await screen.findByText('Could not fetch: Could not resolve host: github.com')
    ).toBeTruthy()
  })
})

describe('CreateProjectDialog — names outside a repo', () => {
  it('refuses a name over 100 characters', async () => {
    const user = userEvent.setup()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await user.click(screen.getByPlaceholderText('My branch'))
    await user.paste('x'.repeat(101))
    await user.click(screen.getByText('Create'))
    expect(screen.getByText('Name must be 100 characters or less')).toBeTruthy()
    expect(projectCreate).not.toHaveBeenCalled()
  })
})

describe('CreateProjectDialog — names outside a repo — treats a repo with no reported root as a plain folder', () => {
  it('treats a repo with no reported root as a plain folder', async () => {
    gitApi.isRepo.mockResolvedValue({ isRepo: true })
    resetStore(useWorkspaceStore, {
      workspaces: [workspaceFixture({ id: 'ws-1', name: 'My WS', folderPath: '/somewhere' })],
    })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await eventually(() => expect(gitApi.isRepo).toHaveBeenCalledWith('/somewhere'))
    expect(screen.getByPlaceholderText('My branch')).toBeTruthy()
    expect(gitApi.listBranches).not.toHaveBeenCalled()
  })
})

describe('CreateProjectDialog — git could not say whether the folder is a repository', () => {
  it('says so rather than offering a plain-folder form for what may be a repository', async () => {
    gitApi.isRepo.mockResolvedValue({ error: 'git rev-parse timed out' })
    resetStore(useWorkspaceStore, {
      workspaces: [workspaceFixture({ id: 'ws-1', name: 'My WS', folderPath: '/repo' })],
    })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByText(/could not read the git repository/i)
    expect(gitApi.listBranches).not.toHaveBeenCalled()
  })
})

/** The branch picker's branches, in order, with the current-branch tick stripped and the
 * "+ New branch…" choice above them left out. */
const listedBranches = (): string[] =>
  within(screen.getByRole('group', { name: 'Branches' }))
    .getAllByRole('button')
    .map((el) => (el.textContent ?? '').replace('✓', ''))
    .filter((name) => name !== '+ New branch…')

describe('CreateProjectDialog — the branch list', () => {
  it.each([
    ['main', ['b', 'main', 'master'], ['main', 'b', 'master']],
    ['master when there is no main', ['b', 'master'], ['master', 'b']],
  ])('lists %s first', async (_, names, expected) => {
    const user = userEvent.setup()
    setupGitWorkspace()
    gitApi.listBranches.mockResolvedValue({
      branches: names.map((name) => ({ name, isCurrent: false, isRemote: false })),
    })
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Branch' })
    await user.click(screen.getByText('Select branch…'))
    await eventually(() => expect(listedBranches()).toEqual(expected))
  })

  it('fetches from the Branch tab too', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Branch' })
    await user.click(screen.getByRole('button', { name: 'Fetch branches' }))
    await eventually(() => expect(gitApi.fetch).toHaveBeenCalledWith('/repo'))
  })
})

/** Submits the repo's current branch from the Branch tab. */
async function submitExistingBranch(user: UserEvent): Promise<void> {
  setupGitWorkspace()
  render(<CreateProjectDialog workspaceId="ws-1" onClose={vi.fn()} />)
  await screen.findByRole('button', { name: 'Branch' })
  await user.click(screen.getByText('Create'))
}

/** Submits a new branch from the Worktree tab. */
async function submitNewWorktree(user: UserEvent): Promise<void> {
  setupGitWorkspace()
  await openWorktreeMode(user)
  await user.type(screen.getByPlaceholderText('feature/my-feature'), 'feature/x')
  await user.click(screen.getByText('Create'))
}

describe('CreateProjectDialog — a refused branch in a repo', () => {
  it.each([
    ['Branch', submitExistingBranch],
    ['Worktree', submitNewWorktree],
  ])('says the repo has that branch already (%s)', async (_, submit) => {
    const user = userEvent.setup()
    projectCreate.mockResolvedValue({ error: 'DUPLICATE_NAME' })
    await submit(user)
    await screen.findByText('This repo already has that branch')
  })

  it.each([
    ['Branch', submitExistingBranch],
    ['Worktree', submitNewWorktree],
  ])('says it could not create the branch otherwise (%s)', async (_, submit) => {
    const user = userEvent.setup()
    projectCreate.mockResolvedValue({ error: 'DB_ERROR' })
    await submit(user)
    await screen.findByText('Could not create the branch')
  })
})

describe('CreateProjectDialog — the worktree branch list', () => {
  it('leaves out branches a worktree is already on', async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    gitApi.listBranches.mockResolvedValue({
      branches: ['main', 'taken', 'free'].map((name) => ({
        name,
        isCurrent: false,
        isRemote: false,
      })),
    })
    gitApi.listWorktrees.mockResolvedValue({
      worktrees: [
        {
          path: '/wt/taken',
          branch: 'taken',
          isMain: false,
          head: 'abc123',
          ...NOT_DETACHED,
        },
      ],
    })
    await openWorktreeMode(user)
    await user.click(screen.getByText('+ New branch…'))
    await eventually(() => expect(listedBranches()).toEqual(['main', 'free']))
  })
})

describe('CreateProjectDialog — the Worktree Base Directory setting', () => {
  it("puts a new worktree under the workspace's base directory", async () => {
    const user = userEvent.setup()
    setupGitWorkspace()
    const settings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      git: { ...DEFAULT_GLOBAL_SETTINGS.git, worktreeBaseDir: '/wt-base' },
    }
    seedStore(useSettingsStore, { resolveSettings: vi.fn().mockReturnValue(settings) })
    await openWorktreeMode(user)

    await user.type(screen.getByPlaceholderText('feature/my-feature'), 'feature/login')

    await eventually(() =>
      expect(git().suggestWorktreePath).toHaveBeenCalledWith('/repo', 'feature/login', '/wt-base')
    )
  })
})
