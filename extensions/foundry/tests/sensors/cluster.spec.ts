import { describe, it, expect } from 'vitest'
import { mergeSensed, ranked, dismiss, promote } from '../../src/sensors/cluster.js'
import type { Signal, SensedItem } from '../../src/sensors/types.js'

let idCounter = 0
function newId(): string {
  idCounter += 1
  return `sig-${idCounter}`
}

function evidence(url: string, at = '2026-01-01T00:00:00.000Z') {
  return { kind: 'ci-run' as const, title: 'CI failed', url, at }
}

function item(key: string, url: string, title = 'Flaky test'): SensedItem {
  return { key, title, evidence: evidence(url) }
}

describe('mergeSensed', () => {
  it('collapses seven runs of one workflow into one signal', () => {
    let signals: Signal[] = []
    for (let i = 0; i < 7; i++) {
      signals = mergeSensed(
        signals,
        { id: 'ci', severity: 'medium' },
        [item('wf-a', `https://ci/run/${i}`)],
        '2026-01-01T00:00:00.000Z',
        newId
      )
    }
    expect(signals).toHaveLength(1)
    expect(signals[0].occurrences).toBe(7)
    expect(signals[0].evidence).toHaveLength(7)
  })

  it('counts the same run seen twice only once', () => {
    let signals: Signal[] = []
    signals = mergeSensed(
      signals,
      { id: 'ci', severity: 'medium' },
      [item('wf-a', 'https://ci/run/1')],
      '2026-01-01T00:00:00.000Z',
      newId
    )
    signals = mergeSensed(
      signals,
      { id: 'ci', severity: 'medium' },
      [item('wf-a', 'https://ci/run/1')],
      '2026-01-02T00:00:00.000Z',
      newId
    )
    expect(signals).toHaveLength(1)
    expect(signals[0].occurrences).toBe(1)
    expect(signals[0].evidence).toHaveLength(1)
  })

  it('creates two signals for two distinct keys', () => {
    const signals = mergeSensed(
      [],
      { id: 'ci', severity: 'medium' },
      [item('wf-a', 'https://ci/run/1'), item('wf-b', 'https://ci/run/2')],
      '2026-01-01T00:00:00.000Z',
      newId
    )
    expect(signals).toHaveLength(2)
    expect(signals[0].status).toBe('open')
    expect(signals[0].firstSeen).toBe('2026-01-01T00:00:00.000Z')
    expect(signals[0].lastSeen).toBe('2026-01-01T00:00:00.000Z')
    expect(signals[0].dismissedAt).toBeNull()
    expect(signals[0].orderId).toBeNull()
  })

  it('reopens a dismissed signal only once occurrences reach ceil(dismissedAt * 1.5)', () => {
    // Build a dismissed signal at occurrences=4 -> dismissedAt=4, reopen threshold=ceil(6)=6
    let signals: Signal[] = mergeSensed(
      [],
      { id: 'ci', severity: 'medium' },
      [
        item('wf-a', 'https://ci/run/1'),
        item('wf-a', 'https://ci/run/2'),
        item('wf-a', 'https://ci/run/3'),
        item('wf-a', 'https://ci/run/4'),
      ],
      '2026-01-01T00:00:00.000Z',
      newId
    )
    signals = [dismiss(signals[0])]
    expect(signals[0].status).toBe('dismissed')
    expect(signals[0].dismissedAt).toBe(4)

    // occurrences -> 5: stays dismissed
    signals = mergeSensed(
      signals,
      { id: 'ci', severity: 'medium' },
      [item('wf-a', 'https://ci/run/5')],
      '2026-01-02T00:00:00.000Z',
      newId
    )
    expect(signals[0].status).toBe('dismissed')
    expect(signals[0].occurrences).toBe(5)

    // occurrences -> 6: reopens
    signals = mergeSensed(
      signals,
      { id: 'ci', severity: 'medium' },
      [item('wf-a', 'https://ci/run/6')],
      '2026-01-03T00:00:00.000Z',
      newId
    )
    expect(signals[0].status).toBe('open')
    expect(signals[0].dismissedAt).toBeNull()
    expect(signals[0].occurrences).toBe(6)
  })

  it('keeps accumulating a promoted signal, staying promoted', () => {
    let signals: Signal[] = mergeSensed(
      [],
      { id: 'ci', severity: 'medium' },
      [item('wf-a', 'https://ci/run/1')],
      '2026-01-01T00:00:00.000Z',
      newId
    )
    signals = [promote(signals[0], 'order-1')]
    signals = mergeSensed(
      signals,
      { id: 'ci', severity: 'medium' },
      [item('wf-a', 'https://ci/run/2')],
      '2026-01-02T00:00:00.000Z',
      newId
    )
    expect(signals[0].status).toBe('promoted')
    expect(signals[0].orderId).toBe('order-1')
    expect(signals[0].occurrences).toBe(2)
  })

  it('leaves signals from other sensors untouched', () => {
    const other: Signal = {
      id: 'other-1',
      sensorId: 'other-sensor',
      key: 'wf-a',
      title: 'Other',
      evidence: [evidence('https://ci/run/1')],
      occurrences: 1,
      severity: 'low',
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-01T00:00:00.000Z',
      status: 'open',
      dismissedAt: null,
      orderId: null,
    }
    const signals = mergeSensed(
      [other],
      { id: 'ci', severity: 'medium' },
      [item('wf-a', 'https://ci/run/2')],
      '2026-01-02T00:00:00.000Z',
      newId
    )
    expect(signals).toContainEqual(other)
  })
})

describe('ranked', () => {
  it('orders open signals by impact desc, hides dismissed/promoted', () => {
    const high: Signal = {
      id: 'high',
      sensorId: 'ci',
      key: 'k-high',
      title: 'High',
      evidence: [evidence('u1'), evidence('u2')],
      occurrences: 2,
      severity: 'high',
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-02T00:00:00.000Z',
      status: 'open',
      dismissedAt: null,
      orderId: null,
    }
    const medium: Signal = {
      id: 'medium',
      sensorId: 'ci',
      key: 'k-medium',
      title: 'Medium',
      evidence: [evidence('u1'), evidence('u2'), evidence('u3')],
      occurrences: 3,
      severity: 'medium',
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-01T00:00:00.000Z',
      status: 'open',
      dismissedAt: null,
      orderId: null,
    }
    const dismissed: Signal = { ...high, id: 'dismissed', status: 'dismissed', dismissedAt: 2 }
    const promoted: Signal = { ...high, id: 'promoted', status: 'promoted', orderId: 'order-1' }

    const result = ranked([medium, dismissed, promoted, high])
    expect(result.map((s) => s.id)).toEqual(['high', 'medium'])
  })

  it('breaks ties by lastSeen desc', () => {
    const a: Signal = {
      id: 'a',
      sensorId: 'ci',
      key: 'k-a',
      title: 'A',
      evidence: [evidence('u1')],
      occurrences: 1,
      severity: 'low',
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-01T00:00:00.000Z',
      status: 'open',
      dismissedAt: null,
      orderId: null,
    }
    const b: Signal = { ...a, id: 'b', lastSeen: '2026-01-05T00:00:00.000Z' }
    expect(ranked([a, b]).map((s) => s.id)).toEqual(['b', 'a'])
  })
})

describe('dismiss', () => {
  it('sets status dismissed and dismissedAt to occurrences', () => {
    const signal: Signal = {
      id: 'a',
      sensorId: 'ci',
      key: 'k-a',
      title: 'A',
      evidence: [evidence('u1'), evidence('u2')],
      occurrences: 2,
      severity: 'low',
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-01T00:00:00.000Z',
      status: 'open',
      dismissedAt: null,
      orderId: null,
    }
    const result = dismiss(signal)
    expect(result.status).toBe('dismissed')
    expect(result.dismissedAt).toBe(2)
  })
})

describe('promote', () => {
  it('sets status promoted and stores the orderId', () => {
    const signal: Signal = {
      id: 'a',
      sensorId: 'ci',
      key: 'k-a',
      title: 'A',
      evidence: [evidence('u1')],
      occurrences: 1,
      severity: 'low',
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-01T00:00:00.000Z',
      status: 'open',
      dismissedAt: null,
      orderId: null,
    }
    const result = promote(signal, 'order-9')
    expect(result.status).toBe('promoted')
    expect(result.orderId).toBe('order-9')
  })
})
