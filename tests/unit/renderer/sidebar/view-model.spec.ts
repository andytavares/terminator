import { describe, it, expect } from 'vitest'
import { isStale, buildGroups } from '../../../../src/renderer/sidebar/view-model'
import type { SessionView } from '../../../../src/renderer/sidebar/view-model'
import type {
  AgentState,
  Project,
  TerminalSession,
  Workspace,
} from '../../../../src/shared/types/index'

const HOUR = 3_600_000
const NOW = 1_000_000_000
const STALE_AFTER = 2 * HOUR

function session(id: string, patch: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    projectId: 'p1',
    tabTitle: id,
    status: 'active',
    type: 'agent',
    scrollbackLimit: 10000,
    createdAt: '2026-08-21T00:00:00.000Z',
    lastActivityAt: NOW,
    agentState: 'idle',
    ...patch,
  }
}

const projects: Project[] = [
  {
    id: 'p1',
    workspaceId: 'w1',
    name: 'API',
    gitBranch: 'main',
    isWorktree: false,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'p2',
    workspaceId: 'w1',
    name: 'Web',
    gitBranch: 'feat/x',
    isWorktree: false,
    createdAt: '',
    updatedAt: '',
  },
  { id: 'p3', workspaceId: 'w2', name: 'Docs', isWorktree: false, createdAt: '', updatedAt: '' },
]

const workspaces: Workspace[] = [
  {
    id: 'w1',
    name: 'Backend',
    folderPath: '/w1',
    color: '#111',
    tags: [],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'w2',
    name: 'Writing',
    folderPath: '/w2',
    color: '#222',
    tags: [],
    createdAt: '',
    updatedAt: '',
  },
]

const view = (patch: Partial<SessionView> = {}): SessionView => ({
  id: 'v',
  name: 'V',
  groupBy: 'project',
  sortBy: 'manual',
  filters: {},
  ...patch,
})

const build = (sessions: TerminalSession[], v: SessionView = view()) =>
  buildGroups(sessions, projects, workspaces, v, NOW, STALE_AFTER)

describe('isStale', () => {
  it.each<[string, Partial<TerminalSession>, boolean]>([
    [
      'exited is stale even when it just stopped',
      { agentState: 'exited', lastActivityAt: NOW },
      true,
    ],
    [
      'awaiting-input is never stale, however long it waits',
      { agentState: 'awaiting-input', lastActivityAt: 0 },
      false,
    ],
    ['exactly at the threshold is not stale', { lastActivityAt: NOW - STALE_AFTER }, false],
    ['one ms past the threshold is stale', { lastActivityAt: NOW - STALE_AFTER - 1 }, true],
    ['recent activity is not stale', { lastActivityAt: NOW - 60_000 }, false],
    [
      'working but long-untouched still goes stale',
      { agentState: 'working', lastActivityAt: 0 },
      true,
    ],
  ])('%s', (_label, patch, expected) => {
    expect(isStale(session('s', patch), NOW, STALE_AFTER)).toBe(expected)
  })

  it('becomes stale as the clock advances, with no other input', () => {
    const s = session('s', { lastActivityAt: NOW - STALE_AFTER })
    expect(isStale(s, NOW, STALE_AFTER)).toBe(false)
    expect(isStale(s, NOW + 1, STALE_AFTER)).toBe(true)
  })

  it('respects a changed threshold without the session changing', () => {
    const s = session('s', { lastActivityAt: NOW - HOUR })
    expect(isStale(s, NOW, 2 * HOUR)).toBe(false)
    expect(isStale(s, NOW, HOUR / 2)).toBe(true)
  })
})

describe('buildGroups — grouping', () => {
  it('groups by project, keyed on project id not name', () => {
    const r = build([session('a'), session('b', { projectId: 'p2' })])
    expect(r.groups.map((g) => [g.key, g.label])).toEqual([
      ['p1', 'API'],
      ['p2', 'Web'],
      ['p3', 'Docs'],
    ])
    expect(r.groups[0].scope).toEqual({ kind: 'project', projectId: 'p1', workspaceId: 'w1' })
  })

  it('groups by workspace', () => {
    const r = build(
      [session('a'), session('b', { projectId: 'p3' })],
      view({ groupBy: 'workspace' })
    )
    expect(r.groups.map((g) => g.label)).toEqual(['Backend', 'Writing'])
    expect(r.groups[0].scope).toEqual({ kind: 'workspace', workspaceId: 'w1' })
  })

  it('groups by status in a fixed severity order', () => {
    const r = build(
      [
        session('idle'),
        session('exited', { agentState: 'exited' }),
        session('needs', { agentState: 'awaiting-input' }),
        session('working', { agentState: 'working' }),
      ],
      view({ groupBy: 'status' })
    )
    expect(r.groups.map((g) => g.key)).toEqual(['awaiting-input', 'working', 'idle', 'exited'])
  })

  it('groups by branch, keyed with a branch prefix', () => {
    const r = build([session('a'), session('b', { projectId: 'p2' })], view({ groupBy: 'branch' }))
    expect(r.groups.map((g) => g.key)).toEqual(['branch:feat/x', 'branch:main'])
  })

  it('puts branchless projects in a single no-branch group', () => {
    const r = build([session('a', { projectId: 'p3' })], view({ groupBy: 'branch' }))
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].key).toBe('branch:')
  })

  it('produces one group keyed all when not grouping', () => {
    const r = build([session('a'), session('b', { projectId: 'p3' })], view({ groupBy: 'none' }))
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].key).toBe('all')
    expect(r.groups[0].sessions).toHaveLength(2)
  })

  it('carries no scope for non-scope groupings, which is what moves actions to the row', () => {
    for (const groupBy of ['status', 'branch', 'none'] as const) {
      const r = build([session('a')], view({ groupBy }))
      expect(r.groups[0].scope).toBeUndefined()
    }
  })

  it('shows every project when unfiltered, even one with no sessions yet', () => {
    // Without this there is no way to reach a project that has never had a
    // terminal — no row to click, no + to press. The tree always showed them.
    const r = build([session('a')], view({ groupBy: 'project' }))
    expect(r.groups.map((g) => g.label)).toEqual(['API', 'Web', 'Docs'])
    expect(r.groups[1].sessions).toEqual([])
    expect(r.groups[1].count).toBe(0)
  })

  it('shows every workspace when unfiltered, even one with no sessions yet', () => {
    const r = build([session('a')], view({ groupBy: 'workspace' }))
    expect(r.groups.map((g) => g.label)).toEqual(['Backend', 'Writing'])
  })

  it('still shows every project when only hide-stale is on — that is browsing, not hunting', () => {
    const r = build([session('a')], view({ groupBy: 'project', filters: { hideStale: true } }))
    expect(r.groups.map((g) => g.label)).toEqual(['API', 'Web', 'Docs'])
  })

  it('drops empty scope groups once a filter is active — the notice explains the absence', () => {
    const r = build(
      [session('a', { agentState: 'working' })],
      view({ groupBy: 'project', filters: { states: ['working'] } })
    )
    expect(r.groups.map((g) => g.label)).toEqual(['API'])
  })

  it('drops empty scope groups while searching', () => {
    const r = build([session('a')], view({ groupBy: 'project', filters: { query: 'a' } }))
    expect(r.groups).toHaveLength(1)
  })

  it('never invents empty groups for non-scope groupings', () => {
    for (const groupBy of ['status', 'branch', 'none'] as const) {
      const r = build([session('a')], view({ groupBy }))
      expect(r.groups).toHaveLength(1)
    }
  })

  it('counts each group', () => {
    const r = build([session('a'), session('b'), session('c', { projectId: 'p2' })])
    expect(r.groups.map((g) => g.count)).toEqual([2, 1, 0])
  })

  it('places every session in exactly one group', () => {
    const sessions = [
      session('a'),
      session('b', { projectId: 'p2' }),
      session('c', { projectId: 'p3' }),
    ]
    for (const groupBy of ['project', 'workspace', 'status', 'branch', 'none'] as const) {
      const r = build(sessions, view({ groupBy }))
      const ids = r.groups.flatMap((g) => g.sessions.map((s) => s.id))
      expect(ids.sort()).toEqual(['a', 'b', 'c'])
    }
  })

  it('falls back to the workspace id and sorts last when the workspace is gone', () => {
    const orphanProject: Project = {
      id: 'p9',
      workspaceId: 'w-gone',
      name: 'Orphan',
      isWorktree: false,
      createdAt: '',
      updatedAt: '',
    }
    const r = buildGroups(
      [session('a'), session('o', { projectId: 'p9' })],
      [...projects, orphanProject],
      workspaces,
      view({ groupBy: 'workspace' }),
      NOW,
      STALE_AFTER
    )
    expect(r.groups.map((g) => g.label)).toEqual(['Backend', 'Writing', 'w-gone'])
  })

  it('ignores a session whose project is unknown rather than throwing', () => {
    const r = build([session('orphan', { projectId: 'gone' })])
    expect(r.groups.flatMap((g) => g.sessions)).toEqual([])
    expect(r.total).toBe(1)
  })
})

describe('buildGroups — sorting', () => {
  const unsorted = [
    session('c', { tabTitle: 'Charlie', lastActivityAt: NOW - 3000, agentState: 'idle' }),
    session('a', { tabTitle: 'Alpha', lastActivityAt: NOW - 1000, agentState: 'exited' }),
    session('b', { tabTitle: 'Bravo', lastActivityAt: NOW - 2000, agentState: 'awaiting-input' }),
  ]

  it.each<[SessionView['sortBy'], string[]]>([
    ['recent', ['a', 'b', 'c']],
    ['oldest', ['c', 'b', 'a']],
    ['name', ['a', 'b', 'c']],
    ['status', ['b', 'c', 'a']],
    ['manual', ['c', 'a', 'b']],
  ])('sorts by %s', (sortBy, expected) => {
    const r = build(unsorted, view({ sortBy }))
    expect(r.groups[0].sessions.map((s) => s.id)).toEqual(expected)
  })

  it('sorts by status using the same severity order as status grouping', () => {
    const all: AgentState[] = ['idle', 'exited', 'working', 'awaiting-input']
    const r = build(
      all.map((agentState, i) => session(String(i), { agentState })),
      view({ sortBy: 'status' })
    )
    expect(r.groups[0].sessions.map((s) => s.agentState)).toEqual([
      'awaiting-input',
      'working',
      'idle',
      'exited',
    ])
  })

  it('sorts names case-insensitively', () => {
    const r = build(
      [session('x', { tabTitle: 'beta' }), session('y', { tabTitle: 'Alpha' })],
      view({ sortBy: 'name' })
    )
    expect(r.groups[0].sessions.map((s) => s.tabTitle)).toEqual(['Alpha', 'beta'])
  })
})

describe('buildGroups — filtering', () => {
  it('reports shown and total so a filtered view can explain itself', () => {
    const r = build(
      [session('a', { agentState: 'working' }), session('b'), session('c')],
      view({ filters: { states: ['working'] } })
    )
    expect({ shown: r.shown, total: r.total }).toEqual({ shown: 1, total: 3 })
  })

  it('reports shown equal to total when nothing is filtered', () => {
    const r = build([session('a'), session('b')])
    expect({ shown: r.shown, total: r.total }).toEqual({ shown: 2, total: 2 })
  })

  it.each([
    ['session title', 'char'],
    ['project name', 'api'],
    ['branch', 'main'],
    ['note', 'review'],
  ])('matches the query against the %s', (_label, query) => {
    const s = session('c', { tabTitle: 'Charlie', note: 'waiting on review' })
    const r = build(
      [s, session('other', { projectId: 'p3', tabTitle: 'zzz' })],
      view({ filters: { query } })
    )
    expect(r.shown).toBe(1)
    expect(r.groups[0].sessions[0].id).toBe('c')
  })

  it('matches the query case-insensitively', () => {
    const r = build([session('a', { tabTitle: 'Deploy' })], view({ filters: { query: 'DEPLOY' } }))
    expect(r.shown).toBe(1)
  })

  it('filters by project id', () => {
    const r = build(
      [session('a'), session('b', { projectId: 'p2' })],
      view({ filters: { projectIds: ['p2'] } })
    )
    expect(r.groups[0].sessions.map((s) => s.id)).toEqual(['b'])
  })

  it('filters by several states at once', () => {
    const r = build(
      [
        session('w', { agentState: 'working' }),
        session('n', { agentState: 'awaiting-input' }),
        session('i'),
      ],
      view({ filters: { states: ['working', 'awaiting-input'] } })
    )
    expect(r.shown).toBe(2)
  })

  it('staleOnly keeps only stale sessions', () => {
    const r = build(
      [session('fresh'), session('old', { lastActivityAt: 0 })],
      view({ filters: { staleOnly: true } })
    )
    expect(r.groups[0].sessions.map((s) => s.id)).toEqual(['old'])
  })

  it('hideStale drops stale sessions', () => {
    const r = build(
      [session('fresh'), session('old', { lastActivityAt: 0 })],
      view({ filters: { hideStale: true } })
    )
    expect(r.groups[0].sessions.map((s) => s.id)).toEqual(['fresh'])
  })

  it('never treats an awaiting-input session as stale, even under staleOnly', () => {
    const r = build(
      [session('waiting', { agentState: 'awaiting-input', lastActivityAt: 0 })],
      view({ filters: { staleOnly: true } })
    )
    expect(r.shown).toBe(0)
  })

  it('applies query and state filters together', () => {
    const r = build(
      [
        session('a', { tabTitle: 'deploy', agentState: 'working' }),
        session('b', { tabTitle: 'deploy' }),
        session('c', { tabTitle: 'other', agentState: 'working' }),
      ],
      view({ filters: { query: 'deploy', states: ['working'] } })
    )
    expect(r.groups[0].sessions.map((s) => s.id)).toEqual(['a'])
  })
})

describe('buildGroups — purity', () => {
  it('returns deeply equal output for identical input', () => {
    const sessions = [session('a'), session('b', { projectId: 'p2' })]
    expect(build(sessions)).toEqual(build(sessions))
  })

  it('mutates none of its inputs', () => {
    const sessions = [session('b'), session('a')]
    const snapshot = JSON.stringify({ sessions, projects, workspaces })
    build(sessions, view({ sortBy: 'name' }))
    expect(JSON.stringify({ sessions, projects, workspaces })).toBe(snapshot)
  })

  it('never reads the clock itself — the same input at a later now differs', () => {
    const s = [session('a', { lastActivityAt: NOW - STALE_AFTER })]
    const v = view({ filters: { staleOnly: true } })
    expect(buildGroups(s, projects, workspaces, v, NOW, STALE_AFTER).shown).toBe(0)
    expect(buildGroups(s, projects, workspaces, v, NOW + 2, STALE_AFTER).shown).toBe(1)
  })

  it('handles an empty session list, still offering every project to start one in', () => {
    const r = build([])
    expect({ shown: r.shown, total: r.total }).toEqual({ shown: 0, total: 0 })
    expect(r.groups.map((g) => g.label)).toEqual(['API', 'Web', 'Docs'])
    expect(r.groups.every((g) => g.count === 0)).toBe(true)
  })

  it('returns no groups at all when there are no projects either', () => {
    expect(buildGroups([], [], workspaces, view(), NOW, STALE_AFTER)).toEqual({
      groups: [],
      shown: 0,
      total: 0,
    })
  })
})
