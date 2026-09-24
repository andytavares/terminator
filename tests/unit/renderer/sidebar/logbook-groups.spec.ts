import { describe, it, expect } from 'vitest'
import {
  buildLogbook,
  headlineOf,
  suggestWorkItems,
} from '../../../../src/renderer/sidebar/logbook-groups'
import { fact } from './fixtures/facts'
import type { IssueSummary } from '../../../../src/shared/types/index'

const titles = new Map([['linear:NW-88', 'Rate limit per API key']])

describe('buildLogbook', () => {
  const T1 = '2026-09-15T10:00:00.000Z'
  const T2 = '2026-09-15T10:01:00.000Z'
  const facts = [
    fact({ sessionId: 'idle-old', state: 'idle', startedAt: T1 }),
    fact({
      sessionId: 'closed-old',
      isClosed: true,
      state: 'exited',
      closedAt: '2026-09-14T00:00:00.000Z',
    }),
    fact({ sessionId: 'needs', state: 'awaiting-input' }),
    fact({ sessionId: 'idle-new', state: 'idle', startedAt: T2 }),
    fact({
      sessionId: 'closed-new',
      isClosed: true,
      state: 'exited',
      closedAt: '2026-09-15T00:00:00.000Z',
    }),
    fact({ sessionId: 'exited', state: 'exited' }),
  ]

  it('groups needs you, running, and exited, oldest first within a group', () => {
    expect(
      buildLogbook(facts, '', titles).map((g) => [g.label, g.facts.map((f) => f.sessionId)])
    ).toEqual([
      ['Needs you', ['needs']],
      ['Running', ['idle-old', 'idle-new']],
      ['Exited', ['exited']],
      ['Closed', ['closed-new', 'closed-old']],
    ])
  })

  it('keeps working and idle sessions in the same Running group, unmoved by a state flip', () => {
    const T3 = '2026-09-15T10:02:00.000Z'
    const running = [
      fact({ sessionId: 'w1', state: 'working', startedAt: T1 }),
      fact({ sessionId: 'w2', state: 'idle', startedAt: T3 }),
    ]
    const before = buildLogbook(running, '', titles)[0].facts.map((f) => f.sessionId)
    const flipped = running.map((f) =>
      f.sessionId === 'w1' ? { ...f, state: 'idle' as const } : f
    )
    const after = buildLogbook(flipped, '', titles)[0].facts.map((f) => f.sessionId)
    expect(after).toEqual(before)
  })

  it('leaves out a group with nothing in it', () => {
    expect(buildLogbook([fact({ state: 'working' })], '', titles).map((g) => g.label)).toEqual([
      'Running',
    ])
  })

  it('applies the text filter', () => {
    const described = fact({ sessionId: 'd', description: 'Ghostty keybinds' })
    expect(buildLogbook([described, fact({ sessionId: 'x' })], 'ghostty', titles)[0].facts).toEqual(
      [described]
    )
  })
})

describe('headlineOf', () => {
  it("is the ticket's title when the session works on one", () => {
    const linked = fact({
      workItem: { source: 'project', ref: { tracker: 'linear', key: 'NW-88' } },
      description: 'ignored',
    })
    expect(headlineOf(linked, titles)).toEqual({ text: 'Rate limit per API key', blank: false })
  })

  it("is the ticket's key while its title is not known", () => {
    const linked = fact({
      workItem: { source: 'session', ref: { tracker: 'linear', key: 'NW-91' } },
    })
    expect(headlineOf(linked, titles)).toEqual({ text: 'NW-91', blank: false })
  })

  it("is the description's first line otherwise", () => {
    expect(headlineOf(fact({ description: 'Ghostty\nkeybinds' }), titles)).toEqual({
      text: 'Ghostty',
      blank: false,
    })
  })

  it('asks for a description when there is neither', () => {
    expect(headlineOf(fact(), titles)).toEqual({ text: 'Add a description', blank: true })
  })
})

describe('suggestWorkItems', () => {
  const issue = (key: string): IssueSummary =>
    ({ tracker: 'linear', key, title: key }) as IssueSummary
  const mine = [issue('A-1'), issue('A-2'), issue('A-3'), issue('A-4')]

  it("offers the user's own tickets, three at most", () => {
    expect(suggestWorkItems(fact(), null, mine).map((i) => i.key)).toEqual(['A-1', 'A-2', 'A-3'])
  })

  it("puts the project's ticket first when the session is on a different one", () => {
    const own = fact({ workItem: { source: 'session', ref: { tracker: 'linear', key: 'A-2' } } })
    expect(suggestWorkItems(own, issue('P-1'), mine).map((i) => i.key)).toEqual([
      'P-1',
      'A-1',
      'A-3',
    ])
  })

  it('does not suggest the ticket the session already shows', () => {
    const inherited = fact({
      workItem: { source: 'project', ref: { tracker: 'linear', key: 'P-1' } },
    })
    expect(
      suggestWorkItems(inherited, issue('P-1'), [issue('P-1'), ...mine]).map((i) => i.key)
    ).toEqual(['A-1', 'A-2', 'A-3'])
  })

  it('lists a ticket once even when it is both the project ticket and one of mine', () => {
    expect(suggestWorkItems(fact(), issue('A-1'), mine).map((i) => i.key)).toEqual([
      'A-1',
      'A-2',
      'A-3',
    ])
  })

  it('tells the same key in two trackers apart', () => {
    const jira = { ...issue('A-1'), tracker: 'jira' } as IssueSummary
    expect(suggestWorkItems(fact(), null, [issue('A-1'), jira]).map((i) => i.tracker)).toEqual([
      'linear',
      'jira',
    ])
  })
})
