import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  shipModeFor,
  GATED_GRADES,
  prBody,
  shipOrder,
  markReady,
  PushRefusedError,
} from '../../src/line/integrate.js'
import type { IntegrateDeps } from '../../src/line/integrate.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { makeVerdict } from '../../src/verify/verdict.js'
import type { Verdict } from '../../src/verify/verdict.js'

// Work ends in a draft pull request without anyone asking for one, and the
// decision the operator is offered is whether to mark it ready — never whether
// to create it.

let root: string

function order(over: Partial<WorkOrder> = {}): WorkOrder {
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
    acceptance: [
      {
        id: 'AC-1',
        statement: 'An expired token is refused',
        priority: 'P0',
        verify: { kind: 'test', command: 'npm test', assert: 'exit 0' },
        unverifiable: null,
      },
    ],
    ...over,
  }
}

function verdict(over: Partial<Parameters<typeof makeVerdict>[0]> = {}): Verdict {
  return makeVerdict({
    nodeId: 'N-1',
    criterionId: 'AC-1',
    result: 'pass',
    reason: '',
    evidence: [{ kind: 'exit_code', exitCode: 0 }],
    producedBy: { role: 'verifier', sessionId: 's-verify' },
    ...over,
  })
}

function deps(
  over: Partial<IntegrateDeps> = {}
): IntegrateDeps & { exec: ReturnType<typeof vi.fn> } {
  const exec = vi.fn(async (options: { command: string; args: string[] }) => {
    if (options.command === 'gh' && options.args[1] === 'create') {
      return {
        exitCode: 0,
        stdout: 'https://github.com/tav/app/pull/7\n',
        stderr: '',
        timedOut: false,
      }
    }
    return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
  })
  return {
    exec: exec as never,
    root,
    now: () => '2026-09-06T12:00:00.000Z',
    autoOpen: true,
    decide: vi.fn(async () => 'approve'),
    record: vi.fn(async () => undefined),
    ...over,
  } as IntegrateDeps & { exec: ReturnType<typeof vi.fn> }
}

function callsTo(exec: ReturnType<typeof vi.fn>, command: string, verb?: string) {
  return exec.mock.calls
    .map((call) => call[0] as { command: string; args: string[]; cwd: string })
    .filter((call) => call.command === command && (verb === undefined || call.args[1] === verb))
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-ship-'))
})

describe('the command line', () => {
  it('opens a draft, not a review request', async () => {
    const d = deps()
    await shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    expect(callsTo(d.exec, 'gh', 'create')[0].args).toContain('--draft')
  })

  it('names the head, the base, the title and a body file — never an inline body', async () => {
    const d = deps()
    await shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    const args = callsTo(d.exec, 'gh', 'create')[0].args

    expect(args).toEqual(
      expect.arrayContaining([
        '--head',
        'foundry/wo-1',
        '--base',
        'main',
        '--title',
        'Refuse an expired refresh token',
        '--body-file',
      ])
    )
    // A pull request body is long, contains newlines and backticks, and is
    // written by an agent. Through argv it is a quoting bug waiting to happen.
    expect(args).not.toContain('--body')
  })

  it('writes the body to the order directory and points gh at that file', async () => {
    const d = deps()
    await shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    const args = callsTo(d.exec, 'gh', 'create')[0].args
    const file = args[args.indexOf('--body-file') + 1]

    expect(file.startsWith(root)).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toContain('AC-1')
  })

  it('runs in the repository it is opening the pull request for', async () => {
    const d = deps()
    await shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    expect(callsTo(d.exec, 'gh', 'create')[0].cwd).toBe('/repos/app')
  })

  it('pushes the branch before asking gh to open anything', async () => {
    const d = deps()
    await shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    const order_ = d.exec.mock.calls.map((c) => (c[0] as { command: string }).command)
    expect(order_.indexOf('git')).toBeLessThan(order_.indexOf('gh'))
  })

  it('sets the upstream on the push, so the branch is trackable afterwards', async () => {
    const d = deps()
    await shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    expect(callsTo(d.exec, 'git')[0].args).toEqual([
      'push',
      '--set-upstream',
      'origin',
      'HEAD:foundry/wo-1',
    ])
  })

  it('returns the pull request URL gh printed', async () => {
    const result = await shipOrder(order(), { verdicts: [verdict()], findings: [] }, deps())
    expect(result.pulls[0].url).toBe('https://github.com/tav/app/pull/7')
  })

  it('refuses to open a pull request when the push failed', async () => {
    const exec = vi.fn(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'rejected: non-fast-forward',
      timedOut: false,
    }))
    const d = deps({ exec: exec as never })
    await expect(
      shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    ).rejects.toBeInstanceOf(PushRefusedError)
    expect(callsTo(exec, 'gh')).toHaveLength(0)
  })

  it('carries the push failure through rather than summarising it away', async () => {
    const exec = vi.fn(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'rejected: non-fast-forward',
      timedOut: false,
    }))
    await expect(
      shipOrder(order(), { verdicts: [verdict()], findings: [] }, deps({ exec: exec as never }))
    ).rejects.toThrow(/non-fast-forward/)
  })
})

describe('marking ready', () => {
  it('calls gh pr ready on the pull request it opened', async () => {
    const d = deps()
    await markReady({ url: 'https://github.com/tav/app/pull/7', cwd: '/repos/app' }, d)
    expect(callsTo(d.exec, 'gh', 'ready')[0].args).toEqual([
      'pr',
      'ready',
      'https://github.com/tav/app/pull/7',
    ])
  })

  it('reports a refusal rather than claiming the pull request is ready', async () => {
    const exec = vi.fn(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'not found',
      timedOut: false,
    }))
    await expect(
      markReady(
        { url: 'https://github.com/tav/app/pull/7', cwd: '/repos/app' },
        deps({ exec: exec as never })
      )
    ).rejects.toThrow(/not found/)
  })
})

describe('risk-ordered shipping (FR-055)', () => {
  it('gates before pushing for the two highest grades', () => {
    expect(GATED_GRADES).toEqual(['P0', 'P1'])
    expect(shipModeFor(order({ risk: { ...order().risk, grade: 'P0' } }))).toBe('gate_then_push')
    expect(shipModeFor(order({ risk: { ...order().risk, grade: 'P1' } }))).toBe('gate_then_push')
  })

  it('opens the draft first for everything lower, so review happens on a real change', () => {
    expect(shipModeFor(order({ risk: { ...order().risk, grade: 'P2' } }))).toBe('push_then_gate')
    expect(shipModeFor(order({ risk: { ...order().risk, grade: 'P3' } }))).toBe('push_then_gate')
  })

  it('takes the decision before anything reaches the remote at P0', async () => {
    const seen: string[] = []
    const d = deps({
      decide: vi.fn(async () => {
        seen.push('decided')
        return 'approve'
      }),
    })
    d.exec = vi.fn(async (options: { command: string; args: string[] }) => {
      seen.push(options.command)
      return {
        exitCode: 0,
        stdout: 'https://github.com/tav/app/pull/7\n',
        stderr: '',
        timedOut: false,
      }
    }) as never
    await shipOrder(
      order({ risk: { ...order().risk, grade: 'P0' } }),
      { verdicts: [verdict()], findings: [] },
      d
    )
    expect(seen[0]).toBe('decided')
  })

  it('pushes nothing when the operator holds a P0', async () => {
    const d = deps({ decide: vi.fn(async () => 'hold') })
    const result = await shipOrder(
      order({ risk: { ...order().risk, grade: 'P0' } }),
      { verdicts: [verdict()], findings: [] },
      d
    )
    expect(result.pulls).toEqual([])
    expect(d.exec).not.toHaveBeenCalled()
    expect(result.held).toBe(true)
  })

  it('asks nobody before pushing at P2', async () => {
    const d = deps({ risk: undefined })
    await shipOrder(
      order({ risk: { ...order().risk, grade: 'P2' } }),
      { verdicts: [verdict()], findings: [] },
      d
    )
    expect(d.decide).not.toHaveBeenCalled()
  })

  it('names the risk grade in the gate it raises, since the rule id does not', async () => {
    const decide = vi.fn(async () => 'approve')
    await shipOrder(
      order({ risk: { ...order().risk, grade: 'P1' } }),
      { verdicts: [verdict()], findings: [] },
      deps({ decide })
    )
    expect(decide.mock.calls[0][0]).toMatchObject({ rule: 'risk.p0', riskGrade: 'P1' })
  })
})

describe('the setting that turns pushing off (FR-054)', () => {
  it('pushes nothing when draft-first is off, and says so', async () => {
    const d = deps({ autoOpen: false })
    const result = await shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    expect(d.exec).not.toHaveBeenCalled()
    expect(result.held).toBe(true)
    expect(result.reason).toMatch(/draft/i)
  })

  it('still writes the body, so the operator can read what would have shipped', async () => {
    const d = deps({ autoOpen: false })
    const result = await shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    expect(fs.readFileSync(result.bodyPaths[0], 'utf8')).toContain('AC-1')
  })
})

describe('the pull request body (FR-056)', () => {
  it('carries a written summary of the work', () => {
    const body = prBody(order(), { verdicts: [verdict()], findings: [] })
    expect(body).toContain('Refuse an expired refresh token')
  })

  it('carries a verdict for every criterion', () => {
    const body = prBody(order(), { verdicts: [verdict()], findings: [] })
    expect(body).toContain('AC-1')
    expect(body).toContain('pass')
  })

  it('says "not measured" for a criterion nothing checked, rather than leaving it out', () => {
    const body = prBody(order(), { verdicts: [], findings: [] })
    expect(body).toContain('AC-1')
    expect(body).toMatch(/not measured/i)
  })

  it('never reads a not-measured criterion as a pass', () => {
    const body = prBody(order(), {
      verdicts: [verdict({ result: 'not_measured', reason: 'no lint command in this repository' })],
      findings: [],
    })
    expect(body).toMatch(/not measured/i)
    expect(body).toContain('no lint command in this repository')
  })

  it('carries inspection findings when there were any', () => {
    const body = prBody(order(), {
      verdicts: [verdict()],
      findings: ['Token comparison is not constant-time'],
    })
    expect(body).toContain('Token comparison is not constant-time')
  })

  it('says the inspection found nothing rather than omitting the section', () => {
    const body = prBody(order(), { verdicts: [verdict()], findings: [] })
    expect(body).toMatch(/inspection/i)
  })

  it('names the order it came from', () => {
    expect(prBody(order(), { verdicts: [], findings: [] })).toContain('WO-1')
  })

  it('marks itself as a draft opened by the factory, not by a person', () => {
    expect(prBody(order(), { verdicts: [], findings: [] })).toMatch(/Foundry/)
  })
})

describe('remembering what was opened', () => {
  it('writes the drafts down, so a decision taken later knows which one it means', async () => {
    const d = deps()
    await shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    const { readPulls } = await import('../../src/line/integrate.js')
    const remembered = await readPulls(root, 'WO-1')
    expect(remembered[0]).toMatchObject({
      url: 'https://github.com/tav/app/pull/7',
      cwd: '/repos/app',
    })
  })

  it('reads no drafts for an order that never opened any', async () => {
    const { readPulls } = await import('../../src/line/integrate.js')
    expect(await readPulls(root, 'WO-nothing')).toEqual([])
  })

  it('reads an unreadable record as none rather than guessing at a URL', async () => {
    fs.mkdirSync(path.join(root, 'orders', 'WO-bad'), { recursive: true })
    fs.writeFileSync(path.join(root, 'orders', 'WO-bad', 'pulls.json'), '{{{')
    const { readPulls } = await import('../../src/line/integrate.js')
    expect(await readPulls(root, 'WO-bad')).toEqual([])
  })
})

describe('the branches a happy path never reaches', () => {
  it('reports the worst verdict for a criterion, not the first', () => {
    const body = prBody(order(), {
      verdicts: [
        verdict({ nodeId: 'N-1' }),
        verdict({ nodeId: 'N-2', result: 'fail', reason: 'the token was accepted' }),
      ],
      findings: [],
    })
    expect(body).toContain('fail')
    expect(body).toContain('the token was accepted')
  })

  it('prefers a not-measured over a pass, so a gap is never hidden by a sibling', () => {
    const body = prBody(order(), {
      verdicts: [
        verdict({ nodeId: 'N-1' }),
        verdict({ nodeId: 'N-2', result: 'not_measured', reason: 'no lint command here' }),
      ],
      findings: [],
    })
    expect(body).toMatch(/not measured/i)
  })

  it('lists the units that did the work', () => {
    const withUnits = order({
      plan: {
        ...order().plan,
        units: [
          {
            id: 'U-1',
            title: 'reject expired tokens',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['src/auth.ts'],
            verify: [],
          },
        ],
      },
    })
    const body = prBody(withUnits, { verdicts: [verdict()], findings: [] })
    expect(body).toContain('U-1')
    expect(body).toContain('builder')
  })

  it('says there are no units rather than leaving the section blank', () => {
    expect(prBody(order(), { verdicts: [], findings: [] })).toContain('_No units._')
  })

  it('says there are no criteria rather than printing an empty table', () => {
    const body = prBody(order({ acceptance: [] }), { verdicts: [], findings: [] })
    expect(body).toContain('_No criteria._')
  })

  it('carries the intent when the order states one', () => {
    const stated = order({
      intent: { problem: 'expired tokens are accepted', outcome: 'they are refused', nonGoals: [] },
    })
    const body = prBody(stated, { verdicts: [], findings: [] })
    expect(body).toContain('expired tokens are accepted')
    expect(body).toContain('they are refused')
  })

  it('names the risk triggers in the shipping gate when there are any', async () => {
    const decide = vi.fn(async () => 'approve')
    await shipOrder(
      order({ risk: { grade: 'P0', triggers: ['secrets'], blastRadius: [], criticalPaths: [] } }),
      { verdicts: [verdict()], findings: [] },
      deps({ decide })
    )
    expect((decide.mock.calls[0][0] as { why: string }).why).toContain('secrets')
  })

  it('reports a refused pull request rather than returning an empty URL', async () => {
    const exec = vi.fn(async (options: { command: string }) =>
      options.command === 'git'
        ? { exitCode: 0, stdout: '', stderr: '', timedOut: false }
        : { exitCode: 1, stdout: '', stderr: 'no upstream configured', timedOut: false }
    )
    await expect(
      shipOrder(order(), { verdicts: [verdict()], findings: [] }, deps({ exec: exec as never }))
    ).rejects.toThrow(/no upstream configured/)
  })

  it('records an empty URL rather than inventing one when gh printed nothing', async () => {
    const exec = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }))
    const result = await shipOrder(
      order(),
      { verdicts: [verdict()], findings: [] },
      deps({ exec: exec as never })
    )
    expect(result.pulls[0].url).toBe('')
  })
})

describe('one order across several repositories (FR-067, FR-068)', () => {
  function twoLanes(over: Partial<WorkOrder> = {}): WorkOrder {
    const base = order()
    return {
      ...base,
      context: {
        ...base.context,
        repos: [
          {
            name: 'proto',
            path: '/repos/proto',
            lane: 1,
            baseBranch: 'main',
            headBranch: 'f/wo-1',
          },
          { name: 'cli', path: '/repos/cli', lane: 2, baseBranch: 'main', headBranch: 'f/wo-1' },
        ],
      },
      plan: {
        ...base.plan,
        sharedFiles: ['proto/session.proto'],
        lanes: [
          { ord: 1, repo: 'proto', branch: '', role: 'producer', blocks: [2], blockedBy: [] },
          { ord: 2, repo: 'cli', branch: '', role: 'consumer', blocks: [], blockedBy: [1] },
        ],
        units: [
          {
            id: 'U-1',
            title: 'the contract',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['proto/session.proto'],
            verify: [],
          },
          {
            id: 'U-2',
            title: 'adopt it',
            role: 'builder',
            lane: 2,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['proto/session.proto'],
            verify: [],
          },
        ],
      },
      ...over,
    }
  }

  /** A client that hands each `gh pr create` its own URL. */
  function multiDeps() {
    let created = 0
    const exec = vi.fn(async (options: { command: string; args: string[] }) => {
      if (options.command === 'gh' && options.args[1] === 'create') {
        created += 1
        return {
          exitCode: 0,
          stdout: `https://github.com/tav/r/pull/${created}\n`,
          stderr: '',
          timedOut: false,
        }
      }
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    })
    return deps({ exec: exec as never })
  }

  it('opens one draft per repository', async () => {
    const d = multiDeps()
    const result = await shipOrder(twoLanes(), { verdicts: [verdict()], findings: [] }, d)
    expect(result.pulls.map((p) => p.repo)).toEqual(['proto', 'cli'])
  })

  it('opens them in merge order, producer first', async () => {
    const d = multiDeps()
    await shipOrder(twoLanes(), { verdicts: [verdict()], findings: [] }, d)
    expect(callsTo(d.exec, 'gh', 'create').map((c) => c.cwd)).toEqual([
      '/repos/proto',
      '/repos/cli',
    ])
  })

  it('tells the consumer which lane it must not merge before', async () => {
    const d = multiDeps()
    const result = await shipOrder(twoLanes(), { verdicts: [verdict()], findings: [] }, d)
    const consumer = fs.readFileSync(result.pulls[1].bodyPath, 'utf8')
    expect(consumer).toContain('Do not merge this before lane 1')
    expect(consumer).toContain('https://github.com/tav/r/pull/1')
  })

  it('names the shared file on both, not only on the producer', async () => {
    const d = multiDeps()
    const result = await shipOrder(twoLanes(), { verdicts: [verdict()], findings: [] }, d)
    for (const pull of result.pulls) {
      expect(fs.readFileSync(pull.bodyPath, 'utf8')).toContain('proto/session.proto')
    }
  })

  it('goes back to GitHub to cross-link the earlier lane, not just the local file', async () => {
    const d = multiDeps()
    await shipOrder(twoLanes(), { verdicts: [verdict()], findings: [] }, d)
    const edits = callsTo(d.exec, 'gh', 'edit')
    expect(edits).toHaveLength(1)
    expect(edits[0].args).toContain('https://github.com/tav/r/pull/1')
  })

  it('records a failed cross-link rather than losing the drafts over a description', async () => {
    let created = 0
    const exec = vi.fn(async (options: { command: string; args: string[] }) => {
      if (options.command === 'gh' && options.args[1] === 'create') {
        created += 1
        return {
          exitCode: 0,
          stdout: `https://github.com/tav/r/pull/${created}\n`,
          stderr: '',
          timedOut: false,
        }
      }
      if (options.command === 'gh' && options.args[1] === 'edit') {
        return { exitCode: 1, stdout: '', stderr: 'could not edit', timedOut: false }
      }
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    })
    const d = deps({ exec: exec as never })
    const result = await shipOrder(twoLanes(), { verdicts: [verdict()], findings: [] }, d)
    expect(result.pulls).toHaveLength(2)
    expect(d.record).toHaveBeenCalledWith(
      'ship.crosslink_failed',
      expect.any(String),
      expect.stringContaining('could not edit')
    )
  })

  it('says nothing about lanes on a single-repository order', async () => {
    const d = deps()
    const result = await shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    expect(fs.readFileSync(result.pulls[0].bodyPath, 'utf8')).not.toMatch(/repository change/)
  })

  it('edits nothing for a single-repository order', async () => {
    const d = deps()
    await shipOrder(order(), { verdicts: [verdict()], findings: [] }, d)
    expect(callsTo(d.exec, 'gh', 'edit')).toHaveLength(0)
  })

  it('takes one shipping decision for the whole order, not one per lane', async () => {
    const decide = vi.fn(async () => 'approve')
    const d = multiDeps()
    await shipOrder(
      twoLanes({ risk: { grade: 'P0', triggers: [], blastRadius: [], criticalPaths: [] } }),
      { verdicts: [verdict()], findings: [] },
      { ...d, decide }
    )
    expect(decide).toHaveBeenCalledTimes(1)
  })
})

describe('the decision the operator is finally offered (FR-057)', () => {
  const ladderOk = {
    steps: [
      {
        rung: 'L1' as const,
        name: "The unit's own tests",
        result: 'pass' as const,
        reason: '',
        exitCode: 0,
      },
    ],
    stoppedAt: null,
    unmeasured: [],
    ok: true,
  }

  it('is whether to mark it ready, not whether to create it', async () => {
    const raiseGate = vi.fn(async () => undefined)
    const result = await shipOrder(
      order(),
      { verdicts: [verdict()], findings: [], ladder: ladderOk },
      deps({ raiseGate })
    )
    expect(result.gate?.rule).toBe('ready-for-review')
    expect(result.gate?.options.map((o) => o.id)).toContain('mark_ready')
    expect(result.gate?.options.map((o) => o.id)).not.toContain('create')
    expect(raiseGate).toHaveBeenCalledWith(expect.objectContaining({ rule: 'ready-for-review' }))
  })

  it('never defaults to shipping when nobody answers', async () => {
    const result = await shipOrder(
      order(),
      { verdicts: [verdict()], findings: [], ladder: ladderOk },
      deps()
    )
    expect(result.gate?.defaultIfIgnored).toBe('hold')
  })

  it('says what was never measured, so a bare repository cannot look checked', async () => {
    const result = await shipOrder(
      order(),
      {
        verdicts: [verdict()],
        findings: [],
        ladder: { ...ladderOk, unmeasured: ['Lint', 'Repository gate'], ok: true },
      },
      deps()
    )
    expect(result.gate?.why).toContain('Not measured here: Lint, Repository gate')
  })

  it('says the inspection found nothing, rather than staying silent about it', async () => {
    const result = await shipOrder(
      order(),
      { verdicts: [verdict()], findings: [], ladder: ladderOk },
      deps()
    )
    expect(result.gate?.why).toContain('inspection found nothing')
  })

  it('points at the body, so the decision is taken on the evidence', async () => {
    const result = await shipOrder(
      order(),
      { verdicts: [verdict()], findings: [], ladder: ladderOk },
      deps()
    )
    expect(result.gate?.evidence[0]).toMatchObject({ kind: 'report_file' })
  })

  it('raises nothing when nothing was pushed', async () => {
    const raiseGate = vi.fn(async () => undefined)
    const result = await shipOrder(
      order(),
      { verdicts: [verdict()], findings: [] },
      deps({ autoOpen: false, raiseGate })
    )
    expect(result.gate).toBeUndefined()
    expect(raiseGate).not.toHaveBeenCalled()
  })
})

describe('the body reports the climb (FR-056)', () => {
  it('names every rung and its result', () => {
    const body = prBody(order(), {
      verdicts: [verdict()],
      findings: [],
      ladder: {
        steps: [
          { rung: 'L0', name: 'Lint', result: 'pass', reason: '', exitCode: 0 },
          {
            rung: 'L2',
            name: 'Repository gate',
            result: 'not_measured',
            reason: 'this repository has no coverage command',
            exitCode: null,
          },
        ],
        stoppedAt: null,
        unmeasured: ['Repository gate'],
        ok: true,
      },
    })
    expect(body).toContain('Lint')
    expect(body).toContain('not measured — this repository has no coverage command')
    expect(body).toMatch(/1 check was not measured here/)
  })

  it('has no verification section when there was no climb', () => {
    const body = prBody(order(), { verdicts: [verdict()], findings: [] })
    expect(body).not.toContain('### Verification')
  })
})

// Three rungs are not commands: independent verification is the verifier's own
// node, the inspection is the inspector's, and the human decision is a gate.
// They used to climb as "runnable" with nothing to run, so every body reported
// them "not measured" — three phantom gaps in every pull request, on the one
// signal the design cannot afford to have people skim.
describe('the rungs decided somewhere else', () => {
  const CLIMB = {
    steps: [
      { rung: 'L0' as const, name: 'Lint', result: 'pass' as const, reason: '', exitCode: 0 },
      {
        rung: 'L3' as const,
        name: 'Independent verification',
        result: 'elsewhere' as const,
        reason: 'by the verifier on each unit — see the criteria table',
        exitCode: null,
      },
    ],
    stoppedAt: null,
    unmeasured: [],
    ok: true,
  }

  it('says they were decided, and where', () => {
    const body = prBody(order(), { verdicts: [verdict()], findings: [], ladder: CLIMB })
    expect(body).toContain('decided — by the verifier on each unit')
  })

  it('never calls them a gap', () => {
    const body = prBody(order(), { verdicts: [verdict()], findings: [], ladder: CLIMB })
    expect(body).not.toMatch(/not measured here/)
    expect(body).not.toContain('not measured — by the verifier')
  })
})
