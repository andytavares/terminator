import { describe, it, expect } from 'vitest'
import { buildBranchRows } from '../../../../src/renderer/sidebar/branch-rows'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'
import type { SessionView } from '../../../../src/renderer/sidebar/view-model'
import type { Project, TerminalSession, Workspace } from '../../../../src/shared/types/index'

const NOW = 1_000_000_000
const STALE_AFTER = 2 * 60 * 60 * 1000

const repoA: Workspace = {
  id: 'ws-1',
  name: 'terminator',
  folderPath: '/repos/terminator',
  color: '#5c6bc0',
  tags: [],
  createdAt: '',
  updatedAt: '',
}
const repoB: Workspace = { ...repoA, id: 'ws-2', name: 'kalli', folderPath: '/repos/kalli' }

const feature: Project = {
  id: 'p1',
  workspaceId: 'ws-1',
  name: 'API',
  gitBranch: '034-declutter',
  isWorktree: true,
  createdAt: '',
  updatedAt: '',
}
const main: Project = {
  id: 'p2',
  workspaceId: 'ws-1',
  name: 'Main',
  gitBranch: 'main',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}
const branchless: Project = {
  id: 'p3',
  workspaceId: 'ws-2',
  name: 'Web',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}

const PROJECTS = [feature, main, branchless]
const REPOS = [repoA, repoB]

function session(
  id: string,
  projectId: string,
  patch: Partial<TerminalSession> = {}
): TerminalSession {
  return {
    id,
    projectId,
    tabTitle: id,
    status: 'active',
    type: 'agent',
    scrollbackLimit: 10000,
    createdAt: '',
    lastActivityAt: NOW,
    agentState: 'idle',
    ...patch,
  }
}

const view = (patch: Partial<SessionView> = {}): SessionView => ({
  id: 'everything',
  name: 'Everything',
  groupBy: 'workspace',
  sortBy: 'recent',
  filters: {},
  builtIn: true,
  ...patch,
})

const build = (sessions: TerminalSession[], v: SessionView = view()) =>
  buildBranchRows(sessions, PROJECTS, REPOS, v, NOW, STALE_AFTER)

const rowFor = (result: ReturnType<typeof build>, projectId: string) =>
  result.groups.flatMap((g) => g.branches).find((b) => b.projectId === projectId)

describe('buildBranchRows', () => {
  // BR-1. The headline change: a branch is a row whether or not a terminal is
  // open on it. Unlike buildGroups this is unconditional — it does not depend
  // on whether the view happens to be narrowed.
  it('lists every branch, including ones with no terminals', () => {
    const rows = build([]).groups.flatMap((g) => g.branches)
    expect(rows.map((b) => b.projectId).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('still lists a branch with no terminals under a narrowing search', () => {
    const result = build([], view({ filters: { query: '034' } }))
    expect(rowFor(result, 'p1')).toBeTruthy()
  })

  it('groups branches under their repo', () => {
    const { groups } = build([])
    expect(groups.map((g) => g.label)).toEqual(['kalli', 'terminator'])
    expect(groups.find((g) => g.label === 'terminator')!.branches).toHaveLength(2)
  })

  it('names a branch by its branch, falling back to its stored name', () => {
    const result = build([])
    expect(rowFor(result, 'p1')!.label).toBe('034-declutter')
    expect(rowFor(result, 'p3')!.label).toBe('Web')
  })

  it('marks which branches are worktrees', () => {
    const result = build([])
    expect(rowFor(result, 'p1')!.isWorktree).toBe(true)
    expect(rowFor(result, 'p2')!.isWorktree).toBe(false)
  })

  it('carries the repo colour and folder path on the group, not the row', () => {
    const group = build([]).groups.find((g) => g.label === 'terminator')!
    expect(group.color).toBe('#5c6bc0')
    expect(group.folderPath).toBe('/repos/terminator')
  })

  // BR-2. The count and the rows are the same number, or the header lies.
  it('reports a branch count equal to the branches it holds', () => {
    for (const group of build([]).groups) {
      expect(group.branchCount).toBe(group.branches.length)
    }
  })

  describe('the row state', () => {
    it('folds its terminals to one state', () => {
      const result = build([
        session('a', 'p1', { agentState: 'idle' }),
        session('b', 'p1', { agentState: 'awaiting-input' }),
      ])
      expect(rowFor(result, 'p1')!.state).toBe('awaiting-input')
    })

    it('reads idle when the branch has no terminals', () => {
      expect(rowFor(build([]), 'p1')!.state).toBe('idle')
    })

    // The count agrees with the glyph rather than totalling the branch.
    it('counts the terminals in the row own state', () => {
      const result = build([
        session('a', 'p1', { agentState: 'awaiting-input' }),
        session('b', 'p1', { agentState: 'awaiting-input' }),
        session('c', 'p1', { agentState: 'idle' }),
      ])
      const row = rowFor(result, 'p1')!
      expect(row.state).toBe('awaiting-input')
      expect(row.stateCount).toBe(2)
      expect(row.sessionCount).toBe(3)
    })

    it('reports the newest activity across its terminals', () => {
      const result = build([
        session('a', 'p1', { lastActivityAt: 10 }),
        session('b', 'p1', { lastActivityAt: 99 }),
      ])
      expect(rowFor(result, 'p1')!.lastActivityAt).toBe(99)
    })

    it('has no activity stamp at all when it has no terminals', () => {
      expect(rowFor(build([]), 'p1')!.lastActivityAt).toBeNull()
    })
  })

  // BR-5. A collapsed repo must still be able to say something inside it is
  // waiting; the pure layer reports the fact, the component decides when to
  // draw it.
  describe('needsYou on the repo', () => {
    it('is true when any branch in it is waiting', () => {
      const { groups } = build([session('a', 'p1', { agentState: 'awaiting-input' })])
      expect(groups.find((g) => g.label === 'terminator')!.needsYou).toBe(true)
    })

    it('is false when nothing in it is waiting', () => {
      const { groups } = build([session('a', 'p1', { agentState: 'working' })])
      expect(groups.find((g) => g.label === 'terminator')!.needsYou).toBe(false)
    })
  })

  // BR-6. A scratch terminal has no branch to be represented by, so it is the
  // one place a terminal is still a row.
  describe('scratch', () => {
    it('comes back separately rather than as a branch', () => {
      const result = build([session('s', SCRATCH_PROJECT_ID)])
      expect(result.scratch.map((s) => s.id)).toEqual(['s'])
      expect(result.groups.flatMap((g) => g.branches).map((b) => b.projectId)).not.toContain(
        SCRATCH_PROJECT_ID
      )
    })

    it('is empty when there are none', () => {
      expect(build([]).scratch).toEqual([])
    })
  })

  // BR-3. Counts are of branches, since branches are what is drawn.
  describe('filtering', () => {
    it('counts branches, not terminals', () => {
      const result = build([session('a', 'p1'), session('b', 'p1'), session('c', 'p2')])
      expect(result.total).toBe(3)
      expect(result.shown).toBe(3)
    })

    // BR-4.
    it('keeps a branch when any of its terminals matches the state filter', () => {
      const result = build(
        [
          session('a', 'p1', { agentState: 'idle' }),
          session('b', 'p1', { agentState: 'working' }),
          session('c', 'p2', { agentState: 'idle' }),
        ],
        view({ filters: { states: ['working'] } })
      )
      expect(rowFor(result, 'p1')).toBeTruthy()
      expect(rowFor(result, 'p2')).toBeUndefined()
      expect(result.shown).toBe(1)
      expect(result.total).toBe(3)
    })

    it('hides a branch with no terminals under a state filter', () => {
      const result = build([session('a', 'p1', { agentState: 'working' })], {
        ...view(),
        filters: { states: ['working'] },
      })
      expect(rowFor(result, 'p3')).toBeUndefined()
    })

    it('matches a search against the branch name', () => {
      const result = build([], view({ filters: { query: 'declutter' } }))
      expect(result.groups.flatMap((g) => g.branches).map((b) => b.projectId)).toEqual(['p1'])
    })

    it('matches a search against the repo name', () => {
      const result = build([], view({ filters: { query: 'kalli' } }))
      expect(result.groups.flatMap((g) => g.branches).map((b) => b.projectId)).toEqual(['p3'])
    })

    it('matches a search against a terminal title', () => {
      const result = build([session('deploy-script', 'p2')], view({ filters: { query: 'deploy' } }))
      expect(result.groups.flatMap((g) => g.branches).map((b) => b.projectId)).toEqual(['p2'])
    })

    it('narrows to the given branches', () => {
      const result = build([], view({ filters: { projectIds: ['p2'] } }))
      expect(result.groups.flatMap((g) => g.branches).map((b) => b.projectId)).toEqual(['p2'])
    })

    it('drops a repo left with no branches', () => {
      const result = build([], view({ filters: { projectIds: ['p3'] } }))
      expect(result.groups.map((g) => g.label)).toEqual(['kalli'])
    })

    it('hides a branch whose every terminal has gone stale', () => {
      const old = NOW - STALE_AFTER - 1
      const result = build(
        [session('a', 'p1', { lastActivityAt: old })],
        view({ filters: { hideStale: true } })
      )
      expect(rowFor(result, 'p1')).toBeUndefined()
    })

    it('keeps a stale branch when one of its terminals is still live', () => {
      const old = NOW - STALE_AFTER - 1
      const result = build(
        [session('a', 'p1', { lastActivityAt: old }), session('b', 'p1')],
        view({ filters: { hideStale: true } })
      )
      expect(rowFor(result, 'p1')).toBeTruthy()
    })

    it('never hides a branch with no terminals for being stale', () => {
      // Nothing has gone quiet on it — there is nothing on it at all, and a
      // branch you have not started work on is not abandoned work.
      const result = build([], view({ filters: { hideStale: true } }))
      expect(rowFor(result, 'p1')).toBeTruthy()
    })

    it('shows only stale branches under staleOnly', () => {
      const old = NOW - STALE_AFTER - 1
      const result = build(
        [session('a', 'p1', { lastActivityAt: old }), session('b', 'p2')],
        view({ filters: { staleOnly: true } })
      )
      expect(rowFor(result, 'p1')).toBeTruthy()
      expect(rowFor(result, 'p2')).toBeUndefined()
    })
  })

  // BR-7. Fixed, observable order.
  describe('order', () => {
    it('sorts branches by recency within a repo', () => {
      const result = build([
        session('a', 'p1', { lastActivityAt: 10 }),
        session('b', 'p2', { lastActivityAt: 99 }),
      ])
      const group = result.groups.find((g) => g.label === 'terminator')!
      expect(group.branches.map((b) => b.projectId)).toEqual(['p2', 'p1'])
    })

    it('sorts branches by name when asked', () => {
      const group = build([], view({ sortBy: 'name' })).groups.find(
        (g) => g.label === 'terminator'
      )!
      expect(group.branches.map((b) => b.label)).toEqual(['034-declutter', 'main'])
    })

    it('sorts branches by state severity when asked', () => {
      const result = build(
        [
          session('a', 'p1', { agentState: 'idle' }),
          session('b', 'p2', { agentState: 'awaiting-input' }),
        ],
        view({ sortBy: 'status' })
      )
      const group = result.groups.find((g) => g.label === 'terminator')!
      expect(group.branches.map((b) => b.projectId)).toEqual(['p2', 'p1'])
    })

    it('sorts repos by name', () => {
      expect(build([]).groups.map((g) => g.label)).toEqual(['kalli', 'terminator'])
    })

    it('puts everything in one group when grouping is off', () => {
      const { groups } = build([], view({ groupBy: 'none' }))
      expect(groups).toHaveLength(1)
      expect(groups[0].branches).toHaveLength(3)
    })
  })

  // BR-8 / BR-9.
  it('carries no change statistics — they belong to the store, behind its TTL', () => {
    const row = rowFor(build([]), 'p1')!
    expect(row).not.toHaveProperty('added')
    expect(row).not.toHaveProperty('removed')
  })

  it('is deterministic and does not mutate its inputs', () => {
    const sessions = [session('a', 'p1'), session('b', 'p2')]
    const order = sessions.map((s) => s.id)
    expect(JSON.stringify(build(sessions))).toBe(JSON.stringify(build(sessions)))
    expect(sessions.map((s) => s.id)).toEqual(order)
    expect(PROJECTS.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('drops a terminal whose branch has gone rather than crashing', () => {
    const result = build([session('a', 'ghost')])
    expect(result.groups.flatMap((g) => g.branches)).toHaveLength(3)
  })

  it('drops a branch whose repo has gone', () => {
    const orphan: Project = { ...feature, id: 'p9', workspaceId: 'ws-gone' }
    const result = buildBranchRows([], [...PROJECTS, orphan], REPOS, view(), NOW, STALE_AFTER)
    expect(result.groups.flatMap((g) => g.branches).map((b) => b.projectId)).not.toContain('p9')
  })
})
