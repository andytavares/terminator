import type { Severity, SensedItem, Signal } from './types.js'
import { impactOf } from './types.js'

function mergeOne(existing: Signal, items: readonly SensedItem[], now: string): Signal {
  const seenUrls = new Set(existing.evidence.map((e) => e.url))
  const newEvidence = items
    .filter((item) => !seenUrls.has(item.evidence.url))
    .map((item) => item.evidence)
  if (newEvidence.length === 0) return existing

  const evidence = [...existing.evidence, ...newEvidence]
  const occurrences = evidence.length

  if (existing.status === 'resolved') {
    return { ...existing, evidence, occurrences, lastSeen: now, status: 'open' }
  }

  if (existing.status === 'dismissed') {
    const threshold = Math.ceil((existing.dismissedAt ?? 0) * 1.5)
    if (occurrences >= threshold) {
      return {
        ...existing,
        evidence,
        occurrences,
        lastSeen: now,
        status: 'open',
        dismissedAt: null,
      }
    }
    return { ...existing, evidence, occurrences }
  }

  return { ...existing, evidence, occurrences, lastSeen: now }
}

/** What one run of a sensor found, when, and how to name a signal it has not seen before. */
export interface Sweep {
  readonly items: readonly SensedItem[]
  readonly now: string
  readonly newId: () => string
  /** Keys whose cause is gone; an open signal under one is closed. */
  readonly resolvedKeys?: readonly string[]
}

type SensorOf = { id: string; severity: Severity }

export function mergeSensed(existing: readonly Signal[], sensor: SensorOf, sweep: Sweep): Signal[] {
  const byKey = groupByKey(sweep.items)
  const ours = (signal: Signal): boolean => signal.sensorId === sensor.id
  const resolved = new Set(sweep.resolvedKeys ?? [])
  const merged = existing.map((signal) => {
    if (ours(signal) && signal.status === 'open' && resolved.has(signal.key)) {
      return { ...signal, status: 'resolved' as const }
    }
    const group = ours(signal) ? byKey.get(signal.key) : undefined
    return group === undefined ? signal : mergeOne(signal, group, sweep.now)
  })
  const known = new Set(existing.filter(ours).map((signal) => signal.key))
  const fresh = [...byKey]
    .filter(([key]) => !known.has(key))
    .map(([, group]) => newSignal(sensor, group, sweep))
  return [...merged, ...fresh]
}

function groupByKey(items: readonly SensedItem[]): Map<string, SensedItem[]> {
  const byKey = new Map<string, SensedItem[]>()
  for (const item of items) byKey.set(item.key, [...(byKey.get(item.key) ?? []), item])
  return byKey
}

/** A signal for a key this sensor has never raised, from every item that names it. */
function newSignal(sensor: SensorOf, group: readonly SensedItem[], sweep: Sweep): Signal {
  const evidenceByUrl = new Map(group.map((item) => [item.evidence.url, item.evidence]))
  return {
    id: sweep.newId(),
    sensorId: sensor.id,
    key: group[0].key,
    title: group[0].title,
    evidence: [...evidenceByUrl.values()],
    occurrences: evidenceByUrl.size,
    severity: sensor.severity,
    firstSeen: sweep.now,
    lastSeen: sweep.now,
    status: 'open',
    dismissedAt: null,
    orderId: null,
  }
}

export function ranked(signals: readonly Signal[]): Signal[] {
  return signals
    .filter((signal) => signal.status === 'open')
    .slice()
    .sort((a, b) => {
      const impactDiff = impactOf(b) - impactOf(a)
      if (impactDiff !== 0) return impactDiff
      return b.lastSeen.localeCompare(a.lastSeen)
    })
}

export function dismiss(signal: Signal): Signal {
  return { ...signal, status: 'dismissed', dismissedAt: signal.occurrences }
}

export function promote(signal: Signal, orderId: string): Signal {
  return { ...signal, status: 'promoted', orderId }
}
