import { describe, it, expect } from 'vitest'
import {
  allWorkThreads,
  buildWorkThreads,
  groupThreads,
  latestResumableThread,
  type WorkThreadInput,
} from '../../../../src/renderer/home/work-threads'
import { fact } from '../sidebar/fixtures/facts'
import { facet, task } from './fixtures'
import { ticket } from './desk-world'
import type { IssueSummary } from '../../../../src/shared/types/index'
import type { SessionFacts } from '../../../../src/renderer/sidebar/session-facts'

const NOW = Date.parse('2026-10-18T12:00:00.000Z')
const hoursBeforeNow = (hours: number) => NOW - hours * 3_600_000
const issue = (key: string, title: string) => ({ tracker: 'linear', key, title }) as IssueSummary

function input(patch: Partial<WorkThreadInput>): WorkThreadInput {
  return {
    facts: [],
    facets: [],
    issues: [],
    changeStats: new Map(),
    tasks: [],
    repoRoots: new Map([
      ['p1', '/repos/terminator'],
      ['p2', '/repos/other'],
    ]),
    repos: new Map(),
    now: NOW,
    ...patch,
  }
}

const working = (patch = {}) =>
  fact({ state: 'working', lastActivityAt: hoursBeforeNow(1), branch: 'tav-31', ...patch })

describe('joining', () => {
  it('puts a ticket-linked session and a branch-keyed pull request on the same branch in one thread', () => {
    const threads = buildWorkThreads(
      input({
        facts: [working({ workItem: ticket('TAV-31') })],
        facets: [facet()],
        issues: [issue('TAV-31', 'Rate limit')],
      })
    )
    expect(threads).toHaveLength(1)
    expect(threads[0]).toMatchObject({
      key: 'linear:TAV-31',
      ticketKey: 'TAV-31',
      title: 'Rate limit',
    })
    expect(threads[0].facets).toHaveLength(1)
  })

  it('never joins the same branch name in two repos', () => {
    const threads = buildWorkThreads(
      input({
        facts: [working({ sessionId: 'a' }), working({ sessionId: 'b', projectId: 'p2' })],
      })
    )
    expect(threads.map((t) => t.key).sort()).toEqual([
      '/repos/other#tav-31',
      '/repos/terminator#tav-31',
    ])
  })
})

describe('joining: tickets', () => {
  it("keeps a session linked to another ticket in that ticket's thread", () => {
    const threads = buildWorkThreads(
      input({
        facts: [
          working({ sessionId: 'a', workItem: ticket('TAV-31') }),
          working({ sessionId: 'b', workItem: ticket('TAV-9', 'session') }),
        ],
      })
    )
    expect(threads.map((t) => t.key).sort()).toEqual(['linear:TAV-31', 'linear:TAV-9'])
  })
})

describe('joining: facets without a session', () => {
  it('gives a pull request with no ticket a branch thread', () => {
    const [thread] = buildWorkThreads(input({ facets: [facet()] }))
    expect(thread).toMatchObject({
      key: '/repos/terminator#tav-31',
      lanes: [{ repoRoot: '/repos/terminator', branch: 'tav-31', repoName: 'terminator' }],
    })
    expect(thread.ticketKey).toBeUndefined()
  })

  it('excludes a merged pull request with no open session, but allWorkThreads keeps it', () => {
    const merged = facet({ stage: 'shipped', closedAt: '2026-10-18T10:00:00.000Z' })
    expect(buildWorkThreads(input({ facets: [merged] }))).toEqual([])
    expect(allWorkThreads(input({ facets: [merged] }))[0].closed).toBe(true)
  })

  it('keeps a merged pull request while a session is still open on it', () => {
    const merged = facet({ stage: 'shipped', closedAt: '2026-10-18T10:00:00.000Z' })
    expect(buildWorkThreads(input({ facts: [working()], facets: [merged] }))).toHaveLength(1)
  })

  it('ignores a closed scratch terminal, which belongs to no work', () => {
    const scratch = fact({
      isClosed: true,
      projectId: null,
      snapshot: { ...fact().snapshot, projectId: '' },
    })
    expect(buildWorkThreads(input({ facts: [scratch] }))).toEqual([])
  })
})

/** A session that has ended: its record keeps the project only in the snapshot. */
const ended = (patch: Partial<SessionFacts> = {}) =>
  fact({
    isClosed: true,
    state: 'exited',
    projectId: null,
    resumable: true,
    branch: 'tav-31',
    lastActivityAt: hoursBeforeNow(1),
    ...patch,
  })

describe('joining: sessions that have ended', () => {
  it('lists a resumable closed session with the open ones on its branch', () => {
    const [thread] = buildWorkThreads(
      input({ facts: [ended({ sessionId: 'old' }), working({ sessionId: 'live' })] })
    )
    expect(thread.sessions.map((s) => s.sessionId)).toEqual(['live', 'old'])
    expect(thread.lanes.map((l) => l.branch)).toEqual(['tav-31'])
  })

  it('keeps a thread whose only sessions have ended, quiet and never parked by a timer', () => {
    const stale = ended({ lastActivityAt: hoursBeforeNow(49) })
    const [thread] = buildWorkThreads(input({ facts: [stale] }))
    expect(thread).toMatchObject({ state: 'quiet', archived: false, closed: false })
  })

  it('drops the thread once its pull request has merged', () => {
    const merged = facet({ stage: 'shipped', closedAt: '2026-10-18T10:00:00.000Z' })
    expect(buildWorkThreads(input({ facts: [ended()], facets: [merged] }))).toEqual([])
    expect(buildWorkThreads(input({ facts: [ended()], facets: [facet()] }))).toHaveLength(1)
  })

  it('keeps an ended session that is not resumable, within its retention', () => {
    const [thread] = buildWorkThreads(input({ facts: [ended({ resumable: false })] }))
    expect(thread.sessions).toHaveLength(1)
  })
})

describe('thread fields: state', () => {
  const stateFor = (facts: WorkThreadInput['facts'], facets: WorkThreadInput['facets'] = []) =>
    buildWorkThreads(input({ facts, facets }))[0].state

  it('says the most urgent state: needs-you, then running, then waiting', () => {
    const asking = working({ sessionId: 'b', state: 'awaiting-input' })
    expect(stateFor([working(), asking])).toBe('needs-you')
    expect(stateFor([working()], [facet({ whoseMove: 'you' })])).toBe('needs-you')
    expect(stateFor([working()], [facet({ whoseMove: 'others' })])).toBe('running')
    expect(stateFor([working({ state: 'idle' })], [facet({ whoseMove: 'others' })])).toBe('waiting')
  })

  it('is quiet, never waiting, for an idle branch with no pull request', () => {
    expect(stateFor([fact({ state: 'idle', branch: 'tav-31' })])).toBe('quiet')
  })

  it('marks the thread inferred when the ask comes from a bell alone', () => {
    const bell = working({ state: 'awaiting-input', askInferred: true, askSignal: 'bell' })
    const [thread] = buildWorkThreads(input({ facts: [bell] }))
    expect(thread).toMatchObject({ state: 'needs-you', inferred: true })
  })

  it('does not read a facet stage', () => {
    expect(
      stateFor([fact({ state: 'idle' })], [facet({ stage: 'shipped', whoseMove: 'agents' })])
    ).toBe('quiet')
  })
})

describe('thread fields: what is happening', () => {
  it('writes what is happening and who is working', () => {
    const [thread] = buildWorkThreads(
      input({
        facts: [
          working({ latestLine: 'Running tests' }),
          working({ sessionId: 'b', state: 'awaiting-input', askMessage: 'Allow Bash?' }),
          working({ sessionId: 'c', latestLine: 'Editing' }),
        ],
      })
    )
    expect(thread.nowLine).toBe('Asking: Allow Bash?')
    expect(thread.agentsLabel).toBe('2 working, 1 asking')
  })

  it('falls back to the pull request line, and to none for agents', () => {
    const [thread] = buildWorkThreads(
      input({ facets: [facet({ line: 'Checks failing', tone: 'bad' })] })
    )
    expect(thread).toMatchObject({
      nowLine: 'Checks failing',
      agentsLabel: 'none',
      prChip: { text: 'Checks failing', tone: 'bad' },
    })
  })
})

describe('thread fields: title and changes', () => {
  it('titles by issue, then facet, then description, then branch', () => {
    const title = (patch: Partial<WorkThreadInput>) => buildWorkThreads(input(patch))[0].title
    const linked = working({ workItem: ticket('TAV-31'), description: 'My notes' })
    expect(title({ facts: [linked], issues: [issue('TAV-31', 'From issue')] })).toBe('From issue')
    expect(title({ facts: [working({ description: 'My notes\nmore' })] })).toBe('My notes')
    expect(title({ facts: [working()] })).toBe('tav-31')
    expect(title({ facets: [facet({ title: 'Add limits' })] })).toBe('Add limits')
  })

  it('keeps a scratch session quiet and not archived, however long it sat', () => {
    const scratch = fact({ projectId: null, branch: null, lastActivityAt: hoursBeforeNow(1) })
    expect(buildWorkThreads(input({ facts: [scratch] }))[0]).toMatchObject({
      state: 'quiet',
      archived: false,
      lanes: [],
    })
    const old = working({ lastActivityAt: hoursBeforeNow(200) })
    expect(buildWorkThreads(input({ facts: [old] }))[0].archived).toBe(false)
  })

  it('carries the uncommitted change stats of its project', () => {
    const stats = { files: 4, added: 210, removed: 8 }
    const [thread] = buildWorkThreads(
      input({ facts: [working()], changeStats: new Map([['p1', stats]]) })
    )
    expect(thread.changes).toEqual(stats)
  })
})

describe('thread fields: scratch title', () => {
  it('titles a scratch session by its tab name, never by its session key', () => {
    const scratch = fact({
      projectId: null,
      projectName: null,
      branch: null,
      name: 'terminal 3',
      lastActivityAt: hoursBeforeNow(1),
    })
    const [thread] = buildWorkThreads(input({ facts: [scratch] }))
    expect(thread.title).toBe('terminal 3')
  })
})

describe('latestResumableThread', () => {
  const agent = {
    provider: 'claude' as const,
    sessionId: 'conv-1',
    cwd: '/repos/terminator',
    transcriptPath: '/repos/terminator/conv-1.jsonl',
    capturedAt: '2026-10-18T09:00:00.000Z',
  }
  const resumable = (patch: Partial<SessionFacts>) => ended({ agent, ...patch })

  it('picks the thread whose conversation ended most recently', () => {
    const threads = buildWorkThreads(
      input({
        facts: [
          resumable({ sessionId: 'a', branch: 'a', lastActivityAt: hoursBeforeNow(5) }),
          resumable({ sessionId: 'b', branch: 'b', lastActivityAt: hoursBeforeNow(2) }),
          working({ sessionId: 'c', branch: 'c' }),
        ],
      })
    )
    expect(latestResumableThread(threads)?.lanes[0].branch).toBe('b')
  })

  it('finds nothing when no ended conversation can be resumed', () => {
    const threads = buildWorkThreads(
      input({ facts: [resumable({ resumable: false }), working({ branch: 'c' })] })
    )
    expect(latestResumableThread(threads)).toBeUndefined()
  })
})

const firstBranch = (t: { lanes: { branch: string | null }[] }) => t.lanes[0].branch

describe('groupThreads', () => {
  const sessions = () => [
    working({ sessionId: 'a', branch: 'a' }),
    working({ sessionId: 'b', branch: 'b', state: 'awaiting-input' }),
    fact({ sessionId: 'd', branch: 'd', state: 'idle' }),
  ]

  it('groups by state in focus order and omits empty groups', () => {
    const groups = groupThreads(buildWorkThreads(input({ facts: sessions() })))
    expect(groups.map((g) => [g.id, g.label])).toEqual([
      ['needs-you', 'Needs you'],
      ['running', 'Running'],
      ['quiet', 'Quiet'],
    ])
  })

  it('never emits a waiting group for an idle branch', () => {
    const idle = fact({ branch: 'd', state: 'idle', lastActivityAt: hoursBeforeNow(1) })
    const groups = groupThreads(buildWorkThreads(input({ facts: [idle] })))
    expect(groups.map((g) => g.id)).toEqual(['quiet'])
  })
})

describe('groupThreads: waiting and done', () => {
  it('emits waiting for an open pull request with someone else, and done for a marked task', () => {
    const stored = task({
      doneAt: '2026-10-18T11:00:00.000Z',
      lanes: [{ repoRoot: '/r', branch: 'x' }],
    })
    const threads = buildWorkThreads(
      input({
        facts: [working({ state: 'idle' })],
        facets: [facet({ whoseMove: 'others' })],
        tasks: [stored],
      })
    )
    expect(groupThreads(threads).map((g) => [g.id, g.label])).toEqual([
      ['waiting', 'Waiting on others'],
      ['done', 'Done'],
    ])
  })
})

describe('groupThreads: archived and order', () => {
  it('leaves archived threads out', () => {
    const archived = task({ archivedAt: '2026-10-18T11:00:00.000Z' })
    const threads = buildWorkThreads(input({ tasks: [archived] }))
    expect(threads).toHaveLength(1)
    expect(groupThreads(threads)).toEqual([])
  })

  it('puts the focused task first in its group, then the newest', () => {
    const focused = task({ focus: true, lanes: [{ repoRoot: '/repos/terminator', branch: 'a' }] })
    const threads = buildWorkThreads(
      input({
        facts: [
          fact({ sessionId: 'a', branch: 'a', startedAt: '2026-10-18T08:00:00.000Z' }),
          fact({ sessionId: 'b', branch: 'b', startedAt: '2026-10-18T09:00:00.000Z' }),
          fact({ sessionId: 'c', branch: 'c', startedAt: '2026-10-18T10:00:00.000Z' }),
        ],
        tasks: [focused],
      })
    )
    const [quiet] = groupThreads(threads)
    expect(quiet.threads.map((t) => t.taskId ?? firstBranch(t))).toEqual([focused.id, 'c', 'b'])
  })
})

describe('groupThreads: order', () => {
  it('orders a group by when the work began, so output never moves a row', () => {
    const facts = (activity: { a: number; b: number }) => [
      working({
        sessionId: 'a',
        branch: 'a',
        startedAt: '2026-10-18T08:00:00.000Z',
        lastActivityAt: hoursBeforeNow(activity.a),
      }),
      working({
        sessionId: 'b',
        branch: 'b',
        startedAt: '2026-10-18T09:00:00.000Z',
        lastActivityAt: hoursBeforeNow(activity.b),
      }),
    ]
    const order = (activity: { a: number; b: number }) =>
      groupThreads(buildWorkThreads(input({ facts: facts(activity) })))[0].threads.map(firstBranch)
    expect(order({ a: 5, b: 1 })).toEqual(['b', 'a'])
    expect(order({ a: 1, b: 5 })).toEqual(['b', 'a'])
  })
})

const repoRoots = new Map([
  ['p1', '/repos/api'],
  ['p2', '/repos/web'],
  ['p3', '/repos/docs'],
])
const lanes = [
  { repoRoot: '/repos/api', branch: 'limits' },
  { repoRoot: '/repos/web', branch: 'limits-ui' },
  { repoRoot: '/repos/docs', branch: 'limits-docs' },
]
const threeRepos = () =>
  lanes.map((lane, i) =>
    working({
      workspaceName: null,
      sessionId: `s${i}`,
      projectId: `p${i + 1}`,
      branch: lane.branch,
    })
  )

describe('tasks', () => {
  it('joins the three lanes of a stored task into one thread with three lanes', () => {
    const stored = task({ lanes })
    const threads = buildWorkThreads(input({ facts: threeRepos(), tasks: [stored], repoRoots }))
    expect(threads).toHaveLength(1)
    expect(threads[0]).toMatchObject({
      key: `task:${stored.id}`,
      taskId: stored.id,
      title: 'Rate limits',
    })
    expect(threads[0].lanes.map((l) => [l.repoName, l.branch, l.state])).toEqual([
      ['api', 'limits', 'running'],
      ['web', 'limits-ui', 'running'],
      ['docs', 'limits-docs', 'running'],
    ])
  })

  it("lets a lane's task beat the session's ticket link", () => {
    const stored = task({ lanes: [lanes[0]] })
    const linked = working({ projectId: 'p1', branch: 'limits', workItem: ticket('TAV-31') })
    const [thread] = buildWorkThreads(input({ facts: [linked], tasks: [stored], repoRoots }))
    expect(thread.key).toBe(`task:${stored.id}`)
  })
})

describe('tasks: implicit and empty lanes', () => {
  it('makes one implicit thread with two lanes of a ticket across two repos', () => {
    const facts = threeRepos()
      .slice(0, 2)
      .map((f) => ({ ...f, workItem: ticket('TAV-31') }))
    const threads = buildWorkThreads(input({ facts, repoRoots }))
    expect(threads).toHaveLength(1)
    expect(threads[0]).toMatchObject({ key: 'linear:TAV-31', taskId: null })
    expect(threads[0].lanes.map((l) => l.repoName)).toEqual(['api', 'web'])
  })

  it('still shows a stored lane with nothing running on it', () => {
    const [thread] = buildWorkThreads(
      input({ facts: [threeRepos()[0]], tasks: [task({ lanes })], repoRoots })
    )
    expect(thread.lanes.map((l) => [l.branch, l.state])).toEqual([
      ['limits', 'running'],
      ['limits-ui', 'quiet'],
      ['limits-docs', 'quiet'],
    ])
  })
})

describe('tasks: lane names', () => {
  it('names a lane with nothing running by its repo, not by its folder', () => {
    const repos = new Map([['/repos/web', { name: 'web-console', color: '#3b82f6' }]])
    const stored = task({ lanes: [{ repoRoot: '/repos/web', branch: 'limits' }] })
    const [thread] = buildWorkThreads(input({ tasks: [stored], repos }))
    expect(thread.lanes[0]).toMatchObject({ repoName: 'web-console', repoColor: '#3b82f6' })
  })
})

describe('tasks: archived and done', () => {
  it('holds the sessions of an archived task so they do not show as loose threads', () => {
    const archived = task({ lanes, archivedAt: '2026-10-18T11:00:00.000Z' })
    const threads = buildWorkThreads(input({ facts: threeRepos(), tasks: [archived], repoRoots }))
    expect(threads).toHaveLength(1)
    expect(threads[0]).toMatchObject({ archived: true, taskId: archived.id })
  })

  it('carries focus and doneAt from the stored task', () => {
    const stored = task({ lanes, focus: true, doneAt: '2026-10-18T11:00:00.000Z' })
    const [thread] = buildWorkThreads(input({ facts: threeRepos(), tasks: [stored], repoRoots }))
    expect(thread).toMatchObject({ focus: true, doneAt: stored.doneAt, state: 'done' })
  })
})

describe('tasks: facets', () => {
  const stored = task({ lanes: [{ repoRoot: '/repos/terminator', branch: 'tav-31' }] })

  it('joins a pull request facet on a stored lane to its task', () => {
    const [thread] = buildWorkThreads(input({ facets: [facet()], tasks: [stored] }))
    expect(thread).toMatchObject({ key: `task:${stored.id}`, state: 'waiting' })
  })
})

describe('thread links', () => {
  const artifact = { label: 'Open artifact', url: 'https://claude.ai/artifact/abc' }

  it("carries every facet's links, once per address", () => {
    const duplicate = { label: 'Artifact again', url: artifact.url }
    const other = { label: 'Open document', url: 'https://example.com/doc' }
    const [thread] = buildWorkThreads(
      input({
        facets: [facet({ links: [artifact] }), facet({ kind: 'order', links: [duplicate, other] })],
      })
    )
    expect(thread.links).toEqual([artifact, other])
  })

  it('has none when no facet publishes any', () => {
    expect(buildWorkThreads(input({ facets: [facet()] }))[0].links).toEqual([])
  })
})
