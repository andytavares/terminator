import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createEarlyShip } from '../../src/line/early-ship.js'
import type { IntegrateDeps, Shipment } from '../../src/line/integrate.js'
import type { RunOutcome } from '../../src/line/executor.js'
import type { CiOutcome } from '../../src/line/ship-tail.js'
import type { LadderOutcome } from '../../src/verify/ladder.js'
import { draftOrder } from '../../src/order/draft.js'
import type { RiskAssessment, WorkOrder } from '../../src/order/schema.js'

// The draft opens before the final check, and the check runs while CI does —
// except where the operator decides before anything reaches the remote.

let root: string

function order(): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Refuse an expired refresh token',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'running',
    context: {
      ...base.context,
      repos: [
        {
          name: 'app',
          path: '/repos/app',
          lane: 1,
          baseBranch: 'main',
          headBranch: 'foundry/wo-1',
        },
      ],
    },
  }
}

const risk = (grade: RiskAssessment['grade']): RiskAssessment => ({
  grade,
  triggers: [],
  blastRadius: [],
  criticalPaths: [],
})

const passing: LadderOutcome = { steps: [], stoppedAt: null, unmeasured: [], ok: true }
const failing: LadderOutcome = {
  steps: [
    {
      rung: 'L0',
      name: 'Lint',
      result: 'fail',
      reason: 'exited 1',
      exitCode: 1,
      command: 'npm run lint',
    },
  ],
  stoppedAt: 'L0',
  unmeasured: [],
  ok: false,
}

function outcome(over: Partial<RunOutcome> = {}): RunOutcome {
  return {
    graph: { orderId: 'WO-1', recipe: 'direct', nodes: [] },
    verdicts: [],
    complete: true,
    awaitingDecision: [],
    gates: [],
    ladder: passing,
    inspection: { required: false, triggers: [], reason: '' },
    risk: risk('P3'),
    shippable: true,
    ...over,
  } as RunOutcome
}

function setup(over: Partial<IntegrateDeps> = {}, dirty = false) {
  const calls: string[] = []
  const exec = vi.fn(async (options: { command: string; args: string[] }) => {
    calls.push(`${options.command} ${options.args.slice(0, 2).join(' ')}`)
    if (options.command === 'gh' && options.args[1] === 'create') {
      return {
        exitCode: 0,
        stdout: 'https://github.com/tav/app/pull/7\n',
        stderr: '',
        timedOut: false,
      }
    }
    const status = options.command === 'git' && options.args[0] === 'status'
    return { exitCode: 0, stdout: status && dirty ? ' M a.ts\n' : '', stderr: '', timedOut: false }
  })
  const raised: string[] = []
  const deps = {
    exec: exec as never,
    root,
    now: () => '2026-09-06T12:00:00.000Z',
    autoOpen: true,
    decide: vi.fn(async () => 'approve'),
    record: vi.fn(async () => undefined),
    raiseGate: async (gate: { rule: string }) => void raised.push(gate.rule),
    watchCi: vi.fn(async () => ({ kind: 'none' }) as CiOutcome),
    ...over,
  } as IntegrateDeps
  const shipment = (): Shipment => ({ verdicts: [], findings: [] })
  const early = createEarlyShip({ order: order(), deps, shipment })
  return { early, calls, raised, deps, exec }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-early-'))
})

describe('opening before the final check', () => {
  it('opens the draft and starts the CI watch for a P3 change, before the check climbs', async () => {
    const { early, calls, deps } = setup()
    const opened = await early.beforeFinalCheck({ risk: risk('P3'), verdicts: [] })
    expect(opened).toBe(true)
    expect(early.opened).toBe(true)
    expect(calls.some((c) => c.startsWith('gh pr'))).toBe(true)
    expect(deps.watchCi).toHaveBeenCalledTimes(1)
  })

  it.each(['P0', 'P1'] as const)(
    'opens nothing at %s: the operator decides first',
    async (grade) => {
      const { early, calls, deps } = setup()
      expect(await early.beforeFinalCheck({ risk: risk(grade), verdicts: [] })).toBe(false)
      expect(early.opened).toBe(false)
      expect(calls).toEqual([])
      expect(deps.watchCi).not.toHaveBeenCalled()
    }
  )

  it('opens nothing and says so when drafts are turned off', async () => {
    const { early, deps } = setup({ autoOpen: false })
    expect(await early.beforeFinalCheck({ risk: risk('P3'), verdicts: [] })).toBe(false)
    expect(deps.watchCi).not.toHaveBeenCalled()
    expect((await early.finish(outcome()))?.held).toBe(true)
  })
})

describe('after the final check', () => {
  it('raises the ready question when the check passed and CI is green', async () => {
    const green: CiOutcome = { kind: 'green', checks: [] }
    const { early, raised } = setup({ watchCi: vi.fn(async () => green) })
    await early.beforeFinalCheck({ risk: risk('P3'), verdicts: [] })
    const done = await early.finish(outcome())
    expect(done?.gate?.rule).toBe('ready-for-review')
    expect(raised).toEqual(['ready-for-review'])
  })

  it('raises nothing, and opens no second draft, when the check failed', async () => {
    const { early, calls, raised } = setup()
    await early.beforeFinalCheck({ risk: risk('P3'), verdicts: [] })
    const done = await early.finish(outcome({ ladder: failing, shippable: false }))
    expect(done).toBeNull()
    expect(raised).toEqual([])
    expect(calls.filter((c) => c === 'gh pr create')).toHaveLength(1)
  })

  it('waits for CI before asking, even when the check finished first', async () => {
    let release: (value: CiOutcome) => void = () => undefined
    const slow = new Promise<CiOutcome>((resolve) => (release = resolve))
    const { early, raised } = setup({ watchCi: vi.fn(() => slow) })
    await early.beforeFinalCheck({ risk: risk('P3'), verdicts: [] })
    const finishing = early.finish(outcome())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(raised).toEqual([])
    release({ kind: 'green', checks: [] })
    await finishing
    expect(raised).toEqual(['ready-for-review'])
  })

  it('does not ask while CI is red: the ci.red gate is the question instead', async () => {
    const red: CiOutcome = { kind: 'red', checks: [], excerpt: '', rounds: 2 }
    const { early, raised } = setup({ watchCi: vi.fn(async () => red) })
    await early.beforeFinalCheck({ risk: risk('P3'), verdicts: [] })
    const done = await early.finish(outcome())
    expect(done?.gate?.rule).toBe('ci.red')
    expect(raised).toEqual(['ci.red'])
  })

  it('commits what the check wrote, pushes it, and watches CI again on that commit', async () => {
    const watchCi = vi.fn(async () => ({ kind: 'green', checks: [] }) as CiOutcome)
    const { early, calls } = setup({ watchCi }, true)
    await early.beforeFinalCheck({ risk: risk('P3'), verdicts: [] })
    await early.finish(outcome())
    expect(calls).toContain('git commit -m')
    expect(calls.filter((c) => c === 'git push --set-upstream')).toHaveLength(2)
    expect(watchCi).toHaveBeenCalledTimes(2)
  })

  it('does nothing when nothing was opened first', async () => {
    const { early } = setup()
    expect(await early.finish(outcome())).toBeNull()
  })

  it('surfaces a CI watch that threw rather than swallowing it', async () => {
    const { early } = setup({ watchCi: vi.fn(async () => Promise.reject(new Error('gh down'))) })
    await early.beforeFinalCheck({ risk: risk('P3'), verdicts: [] })
    await expect(early.finish(outcome())).rejects.toThrow('gh down')
  })

  it('on a re-entry reuses the existing draft rather than creating a second', async () => {
    const first = setup()
    await first.early.beforeFinalCheck({ risk: risk('P3'), verdicts: [] })
    const second = setup()
    await second.early.beforeFinalCheck({ risk: risk('P3'), verdicts: [] })
    expect(second.calls.filter((c) => c === 'gh pr create')).toHaveLength(0)
    expect(second.calls.some((c) => c.startsWith('git push'))).toBe(true)
  })
})
