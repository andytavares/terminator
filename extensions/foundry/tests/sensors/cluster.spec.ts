import { describe, it, expect, beforeEach } from 'vitest'
import { mergeSensed, ranked, dismiss, promote } from '../../src/sensors/cluster.js'
import type { Signal, SensedItem } from '../../src/sensors/types.js'

let idCounter = 0
beforeEach(() => {
  idCounter = 0
})
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

/** The CI sensor every case merges for. */
const CI = { id: 'ci', severity: 'medium' as const }

/** One run of the CI sensor at `now`, finding `items`. */
function sweptAt(now: string, items: SensedItem[]) {
  return { items, now, newId }
}

describe('mergeSensed', () => {
  describe('collapsing', collapsingTests)
  describe('duplicates', duplicatesTests)
  describe('distinct keys', distinctKeysTests)
  describe('reopening', clusterReopeningTests)
  describe('untouched keys', untouchedKeysTests)
  describe('no recorded count', noRecordedCountTests)
  describe('resolved signals', resolvedSignalsTests)
  describe('promoted signals', promotedSignalsTests)
  describe('other sensors', otherSensorsTests)
})

function collapsingTests() {
  it('collapses seven runs of one workflow into one signal', () => {
    let signals: Signal[] = []
    for (let i = 0; i < 7; i++) {
      signals = mergeSensed(
        signals,
        CI,
        sweptAt('2026-01-01T00:00:00.000Z', [item('wf-a', `https://ci/run/${i}`)])
      )
    }
    expect(signals).toHaveLength(1)
    expect(signals[0].occurrences).toBe(7)
    expect(signals[0].evidence).toHaveLength(7)
  })
}

function duplicatesTests() {
  it('counts the same run seen twice only once', () => {
    let signals: Signal[] = []
    signals = mergeSensed(
      signals,
      CI,
      sweptAt('2026-01-01T00:00:00.000Z', [item('wf-a', 'https://ci/run/1')])
    )
    signals = mergeSensed(
      signals,
      CI,
      sweptAt('2026-01-02T00:00:00.000Z', [item('wf-a', 'https://ci/run/1')])
    )
    expect(signals).toHaveLength(1)
    expect(signals[0].occurrences).toBe(1)
    expect(signals[0].evidence).toHaveLength(1)
  })
}

function distinctKeysTests() {
  it('creates two signals for two distinct keys', () => {
    const signals = mergeSensed(
      [],
      CI,
      sweptAt('2026-01-01T00:00:00.000Z', [
        item('wf-a', 'https://ci/run/1'),
        item('wf-b', 'https://ci/run/2'),
      ])
    )
    expect(signals).toHaveLength(2)
    expect(signals[0].status).toBe('open')
    expect(signals[0].firstSeen).toBe('2026-01-01T00:00:00.000Z')
    expect(signals[0].lastSeen).toBe('2026-01-01T00:00:00.000Z')
    expect(signals[0].dismissedAt).toBeNull()
    expect(signals[0].orderId).toBeNull()
  })
}

function untouchedKeysTests() {
  it('leaves a signal of this sensor alone when this run saw nothing for its key', () => {
    const before = mergeSensed(
      [],
      CI,
      sweptAt('2026-01-01T00:00:00.000Z', [item('wf-a', 'https://ci/run/1')])
    )
    const after = mergeSensed(
      before,
      CI,
      sweptAt('2026-01-02T00:00:00.000Z', [item('wf-b', 'https://ci/run/2')])
    )
    expect(after).toHaveLength(2)
    expect(after[0]).toBe(before[0])
    expect(after[1].key).toBe('wf-b')
  })
}

function noRecordedCountTests() {
  it('reopens a dismissed signal with no recorded count on its next new evidence', () => {
    const [first] = mergeSensed(
      [],
      CI,
      sweptAt('2026-01-01T00:00:00.000Z', [item('wf-a', 'https://ci/run/1')])
    )
    const dismissed: Signal = { ...first, status: 'dismissed', dismissedAt: null }
    const [after] = mergeSensed(
      [dismissed],
      CI,
      sweptAt('2026-01-02T00:00:00.000Z', [item('wf-a', 'https://ci/run/2')])
    )
    expect(after.status).toBe('open')
    expect(after.lastSeen).toBe('2026-01-02T00:00:00.000Z')
  })
}

/** Failed runs of workflow wf-a, by run number. */
function runsOfA(...runs: number[]): SensedItem[] {
  return runs.map((run) => item('wf-a', `https://ci/run/${run}`))
}

function clusterReopeningTests() {
  it('reopens a dismissed signal only once occurrences reach ceil(dismissedAt * 1.5)', () => {
    // Build a dismissed signal at occurrences=4 -> dismissedAt=4, reopen threshold=ceil(6)=6
    let signals: Signal[] = mergeSensed(
      [],
      CI,
      sweptAt('2026-01-01T00:00:00.000Z', runsOfA(1, 2, 3, 4))
    )
    signals = [dismiss(signals[0])]
    expect(signals[0].status).toBe('dismissed')
    expect(signals[0].dismissedAt).toBe(4)

    // occurrences -> 5: stays dismissed
    signals = mergeSensed(
      signals,
      CI,
      sweptAt('2026-01-02T00:00:00.000Z', [item('wf-a', 'https://ci/run/5')])
    )
    expect(signals[0].status).toBe('dismissed')
    expect(signals[0].occurrences).toBe(5)

    // occurrences -> 6: reopens
    signals = mergeSensed(
      signals,
      CI,
      sweptAt('2026-01-03T00:00:00.000Z', [item('wf-a', 'https://ci/run/6')])
    )
    expect(signals[0].status).toBe('open')
    expect(signals[0].dismissedAt).toBeNull()
    expect(signals[0].occurrences).toBe(6)
  })
}

function resolvedSignalsTests() {
  const failing = () =>
    mergeSensed([], CI, sweptAt('2026-01-01T00:00:00.000Z', [item('wf-a', 'https://ci/run/1')]))

  it('closes a signal whose key the sweep reports as resolved', () => {
    const [after] = mergeSensed(failing(), CI, {
      ...sweptAt('2026-01-02T00:00:00.000Z', []),
      resolvedKeys: ['wf-a'],
    })
    expect(after.status).toBe('resolved')
    expect(ranked([after])).toEqual([])
  })

  it('reopens a resolved signal when the workflow fails again', () => {
    const resolved = mergeSensed(failing(), CI, {
      ...sweptAt('2026-01-02T00:00:00.000Z', []),
      resolvedKeys: ['wf-a'],
    })
    const [after] = mergeSensed(
      resolved,
      CI,
      sweptAt('2026-01-03T00:00:00.000Z', [item('wf-a', 'https://ci/run/2')])
    )
    expect(after.status).toBe('open')
  })
}

function promotedSignalsTests() {
  it('keeps accumulating a promoted signal, staying promoted', () => {
    let signals: Signal[] = mergeSensed(
      [],
      CI,
      sweptAt('2026-01-01T00:00:00.000Z', [item('wf-a', 'https://ci/run/1')])
    )
    signals = [promote(signals[0], 'order-1')]
    signals = mergeSensed(
      signals,
      CI,
      sweptAt('2026-01-02T00:00:00.000Z', [item('wf-a', 'https://ci/run/2')])
    )
    expect(signals[0].status).toBe('promoted')
    expect(signals[0].orderId).toBe('order-1')
    expect(signals[0].occurrences).toBe(2)
  })
}

function otherSensorsTests() {
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
      CI,
      sweptAt('2026-01-02T00:00:00.000Z', [item('wf-a', 'https://ci/run/2')])
    )
    expect(signals).toContainEqual(other)
  })
}

describe('ranked', () => {
  describe('ordering', clusterOrderingTests)
  describe('ties', tiesTests)
})

/** An open CI signal first seen on New Year's Day, seen once per url in `urls`. */
function openSignal(id: string, urls: string[], over: Partial<Signal> = {}): Signal {
  return {
    id,
    sensorId: 'ci',
    key: `k-${id}`,
    title: id,
    evidence: urls.map((url) => evidence(url)),
    occurrences: urls.length,
    severity: 'medium',
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    status: 'open',
    dismissedAt: null,
    orderId: null,
    ...over,
  }
}

function clusterOrderingTests() {
  it('orders open signals by impact desc, hides dismissed/promoted', () => {
    const high = openSignal('high', ['u1', 'u2'], {
      title: 'High',
      severity: 'high',
      lastSeen: '2026-01-02T00:00:00.000Z',
    })
    const medium = openSignal('medium', ['u1', 'u2', 'u3'], { title: 'Medium' })
    const dismissed: Signal = { ...high, id: 'dismissed', status: 'dismissed', dismissedAt: 2 }
    const promoted: Signal = { ...high, id: 'promoted', status: 'promoted', orderId: 'order-1' }

    const result = ranked([medium, dismissed, promoted, high])
    expect(result.map((s) => s.id)).toEqual(['high', 'medium'])
  })
}

function tiesTests() {
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
}

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
