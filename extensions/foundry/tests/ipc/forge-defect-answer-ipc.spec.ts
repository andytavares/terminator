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
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'

import { makeTempDir } from '../../../../tests/support/temp-dir'
import { fakeHost, type FoundryHost } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate, settleFoundryWork } from '../helpers/foundry-activation.js'
import { builderUnit, testCriterion } from '../helpers/order-parts.js'
import { writeBaseline } from '../../src/line/baseline.js'
import { provenBaseline } from '../helpers/environment.js'
import { createOrderStore } from '../../src/order/store.js'
import { gateStoreAt, orderStoreAt } from '../../src/state/live-index.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { Gate } from '../../src/gates/rules.js'
import { theRunner } from '../helpers/supervision-mocks.js'
import { ledgerFileText } from '../helpers/order-ledger.js'
import { eventually } from '../../../../tests/support/eventually'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))

let dataDir = ''
let host: FoundryHost

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

/** Through the index, which the Home publisher may already have read for this location. */
function saveGate(gate: Gate): Promise<void> {
  return gateStoreAt(dataDir).save(gate)
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

// Each test's proofs, runs and open agent turns end before the next test, or the spec's folder, goes.
afterEach(settleFoundryWork)

afterAll(async () => {
  await deactivate()
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
  const store = orderStoreAt(dataDir)
  await store.save(cleanOrder())
  if (released) {
    await writeBaseline(dataDir, 'WO-1', provenBaseline())
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
  await saveGate(forgeDefectGate())
  architectAmends()
}

function startingTheArchitectTests() {
  it('starts the architect on every open blocking finding, rather than resuming, when the order is not running', async () => {
    dataDir = makeTempDir('fdry-forge-defect-')
    const store = orderStoreAt(dataDir)
    await store.save(order({ redTeam: [regression('RT-2', 'drops canceled tickets')] }))
    await saveGate(forgeDefectGate())

    const r = (await host.call('foundry:inbox.decide', {
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
    const store = orderStoreAt(dataDir)
    // No red-team findings: `fixMessage` is null, and the gate's own rule name
    // is what the architect turn (or, on a rule this test does not special-
    // case, the resume failure) has to name instead.
    await store.save(order({ status: 'draft' }))
    await saveGate({
      ...forgeDefectGate(),
      id: 'WO-1-unit-boundary',
      rule: 'unit.boundary',
      options: [
        { id: 'approve', label: 'Approve', consequence: 'c' },
        { id: 'hold', label: 'Hold', consequence: 'c' },
      ],
    })

    const r = (await host.call('foundry:inbox.decide', {
      gateId: 'WO-1-unit-boundary',
      option: 'approve',
    })) as { ok: boolean; actionError?: string }

    expect(r.actionError).toContain('draft')
    expect(ledgerFileText(dataDir)).toContain('gate.action_failed')
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

/** Waits for the run's last write: the timeline frame where every agent has its session. A run
 * still writing as the file ends recreates the folder cleanup removed, and CI fails the leak. */
async function untilRunSettles(): Promise<void> {
  const timeline = path.join(dataDir, 'orders', 'WO-1', 'run-timeline.jsonl')
  await eventually(() => {
    const last = fs.readFileSync(timeline, 'utf8').trim().split('\n').at(-1) ?? ''
    for (const session of ['builder-session', 'verifier-session', 'scribe-session']) {
      expect(last).toContain(`"sessionId":"${session}"`)
    }
  })
}

function agreeingAgainTests() {
  it('agrees the released order again and starts its run', async () => {
    await seed(true)
    await host.call('foundry:inbox.decide', { gateId: 'WO-1-forge-defect', option: 'answer' })

    await eventually(() => expect(ledgerFileText(dataDir)).toContain('"action":"run.started"'))
    const lines = ledgerFileText(dataDir)
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { action: string; actor: string })
    expect(lines.filter((l) => l.action === 'order.agreed').at(-1)?.actor).toBe('rule:forge')
    expect(lines.some((l) => l.action === 'converge.started')).toBe(true)
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('running')
    await untilRunSettles()
  })
}

function theInboxTests() {
  it('lists an order nobody released on the Inbox, and counts it on the badge', async () => {
    await seed(false)
    await host.call('foundry:inbox.decide', { gateId: 'WO-1-forge-defect', option: 'answer' })

    await eventually(() => expect(ledgerFileText(dataDir)).toContain('order.redrafted'))
    await eventually(async () => {
      const inbox = (await host.call('foundry:inbox.list')) as {
        waiting: { orderId: string; headline: string }[]
      }
      expect(inbox.waiting).toEqual([
        expect.objectContaining({ orderId: 'WO-1', headline: 'Ready to hand off' }),
      ])
    })
    expect(((await host.call('foundry:attention')) as { inbox: number }).inbox).toBe(1)
    expect((await createOrderStore(dataDir).load('WO-1'))?.status).toBe('draft')
    expect(ledgerFileText(dataDir)).not.toContain('run.started')
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
    await host.call('foundry:inbox.decide', { gateId: 'WO-1-forge-defect', option: 'answer' })
    await eventually(() =>
      expect(ledgerFileText(dataDir)).toMatch(/"action":"run\.(started|refused)"/)
    )
    await untilRunSettles()

    expect(ledgerFileText(dataDir)).not.toContain('run.refused')
    expect(ledgerFileText(dataDir)).toContain('"action":"run.started"')
    const saved = await createOrderStore(dataDir).load('WO-1')
    expect(saved?.redTeam.find((f) => f.id === 'RT-inspector-6')?.status).toBe('resolved')
  })
}
