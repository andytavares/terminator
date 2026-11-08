import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { StartWork } from '../../../../src/renderer/components/home/StartWork'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useTaskStore } from '../../../../src/renderer/stores/task.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { installElectronApi } from '../../../support/electron-api'
import { task } from '../home/fixtures'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import type { Project, Workspace } from '../../../../src/shared/types/index'

const launched = vi.hoisted(() => ({
  inBranch: vi.fn(),
  agentInBranch: vi.fn(),
  createFromDraft: vi.fn(),
}))
vi.mock('../../../../src/renderer/terminal/start-session', () => ({
  startSessionInBranch: launched.inBranch,
  startAgentInBranch: launched.agentInBranch,
  startScratchSession: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/sidebar/create-project', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createFromDraft: launched.createFromDraft,
}))

const repo = (id: string, name: string): Workspace => ({
  id,
  name,
  folderPath: `/repos/${name}`,
  color: '#fff',
  tags: [],
  createdAt: '',
  updatedAt: '',
})
const WORKSPACES = [repo('ws-1', 'terminator'), repo('ws-2', 'api-gateway'), repo('ws-3', 'web')]
const mainCard = (workspaceId: string): Project => ({
  id: `main-${workspaceId}`,
  workspaceId,
  name: 'main',
  gitBranch: 'main',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
})

const git = {
  isRepo: vi.fn<ElectronAPI['git']['isRepo']>(),
  listBranches: vi.fn<ElectronAPI['git']['listBranches']>(),
  listWorktrees: vi.fn<ElectronAPI['git']['listWorktrees']>(),
}

/** A task store whose create lands the way main's would: the new task joins the list. */
function useWritableTasks(): void {
  useTaskStore.setState({
    tasks: [],
    create: vi.fn(async (input) => {
      useTaskStore.setState((s) => ({
        tasks: [
          ...s.tasks,
          task({ ...input, id: crypto.randomUUID(), ticket: input.ticket ?? null }),
        ],
      }))
      return true
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useExtensionRegistry.setState({ startWorkOptions: new Map() })
  git.isRepo.mockImplementation(async (path) => ({ isRepo: true, root: path }))
  git.listBranches.mockResolvedValue({
    branches: [{ name: 'main', isCurrent: true, isRemote: false }],
  })
  git.listWorktrees.mockResolvedValue({ worktrees: [] })
  installElectronApi({
    git,
    agents: { list: async () => ({ data: [{ id: 'claude', label: 'Claude Code' }] }) },
    extension: { executeCommand: vi.fn() },
  })
  launched.inBranch.mockResolvedValue('s-new')
  launched.agentInBranch.mockResolvedValue('s-new')
  launched.createFromDraft.mockImplementation(async ({ workspaceId }) => `p-${workspaceId}`)
  useWorkspaceStore.setState({
    workspaces: WORKSPACES,
    activeWorkspaceId: 'ws-1',
    projectsByWorkspaceId: new Map(WORKSPACES.map((w) => [w.id, [mainCard(w.id)]])),
  })
  useIntegrationsStore.setState({ listMine: vi.fn(async () => ({ issues: [], failures: [] })) })
  useWritableTasks()
})

async function openAcrossRepos(user: UserEvent, onClose = vi.fn()) {
  render(<StartWork onClose={onClose} />)
  await user.click(screen.getByRole('tab', { name: 'Across repos' }))
  await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Rate limits')
  const branch = screen.getByRole('textbox', { name: 'Branch in every repo' })
  await user.clear(branch)
  await user.type(branch, 'rate-limits')
  await screen.findAllByText('from main')
  return onClose
}

const startButton = (name: RegExp) => screen.getByRole('button', { name })
const repoRow = (name: string) => screen.getByRole('listitem', { name })

/** A worktree git still has a checkout for. */
const NOT_DETACHED = { detached: false, prunable: false }
const ELSEWHERE_WORKTREE = {
  path: '/elsewhere',
  branch: 'rate-limits',
  isMain: false,
  head: 'abc',
  ...NOT_DETACHED,
}

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

describe('Start work, Across repos — the branch name', () => {
  it('suggests a branch name from the title', async () => {
    const user = userEvent.setup()
    render(<StartWork onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Across repos' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Task title' }),
      'Rate limits across services'
    )
    const branch = screen.getByRole('textbox', { name: 'Branch in every repo' })
    expect((branch as HTMLInputElement).value).toBe('rate-limits-across-services')
  })
})

describe('Start work, Across repos — Terminal only', () => {
  it('starts a terminal in each lane for Terminal only, and no agent', async () => {
    const user = userEvent.setup()
    const onClose = await openAcrossRepos(user)
    await user.click(screen.getByRole('radio', { name: 'Terminal only' }))
    await user.click(startButton(/Start 3 lanes/))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.inBranch.mock.calls.map(([projectId]) => projectId)).toEqual([
      'p-ws-1',
      'p-ws-2',
      'p-ws-3',
    ])
    expect(launched.agentInBranch).not.toHaveBeenCalled()
    expect(useTaskStore.getState().tasks).toHaveLength(1)
  })
})

describe('Start work, Across repos — all repos start', () => {
  it('starts one lane per repo and records one task holding all three', async () => {
    const user = userEvent.setup()
    const onClose = await openAcrossRepos(user)
    await user.type(
      screen.getByRole('textbox', { name: 'First prompt for each agent' }),
      'Add per-tenant limits'
    )
    await user.click(startButton(/Start 3 lanes/))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(launched.agentInBranch).toHaveBeenCalledTimes(3)
    expect(launched.agentInBranch).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p-ws-2', prompt: 'Add per-tenant limits' })
    )
    const { tasks } = useTaskStore.getState()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('Rate limits')
    expect(tasks[0].lanes).toEqual(
      WORKSPACES.map((w) => ({ repoRoot: w.folderPath, branch: 'rate-limits' }))
    )
  })
})

describe('Start work, Across repos — all repos start — some repos', () => {
  it('starts only the repos that stay ticked, and the button counts them', async () => {
    const user = userEvent.setup()
    const onClose = await openAcrossRepos(user)
    await user.click(screen.getByRole('checkbox', { name: 'web' }))
    await user.click(startButton(/Start 2 lanes/))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useTaskStore.getState().tasks[0].lanes.map((l) => l.repoRoot)).toEqual([
      '/repos/terminator',
      '/repos/api-gateway',
    ])
  })
})

describe('Start work, Across repos — a repo that cannot take the branch', () => {
  it('names the repo whose branch is checked out elsewhere and starts nothing', async () => {
    const user = userEvent.setup()
    git.listWorktrees.mockImplementation(async (path) => ({
      worktrees: path === '/repos/api-gateway' ? [ELSEWHERE_WORKTREE] : [],
    }))
    const onClose = await openAcrossRepos(user)
    await user.click(startButton(/Start 3 lanes/))
    const row = repoRow('api-gateway')
    await within(row).findByText(/rate-limits is already checked out in \/elsewhere/)
    expect(launched.agentInBranch).not.toHaveBeenCalled()
    expect(launched.createFromDraft).not.toHaveBeenCalled()
    expect(useTaskStore.getState().tasks).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('names a folder that is not a git repo and starts nothing', async () => {
    const user = userEvent.setup()
    git.isRepo.mockImplementation(async (path) =>
      path === '/repos/web' ? { isRepo: false } : { isRepo: true, root: path }
    )
    await openAcrossRepos(user)
    await user.click(startButton(/Start 3 lanes/))
    await within(repoRow('web')).findByText('web is not a git repo.')
    expect(launched.agentInBranch).not.toHaveBeenCalled()
  })
})

describe('Start work, Across repos — a repo fails midway', () => {
  it('records only the lanes that were made and says what failed, per repo', async () => {
    const user = userEvent.setup()
    launched.createFromDraft.mockImplementation(async ({ workspaceId }) =>
      workspaceId === 'ws-2'
        ? { field: 'form', message: 'Worktree error: raw git' }
        : `p-${workspaceId}`
    )
    const onClose = await openAcrossRepos(user)
    await user.click(startButton(/Start 3 lanes/))
    await within(repoRow('api-gateway')).findByText(/Could not set up rate-limits in api-gateway/)
    expect(within(repoRow('terminator')).getByText('Started')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(useTaskStore.getState().tasks[0].lanes.map((l) => l.repoRoot)).toEqual([
      '/repos/terminator',
      '/repos/web',
    ])
    expect(screen.getByRole('alert').textContent).toMatch(/2 of 3 lanes started/)
  })
})

describe('Start work, Across repos — every repo fails', () => {
  it('says nothing was started or recorded, and keeps the dialog open to try again', async () => {
    const user = userEvent.setup()
    launched.createFromDraft.mockResolvedValue({
      field: 'form',
      message: 'Worktree error: raw git',
    })
    const onClose = await openAcrossRepos(user)
    await user.click(startButton(/Start 3 lanes/))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/No lane was started/)
    expect(alert.textContent).not.toMatch(/recorded/)
    expect(useTaskStore.getState().tasks).toEqual([])
    expect(startButton(/Start 3 lanes/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})
