import { describe, it, expect } from 'vitest'
import { queue, laterOverlapping, advisory } from '../../src/line/refinery.js'
import type { QueueEntry } from '../../src/line/refinery.js'

// Two orders agreed against the same repo+base can each be correct on their
// own and still conflict on disk if they touch the same files — the second
// one to land does a merge, not a build. The queue is the read of "who's
// ahead of whom", scoped to files that actually overlap.

function entry(
  partial: Partial<QueueEntry> & Pick<QueueEntry, 'orderId' | 'agreedAt'>
): QueueEntry {
  return {
    title: partial.orderId,
    repo: '/repos/a',
    base: 'main',
    files: [],
    merged: false,
    ...partial,
  }
}

describe('queue', () => {
  it('orders unmerged entries by agreedAt within a repo+base group, noting only overlaps behind', () => {
    const entries = [
      entry({ orderId: 'WO-1', agreedAt: '2026-09-01T00:00:00.000Z', files: ['a.ts'] }),
      entry({ orderId: 'WO-2', agreedAt: '2026-09-02T00:00:00.000Z', files: ['a.ts', 'b.ts'] }),
      entry({ orderId: 'WO-3', agreedAt: '2026-09-03T00:00:00.000Z', files: ['c.ts'] }),
    ]
    const positions = queue(entries)
    expect(positions.map((p) => [p.orderId, p.position])).toEqual([
      ['WO-1', 1],
      ['WO-2', 2],
      ['WO-3', 3],
    ])
    expect(positions.find((p) => p.orderId === 'WO-1')?.behind).toEqual([])
    expect(positions.find((p) => p.orderId === 'WO-2')?.behind).toEqual([
      { orderId: 'WO-1', title: 'WO-1', files: ['a.ts'] },
    ])
    expect(positions.find((p) => p.orderId === 'WO-3')?.behind).toEqual([])
  })

  it('keeps different base branches in separate queues', () => {
    const entries = [
      entry({ orderId: 'WO-1', agreedAt: '2026-09-01T00:00:00.000Z', files: ['a.ts'] }),
      entry({
        orderId: 'WO-2',
        agreedAt: '2026-09-02T00:00:00.000Z',
        files: ['a.ts'],
        base: 'develop',
      }),
    ]
    const positions = queue(entries)
    expect(positions.map((p) => [p.orderId, p.position])).toEqual([
      ['WO-1', 1],
      ['WO-2', 1],
    ])
    expect(positions.find((p) => p.orderId === 'WO-2')?.behind).toEqual([])
  })

  it('excludes merged entries from positions and from behind lists', () => {
    const entries = [
      entry({
        orderId: 'WO-1',
        agreedAt: '2026-09-01T00:00:00.000Z',
        files: ['a.ts'],
        merged: true,
      }),
      entry({ orderId: 'WO-2', agreedAt: '2026-09-02T00:00:00.000Z', files: ['a.ts'] }),
      entry({ orderId: 'WO-3', agreedAt: '2026-09-03T00:00:00.000Z', files: ['a.ts'] }),
    ]
    const positions = queue(entries)
    expect(positions.map((p) => p.orderId)).toEqual(['WO-2', 'WO-3'])
    expect(positions.find((p) => p.orderId === 'WO-2')?.position).toBe(1)
    expect(positions.find((p) => p.orderId === 'WO-3')?.position).toBe(2)
    expect(positions.find((p) => p.orderId === 'WO-3')?.behind).toEqual([
      { orderId: 'WO-2', title: 'WO-2', files: ['a.ts'] },
    ])
  })
})

describe('laterOverlapping', () => {
  it('names only later unmerged orders that share a file with the merged one', () => {
    const entries = [
      entry({
        orderId: 'WO-1',
        agreedAt: '2026-09-01T00:00:00.000Z',
        files: ['a.ts'],
        merged: true,
      }),
      entry({ orderId: 'WO-2', agreedAt: '2026-09-02T00:00:00.000Z', files: ['a.ts', 'b.ts'] }),
      entry({ orderId: 'WO-3', agreedAt: '2026-09-03T00:00:00.000Z', files: ['c.ts'] }),
      entry({ orderId: 'WO-0', agreedAt: '2026-08-31T00:00:00.000Z', files: ['a.ts'] }),
    ]
    expect(laterOverlapping(entries, 'WO-1')).toEqual([{ orderId: 'WO-2', files: ['a.ts'] }])
  })
})

describe('advisory', () => {
  it('is null when the draft overlaps nothing', () => {
    const entries = [
      entry({ orderId: 'WO-1', agreedAt: '2026-09-01T00:00:00.000Z', files: ['a.ts'] }),
    ]
    expect(advisory({ repo: '/repos/a', base: 'main', files: ['z.ts'] }, entries)).toBeNull()
  })

  it('names a single overlapping order in the singular', () => {
    const entries = [
      entry({
        orderId: 'WO-1',
        title: 'Fix login',
        agreedAt: '2026-09-01T00:00:00.000Z',
        files: ['a.ts', 'b.ts'],
      }),
    ]
    expect(advisory({ repo: '/repos/a', base: 'main', files: ['a.ts', 'b.ts'] }, entries)).toBe(
      'Overlaps WO-1 on 2 files; it will queue behind it.'
    )
  })

  it('names multiple overlapping orders in the plural, counting distinct shared files', () => {
    const entries = [
      entry({ orderId: 'WO-1', agreedAt: '2026-09-01T00:00:00.000Z', files: ['a.ts'] }),
      entry({
        orderId: 'WO-2',
        agreedAt: '2026-09-02T00:00:00.000Z',
        files: ['a.ts', 'b.ts', 'c.ts'],
      }),
    ]
    expect(
      advisory({ repo: '/repos/a', base: 'main', files: ['a.ts', 'b.ts', 'c.ts'] }, entries)
    ).toBe('Overlaps WO-1 and WO-2 on 3 files; it will queue behind them.')
  })

  it('ignores merged entries and entries in a different repo or base', () => {
    const entries = [
      entry({
        orderId: 'WO-1',
        agreedAt: '2026-09-01T00:00:00.000Z',
        files: ['a.ts'],
        merged: true,
      }),
      entry({
        orderId: 'WO-2',
        agreedAt: '2026-09-01T00:00:00.000Z',
        files: ['a.ts'],
        base: 'develop',
      }),
      entry({
        orderId: 'WO-3',
        agreedAt: '2026-09-01T00:00:00.000Z',
        files: ['a.ts'],
        repo: '/repos/b',
      }),
    ]
    expect(advisory({ repo: '/repos/a', base: 'main', files: ['a.ts'] }, entries)).toBeNull()
  })
})
