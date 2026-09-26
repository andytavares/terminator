import { describe, it, expect, vi } from 'vitest'
import { ciRounds } from '../../src/line/ship-tail.js'
import type { CiVerdict, Check } from '../../src/line/ci.js'
import type { Feedback } from '../../src/line/run-graph.js'
import type { CiState } from '../../src/line/ci-state.js'

function check(over: Partial<Check> = {}): Check {
  return { name: 'build', bucket: 'pass', link: 'https://x/1', workflow: 'ci', ...over }
}

const PULL = { url: 'https://github.com/o/r/pull/1', cwd: '/repo' }

function harness(verdicts: CiVerdict[], opts: { sendBack?: boolean } = {}) {
  let call = 0
  const watch = vi.fn(async (): Promise<CiVerdict> => {
    const v = verdicts[Math.min(call, verdicts.length - 1)]
    call += 1
    return v
  })
  const failedLogs = vi.fn(
    async (checks: readonly Check[]) => `log for ${checks.map((c) => c.name).join(',')}`
  )
  const sendBack = vi.fn(async () => opts.sendBack ?? true)
  const record = vi.fn(async () => {})
  const states: CiState[] = []
  const state = vi.fn(async (s: Omit<CiState, 'at'>) => {
    states.push({ ...s, at: 'x' })
  })
  return { watch, failedLogs, sendBack, record, state, states }
}

describe('ciRounds', () => {
  it('declares none when the recipe has no ci', async () => {
    const h = harness([])
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: null,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(outcome).toEqual({ kind: 'none' })
    expect(h.watch).not.toHaveBeenCalled()
    expect(h.state).not.toHaveBeenCalled()
  })

  it('is green the first time, never calling sendBack', async () => {
    const h = harness([{ kind: 'green', checks: [check()] }])
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: 2,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(outcome.kind).toBe('green')
    expect(h.sendBack).not.toHaveBeenCalled()
    expect(h.record).toHaveBeenCalledWith('ci.green', expect.any(String), expect.any(String))
  })

  it('is not_measured the first time and never turns green', async () => {
    const h = harness([{ kind: 'not_measured', checks: [], reason: 'no checks were reported' }])
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: 2,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(outcome).toEqual({ kind: 'not_measured', reason: 'no checks were reported' })
    expect(h.sendBack).not.toHaveBeenCalled()
    expect(h.record).toHaveBeenCalledWith(
      'ci.not_measured',
      expect.any(String),
      'no checks were reported'
    )
  })

  it('goes red then green: one round, one ci.round record, feedback carries the log', async () => {
    const red = { kind: 'red' as const, checks: [check({ name: 'lint', bucket: 'fail' })] }
    const green = { kind: 'green' as const, checks: [check({ name: 'lint' })] }
    const h = harness([red, green])
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: 2,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(outcome.kind).toBe('green')
    expect(h.record).toHaveBeenCalledTimes(2)
    expect(h.record.mock.calls[0][0]).toBe('ci.round')
    expect(h.record.mock.calls[1][0]).toBe('ci.green')
    expect(h.sendBack).toHaveBeenCalledTimes(1)
    const feedback = h.sendBack.mock.calls[0][0] as Feedback
    expect(feedback.source).toBe('ci')
    expect(feedback.excerpt).toContain('log for lint')
    expect(h.states.map((s) => s.status)).toEqual(['watching', 'reworking', 'watching', 'green'])
  })

  it('exhausts rounds: red three times with max 2 rounds sendBack, then a red outcome', async () => {
    const red = { kind: 'red' as const, checks: [check({ name: 'lint', bucket: 'fail' })] }
    const h = harness([red, red, red])
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: 2,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(h.sendBack).toHaveBeenCalledTimes(2)
    expect(outcome.kind).toBe('red')
    if (outcome.kind === 'red') expect(outcome.rounds).toBe(2)
    expect(h.record.mock.calls.at(-1)?.[0]).toBe('ci.exhausted')
  })

  it('halts when sendBack reports it could not finish', async () => {
    const red = { kind: 'red' as const, checks: [check({ name: 'lint', bucket: 'fail' })] }
    const h = harness([red], { sendBack: false })
    const outcome = await ciRounds({
      pulls: [PULL],
      rounds: 2,
      watch: h.watch,
      failedLogs: h.failedLogs,
      sendBack: h.sendBack,
      record: h.record,
      state: h.state,
    })
    expect(outcome).toEqual({ kind: 'halted', reason: expect.any(String) })
    expect(h.sendBack).toHaveBeenCalledTimes(1)
  })

  it('is red when one of two pulls is red', async () => {
    const green: CiVerdict = { kind: 'green', checks: [check()] }
    const red: CiVerdict = { kind: 'red', checks: [check({ name: 'lint', bucket: 'fail' })] }
    let n = 0
    const watch = vi.fn(async (pull: { url: string; cwd: string }): Promise<CiVerdict> => {
      n += 1
      return pull.url.endsWith('/2') ? red : green
    })
    const failedLogs = vi.fn(async () => 'log')
    const sendBack = vi.fn(async () => true)
    const record = vi.fn(async () => {})
    const state = vi.fn(async () => {})
    const outcome = await ciRounds({
      pulls: [PULL, { url: 'https://github.com/o/r/pull/2', cwd: '/repo2' }],
      rounds: 0,
      watch,
      failedLogs,
      sendBack,
      record,
      state,
    })
    expect(outcome.kind).toBe('red')
    void n
  })
})
