import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import { applyArchitectAnswer } from '../../src/forge/converge.js'
import { lastIntake } from '../../src/forge/intake-outcome.js'
import { createForgeChannels } from '../../src/ipc/forge-channels.js'
import { quietForgeSeams } from '../ipc/forge-deps.js'
import { createOrderStore } from '../../src/order/store.js'
import type { OrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'

// WO-0909-6db, from the proposal on disk to the screen that had to say so.
//
// The incident, in order: the architect wrote three file paths into
// `verify.evidence`, which is a closed set of artifact kinds; Zod refused the
// whole document, so six acceptance criteria and the only unit in the plan
// went with it; the refusal was appended to the ledger; and every surface went
// on saying Foundry was shaping the order. The operator's report was two
// sentences — "no way to recover from this" and "there's also zero indication
// anything has even gone wrong".
//
// Each unit on this path had tests and each one passed. Nothing joined them
// up, so this walks the whole thing over real files.

let root: string
let repo: string
let store: OrderStore

/** The proposal that was actually refused, cut down to the offending field. */
const BAD_PROPOSAL = {
  acceptance: [
    {
      id: 'AC-6',
      statement: 'every surface renders the change',
      priority: 'P1',
      verify: {
        kind: 'judge',
        rubric: 'the reviewer confirms the text is red',
        evidence: ['src/app.css', 'src/theme.ts', 'src/index.css'],
      },
      unverifiable: null,
    },
  ],
  note: 'drafted six criteria and one unit',
}

const GOOD_PROPOSAL = {
  acceptance: [
    {
      id: 'AC-6',
      statement: 'every surface renders the change',
      priority: 'P1',
      verify: {
        kind: 'judge',
        rubric: 'the reviewer confirms the text is red in src/app.css and src/theme.ts',
        evidence: ['diff'],
      },
      unverifiable: null,
    },
  ],
  note: 'moved the paths into the rubric',
}

function seeded(): WorkOrder {
  const base = draftOrder({
    id: 'WO-0909-6db',
    title: 'Make all text in the application red',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-09-09T19:20:00.000Z',
  })
  return { ...base, intent: { ...base.intent, problem: 'text is not red' } }
}

/** The reason the architect's answer is refused, from the real parser. */
function refusalOf(answer: unknown): string {
  const outcome = applyArchitectAnswer(seeded(), answer, '2026-09-09T19:33:21.000Z')
  if (outcome.ok) throw new Error('the proposal this test needs refused was accepted')
  return outcome.reason
}

/** One architect line in the ledger, as `afterRefusedProposal`/`afterRedraft` write it. */
async function architectLine(at: string, action: string, reason: string): Promise<void> {
  await store.record({
    at,
    orderId: 'WO-0909-6db',
    actor: 'role:architect',
    action,
    subject: 'WO-0909-6db',
    reason,
    evidence: [],
  })
}

beforeEach(async () => {
  root = makeTempDir('foundry-refused-')
  repo = makeTempDir('foundry-refused-repo-')
  store = createOrderStore(root)
  await store.save(seeded())
  await store.record({
    at: '2026-09-09T19:31:00.000Z',
    orderId: 'WO-0909-6db',
    actor: 'role:architect',
    action: 'converge.started',
    subject: 'sess-arch',
    reason: 'drafting the plan',
    evidence: [],
  })
})

afterEach(() => {
  for (const d of [root, repo]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 })
})

describe('a proposal refused after the turn ended', () => {
  describe('refusing', refusedTurnRefusingTests)
  describe('the surface', theSurfaceTests)
  describe('the corrected proposal', theCorrectedProposalTests)
})

function refusedTurnRefusingTests() {
  it('refuses a file path where an evidence kind belongs, and names the field', () => {
    const reason = refusalOf(BAD_PROPOSAL)
    expect(reason).toContain('evidence')
    expect(reason).toContain('Invalid option: expected one of "exit_code"')
  })
}

function theSurfaceTests() {
  it('reaches the surface that has to say so', async () => {
    await architectLine('2026-09-09T19:33:21.000Z', 'converge.refused', refusalOf(BAD_PROPOSAL))
    const c = createForgeChannels({
      store,
      now: () => '2026-09-09T19:34:00.000Z',
      ...quietForgeSeams(() => root),
    })

    // What the Forge polls. Before this it was the document and the checks,
    // and a refusal changes neither — so the screen said "The architect is
    // working…" over a turn that had ended, for ever.
    const polled = (await c.compile({ id: 'WO-0909-6db', commit: false, automatic: false })) as {
      intake: { kind: string; reason: string }
    }
    expect(polled.intake.kind).toBe('refused')
    expect(polled.intake.reason).toContain('Invalid option: expected one of "exit_code"')

    // And what the order list shows. It said "Foundry is still shaping this".
    const listed = (await c.list()) as {
      orders: Array<{ standing: { turn: string; headline: string } }>
    }
    expect(listed.orders[0].standing.turn).toBe('you')
    expect(listed.orders[0].standing.headline).toMatch(/refused/i)
  })
}

function theCorrectedProposalTests() {
  // The correction the operator's next turn asks for, all the way through.
  it('accepts the corrected proposal and clears the refusal', async () => {
    await architectLine('2026-09-09T19:33:21.000Z', 'converge.refused', refusalOf(BAD_PROPOSAL))
    await architectLine('2026-09-09T19:40:00.000Z', 'converge.started', 'proposal was refused')
    const corrected = applyArchitectAnswer(seeded(), GOOD_PROPOSAL, '2026-09-09T19:41:00.000Z')
    if (!corrected.ok) throw new Error(`the corrected proposal was refused: ${corrected.reason}`)
    await store.save(corrected.order)
    await architectLine('2026-09-09T19:41:00.000Z', 'order.redrafted', corrected.note)

    expect(lastIntake(await store.entries('WO-0909-6db')).kind).toBe('redrafted')

    const c = createForgeChannels({
      store,
      now: () => '2026-09-09T19:41:00.000Z',
      ...quietForgeSeams(() => root),
    })
    const listed = (await c.list()) as { orders: Array<{ standing: { turn: string } }> }
    expect(listed.orders[0].standing.turn).not.toBe('you')
  })
}
