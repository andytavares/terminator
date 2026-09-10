import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readProposal } from '../../src/forge/converge.js'
import { lastIntake } from '../../src/forge/intake-outcome.js'
import { createForgeChannels } from '../../src/ipc/forge-channels.js'
import { createOrderStore } from '../../src/order/store.js'
import { orderDir } from '../../src/data-root.js'
import type { OrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

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

/**
 * The runtime's own callback, as `index.ts` writes it.
 *
 * Copied rather than imported because it lives in the extension's activation,
 * which needs an Electron host. What it does is two lines, and both of them
 * matter: a refusal records and returns without saving, which is the whole
 * reason nothing downstream could see it.
 */
async function finish(order: WorkOrder, proposalPath: string): Promise<void> {
  const outcome = readProposal(order, proposalPath, '2026-09-09T19:33:21.000Z')
  const at = '2026-09-09T19:33:21.000Z'
  if (!outcome.ok) {
    await store.record({
      at,
      orderId: order.id,
      actor: 'role:architect',
      action: 'converge.refused',
      subject: order.id,
      reason: outcome.reason,
      evidence: [],
    })
    return
  }
  await store.save(outcome.order)
  await store.record({
    at,
    orderId: order.id,
    actor: 'role:architect',
    action: 'order.redrafted',
    subject: order.id,
    reason: outcome.note,
    evidence: [],
  })
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-refused-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-refused-repo-'))
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
  function writeProposal(body: unknown): string {
    const dir = orderDir(root, 'WO-0909-6db')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'proposal.json')
    fs.writeFileSync(file, JSON.stringify(body))
    return file
  }

  it('refuses a file path where an evidence kind belongs, and names the field', async () => {
    await finish(seeded(), writeProposal(BAD_PROPOSAL))

    const refusal = lastIntake(await store.entries('WO-0909-6db'))
    expect(refusal.kind).toBe('refused')
    expect(refusal.kind === 'refused' && refusal.reason).toContain('evidence')
    expect(refusal.kind === 'refused' && refusal.reason).toContain('Invalid enum value')
  })

  // The reason it was invisible. A refusal has nothing to save, so the
  // document is untouched — and the document was all any surface read.
  it('leaves the order byte-for-byte what it was', async () => {
    const before = fs.readFileSync(path.join(orderDir(root, 'WO-0909-6db'), 'order.json'), 'utf8')
    await finish(seeded(), writeProposal(BAD_PROPOSAL))
    const after = fs.readFileSync(path.join(orderDir(root, 'WO-0909-6db'), 'order.json'), 'utf8')
    expect(after).toBe(before)
    expect((await store.load('WO-0909-6db'))?.provenance.decisions).toEqual([])
  })

  it('reaches the surface that has to say so', async () => {
    await finish(seeded(), writeProposal(BAD_PROPOSAL))
    const c = createForgeChannels({ store, now: () => '2026-09-09T19:34:00.000Z' })

    // What the Forge polls. Before this it was the document and the checks,
    // and a refusal changes neither — so the screen said "The architect is
    // working…" over a turn that had ended, for ever.
    const polled = (await c.compile({ id: 'WO-0909-6db', commit: false })) as {
      intake: { kind: string; reason: string }
    }
    expect(polled.intake.kind).toBe('refused')
    expect(polled.intake.reason).toContain('Invalid enum value')

    // And what the order list shows. It said "Foundry is still shaping this".
    const listed = (await c.list()) as {
      orders: Array<{ standing: { turn: string; headline: string } }>
    }
    expect(listed.orders[0].standing.turn).toBe('you')
    expect(listed.orders[0].standing.headline).toMatch(/refused/i)
  })

  // The correction the operator's next turn asks for, all the way through.
  it('accepts the corrected proposal and clears the refusal', async () => {
    await finish(seeded(), writeProposal(BAD_PROPOSAL))
    await store.record({
      at: '2026-09-09T19:40:00.000Z',
      orderId: 'WO-0909-6db',
      actor: 'role:architect',
      action: 'converge.started',
      subject: 'sess-arch-2',
      reason: 'Your last proposal was refused',
      evidence: [],
    })
    await finish(seeded(), writeProposal(GOOD_PROPOSAL))

    const after = lastIntake(await store.entries('WO-0909-6db'))
    expect(after.kind).toBe('redrafted')
    expect((await store.load('WO-0909-6db'))?.acceptance).toHaveLength(1)

    const c = createForgeChannels({ store, now: () => '2026-09-09T19:41:00.000Z' })
    const listed = (await c.list()) as { orders: Array<{ standing: { turn: string } }> }
    expect(listed.orders[0].standing.turn).not.toBe('you')
  })

  // The file is removed once read, whatever happened: a stale proposal from a
  // refused turn read as the next turn's answer would make a redraft that
  // never happened look like it worked.
  it('clears the proposal it refused', async () => {
    const file = writeProposal(BAD_PROPOSAL)
    await finish(seeded(), file)
    expect(fs.existsSync(file)).toBe(false)
  })
})
