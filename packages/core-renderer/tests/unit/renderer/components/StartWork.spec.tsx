import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import { StartWork } from '../../../../src/components/home/StartWork'
import { startingWhen, whenProblem } from '../../../../src/components/home/WhenChoices'
import { useIntegrationsStore } from '../../../../src/stores/integrations.store'
import { useSessionRecordsStore } from '../../../../src/stores/session-records.store'
import { useSessionStore } from '../../../../src/stores/session.store'
import { useExtensionRegistry } from '../../../../src/extensions/registry'
import { useWorkMarks } from '../../../../src/home/work-marks'
import { useWorkspaceStore } from '../../../../src/stores/workspace.store'
import { useStartWorkStore } from '../../../../src/components/home/start-work'
import type { Schedule } from '../../../../../core-shared/src/schemas/schedules.schema'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import type { ElectronAPI } from '../../../../../core-shared/src/electron-api/api-type'
import type {
  IssueSummary,
  Project,
  TerminalSession,
  Workspace,
} from '../../../../../core-shared/src/types/index'

const launched = vi.hoisted(() => ({
  inBranch: vi.fn(),
  agentInBranch: vi.fn(),
  scratch: vi.fn(),
  global: vi.fn(),
  createFromDraft: vi.fn(),
}))
vi.mock('../../../../src/terminal/start-session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startSessionInBranch: launched.inBranch,
  startAgentInBranch: launched.agentInBranch,
  startScratchSession: launched.scratch,
  startGlobalPrompt: launched.global,
}))
vi.mock('../../../../src/components/sidebar/create-project', async (importOriginal) => ({
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
const updateSchedule = vi.fn<ElectronAPI['schedules']['update']>()

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
    schedules: {
      create: createSchedule,
      update: updateSchedule,
      list: async () => ({ data: [] }),
    },
    extension: {
      executeCommand,
      getCommands: vi.fn(async () => ({ commands: [] })),
      hasCommand: vi.fn(async () => false),
      list: vi.fn(async () => ({ extensions: [] })),
    },
  })
  stubStarts()
  seedStartWorkStores()
  useStartWorkStore.getState().closeLauncher()
})

/** Every start succeeds, the agent names fix/dev-build, and the launcher opens blank. */
function stubStarts(): void {
  nameBranch.mockResolvedValue({ text: 'fix/dev-build' })
  launched.inBranch.mockResolvedValue('s-new')
  launched.agentInBranch.mockResolvedValue('s-new')
  launched.createFromDraft.mockResolvedValue('p-new')
  launched.global.mockResolvedValue('g-1')
  useStartWorkStore.setState({ prefill: '', editing: null })
}

/** The field the person types in: the search row, or the Prompt tab's own box. */
const searchBox = () =>
  screen.getByRole('textbox', { name: /^(Search tickets or type a prompt|What should it do\?)$/ })
const open = async (onClose = vi.fn()) => {
  render(<StartWork onClose={onClose} />)
  await screen.findByText('TAV-33')
  return onClose
}
const goToTab = (user: UserEvent, name: string) => user.click(screen.getByRole('tab', { name }))
const useRepoFolder = (user: UserEvent) =>
  user.click(screen.getByRole('checkbox', { name: 'Use the repo folder' }))
/** Puts the cursor in the field the person types in, checks it is there, and presses `keys`. */
const pressInBox = async (user: UserEvent, keys: string) => {
  await user.click(searchBox())
  expect(searchBox().matches(':focus')).toBe(true)
  await user.keyboard(keys)
}
/** Replaces what a date or time field holds, as the person does by typing over it. */
const setField = async (user: UserEvent, label: string, value: string) => {
  await user.clear(screen.getByLabelText(label))
  await user.type(screen.getByLabelText(label), value)
}
/** Pastes `text` into `field`: typing a long prompt key by key adds nothing to the test. */
const pasteInto = async (user: UserEvent, field: HTMLElement, text: string) => {
  await user.click(field)
  await user.paste(text)
}
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
vi.mock('../../../../src/usage/record', () => ({ recordUse }))

describe('StartWork — my tickets', () => {
  it('groups tickets by state type, in progress first, and names each group', async () => {
    await open()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((n) => n.textContent)
    expect(headings).toEqual(['In progress', 'Todo', 'Backlog', 'Triage'])
    expect(rowKeys()).toEqual(['TAV-33', 'TAV-35', 'TAV-36', 'TAV-40'])
  })

  it('shows each ticket with its title and its state chip', async () => {
    await open()
    const row = screen.getByRole('option', { name: /TAV-33/ })
    expect(within(row).getByText('Retry rate-limited GitHub searches')).toBeTruthy()
    expect(within(row).getByText('started')).toBeTruthy()
  })

  it('filters by key', async () => {
    const user = userEvent.setup()
    await open()
    await user.type(searchBox(), 'tav-35')
    expect(rowKeys()).toEqual(['TAV-35'])
  })

  it('filters by title and offers what was typed as a prompt', async () => {
    const user = userEvent.setup()
    await open()
    await user.type(searchBox(), 'tunnel')
    expect(rowKeys()).toEqual(['TAV-36'])
    expect(screen.getByRole('heading', { name: 'Or start from what you typed' })).toBeTruthy()
    expect(screen.getByText(/"tunnel" as a new agent task, no ticket/)).toBeTruthy()
  })
})

describe('StartWork — opening and closing', () => {
  it('puts the cursor in the search box when it opens', async () => {
    await open()
    expect(searchBox().matches(':focus')).toBe(true)
  })

  it('closes on Escape', async () => {
    const onClose = await open()
    await userEvent.setup().keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('StartWork — run it as', () => {
  const checked = () => screen.getByRole('radio', { checked: true }).getAttribute('aria-label')

  it('offers the agent tab, Claude in a terminal and Terminal only when no extension adds one', async () => {
    const user = userEvent.setup()
    await open()
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Claude Code in an agent tab',
      'Claude in a terminal',
      'Terminal only',
    ])
    expect(document.body.textContent).not.toMatch(/Foundry/)
    await pressInBox(user, '{Tab}{Tab}{Tab}')
    expect(checked()).toBe('Claude Code in an agent tab')
  })
})

describe('StartWork — run it as, with the arrow keys', () => {
  it('is chosen with the arrow keys alone', async () => {
    const user = userEvent.setup()
    await open()
    await goToTab(user, 'Prompt')
    const choices = screen.getByRole('radiogroup', { name: 'Run it as' })
    const [first, second] = within(choices).getAllByRole('radio')
    const runAs = () =>
      within(choices).getByRole('radio', { checked: true }).getAttribute('aria-label')
    act(() => first.focus())
    expect(first.matches(':focus')).toBe(true)
    expect(runAs()).toBe('Claude Code in an agent tab')

    await user.keyboard('{ArrowDown}')
    expect(runAs()).toBe('Claude in a terminal')
    expect(second.matches(':focus')).toBe(true)

    await user.keyboard('{ArrowUp}')
    expect(runAs()).toBe('Claude Code in an agent tab')
  })
})

describe('StartWork — run it as, with an extension option', () => {
  const checked = () => screen.getByRole('radio', { checked: true }).getAttribute('aria-label')

  it('lists what an extension declared after the two built-in ones, and Tab reaches it', async () => {
    const user = userEvent.setup()
    registerFoundryOption()
    await open()
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Claude Code in an agent tab',
      'Claude in a terminal',
      'Terminal only',
      'Foundry order',
    ])
    await pressInBox(user, '{Tab}{Tab}{Tab}')
    expect(checked()).toBe('Foundry order')
    await pressInBox(user, '{Tab}')
    expect(checked()).toBe('Claude Code in an agent tab')
  })

  it('summarises the branch and worktree of the selected ticket', async () => {
    await open()
    const summary = screen.getByRole('group', { name: 'Where it runs' })
    expect(await within(summary).findByText('main')).toBeTruthy()
    expect(within(summary).getByText('tav-33-retry')).toBeTruthy()
    expect(within(summary).getByText('.worktrees/tav-33-retry')).toBeTruthy()
  })
})

/** The worktree Enter on TAV-33 asks for: a new branch named after the ticket. */
const TAV_33_WORKTREE = {
  workspaceId: 'ws-1',
  gitRoot: '/repo',
  draft: expect.objectContaining({
    branchMode: 'worktree',
    newBranchName: 'tav-33-retry',
    worktreeIsNewBranch: true,
    worktreePath: '/repo/.worktrees/tav-33-retry',
  }),
}

describe('StartWork — Enter on a ticket', () => {
  it('creates the worktree on the ticket branch, starts Claude in it and links the ticket', async () => {
    const user = userEvent.setup()
    const onClose = await open()
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.createFromDraft).toHaveBeenCalledWith(expect.objectContaining(TAV_33_WORKTREE))
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
    const user = userEvent.setup()
    useWorkMarks.setState({ settled: { 'linear:TAV-33': 1, 'linear:TAV-99': 1 } })
    const onClose = await open()
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(Object.keys(useWorkMarks.getState().settled)).toEqual(['linear:TAV-99'])
  })

  it('brings a dismissed branch back once a session started on it', async () => {
    const user = userEvent.setup()
    useWorkMarks.setState({ settled: { '/repo#main': 1 } })
    const onClose = await open()
    await goToTab(user, 'Branch')
    await screen.findByRole('option', { name: /main/ })
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useWorkMarks.getState().settled).toEqual({})
  })

  it('leaves a dismissed ticket dismissed when starting it failed', async () => {
    const user = userEvent.setup()
    useWorkMarks.setState({ settled: { 'linear:TAV-33': 1 } })
    launched.createFromDraft.mockResolvedValue({ field: 'form', message: 'Worktree error: nope' })
    await open()
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(launched.createFromDraft).toHaveBeenCalled())
    expect(Object.keys(useWorkMarks.getState().settled)).toEqual(['linear:TAV-33'])
  })
})

describe('StartWork — Enter on a ticket, run another way', () => {
  it('starts a plain terminal for Terminal only', async () => {
    const user = userEvent.setup()
    await open()
    await pressInBox(user, '{Tab}{Tab}')
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(launched.inBranch).toHaveBeenCalledWith('p-new', undefined, false))
    expect(setLink).toHaveBeenCalled()
  })

  it('moves the selection with the arrow keys before starting', async () => {
    const user = userEvent.setup()
    await open()
    await pressInBox(user, '{ArrowDown}')
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(launched.createFromDraft).toHaveBeenCalled())
    expect(launched.createFromDraft.mock.calls[0][0].draft.newBranchName).toBe('tav-35-quick')
  })
})

describe('StartWork — Enter on a ticket, run another way — a refused worktree', () => {
  it('says why in plain words, and stays open, when the worktree is refused', async () => {
    const user = userEvent.setup()
    launched.createFromDraft.mockResolvedValue({
      field: 'form',
      message: 'Worktree error: fatal: 128 raw git output',
    })
    const onClose = await open()
    await pressInBox(user, '{Enter}')
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
    const user = userEvent.setup()
    registerFoundryOption()
    useExtensionCommandsRegistered()
    const onClose = await open()
    await pressInBox(user, '{Tab}{Tab}{Tab}')
    await pressInBox(user, '{Enter}')
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
    const user = userEvent.setup()
    registerFoundryOption()
    useExtensionCommandsRegistered()
    const onClose = await open()
    await goToTab(user, 'Prompt')
    await useRepoFolder(user)
    await user.type(searchBox(), 'fix the build')
    await pressInBox(user, '{Tab}{Tab}{Tab}')
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(executeCommand).toHaveBeenCalledWith('x.command.new-order', expect.anything(), {
      prompt: 'fix the build',
      repoRoot: '/repo',
    })
  })
})

describe('StartWork — an extension option whose command is not running', () => {
  it('says so in plain words and starts nothing', async () => {
    const user = userEvent.setup()
    registerFoundryOption()
    const onClose = await open()
    await pressInBox(user, '{Tab}{Tab}{Tab}')
    await pressInBox(user, '{Enter}')
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
    schedules: { create: createSchedule, list: async () => ({ data: [] }) },
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
    const user = userEvent.setup()
    const onClose = await open()
    await goToTab(user, 'Prompt')
    await useRepoFolder(user)
    await user.type(searchBox(), "fix the dev's build")
    await pressInBox(user, '{Enter}')
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
})

describe('StartWork — other tabs — a long prompt', () => {
  it('Prompt tab sends an agent tab a prompt of any length', async () => {
    const user = userEvent.setup()
    const onClose = await open()
    await goToTab(user, 'Prompt')
    await useRepoFolder(user)
    await pasteInto(user, searchBox(), 'x'.repeat(1200))
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.agentInBranch).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'x'.repeat(1200) })
    )
  })
})

describe('StartWork — other tabs, Claude in a terminal', () => {
  it('Prompt tab types the command for Claude in a terminal', async () => {
    const user = userEvent.setup()
    const onClose = await open()
    await goToTab(user, 'Prompt')
    await useRepoFolder(user)
    await user.type(searchBox(), "fix the dev's build")
    await pressInBox(user, '{Tab}')
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.inBranch).toHaveBeenCalledWith(
      'p-main',
      `claude 'fix the dev'\\''s build'`,
      false
    )
  })

  it('Prompt tab refuses a prompt too long to type for Claude in a terminal', async () => {
    const user = userEvent.setup()
    await open()
    await goToTab(user, 'Prompt')
    await pasteInto(user, searchBox(), 'x'.repeat(1200))
    await pressInBox(user, '{Tab}')
    await pressInBox(user, '{Enter}')
    expect((await screen.findByRole('alert')).textContent).toMatch(/too long/i)
    expect(launched.inBranch).not.toHaveBeenCalled()
  })
})

describe('StartWork — other tabs, the agent picker', () => {
  it('passes the agent chosen in the picker to the agent tab', async () => {
    const user = userEvent.setup()
    agentsList.mockResolvedValue({
      data: [
        { id: 'claude', label: 'Claude Code' },
        { id: 'opencode', label: 'OpenCode' },
      ],
    })
    const onClose = await open()
    await goToTab(user, 'Prompt')
    await user.type(searchBox(), 'fix it')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Agent' }), 'opencode')
    expect(screen.getByRole('radio', { name: 'OpenCode in an agent tab' })).toBeTruthy()
    await pressInBox(user, '{Enter}')
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
    const user = userEvent.setup()
    const onClose = await open()
    await goToTab(user, 'Scratch terminal')
    expect(screen.getByRole('tab', { name: 'Scratch terminal' }).matches(':focus')).toBe(true)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(launched.scratch).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalled()
    expect(launched.inBranch).not.toHaveBeenCalled()
  })
})

describe('StartWork — terminal tab', () => {
  it('opens a plain shell in the chosen workspace, with no ticket, prompt or new worktree', async () => {
    const user = userEvent.setup()
    const onClose = await open()
    await goToTab(user, 'Terminal')
    expect(screen.getByRole('button', { name: 'Workspace: terminator' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^Open terminal/ }))
    await waitFor(() => expect(launched.inBranch).toHaveBeenCalledWith('p-main', undefined, false))
    expect(onClose).toHaveBeenCalled()
    expect(launched.createFromDraft).not.toHaveBeenCalled()
    expect(launched.scratch).not.toHaveBeenCalled()
    expect(setLink).not.toHaveBeenCalled()
  })

  it('opens it in another workspace when one is picked', async () => {
    const user = userEvent.setup()
    seedTwoWorkspaces()
    useWorkspaceStore.setState({
      projectsByWorkspaceId: new Map([
        ['ws-1', [mainProject]],
        ['ws-2', [secondWorkspaceProject]],
      ]),
    })
    await open()
    await goToTab(user, 'Terminal')
    await user.click(pickerButton())
    await user.click(within(listbox()).getByRole('option', { name: /atlas/ }))
    await user.click(screen.getByRole('button', { name: /^Open terminal/ }))
    await waitFor(() => expect(launched.inBranch).toHaveBeenCalledWith('p-atlas', undefined, false))
  })
})

describe('StartWork — terminal tab, when it cannot open', () => {
  it('stays open and says why when the shell does not start', async () => {
    const user = userEvent.setup()
    launched.inBranch.mockResolvedValue(null)
    const onClose = await open()
    await goToTab(user, 'Terminal')
    await user.click(screen.getByRole('button', { name: /^Open terminal/ }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The terminal could not be opened.'
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('asks for a workspace first when there is none', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ workspaces: [], projectsByWorkspaceId: new Map() })
    const onClose = await open()
    await goToTab(user, 'Terminal')
    await user.click(screen.getByRole('button', { name: /^Open terminal/ }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Add a workspace in the sidebar first.'
    )
    expect(launched.inBranch).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('StartWork — branch tab', () => {
  it('Branch tab lists the repo worktrees and starts a session on the chosen one', async () => {
    const user = userEvent.setup()
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
    await goToTab(user, 'Branch')
    await screen.findByRole('option', { name: /dev/ })
    await pressInBox(user, '{Enter}')
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
    const user = userEvent.setup()
    await open()
    await user.click(pickerButton())
    expect(listbox()).toBeTruthy()
    expect(pickerButton().getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Meta>}r{/Meta}')
    expect(screen.queryByRole('listbox', { name: 'Workspace' })).toBeNull()
    await user.keyboard('{Meta>}r{/Meta}')
    expect(listbox()).toBeTruthy()
  })

  it('marks the current workspace and says the first one is suggested because it is open', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(pickerButton())
    const options = within(listbox()).getAllByRole('option')
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(within(listbox()).getByText('/atlas')).toBeTruthy()
    expect(screen.getByText('suggested · open in the sidebar')).toBeTruthy()
  })
})

describe('StartWork — workspace picker, picking', () => {
  beforeEach(seedTwoWorkspaces)

  it('picking another workspace changes the button and the branches listed', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(pickerButton())
    await user.click(within(listbox()).getByRole('option', { name: /atlas/ }))
    expect(screen.queryByRole('listbox', { name: 'Workspace' })).toBeNull()
    expect(pickerButton().getAttribute('aria-label')).toBe('Workspace: atlas')
    await goToTab(user, 'Branch')
    expect(await screen.findByRole('option', { name: /atlas-main/ })).toBeTruthy()
  })
})

describe('StartWork — workspace picker, the list', () => {
  beforeEach(seedTwoWorkspaces)

  it('closes only the list on Escape, and the launcher stays open', async () => {
    const user = userEvent.setup()
    const onClose = await open()
    await user.click(pickerButton())
    expect(screen.getByRole('textbox', { name: 'Filter workspaces' }).matches(':focus')).toBe(true)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Workspace' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Start work' })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('StartWork — workspace picker, filtering', () => {
  beforeEach(seedTwoWorkspaces)

  it('filters by name as the person types', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(pickerButton())
    await user.type(screen.getByRole('textbox', { name: 'Filter workspaces' }), 'atl')
    expect(
      within(listbox())
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual([expect.stringContaining('atlas')])
  })

  it('moves with the arrow keys and picks with Enter without starting work', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(pickerButton())
    const filter = screen.getByRole('textbox', { name: 'Filter workspaces' })
    expect(filter.matches(':focus')).toBe(true)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(pickerButton().getAttribute('aria-label')).toBe('Workspace: atlas')
    expect(launched.createFromDraft).not.toHaveBeenCalled()
  })
})

describe('StartWork — workspace picker, where it shows', () => {
  beforeEach(seedTwoWorkspaces)

  it('is not offered on the Scratch terminal tab', async () => {
    const user = userEvent.setup()
    await open()
    await goToTab(user, 'Scratch terminal')
    expect(screen.queryByRole('button', { name: /^Workspace:/ })).toBeNull()
  })

  it('names the team of a linked ticket as the reason', async () => {
    const user = userEvent.setup()
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
    await user.click(pickerButton())
    expect(screen.getByText('suggested · TAV ticket linked here')).toBeTruthy()
  })
})

const secondWorkspaceProject: Project = {
  ...mainProject,
  id: 'p-atlas',
  workspaceId: 'ws-2',
  gitBranch: 'tav-1',
}

const typePrompt = async (user: UserEvent, text: string) => {
  await goToTab(user, 'Prompt')
  await pasteInto(user, searchBox(), text)
}

describe('StartWork — a prompt on a branch of its own', () => {
  it('runs an agent prompt in a new worktree on the branch the agent named', async () => {
    const user = userEvent.setup()
    const onClose = await open()
    await typePrompt(user, "fix the dev's build")
    await pressInBox(user, '{Enter}')
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
    const user = userEvent.setup()
    nameBranch.mockRejectedValue(new Error('no agent'))
    const onClose = await open()
    await typePrompt(user, "fix the dev's build")
    await pressInBox(user, '{Enter}')
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
    const user = userEvent.setup()
    nameBranch.mockResolvedValue({ text: 'Sure! Here you go' })
    const onClose = await open()
    await typePrompt(user, 'tidy the readme')
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.createFromDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({ newBranchName: 'prompt/tidy-the-readme' }),
      })
    )
  })
})

describe('StartWork — the branch summary of a prompt', () => {
  afterEach(() => void vi.useRealTimers())

  it('shows the branch, who named it, and a new worktree', async () => {
    const user = userEvent.setup()
    await open()
    await goToTab(user, 'Prompt')
    await user.click(searchBox())
    // Testing Library's own waits need the clock to move; the 800 ms naming pause is jumped below.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    await user.paste("fix the dev's build")
    const summary = screen.getByRole('group', { name: 'Where it runs' })
    expect(within(summary).getByText('a new worktree')).toBeTruthy()
    expect(within(summary).getByText('prompt/fix-the-dev-s')).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(800))
    expect(within(summary).getByText(/fix\/dev-build/)).toBeTruthy()
    expect(within(summary).getByText('named by Claude')).toBeTruthy()
  })
})

describe('StartWork — the branch summary of a prompt — the repo folder', () => {
  it('keeps the repo folder, and asks for no name, when "Use the repo folder" is checked', async () => {
    const user = userEvent.setup()
    await open()
    await typePrompt(user, 'tidy the readme')
    await useRepoFolder(user)
    const summary = screen.getByRole('group', { name: 'Where it runs' })
    expect(within(summary).getByText('the repo folder')).toBeTruthy()
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(launched.agentInBranch).toHaveBeenCalled())
    expect(nameBranch).not.toHaveBeenCalled()
    expect(launched.createFromDraft).not.toHaveBeenCalled()
  })

  it('offers no worktree for Terminal only', async () => {
    const user = userEvent.setup()
    await open()
    await typePrompt(user, 'tidy the readme')
    await pressInBox(user, '{Tab}{Tab}')
    expect(screen.queryByRole('checkbox', { name: 'Use the repo folder' })).toBeNull()
  })
})

describe('StartWork — When', () => {
  const choice = (name: string) => screen.getByRole('radio', { name })

  it('offers Now, Once and Repeat on a prompt, Now first', async () => {
    const user = userEvent.setup()
    await open()
    await typePrompt(user, 'tidy the readme')
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
    const user = userEvent.setup()
    await open()
    await typePrompt(user, 'tidy the readme')
    expect(screen.getByRole('button', { name: /^Start/ })).toBeTruthy()
    await user.click(choice('Repeat'))
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
    const user = userEvent.setup()
    createSchedule.mockResolvedValue({ data: {} as never })
    const onClose = await open()
    await typePrompt(user, 'tidy the readme')
    await user.click(choice('Repeat'))
    await setField(user, 'Time', '07:30')
    await user.click(screen.getByRole('button', { name: /^Schedule/ }))
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
    const user = userEvent.setup()
    createSchedule.mockResolvedValue({ error: 'failed', message: 'The date is in the past.' })
    const onClose = await open()
    await typePrompt(user, 'tidy the readme')
    await user.click(choice('Once'))
    await setField(user, 'Date', '2030-01-02')
    await user.click(screen.getByRole('button', { name: /^Schedule/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('The date is in the past.')
    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'once', date: '2030-01-02' })
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('StartWork — the Prompt tab', () => {
  it('has its own box and no field in the title bar', async () => {
    const user = userEvent.setup()
    await open()
    await goToTab(user, 'Prompt')
    expect(screen.queryByRole('textbox', { name: 'Search tickets or type a prompt' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'What should it do?' })).toBeTruthy()
  })

  it('Shift+Enter adds a line and Enter starts', async () => {
    const user = userEvent.setup()
    const onClose = await open()
    await goToTab(user, 'Prompt')
    await useRepoFolder(user)
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
    const user = userEvent.setup()
    await open()
    await user.type(searchBox(), 'zzz no such ticket')
    await user.click(screen.getByRole('button', { name: 'Write it as a prompt' }))
    const box = screen.getByRole('textbox', { name: 'What should it do?' }) as HTMLTextAreaElement
    expect(box.value).toBe('zzz no such ticket')
  })
})

describe('StartWork — When, Repeat', () => {
  const choice = (name: string) => screen.getByRole('radio', { name })

  it('shows three next times and how many runs a day', async () => {
    const user = userEvent.setup()
    await open()
    await typePrompt(user, 'tidy the readme')
    await user.click(choice('Repeat'))
    await user.click(screen.getByRole('button', { name: 'Every 30 min' }))
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
    const user = userEvent.setup()
    createSchedule.mockResolvedValue({ data: {} as never })
    const onClose = await open()
    await typePrompt(user, 'tidy the readme')
    await user.click(choice('Repeat'))
    await user.click(screen.getByRole('button', { name: 'Every 30 min' }))
    await user.click(screen.getByRole('button', { name: 'Tue' }))
    expect(screen.getByRole('button', { name: 'Tue' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: /^Schedule/ }))
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
    const user = userEvent.setup()
    await open()
    await typePrompt(user, 'tidy the readme')
    await user.click(choice('Repeat'))
    await user.click(screen.getByRole('button', { name: 'Every 30 min' }))
    await user.tripleClick(screen.getByLabelText('Every'))
    await user.keyboard('2')
    expect(screen.getByText('Runs 288 times a day or more.')).toBeTruthy()
  })
})

describe('StartWork — When, a time that cannot run', () => {
  it.each([
    [
      'a Repeat window that ends before it starts',
      async (user: UserEvent) => {
        await user.click(screen.getByRole('radio', { name: 'Repeat' }))
        await user.click(screen.getByRole('button', { name: 'Every 30 min' }))
        await setField(user, 'To', '08:00')
      },
      'The end time must be after the start time.',
    ],
    [
      'Once in the past',
      async (user: UserEvent) => {
        await user.click(screen.getByRole('radio', { name: 'Once' }))
        await setField(user, 'Date', '2020-01-01')
      },
      'That time has passed.',
    ],
  ])('shows an error and disables Schedule for %s', async (_case, chooseWhen, error) => {
    const user = userEvent.setup()
    await open()
    await typePrompt(user, 'tidy the readme')
    await chooseWhen(user)
    expect(screen.getByText(error)).toBeTruthy()
    const button = screen.getByRole('button', { name: /^Schedule/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})

describe('StartWork — Once after a clock repeat', () => {
  it('saves the time shown, not the repeat window start', async () => {
    const user = userEvent.setup()
    createSchedule.mockResolvedValue({ data: {} as never })
    await open()
    await typePrompt(user, 'cut the release notes')
    await user.click(screen.getByRole('radio', { name: 'Repeat' }))
    await user.click(screen.getByRole('button', { name: 'Every 30 min' }))
    await user.click(screen.getByRole('radio', { name: 'Once' }))
    await setField(user, 'Date', '2099-01-01')
    await setField(user, 'Time', '17:00')
    await user.click(screen.getByRole('button', { name: /^Schedule/ }))
    await waitFor(() => expect(createSchedule).toHaveBeenCalled())
    expect(createSchedule.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'once', time: '17:00' })
  })
})

describe('StartWork — keys on a focused control', () => {
  it('Enter on a preset presses it and saves nothing', async () => {
    const user = userEvent.setup()
    const onClose = await open()
    await typePrompt(user, 'tidy the readme')
    await user.click(screen.getByRole('radio', { name: 'Repeat' }))
    screen.getByRole('button', { name: 'Hourly' }).focus()
    await user.keyboard('{Enter}')
    expect((screen.getByRole('combobox', { name: 'Unit' }) as HTMLSelectElement).value).toBe('hour')
    expect(createSchedule).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Enter in the prompt box does not save a schedule Schedule refuses', async () => {
    const user = userEvent.setup()
    await open()
    await typePrompt(user, 'tidy the readme')
    await user.click(screen.getByRole('radio', { name: 'Once' }))
    await setField(user, 'Date', '2020-01-01')
    await pressInBox(user, '{Enter}')
    expect(createSchedule).not.toHaveBeenCalled()
  })
})

describe('whenProblem — a repeat that never runs', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 4, 10, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('says so, so it cannot be saved', () => {
    const notToday = (new Date().getDay() + 1) % 7
    const value = { ...startingWhen('2099-01-01'), when: 'repeat' as const }
    const rule = { ...value.rule, every: 7, unit: 'day' as const, days: [notToday], between: null }
    expect(whenProblem({ ...value, rule })).toBe('This repeat never runs.')
  })
})

describe('StartWork — an extension option on a repeat', () => {
  it('is refused: each run would start a new order', async () => {
    const user = userEvent.setup()
    registerFoundryOption()
    useExtensionCommandsRegistered()
    await open()
    await goToTab(user, 'Prompt')
    await user.type(searchBox(), 'fix the build')
    await pressInBox(user, '{Tab}{Tab}{Tab}')
    await user.click(screen.getByRole('radio', { name: 'Repeat' }))
    expect(screen.getByText('Foundry order cannot repeat. Pick Once or Now.')).toBeTruthy()
    const button = screen.getByRole('button', { name: /^Schedule/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})

const runAsNames = () =>
  within(screen.getByRole('radiogroup', { name: 'Run it as' }))
    .getAllByRole('radio')
    .map((r) => r.getAttribute('aria-label'))
const pickGlobal = async (user: UserEvent) => {
  await user.click(pickerButton())
  await user.click(within(listbox()).getByRole('option', { name: /Global/ }))
}

describe('StartWork — Global in the workspace picker', () => {
  beforeEach(seedTwoWorkspaces)

  it('offers Global first on the Prompt tab, with where it runs', async () => {
    const user = userEvent.setup()
    await open()
    await goToTab(user, 'Prompt')
    await user.click(pickerButton())
    const options = within(listbox()).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^Globalno workspace~ · shows in Scratch$/),
      expect.stringContaining('terminator'),
      expect.stringContaining('atlas'),
    ])
  })

  it('does not offer Global on My tickets', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(pickerButton())
    expect(within(listbox()).queryByRole('option', { name: /Global/ })).toBeNull()
  })
})

describe('StartWork — Global in the workspace picker — filtering', () => {
  beforeEach(seedTwoWorkspaces)

  it('filters Global out with the workspaces, and picks it with Enter', async () => {
    const user = userEvent.setup()
    await open()
    await goToTab(user, 'Prompt')
    await user.click(pickerButton())
    const filter = screen.getByRole('textbox', { name: 'Filter workspaces' })
    await user.type(filter, 'atl')
    expect(within(listbox()).queryByRole('option', { name: /Global/ })).toBeNull()
    await user.clear(filter)
    await user.type(filter, 'glo{Enter}')
    expect(pickerButton().getAttribute('aria-label')).toBe('Workspace: Global')
  })
})

describe('StartWork — Global chosen', () => {
  beforeEach(seedTwoWorkspaces)

  it('runs only as the agent tab or Claude in a terminal, and says where it runs', async () => {
    const user = userEvent.setup()
    await open()
    await typePrompt(user, 'sum up the PRs')
    await user.click(screen.getByRole('radio', { name: 'Terminal only' }))
    await pickGlobal(user)
    expect(pickerButton().textContent).toMatch(/Global/)
    expect(runAsNames()).toEqual(['Claude Code in an agent tab', 'Claude in a terminal'])
    expect(screen.getByRole('radio', { checked: true, name: /agent tab/ })).toBeTruthy()
    const where = screen.getByRole('group', { name: 'Where it runs' })
    expect(where.textContent).toBe('Runs in~ (your home folder)Shows inScratch')
    expect(screen.queryByRole('checkbox', { name: 'Use the repo folder' })).toBeNull()
  })

  it('goes back to the suggested workspace on another tab', async () => {
    const user = userEvent.setup()
    await open()
    await goToTab(user, 'Prompt')
    await pickGlobal(user)
    await goToTab(user, 'My tickets')
    expect(pickerButton().getAttribute('aria-label')).toBe('Workspace: terminator')
  })
})

describe('StartWork — Global, starting', () => {
  beforeEach(seedTwoWorkspaces)

  it('starts the prompt in Scratch on Enter with When Now, and closes', async () => {
    const user = userEvent.setup()
    const onClose = await open()
    await typePrompt(user, 'sum up the PRs')
    await pickGlobal(user)
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.global).toHaveBeenCalledWith({ text: 'sum up the PRs', runAs: 'agent' })
    expect(launched.agentInBranch).not.toHaveBeenCalled()
  })

  it('says why when it does not start', async () => {
    const user = userEvent.setup()
    launched.global.mockResolvedValue(null)
    const onClose = await open()
    await typePrompt(user, 'x'.repeat(2000))
    await pickGlobal(user)
    await user.click(screen.getByRole('radio', { name: 'Claude in a terminal' }))
    await pressInBox(user, '{Enter}')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That prompt is too long to start an agent with. Shorten it.'
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('StartWork — Global, scheduling', () => {
  beforeEach(seedTwoWorkspaces)

  it('saves with no workspace, no branch and no worktree', async () => {
    const user = userEvent.setup()
    createSchedule.mockResolvedValue({ data: {} as never })
    const onClose = await open()
    await typePrompt(user, 'sum up the PRs')
    await pickGlobal(user)
    await user.click(screen.getByRole('radio', { name: 'Repeat' }))
    await user.click(screen.getByRole('button', { name: /^Schedule/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ repoRoot: null, branch: null, newWorktree: false, runAs: 'agent' })
    )
    expect(nameBranch).not.toHaveBeenCalled()
  })
})

const savedRun: Schedule = {
  id: 'sch-1',
  repoRoot: '/repo',
  prompt: 'Triage new Sentry errors',
  runAs: 'agent',
  kind: 'repeat',
  repeat: { every: 1, unit: 'day', days: [1, 2, 3, 4, 5], between: null, overlap: 'skip' },
  branch: 'feat/triage',
  time: '09:00',
  date: null,
  newWorktree: true,
  agentId: null,
  lastRunAt: null,
  createdAt: '2026-11-04T10:00:00',
  paused: false,
}

const openEditing = async (editing: Schedule, onClose = vi.fn()) => {
  useStartWorkStore.getState().openLauncher('', editing)
  render(<StartWork onClose={onClose} />)
  await screen.findByRole('heading', { name: 'Edit scheduled run' })
  return onClose
}
const whenNames = () =>
  within(screen.getByRole('radiogroup', { name: 'When' }))
    .getAllByRole('radio')
    .map((r) => r.textContent)

describe('useStartWorkStore — editing', () => {
  it('opens with the schedule to edit and forgets it on close', () => {
    useStartWorkStore.getState().openLauncher('', savedRun)
    expect(useStartWorkStore.getState()).toMatchObject({ open: true, editing: savedRun })
    useStartWorkStore.getState().closeLauncher()
    expect(useStartWorkStore.getState()).toMatchObject({ open: false, editing: null })
  })
})

describe('StartWork — a new scheduled run', () => {
  beforeEach(seedTwoWorkspaces)

  it('opens on the Prompt tab with When set to Repeat', async () => {
    useStartWorkStore.getState().openScheduledRun()
    render(<StartWork onClose={vi.fn()} />)
    expect((await screen.findByRole('tab', { name: 'Prompt' })).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(screen.getByRole('radio', { name: 'Repeat' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('heading', { name: 'Edit scheduled run' })).toBeNull()
  })

  it('opens plainly again after it closes', () => {
    useStartWorkStore.getState().openScheduledRun()
    useStartWorkStore.getState().closeLauncher()
    useStartWorkStore.getState().openLauncher()
    expect(useStartWorkStore.getState().repeat).toBe(false)
  })
})

describe('StartWork — editing a scheduled run', () => {
  beforeEach(seedTwoWorkspaces)

  it('shows the title, the saved prompt and its repeat, with no tabs and no Now', async () => {
    await openEditing(savedRun)
    expect(screen.queryByRole('tab')).toBeNull()
    expect((searchBox() as HTMLTextAreaElement).value).toBe('Triage new Sentry errors')
    expect(whenNames()).toEqual(['Once', 'Repeat'])
    expect(screen.getByRole('radio', { name: 'Repeat' }).getAttribute('aria-checked')).toBe('true')
    expect(pickerButton().getAttribute('aria-label')).toBe('Workspace: terminator')
    expect(
      screen.getByText(
        /^Created Wed 4 Nov 10:00 · last run never · next run \w{3} \d+ \w{3} 09:00$/
      )
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
})

describe('StartWork — editing a scheduled run, saving', () => {
  beforeEach(seedTwoWorkspaces)

  it('saves the changes on the same id and keeps the branch, then closes', async () => {
    const user = userEvent.setup()
    updateSchedule.mockResolvedValue({ data: {} as never })
    const onClose = await openEditing(savedRun)
    await user.clear(searchBox())
    await user.type(searchBox(), 'Triage new errors')
    await user.click(screen.getByRole('button', { name: /^Save changes/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateSchedule).toHaveBeenCalledWith({
      id: 'sch-1',
      repoRoot: '/repo',
      prompt: 'Triage new errors',
      runAs: 'agent',
      kind: 'repeat',
      repeat: savedRun.repeat,
      branch: 'feat/triage',
      time: '09:00',
      date: null,
      newWorktree: true,
      agentId: null,
    })
    expect(createSchedule).not.toHaveBeenCalled()
  })
})

describe('StartWork — editing a scheduled run, another workspace or a refusal', () => {
  beforeEach(seedTwoWorkspaces)

  it('names the branch again when the workspace changes', async () => {
    const user = userEvent.setup()
    updateSchedule.mockResolvedValue({ data: {} as never })
    const onClose = await openEditing(savedRun)
    await user.click(pickerButton())
    await user.click(within(listbox()).getByRole('option', { name: /atlas/ }))
    await pressInBox(user, '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ repoRoot: '/atlas', branch: 'fix/dev-build' })
    )
  })
})

describe('StartWork — editing a scheduled run, guards', () => {
  beforeEach(seedTwoWorkspaces)

  it('drops the branch when the run no longer runs on one', async () => {
    const user = userEvent.setup()
    updateSchedule.mockResolvedValue({ data: {} as never })
    const onClose = await openEditing(savedRun)
    await user.click(screen.getByRole('radio', { name: 'Terminal only' }))
    await user.click(screen.getByRole('button', { name: /^Save changes/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ runAs: 'terminal', branch: null, newWorktree: false })
    )
  })

  it('refuses to move a run whose workspace is gone to the suggested one', async () => {
    const user = userEvent.setup()
    const onClose = await openEditing({ ...savedRun, repoRoot: '/removed' })
    await user.click(screen.getByRole('button', { name: /^Save changes/ }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Its workspace is no longer in the sidebar. Pick a workspace or Global.'
    )
    expect(updateSchedule).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('StartWork — editing a scheduled run, guards — a refusal', () => {
  beforeEach(seedTwoWorkspaces)

  it('shows the refusal and stays open', async () => {
    const user = userEvent.setup()
    updateSchedule.mockResolvedValue({ error: 'failed', message: 'No such schedule.' })
    const onClose = await openEditing(savedRun)
    await user.click(screen.getByRole('button', { name: /^Save changes/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('No such schedule.')
    expect(onClose).not.toHaveBeenCalled()
  })
})

/** A one-time global scheduled run that ran once. */
const globalOnce: Schedule = {
  ...savedRun,
  repoRoot: null,
  branch: null,
  newWorktree: false,
  kind: 'once',
  repeat: null,
  date: '2099-01-02',
  lastRunAt: '2026-11-05T09:00:00',
}

describe('StartWork — editing other scheduled runs', () => {
  beforeEach(seedTwoWorkspaces)
  afterEach(() => void vi.useRealTimers())

  it('opens a one-time global run on Once, its date and Global', async () => {
    await openEditing(globalOnce)
    expect(screen.getByRole('radio', { name: 'Once' }).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2099-01-02')
    expect(pickerButton().getAttribute('aria-label')).toBe('Workspace: Global')
    expect(
      screen.getByText(
        'Created Wed 4 Nov 10:00 · last run Thu 5 Nov 09:00 · next run Fri 2 Jan 09:00'
      )
    ).toBeTruthy()
  })

  it('counts the next runs from when the run was created, as the scheduler does', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 5, 12, 0))
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const everyOtherDay = { ...savedRun.repeat!, every: 2, days: [] }
    await openEditing({ ...savedRun, repeat: everyOtherDay, createdAt: yesterday.toISOString() })
    const month = tomorrow.toLocaleDateString('en-GB', { month: 'short' })
    expect(screen.getByText(/^Next: /).textContent).toMatch(
      new RegExp(`^Next: \\w+ ${tomorrow.getDate()} ${month} 09:00`)
    )
  })
})
