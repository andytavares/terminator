import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFiringLog } from '../../../../../src/main/supervision/stall/firing-log.js'
import type { StallFiring } from '../../../../../src/main/supervision/stall/evaluate-stall.js'

// FR-017: every firing is recorded in every mode, with the signal and the input
// values that satisfied it. FR-020: the operator judges them, and the
// proportion judged incorrect is what SC-002 is measured against.

let dir: string
let logPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'firings-'))
  logPath = join(dir, 'firings.jsonl')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function firing(over: Partial<StallFiring> = {}): StallFiring {
  return {
    sessionId: 's1',
    signal: 'silence',
    firedAt: 1_000,
    inputs: {
      toolSilenceMs: 9 * 60_000,
      diffSilenceMs: 0,
      distinctFiles: 0,
      netChange: 0,
      reverts: 0,
      shellInFlight: false,
    },
    ...over,
  }
}

describe('recording', () => {
  it('records a firing with its signal and inputs', () => {
    const log = createFiringLog(logPath)
    log.record(firing(), true)
    const [row] = log.list()
    expect(row).toMatchObject({ sessionId: 's1', signal: 'silence', shadowMode: true })
    expect(row.inputs.toolSilenceMs).toBe(9 * 60_000)
  })

  it('records whether shadow mode was on, so precision can be read per mode', () => {
    const log = createFiringLog(logPath)
    log.record(firing(), true)
    log.record(firing({ firedAt: 2_000 }), false)
    expect(log.list().map((r) => r.shadowMode)).toEqual([true, false])
  })

  it('issues a distinct id per firing so a judgement can name one', () => {
    const log = createFiringLog(logPath)
    log.record(firing(), true)
    log.record(firing({ firedAt: 2_000 }), true)
    const ids = log.list().map((r) => r.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('starts unjudged', () => {
    const log = createFiringLog(logPath)
    log.record(firing(), true)
    expect(log.list()[0].judgement).toBeNull()
  })
})

describe('judging (FR-020)', () => {
  it('records a judgement against a firing', () => {
    const log = createFiringLog(logPath)
    log.record(firing(), true)
    const { id } = log.list()[0]
    log.judge(id, 'incorrect', 5_000)
    expect(log.list()[0]).toMatchObject({ judgement: 'incorrect', judgedAt: 5_000 })
  })

  it('allows a judgement to be revised', () => {
    const log = createFiringLog(logPath)
    log.record(firing(), true)
    const { id } = log.list()[0]
    log.judge(id, 'incorrect', 5_000)
    log.judge(id, 'correct', 6_000)
    expect(log.list()[0].judgement).toBe('correct')
  })

  it('ignores a judgement for an unknown firing', () => {
    const log = createFiringLog(logPath)
    expect(() => log.judge('nope', 'correct', 5_000)).not.toThrow()
  })
})

describe('precision report (SC-002)', () => {
  it('reports the proportion judged incorrect over a window', () => {
    const log = createFiringLog(logPath)
    for (let i = 0; i < 10; i++) log.record(firing({ firedAt: 1_000 + i }), true)
    const rows = log.list()
    rows.slice(0, 1).forEach((r) => log.judge(r.id, 'incorrect', 9_000))
    rows.slice(1).forEach((r) => log.judge(r.id, 'correct', 9_000))
    const report = log.precision(0, 100_000)
    expect(report).toMatchObject({ judged: 10, incorrect: 1 })
    expect(report.incorrectRate).toBeCloseTo(0.1)
  })

  it('counts only judged firings, so an unjudged log does not look perfect', () => {
    const log = createFiringLog(logPath)
    log.record(firing(), true)
    const report = log.precision(0, 100_000)
    expect(report).toMatchObject({ judged: 0, total: 1 })
    // Rate is null rather than 0: nothing has been judged, so nothing is known.
    expect(report.incorrectRate).toBeNull()
  })

  it('restricts the report to the requested window', () => {
    const log = createFiringLog(logPath)
    log.record(firing({ firedAt: 1_000 }), true)
    log.record(firing({ firedAt: 50_000 }), true)
    log.list().forEach((r) => log.judge(r.id, 'correct', 60_000))
    expect(log.precision(0, 10_000).judged).toBe(1)
  })

  it('reports an empty window without dividing by zero', () => {
    const log = createFiringLog(logPath)
    expect(log.precision(0, 10)).toMatchObject({ total: 0, judged: 0, incorrectRate: null })
  })
})

describe('durability', () => {
  it('survives a reopen, because the record outlives the process', () => {
    const first = createFiringLog(logPath)
    first.record(firing(), true)
    expect(createFiringLog(logPath).list()).toHaveLength(1)
  })
})
