import { describe, it, expect } from 'vitest'
import { hallSigns, joinedWords } from '../../src/factory/signs.js'
import type { HallMap } from '../../src/factory/layout.js'

const tile = (kind: 'split' | 'merge', x: number, y: number) => ({
  x,
  y,
  kind,
  ins: ['W'],
  outs: ['E'],
  over: null,
})

const map = {
  width: 40,
  height: 20,
  props: [
    { id: 'fixture-statuswall', kind: 'statuswall', x: 20, y: 2, w: 3, h: 1, nodeId: null },
    { id: 'dispatch', kind: 'dispatch', x: 38, y: 8, w: 1, h: 1, nodeId: 'ci' },
  ],
  belts: [
    {
      id: 'a-b',
      fromNodeId: 'plan',
      toNodeId: 'inspect',
      path: [
        { x: 5, y: 5 },
        { x: 6, y: 5 },
      ],
    },
    {
      id: 'a-c',
      fromNodeId: 'plan',
      toNodeId: 'scribe',
      path: [
        { x: 5, y: 5 },
        { x: 6, y: 6 },
      ],
    },
    { id: 'b-d', fromNodeId: 'inspect', toNodeId: 'integrate', path: [{ x: 9, y: 5 }] },
    { id: 'c-d', fromNodeId: 'scribe', toNodeId: 'integrate', path: [{ x: 9, y: 5 }] },
  ],
  beltTiles: [tile('split', 5, 5), tile('merge', 9, 5)],
  anchors: { exit: { x: 39, y: 8 } },
} as unknown as HallMap

const labels = { inspect: 'Inspector', scribe: 'Scribe', integrate: 'Integrate' }
const none = { labels, metrics: null, queue: null, ci: null }

describe('factory/signs', () => {
  it('joins names in words', () => {
    expect(joinedWords(['A'])).toBe('A')
    expect(joinedWords(['A', 'B'])).toBe('A and B')
    expect(joinedWords(['A', 'B', 'C'])).toBe('A, B and C')
  })

  it('names where a split junction leads and what a merge flows into', () => {
    const signs = hallSigns(map, none)
    expect(signs.find((s) => s.id === 'split-5,5')?.text).toBe('Splits to Inspector and Scribe')
    expect(signs.find((s) => s.id === 'merge-9,5')?.text).toBe('Merges into Integrate')
  })

  it('labels the scoreboard with the real figures, in words', () => {
    const board = hallSigns(map, {
      ...none,
      metrics: { leadTimeMs: 25 * 60_000, reworks: 0, ciRounds: 0 },
    }).find((s) => s.id === 'scoreboard')
    expect(board?.text).toBe('Lead time 25 min · 0 reworks · 0 CI fix rounds')
    const one = hallSigns(map, {
      ...none,
      metrics: { leadTimeMs: null, reworks: 1, ciRounds: 1 },
    }).find((s) => s.id === 'scoreboard')
    expect(one?.text).toBe('Lead time not known yet · 1 rework · 1 CI fix round')
  })

  it('still names the scoreboard when the order has no figures yet', () => {
    expect(hallSigns(map, none).find((s) => s.id === 'scoreboard')?.text).toBe(
      'Scoreboard · no figures yet'
    )
  })

  it("says the order's place in the merge queue", () => {
    const plate = hallSigns(map, { ...none, queue: { position: 1 } }).find((s) => s.id === 'queue')
    expect(plate?.text).toBe('1st in the merge queue')
    expect(hallSigns(map, none).some((s) => s.id === 'queue')).toBe(false)
  })

  it('says how far the checks have got on the tower', () => {
    const ci = { checks: { a: 'pass', b: 'pending', c: 'fail' } } as const
    const tower = hallSigns(map, { ...none, ci }).find((s) => s.id === 'tower')
    expect(tower?.text).toBe('Waiting on checks · 2 of 3 done')
    const done = hallSigns(map, { ...none, ci: { checks: { a: 'pass', c: 'fail' } } }).find(
      (s) => s.id === 'tower'
    )
    expect(done?.text).toBe('Checks · 1 passed · 1 failed')
  })
})
