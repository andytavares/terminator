import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createBackpressureGate } from '../../../../../src/main/supervision/review/backpressure.js'

// The one feature in the spec no competitor ships. Counted globally, because
// the constraint being modelled is one human's review capacity, not a repo's.

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'backpressure-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function gate(unreviewed: number, limit = 3) {
  return createBackpressureGate({
    limit,
    countUnreviewed: () => unreviewed,
    overrideLogPath: join(dir, 'overrides.jsonl'),
  })
}

describe('the gate (FR-053)', () => {
  it('permits a start below the limit', () => {
    expect(gate(2).check()).toMatchObject({ allowed: true })
  })

  it('refuses at the limit', () => {
    expect(gate(3).check()).toMatchObject({ allowed: false })
  })

  it('refuses above the limit', () => {
    expect(gate(5).check()).toMatchObject({ allowed: false })
  })

  it('states the reason and the current count, not just a refusal', () => {
    const result = gate(3).check()
    expect(result.reason).toContain('3')
    expect(result).toMatchObject({ unreviewed: 3, limit: 3 })
  })

  it('honours a configured limit', () => {
    expect(gate(3, 10).check()).toMatchObject({ allowed: true })
  })

  it('refuses everything when the limit is zero', () => {
    expect(gate(0, 0).check()).toMatchObject({ allowed: false })
  })
})

describe('override (FR-054)', () => {
  it('records the override with its timestamp and the queue depth at the time', () => {
    const g = gate(4)
    g.override('s9', 7_000)
    expect(g.overrides()).toEqual([{ sessionId: 's9', at: 7_000, queueDepth: 4 }])
  })

  it('records each override separately, so the pattern is visible over time', () => {
    const g = gate(4)
    g.override('s1', 7_000)
    g.override('s2', 8_000)
    expect(g.overrides()).toHaveLength(2)
  })

  it('persists overrides across a reopen', () => {
    const overrideLogPath = join(dir, 'overrides.jsonl')
    createBackpressureGate({ limit: 3, countUnreviewed: () => 4, overrideLogPath }).override(
      's1',
      7_000
    )
    const reopened = createBackpressureGate({
      limit: 3,
      countUnreviewed: () => 4,
      overrideLogPath,
    })
    expect(reopened.overrides()).toHaveLength(1)
  })
})

describe('applying only to the next start (spec Edge Cases)', () => {
  it('never reports on running agents — the gate is a start check, not a killer', () => {
    // Starting the console with the limit already exceeded must not kill work
    // that is already in flight.
    const g = gate(99)
    expect(g.check()).toMatchObject({ allowed: false })
    expect(g).not.toHaveProperty('stopRunning')
  })
})

describe('how the refusal reads', () => {
  it('says "session is" when exactly one is waiting', () => {
    // The refusal is the whole mechanism: it has to read like a sentence, not
    // a counter.
    expect(gate(1, 1).check().reason).toContain('1 finished session is waiting')
  })

  it('says "sessions are" when more than one is waiting', () => {
    expect(gate(4, 3).check().reason).toContain('4 finished sessions are waiting')
  })
})
