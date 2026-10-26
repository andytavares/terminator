import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { ThreadDrawer } from '../../../../src/renderer/components/home/ThreadDrawer'
import { useDeskSelection } from '../../../../src/renderer/components/home/desk-selection'
import { useTaskStore } from '../../../../src/renderer/stores/task.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useParkedThreads } from '../../../../src/renderer/components/home/parked-threads'
import { useDismissedThreads } from '../../../../src/renderer/components/home/dismissed-threads'
import { installElectronApi } from '../../../support/electron-api'
import { FACTS, REPO_ROOT, seedDesk } from '../home/desk-world'
import { task } from '../home/fixtures'
import type { TaskLane } from '../../../../src/shared/schemas/tasks.schema'
import type { Project, Workspace } from '../../../../src/shared/types/index'

const launched = vi.hoisted(() => ({ inBranch: vi.fn(), createFromDraft: vi.fn() }))
vi.mock('../../../../src/renderer/terminal/start-session', () => ({
  startSessionInBranch: launched.inBranch,
  startScratchSession: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/sidebar/create-project', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createFromDraft: launched.createFromDraft,
}))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => FACTS,
}))
vi.mock('../../../../src/renderer/components/session/SessionLinkDialog', () => ({
  SessionLinkDialog: () => <div role="dialog" aria-label="Link a work item" />,
}))

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const gateway: Workspace = {
  id: 'ws-2',
  name: 'api-gateway',
  folderPath: '/repos/api-gateway',
  color: '#fff',
  tags: [],
  createdAt: '',
  updatedAt: '',
}
const edgeCache: Project = {
  id: 'p-edge',
  workspaceId: 'ws-2',
  name: 'edge-cache',
  gitBranch: 'edge-cache',
  isWorktree: true,
  createdAt: '',
  updatedAt: '',
}

function seedWorkspaces(): void {
  seedDesk()
  const world = useWorkspaceStore.getState()
  useWorkspaceStore.setState({
    workspaces: [...world.workspaces, gateway],
    projectsByWorkspaceId: new Map([...world.projectsByWorkspaceId, ['ws-2', [edgeCache]]]),
  })
}

function installApi(): void {
  installElectronApi({
    homeThreadSummary: { get: vi.fn().mockResolvedValue({ text: 'Two.', generatedAt: 'now' }) },
    agentUsage: { get: vi.fn().mockResolvedValue({ data: { sessions: [], totals: {} } }) },
    git: {
      changeStats: vi.fn().mockResolvedValue({ added: 1, removed: 1, files: 1 }),
      isRepo: vi.fn(async (path: string) => ({ isRepo: true, root: path })),
      listBranches: vi.fn(async () => ({ branches: [] })),
      listWorktrees: vi.fn(async () => ({ worktrees: [] })),
    },
  })
}

/** One stored task on tav-20, whose lane writes land the way main's would. */
function seedTask(): void {
  const lanes = [{ repoRoot: REPO_ROOT, branch: 'tav-20' }]
  useTaskStore.setState({
    tasks: [task({ id: TASK_ID, title: 'Rate limits', lanes })],
    addLane: vi.fn(async (id: string, lane: TaskLane) => {
      useTaskStore.setState((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, lanes: [...t.lanes, lane] } : t)),
      }))
      return true
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  seedWorkspaces()
  useDeskSelection.setState({ selectedThreadKey: null, openThreadKey: null, groupBy: 'move' })
  useParkedThreads.setState({ keys: [] })
  useDismissedThreads.setState({ dismissed: {} })
  installApi()
  launched.inBranch.mockResolvedValue('s-new')
  launched.createFromDraft.mockResolvedValue('p-new')
  seedTask()
  useDeskSelection.getState().openThread(`task:${TASK_ID}`)
  render(<ThreadDrawer />)
})

const lanes = () => within(screen.getByRole('list', { name: 'Lanes' }))

describe('the task drawer — Add a branch I already have', () => {
  it('offers branches in repos the task is not in, and a chosen one joins the lanes', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add a branch I already have…' }))
    expect(screen.queryByRole('button', { name: /terminator \/ tav-31/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'api-gateway / edge-cache' }))
    expect(await lanes().findByRole('listitem', { name: /edge-cache lane/ })).toBeTruthy()
    expect(useTaskStore.getState().tasks[0].lanes).toContainEqual({
      repoRoot: '/repos/api-gateway',
      branch: 'edge-cache',
    })
  })
})

describe('the task drawer — Add a repo', () => {
  it('makes a worktree on the task’s branch in that repo, opens a terminal and adds the lane', async () => {
    fireEvent.click(screen.getByRole('button', { name: '+ Add a repo' }))
    fireEvent.click(screen.getByRole('button', { name: 'api-gateway' }))
    expect(await lanes().findByRole('listitem', { name: /tav-20 lane.*|tav-20/ })).toBeTruthy()
    await waitFor(() =>
      expect(useTaskStore.getState().tasks[0].lanes).toContainEqual({
        repoRoot: '/repos/api-gateway',
        branch: 'tav-20',
      })
    )
    expect(launched.createFromDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-2',
        draft: expect.objectContaining({ newBranchName: 'tav-20' }),
      })
    )
    expect(launched.inBranch).toHaveBeenCalledWith('p-new', undefined)
  })

  it('says why in plain words when the worktree cannot be made, and adds nothing', async () => {
    launched.createFromDraft.mockResolvedValue({ field: 'form', message: 'Worktree error: raw' })
    fireEvent.click(screen.getByRole('button', { name: '+ Add a repo' }))
    fireEvent.click(screen.getByRole('button', { name: 'api-gateway' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Could not set up tav-20 in api-gateway/
    )
    expect(useTaskStore.getState().tasks[0].lanes).toHaveLength(1)
  })
})
