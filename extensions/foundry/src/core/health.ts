import type { HarnessHealthEvent } from '../types/foundry.types.js'

const sensorFailureCount = new Map<string, number>()
const gateRejectionCount = new Map<string, number>()

// Module-level health events array — main process authoritative
export const healthEvents: HarnessHealthEvent[] = []

// Callback invoked whenever healthEvents changes (set by index.ts to broadcast)
let onHealthChanged: (() => void) | null = null

export function setHealthChangedCallback(cb: () => void) {
  onHealthChanged = cb
}

export function trackSensorResult(
  sensorName: string,
  pass: boolean,
  _workspaceRoot?: string
): void {
  if (pass) {
    sensorFailureCount.delete(sensorName)
    const idx = healthEvents.findIndex(
      (e) => e.kind === 'sensor-failure' && e.sensorName === sensorName
    )
    if (idx >= 0) {
      healthEvents.splice(idx, 1)
      onHealthChanged?.()
    }
    return
  }
  const count = (sensorFailureCount.get(sensorName) ?? 0) + 1
  sensorFailureCount.set(sensorName, count)
  if (count >= 3) {
    const existing = healthEvents.find(
      (e) => e.kind === 'sensor-failure' && e.sensorName === sensorName
    )
    if (existing) {
      existing.consecutiveCount = count
      existing.lastOccurredAt = new Date().toISOString()
    } else {
      healthEvents.push({
        kind: 'sensor-failure',
        sensorName,
        consecutiveCount: count,
        lastOccurredAt: new Date().toISOString(),
      })
    }
    onHealthChanged?.()
  }
}

export function trackGateDecision(
  specPath: string,
  gateIndex: number,
  decision: 'approve' | 'request-changes' | 'reject',
  _workspaceRoot?: string
): void {
  const key = `${specPath}:${gateIndex}`
  if (decision !== 'reject') {
    gateRejectionCount.delete(key)
    return
  }
  const count = (gateRejectionCount.get(key) ?? 0) + 1
  gateRejectionCount.set(key, count)
  if (count >= 3) {
    const existing = healthEvents.find(
      (e) => e.kind === 'feedforward-gap' && e.specPath === specPath
    )
    if (existing) {
      existing.consecutiveCount = count
      existing.lastOccurredAt = new Date().toISOString()
    } else {
      healthEvents.push({
        kind: 'feedforward-gap',
        specPath,
        consecutiveCount: count,
        lastOccurredAt: new Date().toISOString(),
      })
    }
    onHealthChanged?.()
  }
}

export function trackStaleRefs(staleRefs: Array<{ line: number; ref: string }>): void {
  // Remove any existing stale-reference event
  const idx = healthEvents.findIndex((e) => e.kind === 'stale-reference')
  if (staleRefs.length === 0) {
    if (idx >= 0) {
      healthEvents.splice(idx, 1)
      onHealthChanged?.()
    }
    return
  }
  const first = staleRefs[0]
  if (idx >= 0) {
    healthEvents[idx].agentsMdLine = first.line
    healthEvents[idx].agentsMdRef = first.ref
    healthEvents[idx].consecutiveCount = staleRefs.length
    healthEvents[idx].lastOccurredAt = new Date().toISOString()
  } else {
    healthEvents.push({
      kind: 'stale-reference',
      agentsMdLine: first.line,
      agentsMdRef: first.ref,
      consecutiveCount: staleRefs.length,
      lastOccurredAt: new Date().toISOString(),
    })
  }
  onHealthChanged?.()
}

export function resolveHealthEvent(kind: HarnessHealthEvent['kind'], key?: string): void {
  const idx = healthEvents.findIndex((e) => {
    if (e.kind !== kind) return false
    if (kind === 'sensor-failure') return !key || e.sensorName === key
    if (kind === 'feedforward-gap') return !key || e.specPath === key
    return true
  })
  if (idx >= 0) {
    healthEvents.splice(idx, 1)
    onHealthChanged?.()
  }
}

export function resetHealthState(): void {
  sensorFailureCount.clear()
  gateRejectionCount.clear()
  healthEvents.length = 0
}
