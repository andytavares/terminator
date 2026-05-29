import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  trackSensorResult,
  trackGateDecision,
  trackStaleRefs,
  resolveHealthEvent,
  healthEvents,
  resetHealthState,
  setHealthChangedCallback,
} from '../../../src/core/health.js'

// health.ts has no Electron dependency — tests run in plain Node environment

describe('trackSensorResult()', () => {
  beforeEach(() => {
    resetHealthState()
  })

  it('does not emit alert after 1 failure', () => {
    trackSensorResult('lint', false)
    expect(healthEvents).toHaveLength(0)
  })

  it('does not emit alert after 2 consecutive failures', () => {
    trackSensorResult('lint', false)
    trackSensorResult('lint', false)
    expect(healthEvents).toHaveLength(0)
  })

  it('emits sensor-failure health event at 3rd consecutive failure', () => {
    trackSensorResult('lint', false)
    trackSensorResult('lint', false)
    trackSensorResult('lint', false)
    expect(healthEvents).toHaveLength(1)
    expect(healthEvents[0].kind).toBe('sensor-failure')
    expect(healthEvents[0].sensorName).toBe('lint')
    expect(healthEvents[0].consecutiveCount).toBe(3)
  })

  it('resets counter and removes health event on pass', () => {
    trackSensorResult('lint', false)
    trackSensorResult('lint', false)
    trackSensorResult('lint', false)
    expect(healthEvents).toHaveLength(1)
    trackSensorResult('lint', true)
    expect(healthEvents).toHaveLength(0)
  })

  it('increments consecutive count on 4th failure', () => {
    for (let i = 0; i < 4; i++) trackSensorResult('lint', false)
    expect(healthEvents[0].consecutiveCount).toBe(4)
  })
})

describe('trackGateDecision()', () => {
  beforeEach(() => {
    resetHealthState()
  })

  it('does not emit alert for approve decisions', () => {
    trackGateDecision('spec.md', 1, 'approve')
    expect(healthEvents).toHaveLength(0)
  })

  it('emits feedforward-gap at 3rd consecutive rejection for same gate', () => {
    trackGateDecision('spec.md', 1, 'reject')
    trackGateDecision('spec.md', 1, 'reject')
    trackGateDecision('spec.md', 1, 'reject')
    expect(healthEvents).toHaveLength(1)
    expect(healthEvents[0].kind).toBe('feedforward-gap')
    expect(healthEvents[0].specPath).toBe('spec.md')
  })

  it('resets rejection count on approve', () => {
    trackGateDecision('spec.md', 2, 'reject')
    trackGateDecision('spec.md', 2, 'reject')
    trackGateDecision('spec.md', 2, 'approve')
    // After approve, count resets — 3rd reject of a new run won't trigger yet
    trackGateDecision('spec.md', 2, 'reject')
    expect(healthEvents).toHaveLength(0)
  })

  it('resets all state via resetHealthState', () => {
    trackGateDecision('spec.md', 1, 'reject')
    trackGateDecision('spec.md', 1, 'reject')
    trackGateDecision('spec.md', 1, 'reject')
    expect(healthEvents).toHaveLength(1)
    resetHealthState()
    expect(healthEvents).toHaveLength(0)
  })
})

describe('trackStaleRefs()', () => {
  beforeEach(() => resetHealthState())

  it('does nothing when called with empty array and no existing event', () => {
    trackStaleRefs([])
    expect(healthEvents).toHaveLength(0)
  })

  it('emits stale-reference event with first ref details', () => {
    trackStaleRefs([
      { line: 5, ref: 'src/missing.ts' },
      { line: 9, ref: 'docs/gone.md' },
    ])
    expect(healthEvents).toHaveLength(1)
    expect(healthEvents[0].kind).toBe('stale-reference')
    expect(healthEvents[0].agentsMdLine).toBe(5)
    expect(healthEvents[0].agentsMdRef).toBe('src/missing.ts')
    expect(healthEvents[0].consecutiveCount).toBe(2)
  })

  it('updates existing stale-reference event when called again', () => {
    trackStaleRefs([{ line: 1, ref: 'old.ts' }])
    trackStaleRefs([{ line: 3, ref: 'new.ts' }])
    expect(healthEvents).toHaveLength(1)
    expect(healthEvents[0].agentsMdRef).toBe('new.ts')
  })

  it('removes existing event when called with empty array', () => {
    trackStaleRefs([{ line: 1, ref: 'gone.ts' }])
    expect(healthEvents).toHaveLength(1)
    trackStaleRefs([])
    expect(healthEvents).toHaveLength(0)
  })

  it('invokes callback when event added', () => {
    const cb = vi.fn()
    setHealthChangedCallback(cb)
    trackStaleRefs([{ line: 2, ref: 'x.ts' }])
    expect(cb).toHaveBeenCalled()
    setHealthChangedCallback(() => {})
  })
})

describe('resolveHealthEvent()', () => {
  beforeEach(() => resetHealthState())

  it('removes a sensor-failure event by name', () => {
    for (let i = 0; i < 3; i++) trackSensorResult('lint', false)
    expect(healthEvents).toHaveLength(1)
    resolveHealthEvent('sensor-failure', 'lint')
    expect(healthEvents).toHaveLength(0)
  })

  it('removes a feedforward-gap event by specPath', () => {
    for (let i = 0; i < 3; i++) trackGateDecision('spec.md', 1, 'reject')
    expect(healthEvents).toHaveLength(1)
    resolveHealthEvent('feedforward-gap', 'spec.md')
    expect(healthEvents).toHaveLength(0)
  })

  it('removes a stale-reference event', () => {
    trackStaleRefs([{ line: 1, ref: 'x.ts' }])
    resolveHealthEvent('stale-reference')
    expect(healthEvents).toHaveLength(0)
  })

  it('does nothing when event not found', () => {
    resolveHealthEvent('sensor-failure', 'nonexistent')
    expect(healthEvents).toHaveLength(0)
  })

  it('invokes callback when event removed', () => {
    const cb = vi.fn()
    for (let i = 0; i < 3; i++) trackSensorResult('build', false)
    setHealthChangedCallback(cb)
    const before = cb.mock.calls.length
    resolveHealthEvent('sensor-failure', 'build')
    expect(cb.mock.calls.length).toBeGreaterThan(before)
    setHealthChangedCallback(() => {})
  })
})

describe('setHealthChangedCallback()', () => {
  beforeEach(() => {
    resetHealthState()
  })

  it('callback is invoked when a health event is added', () => {
    const cb = vi.fn()
    setHealthChangedCallback(cb)
    trackSensorResult('build', false)
    trackSensorResult('build', false)
    trackSensorResult('build', false)
    expect(cb).toHaveBeenCalled()
    // cleanup: clear callback
    setHealthChangedCallback(() => {})
  })

  it('callback is invoked when a health event is removed (on pass)', () => {
    const cb = vi.fn()
    setHealthChangedCallback(cb)
    trackSensorResult('test', false)
    trackSensorResult('test', false)
    trackSensorResult('test', false)
    const callCount = cb.mock.calls.length
    trackSensorResult('test', true)
    expect(cb.mock.calls.length).toBeGreaterThan(callCount)
    setHealthChangedCallback(() => {})
  })
})
