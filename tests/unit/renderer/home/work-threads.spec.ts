import { describe, it, expect } from 'vitest'
import {
  allWorkThreads,
  buildWorkThreads,
  groupThreads,
  type WorkThreadInput,
} from '../../../../src/renderer/home/work-threads'
import { fact } from '../sidebar/fixtures/facts'
import { facet } from './fixtures'
import type { IssueSummary } from '../../../../src/shared/types/index'

const NOW = Date.parse('2026-10-18T12:00:00.000Z')
const hoursBeforeNow = (hours: number) => NOW - hours * 3_600_000
const ticket = (key: string, source: 'project' | 'session' = 'project') =>
  ({ source, ref: { tracker: 'linear' as const, key } }) as const
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

  it('ignores closed session records', () => {
    expect(buildWorkThreads(input({ facts: [working({ isClosed: true })] }))).toEqual([])
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
