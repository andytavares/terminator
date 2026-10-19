import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { StartWork } from '../../../../src/renderer/components/home/StartWork'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
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
  scratch: vi.fn(),
  createFromDraft: vi.fn(),
}))
vi.mock('../../../../src/renderer/terminal/start-session', () => ({
  startSessionInBranch: launched.inBranch,
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
  git.isRepo.mockResolvedValue({ isRepo: true, root: '/repo' })
  git.listBranches.mockResolvedValue({
    branches: [{ name: 'main', isCurrent: true, isRemote: false }],
  })
  git.listWorktrees.mockResolvedValue({ worktrees: [] })
  installElectronApi({
    git,
    extension: { executeCommand, getCommands: vi.fn(async () => ({ commands: [] })) },
  })
  launched.inBranch.mockResolvedValue('s-new')
  launched.createFromDraft.mockResolvedValue('p-new')
  seedStartWorkStores()
})

const searchBox = () => screen.getByRole('textbox', { name: 'Search tickets or type a prompt' })
const open = async (onClose = vi.fn()) => {
  render(<StartWork onClose={onClose} />)
  await screen.findByText('TAV-33')
  return onClose
}
const goToTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))
const rowKeys = () => screen.getAllByTestId('start-work-key').map((n) => n.textContent)

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

  it('starts on Claude agent and Tab cycles through the three', async () => {
    await open()
    expect(checked()).toBe('Claude agent')
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    expect(checked()).toBe('Terminal only')
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    expect(checked()).toBe('Foundry order')
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    expect(checked()).toBe('Claude agent')
  })

  it('summarises the repo, branch and worktree of the selected ticket', async () => {
    await open()
    const summary = screen.getByRole('group', { name: 'Where it runs' })
    await waitFor(() => expect(within(summary).getByText('main')).toBeTruthy())
    expect(within(summary).getByText('terminator')).toBeTruthy()
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
    expect(launched.inBranch).toHaveBeenCalledWith(
      'p-new',
      expect.stringMatching(/^claude 'Work on TAV-33: Retry rate-limited GitHub searches/)
    )
    expect(setLink).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's-new' }), {
      tracker: 'linear',
      key: 'TAV-33',
    })
  })
})

describe('StartWork — Enter on a ticket, run another way', () => {
  it('starts a plain terminal for Terminal only', async () => {
    await open()
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

describe('StartWork — Foundry order', () => {
  it('runs the command Foundry registered for a new order', async () => {
    useExtensionCommandsRegistered()
    const onClose = await open()
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
    fireEvent.keyDown(searchBox(), { key: 'Tab' })
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

function useExtensionCommandsRegistered(): void {
  installElectronApi({
    git,
    extension: {
      executeCommand,
      getCommands: vi.fn(async () => ({
        commands: [
          {
            key: 'x.command.new-order',
            extensionId: 'x',
            id: 'new-order',
            label: 'New work order…',
            category: 'Foundry',
          },
        ],
      })),
      list: vi.fn(async () => ({ extensions: [] })),
    },
  })
}

describe('StartWork — other tabs', () => {
  it('Prompt tab starts a Claude agent with the typed prompt and links nothing', async () => {
    const onClose = await open()
    goToTab('Prompt')
    fireEvent.change(searchBox(), { target: { value: "fix the dev's build" } })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.inBranch).toHaveBeenCalledWith('p-main', `claude 'fix the dev'\\''s build'`)
    expect(launched.createFromDraft).not.toHaveBeenCalled()
    expect(setLink).not.toHaveBeenCalled()
  })

  it('Prompt tab refuses a prompt too long to type into a terminal line', async () => {
    await open()
    goToTab('Prompt')
    fireEvent.change(searchBox(), { target: { value: 'x'.repeat(1200) } })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toMatch(/too long/i)
    expect(launched.inBranch).not.toHaveBeenCalled()
  })
})

describe('StartWork — scratch and branch tabs', () => {
  it('Scratch terminal tab starts a scratch session', async () => {
    const onClose = await open()
    goToTab('Scratch terminal')
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    await waitFor(() => expect(launched.scratch).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalled()
    expect(launched.inBranch).not.toHaveBeenCalled()
  })

  it('Branch tab lists the repo worktrees and starts a session on the chosen one', async () => {
    git.listWorktrees.mockResolvedValue({
      worktrees: [{ path: '/repo/.worktrees/dev', branch: 'dev', isMain: false, head: 'abc' }],
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
    expect(launched.inBranch).toHaveBeenCalledWith('p-dev', expect.stringMatching(/^claude$/))
  })
})
