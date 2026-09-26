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

export function mergeSensed(
  existing: readonly Signal[],
  sensor: { id: string; severity: Severity },
  items: readonly SensedItem[],
  now: string,
  newId: () => string
): Signal[] {
  const byKey = new Map<string, SensedItem[]>()
  for (const item of items) {
    const group = byKey.get(item.key)
    if (group) group.push(item)
    else byKey.set(item.key, [item])
  }

  const result: Signal[] = []
  const handledKeys = new Set<string>()

  for (const signal of existing) {
    if (signal.sensorId !== sensor.id) {
      result.push(signal)
      continue
    }
    const group = byKey.get(signal.key)
    if (!group) {
      result.push(signal)
      continue
    }
    handledKeys.add(signal.key)
    result.push(mergeOne(signal, group, now))
  }

  for (const [key, group] of byKey) {
    if (handledKeys.has(key)) continue
    const evidenceByUrl = new Map(group.map((item) => [item.evidence.url, item.evidence]))
    result.push({
      id: newId(),
      sensorId: sensor.id,
      key,
      title: group[0].title,
      evidence: [...evidenceByUrl.values()],
      occurrences: evidenceByUrl.size,
      severity: sensor.severity,
      firstSeen: now,
      lastSeen: now,
      status: 'open',
      dismissedAt: null,
      orderId: null,
    })
  }

  return result
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
