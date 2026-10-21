import { describe, it, expect } from 'vitest'
import {
  allWorkThreads,
  buildWorkThreads,
  groupThreads,
  latestResumableThread,
  type WorkThreadInput,
} from '../../../../src/renderer/home/work-threads'
import { fact } from '../sidebar/fixtures/facts'
import { facet } from './fixtures'
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
    repoRoots: new Map([
      ['p1', '/repos/terminator'],
      ['p2', '/repos/other'],
    ]),
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
      branch: 'tav-31',
      repoName: 'terminator',
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
    expect(thread.branch).toBe('tav-31')
  })

  it('keeps a thread whose only sessions have ended, in In flight until 48 hours pass', () => {
    const [recent] = buildWorkThreads(input({ facts: [ended()] }))
    expect(recent).toMatchObject({ whoseMove: 'others', parked: false, closed: false })
    const [stale] = buildWorkThreads(
      input({ facts: [ended({ lastActivityAt: hoursBeforeNow(49) })] })
    )
    expect(stale.parked).toBe(true)
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

describe('thread fields', () => {
  it('takes the furthest facet stage, and building when only a session exists', () => {
    const two = buildWorkThreads(
      input({
        facts: [working()],
        facets: [facet({ stage: 'in-review' }), facet({ kind: 'task', stage: 'building' })],
      })
    )
    expect(two[0].stage).toBe('in-review')
    expect(buildWorkThreads(input({ facts: [working()] }))[0].stage).toBe('building')
  })

  it('leaves a Foundry order that is shaping at shaping', () => {
    const order = facet({ kind: 'order', stage: 'shaping' })
    expect(buildWorkThreads(input({ facts: [working()], facets: [order] }))[0].stage).toBe(
      'shaping'
    )
  })
})

describe('thread fields: who moves next', () => {
  it('says whose move it is: you beats agents beats others', () => {
    const whoseMoveFor = (
      facts: WorkThreadInput['facts'],
      facets: WorkThreadInput['facets'] = []
    ) => buildWorkThreads(input({ facts, facets }))[0].whoseMove
    expect(whoseMoveFor([working(), working({ sessionId: 'b', state: 'awaiting-input' })])).toBe(
      'you'
    )
    expect(whoseMoveFor([working()], [facet({ whoseMove: 'you' })])).toBe('you')
    expect(whoseMoveFor([working()], [facet({ whoseMove: 'others' })])).toBe('agents')
    expect(
      whoseMoveFor([fact({ state: 'idle', lastActivityAt: hoursBeforeNow(1) })], [facet()])
    ).toBe('others')
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

describe('thread fields: title, parking and changes', () => {
  it('titles by issue, then facet, then description, then branch', () => {
    const title = (patch: Partial<WorkThreadInput>) => buildWorkThreads(input(patch))[0].title
    const linked = working({ workItem: ticket('TAV-31'), description: 'My notes' })
    expect(title({ facts: [linked], issues: [issue('TAV-31', 'From issue')] })).toBe('From issue')
    expect(title({ facts: [working({ description: 'My notes\nmore' })] })).toBe('My notes')
    expect(title({ facts: [working()] })).toBe('tav-31')
    expect(title({ facets: [facet({ title: 'Add limits' })] })).toBe('Add limits')
  })

  it('parks a scratch session and anything untouched for 48 hours', () => {
    const scratch = fact({ projectId: null, branch: null, lastActivityAt: hoursBeforeNow(1) })
    expect(buildWorkThreads(input({ facts: [scratch] }))[0].parked).toBe(true)
    expect(
      buildWorkThreads(input({ facts: [working({ lastActivityAt: hoursBeforeNow(47) })] }))[0]
        .parked
    ).toBe(false)
    expect(
      buildWorkThreads(input({ facts: [working({ lastActivityAt: hoursBeforeNow(49) })] }))[0]
        .parked
    ).toBe(true)
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
    expect(latestResumableThread(threads)?.branch).toBe('b')
  })

  it('finds nothing when no ended conversation can be resumed', () => {
    const threads = buildWorkThreads(
      input({ facts: [resumable({ resumable: false }), working({ branch: 'c' })] })
    )
    expect(latestResumableThread(threads)).toBeUndefined()
  })
})

describe('groupThreads', () => {
  it('groups, puts your move first in Agents working, and omits empty groups', () => {
    const threads = buildWorkThreads(
      input({
        facts: [
          working({ sessionId: 'a', branch: 'a', lastActivityAt: hoursBeforeNow(1) }),
          working({
            sessionId: 'b',
            branch: 'b',
            state: 'awaiting-input',
            lastActivityAt: hoursBeforeNow(3),
          }),
          working({ sessionId: 'c', branch: 'c', lastActivityAt: hoursBeforeNow(60) }),
          fact({ sessionId: 'd', branch: 'd', state: 'idle', lastActivityAt: hoursBeforeNow(1) }),
        ],
      })
    )
    const groups = groupThreads(threads)
    expect(groups.map((g) => [g.id, g.label])).toEqual([
      ['agents', 'Agents working'],
      ['others', 'Waiting on others'],
      ['parked', 'Parked'],
    ])
    expect(groups[0].threads.map((t) => t.branch)).toEqual(['b', 'a'])
    expect(groupThreads(threads.filter((t) => !t.parked)).map((g) => g.id)).toEqual([
      'agents',
      'others',
    ])
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
      groupThreads(buildWorkThreads(input({ facts: facts(activity) })))[0].threads.map(
        (t) => t.branch
      )
    expect(order({ a: 5, b: 1 })).toEqual(['b', 'a'])
    expect(order({ a: 1, b: 5 })).toEqual(['b', 'a'])
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
