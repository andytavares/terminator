import { describe, it, expect } from 'vitest'
import { groupByTask, laneOf } from '../../../../src/renderer/sidebar/task-groups'
import type { BranchRow, RepoGroup } from '../../../../src/renderer/sidebar/branch-rows'
import type { Task } from '../../../../src/shared/schemas/tasks.schema'
import { projectFixture, workspaceFixture } from '../../../support/renderer-stores'

function branchRow(projectId: string, label: string, patch: Partial<BranchRow> = {}): BranchRow {
  return {
    projectId,
    label,
    isWorktree: true,
    state: 'idle',
    stateCount: 0,
    sessionCount: 0,
    terminals: [],
    lastActivityAt: null,
    workspaceId: 'ws-api',
    ...patch,
  }
}

function repoGroup(workspaceId: string, label: string, branches: BranchRow[]): RepoGroup {
  return {
    workspaceId,
    label,
    color: '#5c6bc0',
    folderPath: `/repos/${label}`,
    branches,
    branchCount: branches.length,
    needsYou: branches.some((b) => b.state === 'awaiting-input'),
  }
}

function taskOf(title: string, lanes: Task['lanes'], patch: Partial<Task> = {}): Task {
  return {
    id: `id-${title}`,
    title,
    lanes,
    ticket: null,
    focus: false,
    doneAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    archivedAt: null,
    ...patch,
  }
}

const REPOS: RepoGroup[] = [
  repoGroup('ws-api', 'api', [branchRow('p-api-main', 'main'), branchRow('p-api-login', 'login')]),
  repoGroup('ws-web', 'web', [branchRow('p-web-login', 'login', { workspaceId: 'ws-web' })]),
  repoGroup('ws-docs', 'docs', [branchRow('p-docs-login', 'login', { workspaceId: 'ws-docs' })]),
]

const LOGIN_LANES = [
  { repoRoot: '/repos/api', branch: 'login' },
  { repoRoot: '/repos/web', branch: 'login' },
  { repoRoot: '/repos/docs', branch: 'login' },
]

describe('groupByTask', () => {
  it('gives a task its three lanes, named by repo, in the order the task stores them', () => {
    const { sections } = groupByTask(REPOS, [taskOf('Login rework', LOGIN_LANES)])
    expect(sections.map((s) => s.task.title)).toEqual(['Login rework'])
    expect(sections[0].lanes.map((l) => [l.repoName, l.row.label])).toEqual([
      ['api', 'login'],
      ['web', 'login'],
      ['docs', 'login'],
    ])
  })

  it('leaves the branches in no task under their repos', () => {
    const { rest } = groupByTask(REPOS, [taskOf('Login rework', LOGIN_LANES)])
    expect(rest.map((g) => [g.label, g.branches.map((b) => b.label)])).toEqual([['api', ['main']]])
  })
})

describe('groupByTask — what it leaves out', () => {
  it('skips an archived task, so its branches fall back under their repos', () => {
    const archived = taskOf('Old', LOGIN_LANES, { archivedAt: '2026-10-02T00:00:00.000Z' })
    const { sections, rest } = groupByTask(REPOS, [archived])
    expect(sections).toEqual([])
    expect(rest.map((g) => g.label)).toEqual(['api', 'web', 'docs'])
  })

  it('omits a task none of whose lanes are listed, as a filter can leave it', () => {
    const lanes = [{ repoRoot: '/repos/api', branch: 'gone' }]
    expect(groupByTask(REPOS, [taskOf('Ghost', lanes)]).sections).toEqual([])
  })

  it('reports that a task needs you when one of its lanes does', () => {
    const asking = [
      repoGroup('ws-api', 'api', [branchRow('p1', 'login', { state: 'awaiting-input' })]),
    ]
    const lanes = [{ repoRoot: '/repos/api', branch: 'login' }]
    expect(groupByTask(asking, [taskOf('Login', lanes)]).sections[0].needsYou).toBe(true)
  })
})

describe('laneOf', () => {
  it('names a branch by its repo folder and its git branch', () => {
    const workspace = workspaceFixture({ id: 'ws-api', folderPath: '/repos/api' })
    const project = projectFixture({ id: 'p1', workspaceId: 'ws-api', gitBranch: 'login' })
    expect(laneOf(project, workspace)).toEqual({ repoRoot: '/repos/api', branch: 'login' })
  })

  it('falls back to the stored name for a folder that is not a repository', () => {
    const workspace = workspaceFixture({ id: 'ws-api', folderPath: '/notes' })
    const project = projectFixture({ id: 'p1', workspaceId: 'ws-api', name: 'Notes' })
    expect(laneOf({ ...project, gitBranch: undefined }, workspace).branch).toBe('Notes')
  })
})
