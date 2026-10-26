import { describe, it, expect } from 'vitest'
import { isoMinutesBefore } from './desk-world'
import {
  ageLabel,
  askSignature,
  isHot,
  orderAsks,
  type Dismissals,
} from '../../../../src/renderer/home/desk-order'
import type { HomeAsk } from '../../../../src/shared/schemas/home-feed.schema'

const NOW = Date.parse('2026-10-18T12:00:00.000Z')

interface AskSpec {
  id: string
  kind: HomeAsk['kind']
  ageMinutes: number
  detail?: string
}

function ask(spec: AskSpec): HomeAsk {
  const { id, kind, ageMinutes, detail = 'd' } = spec
  return {
    id,
    kind,
    title: id,
    detail,
    facts: ['f'],
    workKey: null,
    since: isoMinutesBefore(NOW, ageMinutes),
    actions: [],
    open: { command: 'x' },
  }
}

const MIXED_KINDS = [
  ['task', 'task', 90],
  ['fin', 'finished', 5],
  ['ans-new', 'answer', 1],
  ['ans-old', 'answer', 30],
  ['fix', 'fix', 2],
  ['rev', 'review', 2],
  ['dec', 'decide', 2],
] as const

describe('orderAsks', () => {
  it('orders by kind, then oldest first', () => {
    const ordered = orderAsks(
      MIXED_KINDS.map(([id, kind, ageMinutes]) => ask({ id, kind, ageMinutes })),
      {},
      NOW
    )
    expect(ordered.map((a) => a.id)).toEqual([
      'ans-old',
      'ans-new',
      'fix',
      'rev',
      'dec',
      'fin',
      'task',
    ])
  })
})

describe('orderAsks: done', () => {
  it('hides done items', () => {
    const d: Dismissals = { a: { kind: 'done', at: NOW } }
    expect(
      orderAsks(
        [
          ask({ id: 'a', kind: 'answer', ageMinutes: 1 }),
          ask({ id: 'b', kind: 'answer', ageMinutes: 1 }),
        ],
        d,
        NOW
      ).map((x) => x.id)
    ).toEqual(['b'])
  })
})

describe('snooze', () => {
  const a = ask({ id: 'a', kind: 'answer', ageMinutes: 10 })
  const snoozed = (until: number, signature = askSignature(a)): Dismissals => ({
    a: { kind: 'snoozed', at: NOW - 1000, until, signature },
  })

  it('hides until it expires', () => {
    expect(orderAsks([a], snoozed(NOW + 1000), NOW)).toEqual([])
  })
  it('returns once the snooze has expired', () => {
    expect(orderAsks([a], snoozed(NOW - 1), NOW)).toHaveLength(1)
  })
  it('wakes early when the detail changed since snoozing', () => {
    const changed = { ...a, detail: 'now different' }
    expect(orderAsks([changed], snoozed(NOW + 1000), NOW)).toHaveLength(1)
  })
  it('wakes early when the facts changed', () => {
    const changed = { ...a, facts: ['f', 'new'] }
    expect(orderAsks([changed], snoozed(NOW + 1000), NOW)).toHaveLength(1)
  })
})

describe('ageLabel', () => {
  it.each([
    [0, '1 min'],
    [4, '4 min'],
    [59, '59 min'],
    [180, '3 h'],
    [60 * 48, '2 d'],
  ])('%i minutes reads %s', (m, label) => {
    expect(ageLabel(isoMinutesBefore(NOW, m), NOW)).toBe(label)
  })
})

describe('isHot', () => {
  it('is an answer older than two minutes', () => {
    expect(isHot(ask({ id: 'a', kind: 'answer', ageMinutes: 3 }), NOW)).toBe(true)
    expect(isHot(ask({ id: 'a', kind: 'answer', ageMinutes: 2 }), NOW)).toBe(false)
    expect(isHot(ask({ id: 'a', kind: 'finished', ageMinutes: 30 }), NOW)).toBe(false)
  })
})

describe('orderAsks — told before guessed', () => {
  it('puts a reported answer before an older inferred one, and still oldest first within each', () => {
    const answer = (id: string, ageMinutes: number, inferred: boolean) => ({
      ...ask({ id, kind: 'answer', ageMinutes }),
      ...(inferred ? { inferred: true } : {}),
    })
    const ordered = orderAsks(
      [
        answer('guess-old', 40, true),
        answer('told-new', 1, false),
        answer('guess-new', 2, true),
        answer('told-old', 10, false),
        ask({ id: 'fix', kind: 'fix', ageMinutes: 90 }),
      ],
      {},
      NOW
    )
    expect(ordered.map((a) => a.id)).toEqual([
      'told-old',
      'told-new',
      'guess-old',
      'guess-new',
      'fix',
    ])
  })
})
