import { describe, it, expect, vi } from 'vitest'
import { watchChecks, failedLogs } from '../../src/line/ci.js'
import type { Check } from '../../src/line/ci.js'
import type { ExecResult, ShellExec } from '../../src/line/integrate.js'
import { partialFake } from '../../../../tests/support/fakes'

// gh pr checks exits 0 even while pending; a PR with no checks reported
// exits 1 with a fixed message. Both are read here, never inferred.

const pull = { url: 'https://github.com/o/r/pull/1', cwd: '/repos/app' }

function ok(stdout: unknown): ExecResult {
  return { exitCode: 0, stdout: JSON.stringify(stdout), stderr: '', timedOut: false }
}

function fail(stderr: string): ExecResult {
  return { exitCode: 1, stdout: '', stderr, timedOut: false }
}

function check(over: Partial<Check> = {}): Check {
  return {
    name: 'Test',
    bucket: 'pending',
    link: 'https://github.com/o/r/actions/runs/36256477669/job/108444100336',
    workflow: 'CI',
    ...over,
  }
}

/** A fake exec that replays a fixed queue of results, one per call. */
function queuedExec(results: ExecResult[]): ShellExec {
  const calls = [...results]
  return vi.fn(async () => {
    const next = calls.shift()
    if (!next) throw new Error('exec queue exhausted')
    return next
  })
}

function noopSleep() {
  return async () => {}
}

describe('watchChecks', () => {
  describe('passing and failing', passingAndFailingTests)
  describe('no checks yet', noChecksYetTests)
  describe('waiting for checks to appear', waitingForChecksToAppearTests)
  describe('runs already judged', runsAlreadyJudgedTests)
  describe('cancel and unreadable output', cancelAndUnreadableOutputTests)
  describe('timing out and polling', timingOutAndPollingTests)
  describe('odd output', oddOutputTests)
  describe('runs it cannot place', runsItCannotPlaceTests)
})

function passingAndFailingTests() {
  it('pending then pass is green after one sleep', async () => {
    const exec = queuedExec([ok([check({ bucket: 'pending' })]), ok([check({ bucket: 'pass' })])])
    const sleep = vi.fn(noopSleep())
    const verdict = await watchChecks(pull, exec, { sleep })
    expect(verdict.kind).toBe('green')
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('pending then fail is red', async () => {
    const exec = queuedExec([ok([check({ bucket: 'pending' })]), ok([check({ bucket: 'fail' })])])
    const verdict = await watchChecks(pull, exec, { sleep: noopSleep() })
    expect(verdict.kind).toBe('red')
  })

  it('only skipping is green', async () => {
    const exec = queuedExec([ok([check({ bucket: 'skipping' })])])
    const verdict = await watchChecks(pull, exec, { sleep: noopSleep() })
    expect(verdict.kind).toBe('green')
  })
}

function noChecksYetTests() {
  it('empty checks list is not_measured once the wait for checks is over, never green', async () => {
    const exec = queuedExec([ok([]), ok([]), ok([])])
    const sleep = vi.fn(noopSleep())
    const verdict = await watchChecks(pull, exec, { sleep, pollMs: 10, appearWithinMs: 20 })
    expect(verdict.kind).toBe('not_measured')
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('"no checks reported" exit 1 is not_measured once the wait for checks is over', async () => {
    const none = fail("no checks reported on the 'foo' branch")
    const exec = queuedExec([none, none])
    const verdict = await watchChecks(pull, exec, {
      sleep: noopSleep(),
      pollMs: 10,
      appearWithinMs: 10,
    })
    expect(verdict).toMatchObject({
      kind: 'not_measured',
      reason: expect.stringMatching(/no checks/i),
    })
  })
}

function waitingForChecksToAppearTests() {
  // Seen live: the draft was polled two seconds after `gh pr create`, before
  // GitHub had registered the workflow that started seven seconds later.
  it('waits for checks to appear after the draft opens', async () => {
    const exec = queuedExec([
      fail("no checks reported on the 'foo' branch"),
      ok([]),
      ok([check({ bucket: 'pending' })]),
      ok([check({ bucket: 'fail' })]),
    ])
    const verdict = await watchChecks(pull, exec, { sleep: noopSleep() })
    expect(verdict.kind).toBe('red')
  })
}

function runsAlreadyJudgedTests() {
  // Seen live: right after a fix was pushed, `gh pr checks` still listed the
  // previous commit's failed run, and a second round began for a fix that had
  // already worked.
  it('ignores the runs it has already judged, waiting for the new ones', async () => {
    const stale = check({ bucket: 'fail', link: 'https://github.com/o/r/actions/runs/111/job/1' })
    const fresh = (bucket: Check['bucket']) =>
      check({ bucket, link: 'https://github.com/o/r/actions/runs/222/job/2' })
    const exec = queuedExec([ok([stale]), ok([fresh('pending')]), ok([fresh('pass')])])
    const verdict = await watchChecks(pull, exec, {
      sleep: noopSleep(),
      ignoreRuns: new Set(['111']),
    })
    expect(verdict.kind).toBe('green')
  })

  it('is not measured when only judged runs are listed once the wait is over', async () => {
    const stale = check({ bucket: 'fail', link: 'https://github.com/o/r/actions/runs/111/job/1' })
    const exec = queuedExec([ok([stale]), ok([stale])])
    const verdict = await watchChecks(pull, exec, {
      sleep: noopSleep(),
      pollMs: 10,
      appearWithinMs: 10,
      ignoreRuns: new Set(['111']),
    })
    expect(verdict.kind).toBe('not_measured')
  })
}

function cancelAndUnreadableOutputTests() {
  it('cancel is red', async () => {
    const exec = queuedExec([ok([check({ bucket: 'cancel' })])])
    const verdict = await watchChecks(pull, exec, { sleep: noopSleep() })
    expect(verdict.kind).toBe('red')
  })

  it('unparseable output with non-zero exit is not_measured with stderr as reason', async () => {
    const exec = queuedExec([fail('gh: some other failure')])
    const verdict = await watchChecks(pull, exec, { sleep: noopSleep() })
    expect(verdict).toMatchObject({ kind: 'not_measured', reason: 'gh: some other failure' })
  })
}

function oddOutputTests() {
  it('is not measured when gh prints something other than a list of checks', async () => {
    const exec = queuedExec([ok({ checks: [] })])
    const verdict = await watchChecks(pull, exec, { sleep: noopSleep() })
    expect(verdict).toEqual({
      kind: 'not_measured',
      checks: [],
      reason: 'unparseable checks output',
    })
  })

  it('is not measured when what gh printed is not JSON at all', async () => {
    const exec = queuedExec([{ exitCode: 0, stdout: 'not json', stderr: '', timedOut: false }])
    const verdict = await watchChecks(pull, exec, { sleep: noopSleep() })
    expect(verdict).toEqual({
      kind: 'not_measured',
      checks: [],
      reason: 'unparseable checks output',
    })
  })

  it('gives what gh printed as the reason when it failed saying nothing on stderr', async () => {
    const exec = queuedExec([{ exitCode: 4, stdout: 'HTTP 502', stderr: '', timedOut: false }])
    const verdict = await watchChecks(pull, exec, { sleep: noopSleep() })
    expect(verdict).toEqual({ kind: 'not_measured', checks: [], reason: 'HTTP 502' })
  })
}

function runsItCannotPlaceTests() {
  it('reads a check with no run in its link as a fresh one', async () => {
    const exec = queuedExec([ok([check({ bucket: 'pass', link: 'https://example.com/status' })])])
    const verdict = await watchChecks(pull, exec, {
      sleep: noopSleep(),
      ignoreRuns: new Set(['111']),
    })
    expect(verdict.kind).toBe('green')
  })
}

function timingOutAndPollingTests() {
  it('times out after timeoutMs/pollMs polls while still pending', async () => {
    const results = Array.from({ length: 4 }, () => ok([check({ bucket: 'pending' })]))
    const exec = queuedExec(results)
    const sleep = vi.fn(noopSleep())
    const verdict = await watchChecks(pull, exec, { sleep, pollMs: 1000, timeoutMs: 3000 })
    expect(verdict).toMatchObject({
      kind: 'not_measured',
      reason: expect.stringMatching(/still pending/i),
    })
    expect(sleep).toHaveBeenCalledTimes(3)
  })

  it('calls onPoll with each parsed list', async () => {
    const exec = queuedExec([ok([check({ bucket: 'pending' })]), ok([check({ bucket: 'pass' })])])
    const onPoll = vi.fn()
    await watchChecks(pull, exec, { sleep: noopSleep(), onPoll })
    expect(onPoll).toHaveBeenCalledTimes(2)
    expect(onPoll.mock.calls[0][0][0].bucket).toBe('pending')
  })
}

describe('failedLogs', () => {
  describe('run logs', runLogsTests)
  describe('checks without a run, and failures', checksWithoutARunAndFailuresTests)
  describe('non-Error throws', nonErrorThrowsTests)
})

function runLogsTests() {
  it('extracts the run id from the link, dedupes two jobs of one run, truncates, survives a failure', async () => {
    const checks: Check[] = [
      check({
        name: 'Test',
        bucket: 'fail',
        link: 'https://github.com/o/r/actions/runs/36256477669/job/108444100336',
      }),
      check({
        name: 'Lint',
        bucket: 'fail',
        link: 'https://github.com/o/r/actions/runs/36256477669/job/999',
      }),
    ]
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n')
    const exec = partialFake<ShellExec>(
      vi.fn(async ({ args }: { args: string[] }) => {
        expect(args).toContain('36256477669')
        return { exitCode: 0, stdout: lines, stderr: '', timedOut: false }
      })
    )
    const out = await failedLogs(checks, '/repos/app', exec)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(out.split('\n').length).toBeLessThanOrEqual(200)
    expect(out).toContain('line 249')
  })
}

function checksWithoutARunAndFailuresTests() {
  it('lists a check by name and link when the link has no run id', async () => {
    const checks: Check[] = [check({ bucket: 'cancel', link: 'https://example.com/no-run-id' })]
    const exec = partialFake<ShellExec>(
      vi.fn(async () => {
        throw new Error('should not be called')
      })
    )
    const out = await failedLogs(checks, '/repos/app', exec)
    expect(out).toContain('Test')
    expect(out).toContain('https://example.com/no-run-id')
  })

  it('never throws; a failing gh run view contributes a line saying so', async () => {
    const checks: Check[] = [
      check({
        bucket: 'fail',
        link: 'https://github.com/o/r/actions/runs/1/job/2',
      }),
    ]
    const exec = partialFake<ShellExec>(
      vi.fn(async () => {
        throw new Error('boom')
      })
    )
    const out = await failedLogs(checks, '/repos/app', exec)
    expect(out).toContain('could not be read')
  })
}

function nonErrorThrowsTests() {
  it('says what was thrown when it was not an Error', async () => {
    const checks: Check[] = [
      check({ bucket: 'fail', link: 'https://github.com/o/r/actions/runs/1/job/2' }),
    ]
    const exec = partialFake<ShellExec>(
      vi.fn(async () => {
        throw 'gh went away'
      })
    )
    const out = await failedLogs(checks, '/repos/app', exec)
    expect(out).toBe('## CI/Test (run 1)\nlog could not be read: gh went away')
  })
}
