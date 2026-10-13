/**
 * "Answer" on a `forge-defect` gate, end to end.
 *
 * The finding that raises this gate already sent the order back to `draft`
 * (`amendOrder`), and `runs.resume` refuses anything that is not `running` —
 * so the button called it anyway and did nothing (docs/research/foundry-red-
 * team-loop.md, cause 3). This drives the real `act` closure through
 * `activate`, because the decision it makes now — converge instead of resume,
 * and a resume failure recorded rather than swallowed — lives entirely inside
 * that closure.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

import { makeTempDir } from '../../../../tests/support/temp-dir'
import { fakeHost, type FoundryHost } from '../helpers/foundry-host.js'
import { activateFoundry } from '../helpers/foundry-activation.js'
import { builderUnit, testCriterion } from '../helpers/order-parts.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { Gate } from '../../src/gates/rules.js'
import { theRunner } from '../helpers/supervision-mocks.js'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

let dataDir = ''
let host: FoundryHost
const call = (channel: string, payload: unknown = {}) => host.call(channel, payload)

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Make the thing work',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...base, status: 'draft', recipe: 'direct', ...over }
}

function ledger(): string {
  const file = path.join(dataDir, 'orders', 'WO-1', 'ledger.jsonl')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function saveGate(gate: Gate): void {
  fs.writeFileSync(path.join(dataDir, 'orders', 'WO-1', 'gates.json'), JSON.stringify([gate]))
}

function forgeDefectGate(): Gate {
  return {
    id: 'WO-1-forge-defect',
    rule: 'forge-defect',
    orderId: 'WO-1',
    nodeId: null,
    summary: 's',
    why: 'the order contradicts itself',
    evidence: [],
    options: [
      { id: 'answer', label: 'Answer', consequence: 'c' },
      { id: 'hold', label: 'Hold', consequence: 'c' },
    ],
    defaultIfIgnored: 'hold',
    deadline: null,
    blockedUnits: 0,
    riskGrade: 'P3',
    raisedAt: '2026-09-06T10:00:00.000Z',
    decision: null,
  }
}

beforeAll(async () => {
  host = fakeHost(() => dataDir)
  host.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
  await activateFoundry(host)
})

beforeEach(() => {
  theRunner.start.mockReset()
  theRunner.start.mockImplementation(async (...args: unknown[]) => {
    const input = args[0] as StartInput
    input.onRegistered?.({ sessionId: 'architect-session' })
    return { sessionId: 'architect-session' }
  })
})

describe('answering a forge-defect gate', () => {
  describe('starting the architect', startingTheArchitectTests)
  describe('resume failures', resumeFailuresTests)
})

/** An open, blocking regression the red team raised in round 1. */
function regression(id: string, text: string): WorkOrder['redTeam'][number] {
  return {
    id,
    severity: 'high',
    text,
    status: 'open',
    reason: '',
    category: 'regression',
    round: 1,
  }
}

/** What the architect hands back: the finding resolved, and how. */
function writeAmendment(): void {
  fs.writeFileSync(
    path.join(dataDir, 'orders', 'WO-1', 'proposal.json'),
    JSON.stringify({
      note: 'Added AC-5 so footnote links survive the sanitizer',
      resolveFindings: [{ id: 'RT-inspector-6', how: 'prefix #… hrefs in the a override' }],
    })
  )
}

type StartInput = {
  phase: string
  onRegistered?: (run: { sessionId: string }) => void
  onTurnEnd?: () => void
}

/** Makes the next read of `file`, once armed, come back 100 ms late, holding the order as it was
 * before whatever wrote it in the meantime. */
function slowNextRead(file: string): { arm: () => void; restore: () => void } {
  const readFile = fs.promises.readFile
  let armed = false
  const spy = vi.spyOn(fs.promises, 'readFile').mockImplementation((async (
    read: fs.PathLike,
    options?: unknown
  ) => {
    const contents = await readFile(read, options as BufferEncoding)
    if (armed && String(read) === file) {
      armed = false
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return contents
  }) as typeof fs.promises.readFile)
  return { arm: () => (armed = true), restore: () => spy.mockRestore() }
}

/** An architect that amends the order, then has the next order read come back late. */
function architectAmendsThenReadsLate(armSlowRead: () => void): void {
  theRunner.start.mockImplementation(async (...args: unknown[]) => {
    const input = args[0] as StartInput
    const sessionId = `${input.phase}-session`
    if (input.phase === 'architect') {
      writeAmendment()
      armSlowRead()
    }
    input.onRegistered?.({ sessionId })
    if (input.phase === 'architect') input.onTurnEnd?.()
    return { sessionId }
  })
}

function cleanOrder(): WorkOrder {
  const base = order()
  return {
    ...base,
    recipe: null,
    intent: { problem: 'p', outcome: 'rows render fully', nonGoals: ['scrollbars'] },
    risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    acceptance: [testCriterion('AC-1', { statement: 'a full-width row renders its final glyph' })],
    plan: {
      ...base.plan,
      units: [builderUnit('U-1', { title: 'widen', satisfies: ['AC-1'], touches: ['src/a.ts'] })],
    },
    redTeam: [regression('RT-inspector-6', 'footnote links stop working')],
  }
}
function architectAmends(): void {
  theRunner.start.mockImplementation(async (...args: unknown[]) => {
    const input = args[0] as StartInput
    const sessionId = `${input.phase}-session`
    input.onRegistered?.({ sessionId })
    if (input.phase === 'architect') {
      writeAmendment()
      setTimeout(() => input.onTurnEnd?.(), 0)
    }
    return { sessionId }
  })
}
async function seed(released: boolean): Promise<void> {
  dataDir = makeTempDir('fdry-amended-')
  const store = createOrderStore(dataDir)
  await store.save(cleanOrder())
  if (released) {
    await store.record({
      at: '2026-10-08T01:55:24.000Z',
      orderId: 'WO-1',
      actor: 'operator',
      action: 'order.agreed',
      subject: 'WO-1',
      reason: 'all checks pass',
      evidence: [],
    })
  }
  saveGate(forgeDefectGate())
  architectAmends()
}

function startingTheArchitectTests() {
  it('starts the architect on every open blocking finding, rather than resuming, when the order is not running', async () => {
    dataDir = makeTempDir('fdry-forge-defect-')
    const store = createOrderStore(dataDir)
    await store.save(order({ redTeam: [regression('RT-2', 'drops canceled tickets')] }))
    saveGate(forgeDefectGate())

    const r = (await call('foundry:inbox.decide', {
      gateId: 'WO-1-forge-defect',
      option: 'answer',
    })) as { ok: boolean; actionError?: string }

    expect(r.actionError).toBeUndefined()
    expect(theRunner.start).toHaveBeenCalledTimes(1)
    const started = theRunner.start.mock.calls[0][0] as { phase: string; prompt: string }
    expect(started.phase).toBe('architect')
    expect(started.prompt).toContain('RT-2')
  })
}

function resumeFailuresTests() {
  it('records a resume failure as gate.action_failed, rather than a silent no-op', async () => {
    dataDir = makeTempDir('fdry-forge-defect-resume-')
    const store = createOrderStore(dataDir)
    // No red-team findings: `fixMessage` is null, and the gate's own rule name
    // is what the architect turn (or, on a rule this test does not special-
    // case, the resume failure) has to name instead.
    await store.save(order({ status: 'draft' }))
    saveGate({
      ...forgeDefectGate(),
      id: 'WO-1-unit-boundary',
      rule: 'unit.boundary',
      options: [
        { id: 'approve', label: 'Approve', consequence: 'c' },
        { id: 'hold', label: 'Hold', consequence: 'c' },
      ],
    })

    const r = (await call('foundry:inbox.decide', {
      gateId: 'WO-1-unit-boundary',
      option: 'approve',
    })) as { ok: boolean; actionError?: string }

    expect(r.actionError).toContain('draft')
    expect(ledger()).toContain('gate.action_failed')
    expect(theRunner.start).not.toHaveBeenCalled()
  })
}

/**
 * WO-1008-287, end to end: the operator handed the order off, the inspector
 * sent it back with a defect, the operator answered, and the architect amended
 * the plan. The amended order must run again — and an order nobody released
 * must say so on the Inbox rather than sit there.
 */
describe('after the architect amends an answered defect', () => {
  describe('agreeing again', agreeingAgainTests)
  describe('the inbox', theInboxTests)
  describe('the order before', theOrderBeforeTests)
})

function agreeingAgainTests() {
  it('agrees the released order again and starts its run', async () => {
    await seed(true)
    await call('foundry:inbox.decide', { gateId: 'WO-1-forge-defect', option: 'answer' })

    await vi.waitFor(() => expect(ledger()).toContain('"action":"run.started"'), {
      timeout: 5000,
    })
    const lines = ledger()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { action: string; actor: string })
    expect(lines.filter((l) => l.action === 'order.agreed').at(-1)?.actor).toBe('rule:forge')
    expect(lines.some((l) => l.action === 'converge.started')).toBe(true)
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('running')
  })
}

function theInboxTests() {
  it('lists an order nobody released on the Inbox, and counts it on the badge', async () => {
    await seed(false)
    await call('foundry:inbox.decide', { gateId: 'WO-1-forge-defect', option: 'answer' })

    await vi.waitFor(() => expect(ledger()).toContain('order.redrafted'), { timeout: 5000 })
    await vi.waitFor(
      async () => {
        const inbox = (await call('foundry:inbox.list')) as {
          waiting: { orderId: string; headline: string }[]
        }
        expect(inbox.waiting).toEqual([
          expect.objectContaining({ orderId: 'WO-1', headline: 'Ready to hand off' }),
        ])
      },
      { timeout: 5000 }
    )
    expect(((await call('foundry:attention')) as { inbox: number }).inbox).toBe(1)
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('draft')
    expect(ledger()).not.toContain('run.started')
  })
}

function theOrderBeforeTests() {
  // Recording which conversation wrote the plan loads the whole order and
  // saves it back. Unordered, that save could land after the amendment's and
  // put the old plan back: the answered finding open again, and the restart
  // refused with "the adversarial pass left 1 blocking finding unresolved".
  // Seen in CI as the test above timing out.
  it('never puts the order from before the amendment back', async () => {
    await seed(true)
    const slow = slowNextRead(path.join(dataDir, 'orders', 'WO-1', 'order.json'))
    architectAmendsThenReadsLate(slow.arm)

    try {
      await call('foundry:inbox.decide', { gateId: 'WO-1-forge-defect', option: 'answer' })
      await vi.waitFor(() => expect(ledger()).toMatch(/"action":"run\.(started|refused)"/), {
        timeout: 2000,
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
    } finally {
      slow.restore()
    }

    expect(ledger()).not.toContain('run.refused')
    expect(ledger()).toContain('"action":"run.started"')
    const saved = await createOrderStore(dataDir).load('WO-1')
    expect(saved?.redTeam.find((f) => f.id === 'RT-inspector-6')?.status).toBe('resolved')
  })
}
