import { describe, it, expect } from 'vitest'
import { reconcile } from '../../../../../src/main/supervision/state/reconcile.js'
import { initialSessionState } from '../../../../../src/main/supervision/state/state-machine.js'

// FR-006: the driver and the transcript can disagree — the driver process can
// die, be restarted, or lag. The agent's own durable record is the tie-breaker.

const state = (over: Partial<ReturnType<typeof initialSessionState>> = {}) => ({
  ...initialSessionState('s1', 0),
  ...over,
})

describe('reconcile(driverState, transcriptState)', () => {
  it('prefers the transcript when the two disagree on runtime state', () => {
    const driver = state({ runtimeState: 'working', stateSince: 100 })
    const transcript = state({ runtimeState: 'stalled', stateSince: 400 })
    expect(reconcile(driver, transcript).runtimeState).toBe('stalled')
  })

  it('prefers the transcript when it has seen more recent tool activity', () => {
    const driver = state({ lastToolActivityAt: 100 })
    const transcript = state({ lastToolActivityAt: 900 })
    expect(reconcile(driver, transcript).lastToolActivityAt).toBe(900)
  })

  it('keeps the driver value when the transcript has nothing to say', () => {
    const driver = state({ lastToolActivityAt: 100, turns: 7 })
    const transcript = state({ lastToolActivityAt: null, turns: 0 })
    const merged = reconcile(driver, transcript)
    expect(merged.lastToolActivityAt).toBe(100)
    expect(merged.turns).toBe(7)
  })

  it('returns the driver state unchanged when there is no transcript state at all', () => {
    const driver = state({ runtimeState: 'working' })
    expect(reconcile(driver, null)).toEqual(driver)
  })

  it('keeps the pending permission from the driver, which the transcript cannot know', () => {
    // A permission request is a live callback, not something written to the
    // transcript, so the driver is authoritative for it.
    const driver = state({
      runtimeState: 'needs_input',
      pendingPermission: {
        requestId: 'r1',
        toolName: 'Bash',
        summary: 'ls',
        requestedAt: 200,
      },
    })
    const transcript = state({ runtimeState: 'working' })
    const merged = reconcile(driver, transcript)
    expect(merged.pendingPermission?.requestId).toBe('r1')
    expect(merged.runtimeState).toBe('needs_input')
  })

  it('takes the higher turn count and cost, since both only ever grow', () => {
    const driver = state({ turns: 4, costUsd: 1 })
    const transcript = state({ turns: 9, costUsd: 0.5 })
    const merged = reconcile(driver, transcript)
    expect(merged.turns).toBe(9)
    expect(merged.costUsd).toBe(1)
  })

  it('never mutates either input', () => {
    const driver = state({ turns: 4 })
    const transcript = state({ turns: 9 })
    const snapshot = JSON.parse(JSON.stringify(driver))
    reconcile(driver, transcript)
    expect(driver).toEqual(snapshot)
  })
})
