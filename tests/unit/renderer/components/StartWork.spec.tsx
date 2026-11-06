import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { StartWork } from '../../../../src/renderer/components/home/StartWork'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useDismissedThreads } from '../../../../src/renderer/components/home/dismissed-threads'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import userEvent from '@testing-library/user-event'
import { installElectronApi } from '../../../support/electron-api'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import type {
  IssueSummary,
  Project,
  TerminalSession,
  Workspace,
} from '../../../../src/shared/types/index'

const launched = vi.hoisted(() => ({
  inBranch: vi.fn(),
  agentInBranch: vi.fn(),
  scratch: vi.fn(),
  createFromDraft: vi.fn(),
}))
vi.mock('../../../../src/renderer/terminal/start-session', () => ({
  startSessionInBranch: launched.inBranch,
  startAgentInBranch: launched.agentInBranch,
  startScratchSession: launched.scratch,
}))
vi.mock('../../../../src/renderer/components/sidebar/create-project', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createFromDraft: launched.createFromDraft,
}))

const workspace: Workspace = {
  id: 'ws-1',
  name: 'terminator',
  folderPath: '/repo',
  color: '#fff',
  tags: [],
  createdAt: '',
  updatedAt: '',
}
const secondWorkspace: Workspace = {
  ...workspace,
  id: 'ws-2',
  name: 'atlas',
  folderPath: '/atlas',
  color: '#0f0',
}
const mainProject: Project = {
  id: 'p-main',
  workspaceId: 'ws-1',
  name: 'main',
  gitBranch: 'main',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}

interface TicketFixture {
  key: string
  title: string
  type: string
  branchName: string | null
}

function linearIssue({ key, title, type, branchName }: TicketFixture): IssueSummary {
  return {
    tracker: 'linear',
    id: `id-${key}`,
    key,
    title,
    url: `https://linear.app/t/issue/${key}`,
    state: { name: type, type: type as IssueSummary['state']['type'] },
    assignee: null,
    branchName,
  }
}

const ISSUES = [
  linearIssue({
    key: 'TAV-36',
    title: 'Remote control shows the tunnel address',
    type: 'backlog',
    branchName: 'tav-36-tunnel',
  }),
  linearIssue({
    key: 'TAV-35',
    title: 'Quick actions remembers the last query',
    type: 'unstarted',
    branchName: 'tav-35-quick',
  }),
  linearIssue({
    key: 'TAV-33',
    title: 'Retry rate-limited GitHub searches',
    type: 'started',
    branchName: 'tav-33-retry',
  }),
  linearIssue({
    key: 'TAV-40',
    title: 'Sort the inbox',
    type: 'triage',
    branchName: 'tav-40-inbox',
  }),
]

const setLink = vi.fn()
const git = {
  isRepo: vi.fn<ElectronAPI['git']['isRepo']>(),
  listBranches: vi.fn<ElectronAPI['git']['listBranches']>(),
  listWorktrees: vi.fn<ElectronAPI['git']['listWorktrees']>(),
}
const executeCommand = vi.fn<ElectronAPI['extension']['executeCommand']>()
const agentsList = vi.fn<ElectronAPI['agents']['list']>()
const nameBranch = vi.fn<ElectronAPI['homeBranchName']['get']>()
const createSchedule = vi.fn<ElectronAPI['schedules']['create']>()

function seedStartWorkStores(): void {
  useWorkspaceStore.setState({
    workspaces: [workspace],
    activeWorkspaceId: 'ws-1',
    projectsByWorkspaceId: new Map([['ws-1', [mainProject]]]),
  })
  useIntegrationsStore.setState({
    listMine: vi.fn(async () => ({ issues: ISSUES, failures: [] })),
  })
  useSessionRecordsStore.setState({ setLink })
  const session = {
    id: 's-new',
    projectId: 'p-new',
    tabTitle: 'Terminal 1',
    createdAt: '2026-10-18T00:00:00Z',
  } as TerminalSession
  useSessionStore.setState({ sessions: new Map([['s-new', session]]) })
}

beforeEach(() => {
  vi.clearAllMocks()
  useExtensionRegistry.setState({ startWorkOptions: new Map() })
  git.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
  git.listBranches.mockResolvedValue({
    branches: [{ name: 'main', isCurrent: true, isRemote: false }],
  })
  git.listWorktrees.mockResolvedValue({ worktrees: [] })
  agentsList.mockResolvedValue({ data: [{ id: 'claude', label: 'Claude Code' }] })
  installElectronApi({
    git,
    agents: { list: agentsList },
    homeBranchName: { get: nameBranch },
    schedules: { create: createSchedule, list: async () => ({ data: [] }) },
    extension: {
      executeCommand,
      getCommands: vi.fn(async () => ({ commands: [] })),
      hasCommand: vi.fn(async () => false),
      list: vi.fn(async () => ({ extensions: [] })),
    },
  })
  nameBranch.mockResolvedValue({ text: 'fix/dev-build' })
  launched.inBranch.mockResolvedValue('s-new')
  launched.agentInBranch.mockResolvedValue('s-new')
  launched.createFromDraft.mockResolvedValue('p-new')
  seedStartWorkStores()
})

/** The field the person types in: the search row, or the Prompt tab's own box. */
const searchBox = () =>
  screen.getByRole('textbox', { name: /^(Search tickets or type a prompt|What should it do\?)$/ })
const open = async (onClose = vi.fn()) => {
  render(<StartWork onClose={onClose} />)
  await screen.findByText('TAV-33')
  return onClose
}
const goToTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))
const useRepoFolder = () =>
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use the repo folder' }))
const rowKeys = () => screen.getAllByTestId('start-work-key').map((n) => n.textContent)

/** A worktree git still has a checkout for. */
const NOT_DETACHED = { detached: false, prunable: false }
const DEV_WORKTREE = {
  path: '/repo/.worktrees/dev',
  branch: 'dev',
  isMain: false,
  head: 'abc',
  ...NOT_DETACHED,
}

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('StartWork — my tickets', () => {
  it('groups tickets by state type, in progress first, and names each group', async () => {
    await open()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((n) => n.textContent)
    expect(headings).toEqual(['In progress', 'Todo', 'Backlog', 'Triage'])
    expect(rowKeys()).toEqual(['TAV-33', 'TAV-35', 'TAV-36', 'TAV-40'])
  })

  it('shows each ticket with its title and its state chip', async () => {
    await open()
    const row = screen.getByText('TAV-33').closest('[role="option"]') as HTMLElement
    expect(within(row).getByText('Retry rate-limited GitHub searches')).toBeTruthy()
    expect(within(row).getByText('started')).toBeTruthy()
  })

  it('filters by key', async () => {
    await open()
    fireEvent.change(searchBox(), { target: { value: 'tav-35' } })
    expect(rowKeys()).toEqual(['TAV-35'])
  })

  it('filters by title and offers what was typed as a prompt', async () => {
    await open()
    fireEvent.change(searchBox(), { target: { value: 'tunnel' } })
    expect(rowKeys()).toEqual(['TAV-36'])
    expect(screen.getByRole('heading', { name: 'Or start from what you typed' })).toBeTruthy()
    expect(screen.getByText(/"tunnel" as a new agent task, no ticket/)).toBeTruthy()
  })
})

describe('StartWork — opening and closing', () => {
  it('puts the cursor in the search box when it opens', async () => {
    await open()
    expect(document.activeElement).toBe(searchBox())
  })

  it('closes on Escape', async () => {
    const onClose = await open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('StartWork — run it as', () => {
  const checked = () => screen.getByRole('radio', { checked: true }).getAttribute('aria-label')

  it('offers the agent tab, Claude in a terminal and Terminal only when no extension adds one', async () => {
    await open()
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Claude Code in an agent tab',
      'Claude in a terminal',
      'Terminal only',
    ])
    expect(document.body.textContent).not.toMatch(/Foundry/)
    for (let step = 0; step < 3; step++) fireEvent.keyDown(searchBox(), { key: 'Tab' })
    expect(checked()).toBe('Claude Code in an agent tab')
  })
})

describe('StartWork — run it as, with an extension option', () => {
  const checked = () => screen.getByRole('radio', { checked: true }).getAttribute('aria-label')

  it('lists what an extension declared after the two built-in ones, and Tab reaches it', async () => {
    registerFoundryOption()
    await open()
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Claude Code in an agent tab',
      'Claude in a terminal',
      'Terminal only',
      'Foundry order',
    ])
    for (let step = 0; step < 3; step++) fireEvent.keyDown(searchBox(), { key: 'Tab' })
    expect(checked()).toBe('Foundry order')
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    expect(checked()).toBe('Claude Code in an agent tab')
  })

  it('summarises the branch and worktree of the selected ticket', async () => {
    await open()
    const summary = screen.getByRole('group', { name: 'Where it runs' })
    await waitFor(() => expect(within(summary).getByText('main')).toBeTruthy())
    expect(within(summary).getByText('tav-33-retry')).toBeTruthy()
    expect(within(summary).getByText('.worktrees/tav-33-retry')).toBeTruthy()
  })
})

describe('StartWork — Enter on a ticket', () => {
  it('creates the worktree on the ticket branch, starts Claude in it and links the ticket', async () => {
    const onClose = await open()
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.createFromDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        gitRoot: '/repo',
        draft: expect.objectContaining({
          branchMode: 'worktree',
          newBranchName: 'tav-33-retry',
          worktreeIsNewBranch: true,
          worktreePath: '/repo/.worktrees/tav-33-retry',
        }),
      })
    )
    expect(launched.agentInBranch).toHaveBeenCalledWith({
      projectId: 'p-new',
      title: 'TAV-33',
      prompt: expect.stringMatching(/^Work on TAV-33: Retry rate-limited GitHub searches/),
      agentId: undefined,
    })
    expect(launched.inBranch).not.toHaveBeenCalled()
    expect(setLink).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's-new' }), {
      tracker: 'linear',
      key: 'TAV-33',
    })
  })
})

describe('StartWork — starting dismissed work', () => {
  it('brings a dismissed ticket back to In flight once it has started', async () => {
    useDismissedThreads.setState({ dismissed: { 'linear:TAV-33': 1, 'linear:TAV-99': 1 } })
    const onClose = await open()
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(Object.keys(useDismissedThreads.getState().dismissed)).toEqual(['linear:TAV-99'])
  })

  it('brings a dismissed branch back once a session started on it', async () => {
    useDismissedThreads.setState({ dismissed: { '/repo#main': 1 } })
    const onClose = await open()
    goToTab('Branch')
    await screen.findByRole('option', { name: /main/ })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useDismissedThreads.getState().dismissed).toEqual({})
  })

  it('leaves a dismissed ticket dismissed when starting it failed', async () => {
    useDismissedThreads.setState({ dismissed: { 'linear:TAV-33': 1 } })
    launched.createFromDraft.mockResolvedValue({ field: 'form', message: 'Worktree error: nope' })
    await open()
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(launched.createFromDraft).toHaveBeenCalled())
    expect(Object.keys(useDismissedThreads.getState().dismissed)).toEqual(['linear:TAV-33'])
  })
})

describe('StartWork — Enter on a ticket, run another way', () => {
  it('starts a plain terminal for Terminal only', async () => {
    await open()
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(launched.inBranch).toHaveBeenCalledWith('p-new', undefined))
    expect(setLink).toHaveBeenCalled()
  })

  it('moves the selection with the arrow keys before starting', async () => {
    await open()
    fireEvent.keyDown(searchBox(), { key: 'ArrowDown' })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(launched.createFromDraft).toHaveBeenCalled())
    expect(launched.createFromDraft.mock.calls[0][0].draft.newBranchName).toBe('tav-35-quick')
  })

  it('says why in plain words, and stays open, when the worktree is refused', async () => {
    launched.createFromDraft.mockResolvedValue({
      field: 'form',
      message: 'Worktree error: fatal: 128 raw git output',
    })
    const onClose = await open()
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/fatal|128/)
    expect(alert.textContent).toMatch(/tav-33-retry/)
    expect(onClose).not.toHaveBeenCalled()
    expect(launched.inBranch).not.toHaveBeenCalled()
  })
})

function registerFoundryOption(): void {
  useExtensionRegistry.getState().registerStartWorkOption({
    key: 'x:new-order',
    extensionId: 'x',
    label: 'Foundry order',
    description: "Shaped, planned and built by Foundry's line.",
    command: 'new-order',
  })
}

describe('StartWork — an extension option', () => {
  it('runs the command the extension declared for it', async () => {
    registerFoundryOption()
    useExtensionCommandsRegistered()
    const onClose = await open()
    for (let step = 0; step < 3; step++) fireEvent.keyDown(searchBox(), { key: 'Tab' })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(executeCommand).toHaveBeenCalledWith(
      'x.command.new-order',
      { projectId: null, sessionId: null, repoRoot: '/repo' },
      {
        tracker: 'linear',
        key: 'TAV-33',
        title: 'Retry rate-limited GitHub searches',
        repoRoot: '/repo',
      }
    )
    expect(launched.createFromDraft).not.toHaveBeenCalled()
  })
})

describe('StartWork — an extension option given a typed prompt', () => {
  it('passes the prompt and the repository', async () => {
    registerFoundryOption()
    useExtensionCommandsRegistered()
    const onClose = await open()
    goToTab('Prompt')
    useRepoFolder()
    fireEvent.change(searchBox(), { target: { value: 'fix the build' } })
    for (let step = 0; step < 3; step++) fireEvent.keyDown(searchBox(), { key: 'Tab' })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(executeCommand).toHaveBeenCalledWith('x.command.new-order', expect.anything(), {
      prompt: 'fix the build',
      repoRoot: '/repo',
    })
  })
})

describe('StartWork — an extension option whose command is not running', () => {
  it('says so in plain words and starts nothing', async () => {
    registerFoundryOption()
    const onClose = await open()
    for (let step = 0; step < 3; step++) fireEvent.keyDown(searchBox(), { key: 'Tab' })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Foundry order is not turned on, so it cannot take this.'
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalled()
  })
})

function useExtensionCommandsRegistered(): void {
  installElectronApi({
    git,
    agents: { list: agentsList },
    extension: {
      executeCommand,
      // As core answers: a command that takes args is in no quick-action list, only registered.
      getCommands: vi.fn(async () => ({ commands: [] })),
      hasCommand: vi.fn(async (key: string) => key === 'x.command.new-order'),
      list: vi.fn(async () => ({ extensions: [] })),
    },
  })
}

describe('StartWork — other tabs', () => {
  it('Prompt tab starts an agent tab with the typed prompt and links nothing', async () => {
    const onClose = await open()
    goToTab('Prompt')
    useRepoFolder()
    fireEvent.change(searchBox(), { target: { value: "fix the dev's build" } })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.agentInBranch).toHaveBeenCalledWith({
      projectId: 'p-main',
      title: 'Agent',
      prompt: "fix the dev's build",
      agentId: undefined,
    })
    expect(launched.createFromDraft).not.toHaveBeenCalled()
    expect(setLink).not.toHaveBeenCalled()
  })

  it('Prompt tab sends an agent tab a prompt of any length', async () => {
    const onClose = await open()
    goToTab('Prompt')
    useRepoFolder()
    fireEvent.change(searchBox(), { target: { value: 'x'.repeat(1200) } })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.agentInBranch).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'x'.repeat(1200) })
    )
  })
})

describe('StartWork — other tabs, Claude in a terminal', () => {
  it('Prompt tab types the command for Claude in a terminal', async () => {
    const onClose = await open()
    goToTab('Prompt')
    useRepoFolder()
    fireEvent.change(searchBox(), { target: { value: "fix the dev's build" } })
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.inBranch).toHaveBeenCalledWith('p-main', `claude 'fix the dev'\\''s build'`)
  })

  it('Prompt tab refuses a prompt too long to type for Claude in a terminal', async () => {
    await open()
    goToTab('Prompt')
    fireEvent.change(searchBox(), { target: { value: 'x'.repeat(1200) } })
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toMatch(/too long/i)
    expect(launched.inBranch).not.toHaveBeenCalled()
  })
})

describe('StartWork — other tabs, the agent picker', () => {
  it('passes the agent chosen in the picker to the agent tab', async () => {
    agentsList.mockResolvedValue({
      data: [
        { id: 'claude', label: 'Claude Code' },
        { id: 'opencode', label: 'OpenCode' },
      ],
    })
    const onClose = await open()
    goToTab('Prompt')
    fireEvent.change(searchBox(), { target: { value: 'fix it' } })
    fireEvent.change(await screen.findByRole('combobox', { name: 'Agent' }), {
      target: { value: 'opencode' },
    })
    expect(screen.getByRole('radio', { name: 'OpenCode in an agent tab' })).toBeTruthy()
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.agentInBranch).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'opencode', prompt: 'fix it' })
    )
  })

  it('shows no picker when only one agent exists', async () => {
    await open()
    expect(screen.queryByRole('combobox', { name: 'Agent' })).toBeNull()
  })
})

describe('StartWork — scratch and branch tabs', () => {
  it('Scratch terminal tab starts a scratch session', async () => {
    const onClose = await open()
    goToTab('Scratch terminal')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Scratch terminal' }), { key: 'Enter' })
    await waitFor(() => expect(launched.scratch).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalled()
    expect(launched.inBranch).not.toHaveBeenCalled()
  })
})

describe('StartWork — branch tab', () => {
  it('Branch tab lists the repo worktrees and starts a session on the chosen one', async () => {
    git.listWorktrees.mockResolvedValue({
      worktrees: [DEV_WORKTREE],
    })
    useWorkspaceStore.setState({
      projectsByWorkspaceId: new Map([
        [
          'ws-1',
          [mainProject, { ...mainProject, id: 'p-dev', gitBranch: 'dev', isWorktree: true }],
        ],
      ]),
    })
    const onClose = await open()
    goToTab('Branch')
    await screen.findByRole('option', { name: /dev/ })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.agentInBranch).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p-dev', prompt: null })
    )
  })
})

function seedTwoWorkspaces(): void {
  useWorkspaceStore.setState({ workspaces: [workspace, secondWorkspace] })
  git.isRepo.mockImplementation(async (path) => ({ isRepo: true, root: path }))
  git.listBranches.mockImplementation(async (root) => ({
    branches: [
      { name: root === '/atlas' ? 'atlas-main' : 'main', isCurrent: true, isRemote: false },
    ],
  }))
}

const pickerButton = () => screen.getByRole('button', { name: /^Workspace:/ })
const listbox = () => screen.getByRole('listbox', { name: 'Workspace' })

describe('StartWork — workspace picker', () => {
  beforeEach(seedTwoWorkspaces)

  it('shows the suggested workspace on the button', async () => {
    await open()
    expect(pickerButton().getAttribute('aria-label')).toBe('Workspace: terminator')
    expect(pickerButton().textContent).toMatch(/terminator/)
  })

  it('opens the workspace list on click and on Command R', async () => {
    await open()
    fireEvent.click(pickerButton())
    expect(listbox()).toBeTruthy()
    expect(pickerButton().getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(searchBox(), { key: 'r', metaKey: true })
    expect(screen.queryByRole('listbox', { name: 'Workspace' })).toBeNull()
    fireEvent.keyDown(searchBox(), { key: 'r', metaKey: true })
    expect(listbox()).toBeTruthy()
  })

  it('marks the current workspace and says the first one is suggested because it is open', async () => {
    await open()
    fireEvent.click(pickerButton())
    const options = within(listbox()).getAllByRole('option')
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(within(listbox()).getByText('/atlas')).toBeTruthy()
    expect(screen.getByText('suggested · open in the sidebar')).toBeTruthy()
  })
})

describe('StartWork — workspace picker, picking', () => {
  beforeEach(seedTwoWorkspaces)

  it('picking another workspace changes the button and the branches listed', async () => {
    await open()
    fireEvent.click(pickerButton())
    fireEvent.click(within(listbox()).getByRole('option', { name: /atlas/ }))
    expect(screen.queryByRole('listbox', { name: 'Workspace' })).toBeNull()
    expect(pickerButton().getAttribute('aria-label')).toBe('Workspace: atlas')
    goToTab('Branch')
    expect(await screen.findByRole('option', { name: /atlas-main/ })).toBeTruthy()
  })
})

describe('StartWork — workspace picker, the list', () => {
  beforeEach(seedTwoWorkspaces)

  it('closes only the list on Escape, and the launcher stays open', async () => {
    const onClose = await open()
    fireEvent.click(pickerButton())
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Filter workspaces' }), {
      key: 'Escape',
    })
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Workspace' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Start work' })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('StartWork — workspace picker, filtering', () => {
  beforeEach(seedTwoWorkspaces)

  it('filters by name as the person types', async () => {
    await open()
    fireEvent.click(pickerButton())
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter workspaces' }), {
      target: { value: 'atl' },
    })
    expect(
      within(listbox())
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual([expect.stringContaining('atlas')])
  })

  it('moves with the arrow keys and picks with Enter without starting work', async () => {
    await open()
    fireEvent.click(pickerButton())
    const filter = screen.getByRole('textbox', { name: 'Filter workspaces' })
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(pickerButton().getAttribute('aria-label')).toBe('Workspace: atlas')
    expect(launched.createFromDraft).not.toHaveBeenCalled()
  })
})

describe('StartWork — workspace picker, where it shows', () => {
  beforeEach(seedTwoWorkspaces)

  it('is not offered on the Scratch terminal tab', async () => {
    await open()
    goToTab('Scratch terminal')
    expect(screen.queryByRole('button', { name: /^Workspace:/ })).toBeNull()
  })

  it('names the team of a linked ticket as the reason', async () => {
    useWorkspaceStore.setState({
      activeWorkspaceId: 'ws-1',
      projectsByWorkspaceId: new Map([
        ['ws-1', [mainProject]],
        ['ws-2', [{ ...secondWorkspaceProject, updatedAt: '2026-10-01' }]],
      ]),
    })
    useIntegrationsStore.setState({
      links: new Map([['p-atlas', { tracker: 'linear', key: 'TAV-1' }]]),
    } as never)
    await open()
    expect(pickerButton().getAttribute('aria-label')).toBe('Workspace: atlas')
    fireEvent.click(pickerButton())
    expect(screen.getByText('suggested · TAV ticket linked here')).toBeTruthy()
  })
})

const secondWorkspaceProject: Project = {
  ...mainProject,
  id: 'p-atlas',
  workspaceId: 'ws-2',
  gitBranch: 'tav-1',
}

const typePrompt = (text: string) => {
  goToTab('Prompt')
  fireEvent.change(searchBox(), { target: { value: text } })
}

describe('StartWork — a prompt on a branch of its own', () => {
  it('runs an agent prompt in a new worktree on the branch the agent named', async () => {
    const onClose = await open()
    typePrompt("fix the dev's build")
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.createFromDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          newBranchName: 'fix/dev-build',
          worktreePath: '/repo/.worktrees/fix/dev-build',
        }),
      })
    )
    expect(launched.agentInBranch).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p-new', prompt: "fix the dev's build" })
    )
  })
})

describe('StartWork — a prompt on its own branch, failures', () => {
  it('falls back to prompt/ and the first four words when the agent fails', async () => {
    nameBranch.mockRejectedValue(new Error('no agent'))
    const onClose = await open()
    typePrompt("fix the dev's build")
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.createFromDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({ newBranchName: 'prompt/fix-the-dev-s' }),
      })
    )
  })
})

describe('StartWork — a prompt on its own branch, fallbacks', () => {
  it('falls back when the agent answers something that is not a branch name', async () => {
    nameBranch.mockResolvedValue({ text: 'Sure! Here you go' })
    const onClose = await open()
    typePrompt('tidy the readme')
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.createFromDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({ newBranchName: 'prompt/tidy-the-readme' }),
      })
    )
  })
})

describe('StartWork — the branch summary of a prompt', () => {
  it('shows the branch, who named it, and a new worktree', async () => {
    await open()
    typePrompt("fix the dev's build")
    const summary = screen.getByRole('group', { name: 'Where it runs' })
    expect(within(summary).getByText('a new worktree')).toBeTruthy()
    expect(within(summary).getByText('prompt/fix-the-dev-s')).toBeTruthy()
    expect(await within(summary).findByText(/fix\/dev-build/, {}, { timeout: 3000 })).toBeTruthy()
    expect(within(summary).getByText('named by Claude')).toBeTruthy()
  })

  it('keeps the repo folder, and asks for no name, when "Use the repo folder" is checked', async () => {
    await open()
    typePrompt('tidy the readme')
    useRepoFolder()
    const summary = screen.getByRole('group', { name: 'Where it runs' })
    expect(within(summary).getByText('the repo folder')).toBeTruthy()
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(launched.agentInBranch).toHaveBeenCalled())
    expect(nameBranch).not.toHaveBeenCalled()
    expect(launched.createFromDraft).not.toHaveBeenCalled()
  })

  it('offers no worktree for Terminal only', async () => {
    await open()
    typePrompt('tidy the readme')
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    expect(screen.queryByRole('checkbox', { name: 'Use the repo folder' })).toBeNull()
  })
})

describe('StartWork — When', () => {
  const choice = (name: string) => screen.getByRole('radio', { name })

  it('offers Now, Once and Repeat on a prompt, Now first', async () => {
    await open()
    typePrompt('tidy the readme')
    const group = screen.getByRole('radiogroup', { name: 'When' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent)
    ).toEqual(['Now', 'Once', 'Repeat'])
    expect(choice('Now').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByLabelText('Time')).toBeNull()
  })

  it('is not offered for a ticket', async () => {
    await open()
    expect(screen.queryByRole('radiogroup', { name: 'When' })).toBeNull()
  })
})

describe('StartWork — When, scheduling', () => {
  const choice = (name: string) => screen.getByRole('radio', { name })

  it('shows the time, the note and a Schedule button once it is not Now', async () => {
    await open()
    typePrompt('tidy the readme')
    expect(screen.getByRole('button', { name: /^Start/ })).toBeTruthy()
    fireEvent.click(choice('Repeat'))
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('09:00')
    expect(
      screen.getByText('Runs while Terminator is open. A missed run waits in Needs you.')
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Schedule/ })).toBeTruthy()
  })
})

describe('StartWork — When, saving', () => {
  const choice = (name: string) => screen.getByRole('radio', { name })

  it('saves a repeat schedule instead of starting, counts it, and closes', async () => {
    createSchedule.mockResolvedValue({ data: {} as never })
    const onClose = await open()
    typePrompt('tidy the readme')
    fireEvent.click(choice('Repeat'))
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '07:30' } })
    fireEvent.click(screen.getByRole('button', { name: /^Schedule/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(createSchedule).toHaveBeenCalledWith({
      repoRoot: '/repo',
      prompt: 'tidy the readme',
      runAs: 'agent',
      kind: 'repeat',
      repeat: { every: 1, unit: 'day', days: [], between: null, overlap: 'skip' },
      branch: 'fix/dev-build',
      time: '07:30',
      date: null,
      newWorktree: true,
      agentId: null,
    })
    expect(launched.agentInBranch).not.toHaveBeenCalled()
    expect(recordUse).toHaveBeenCalledWith('core.start-work.schedule', 'click', expect.anything())
  })
})

describe('StartWork — When, Once', () => {
  const choice = (name: string) => screen.getByRole('radio', { name })

  it('sends a date with Once, and shows a refusal in the dialog', async () => {
    createSchedule.mockResolvedValue({ error: 'failed', message: 'The date is in the past.' })
    const onClose = await open()
    typePrompt('tidy the readme')
    fireEvent.click(choice('Once'))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2030-01-02' } })
    fireEvent.click(screen.getByRole('button', { name: /^Schedule/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('The date is in the past.')
    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'once', date: '2030-01-02' })
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('StartWork — the Prompt tab', () => {
  it('has its own box and no field in the title bar', async () => {
    await open()
    goToTab('Prompt')
    expect(screen.queryByRole('textbox', { name: 'Search tickets or type a prompt' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'What should it do?' })).toBeTruthy()
  })

  it('Shift+Enter adds a line and Enter starts', async () => {
    const user = userEvent.setup()
    const onClose = await open()
    goToTab('Prompt')
    useRepoFolder()
    const box = screen.getByRole('textbox', { name: 'What should it do?' }) as HTMLTextAreaElement
    await user.type(box, 'tidy{Shift>}{Enter}{/Shift}readme')
    expect(box.value).toBe('tidy\nreadme')
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.agentInBranch).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'tidy\nreadme' })
    )
  })
})

describe('StartWork — My tickets with no match', () => {
  it('offers to write the text as a prompt and keeps it', async () => {
    await open()
    fireEvent.change(searchBox(), { target: { value: 'zzz no such ticket' } })
    fireEvent.click(screen.getByRole('button', { name: 'Write it as a prompt' }))
    const box = screen.getByRole('textbox', { name: 'What should it do?' }) as HTMLTextAreaElement
    expect(box.value).toBe('zzz no such ticket')
  })
})

describe('StartWork — When, Repeat', () => {
  const choice = (name: string) => screen.getByRole('radio', { name })

  it('shows three next times and how many runs a day', async () => {
    await open()
    typePrompt('tidy the readme')
    fireEvent.click(choice('Repeat'))
    fireEvent.click(screen.getByRole('button', { name: 'Every 30 min' }))
    const next = screen.getByText(/^Next: /).textContent ?? ''
    expect(next).toMatch(/^Next: .+ · \d+ runs a day$/)
    expect(
      next
        .replace(/^Next: /, '')
        .replace(/ · .*$/, '')
        .split(', ')
    ).toHaveLength(3)
  })
})

describe('StartWork — When, Repeat, saving', () => {
  const choice = (name: string) => screen.getByRole('radio', { name })

  it('saves Every 30 min with the default window and a toggled weekday', async () => {
    createSchedule.mockResolvedValue({ data: {} as never })
    const onClose = await open()
    typePrompt('tidy the readme')
    fireEvent.click(choice('Repeat'))
    fireEvent.click(screen.getByRole('button', { name: 'Every 30 min' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tue' }))
    expect(screen.getByRole('button', { name: 'Tue' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^Schedule/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'repeat',
        time: '09:00',
        repeat: {
          every: 30,
          unit: 'minute',
          days: [2],
          between: { from: '09:00', to: '18:00' },
          overlap: 'skip',
        },
      })
    )
  })
})

describe('StartWork — When, Repeat, warning', () => {
  const choice = (name: string) => screen.getByRole('radio', { name })

  it('warns when it runs more than every 5 minutes', async () => {
    await open()
    typePrompt('tidy the readme')
    fireEvent.click(choice('Repeat'))
    fireEvent.click(screen.getByRole('button', { name: 'Every 30 min' }))
    fireEvent.change(screen.getByLabelText('Every'), { target: { value: '2' } })
    expect(screen.getByText('Runs 288 times a day or more.')).toBeTruthy()
  })
})

describe('StartWork — When, Repeat window ends before it starts', () => {
  it('shows an error and disables Schedule', async () => {
    await open()
    typePrompt('tidy the readme')
    fireEvent.click(screen.getByRole('radio', { name: 'Repeat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Every 30 min' }))
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '08:00' } })
    expect(screen.getByText('The end time must be after the start time.')).toBeTruthy()
    const button = screen.getByRole('button', { name: /^Schedule/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})

describe('StartWork — When, Once in the past', () => {
  it('shows an error and disables Schedule', async () => {
    await open()
    typePrompt('tidy the readme')
    fireEvent.click(screen.getByRole('radio', { name: 'Once' }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } })
    expect(screen.getByText('That time has passed.')).toBeTruthy()
    const button = screen.getByRole('button', { name: /^Schedule/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
