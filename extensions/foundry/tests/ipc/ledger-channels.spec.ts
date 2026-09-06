import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createLedgerChannels } from '../../src/ipc/ledger-channels.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/schema.js'
import { resolveRule } from '../../src/recipe/resolve.js'
import { declinedProposals } from '../../src/verify/rules.js'
import type { LedgerEntry } from '../../src/ledger/append.js'

// Reading the record, and asking it what it thinks.
//
// Proposals arrive when the operator presses the button and at no other time.
// Nothing here is reachable from the append path, from a timer or from a run.

let root: string

function channels(existingRuleIds: string[] = []) {
  return createLedgerChannels({
    store: createOrderStore(root),
    dataRoot: () => root,
    existingRuleIds: () => existingRuleIds,
    now: () => '2026-09-06T12:00:00.000Z',
  })
}

async function seedOrder(id: string): Promise<void> {
  await createOrderStore(root).save(
    draftOrder({
      id,
      title: id,
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/app'],
      now: '2026-09-06T10:00:00.000Z',
    })
  )
}

async function record(orderId: string, over: Partial<LedgerEntry> = {}): Promise<void> {
  await createOrderStore(root).record({
    at: '2026-09-06T10:00:00.000Z',
    orderId,
    actor: 'operator',
    action: 'review.rejected',
    subject: 'U-1',
    reason: 'the timeout is hardcoded rather than read from configuration',
    evidence: [],
    ...over,
  })
}

/** Three rejections of the same thing, in one order. */
async function repeatedRejections(orderId = 'WO-1'): Promise<void> {
  await seedOrder(orderId)
  for (const n of [1, 2, 3]) {
    await record(orderId, { at: `2026-09-0${n}T10:00:00.000Z`, subject: `U-${n}` })
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-ledger-ipc-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

describe('foundry:ledger.query', () => {
  it('is empty before anything has happened', async () => {
    const r = (await channels().query({})) as { entries: LedgerEntry[]; total: number }
    expect(r.entries).toEqual([])
    expect(r.total).toBe(0)
  })

  it('reads across every order when none is named', async () => {
    await seedOrder('WO-1')
    await seedOrder('WO-2')
    await record('WO-1', { subject: 'a' })
    await record('WO-2', { subject: 'b' })
    const r = (await channels().query({})) as { entries: LedgerEntry[] }
    expect(r.entries.map((e) => e.subject).sort()).toEqual(['a', 'b'])
  })

  it('reads one order alone when one is named', async () => {
    await seedOrder('WO-1')
    await seedOrder('WO-2')
    await record('WO-1', { subject: 'a' })
    await record('WO-2', { subject: 'b' })
    const r = (await channels().query({ orderId: 'WO-2' })) as { entries: LedgerEntry[] }
    expect(r.entries.map((e) => e.subject)).toEqual(['b'])
  })

  it('filters by actor', async () => {
    await seedOrder('WO-1')
    await record('WO-1', { actor: 'operator', subject: 'a' })
    await record('WO-1', { actor: 'rule:budget.exceeded', subject: 'b' })
    const r = (await channels().query({ actor: 'operator' })) as { entries: LedgerEntry[] }
    expect(r.entries.map((e) => e.subject)).toEqual(['a'])
  })

  it('filters by action', async () => {
    await seedOrder('WO-1')
    await record('WO-1', { action: 'gate.decided', subject: 'a' })
    await record('WO-1', { action: 'order.agreed', subject: 'b' })
    const r = (await channels().query({ action: 'order.agreed' })) as { entries: LedgerEntry[] }
    expect(r.entries.map((e) => e.subject)).toEqual(['b'])
  })

  it('treats an empty filter as no filter, not as a value nothing matches', async () => {
    await seedOrder('WO-1')
    await record('WO-1')
    const r = (await channels().query({ actor: '', action: '' })) as { entries: LedgerEntry[] }
    expect(r.entries).toHaveLength(1)
  })

  it('filters by time', async () => {
    await seedOrder('WO-1')
    await record('WO-1', { at: '2026-09-01T10:00:00.000Z', subject: 'old' })
    await record('WO-1', { at: '2026-09-05T10:00:00.000Z', subject: 'new' })
    const r = (await channels().query({ since: '2026-09-03T00:00:00.000Z' })) as {
      entries: LedgerEntry[]
    }
    expect(r.entries.map((e) => e.subject)).toEqual(['new'])
  })

  it('reads newest first, though the file is written oldest first', async () => {
    await seedOrder('WO-1')
    await record('WO-1', { at: '2026-09-01T10:00:00.000Z', subject: 'old' })
    await record('WO-1', { at: '2026-09-05T10:00:00.000Z', subject: 'new' })
    const r = (await channels().query({})) as { entries: LedgerEntry[] }
    expect(r.entries.map((e) => e.subject)).toEqual(['new', 'old'])
  })

  it('honours a limit while still reporting the true total', async () => {
    await repeatedRejections()
    const r = (await channels().query({ limit: 2 })) as { entries: LedgerEntry[]; total: number }
    expect(r.entries).toHaveLength(2)
    expect(r.total).toBe(3)
  })

  it('offers only the filter values that actually occur', async () => {
    await seedOrder('WO-1')
    await record('WO-1', { actor: 'operator', action: 'gate.decided' })
    await record('WO-1', { actor: 'rule:risk.p0', action: 'gate.default' })
    const r = (await channels().query({})) as { actors: string[]; actions: string[] }
    expect(r.actors).toEqual(['operator', 'rule:risk.p0'])
    expect(r.actions).toEqual(['gate.decided', 'gate.default'])
  })

  it('rejects a malformed request', async () => {
    expect(await channels().query({ limit: 'lots' })).toEqual({ error: 'Malformed request.' })
  })
})

describe('foundry:rules.propose', () => {
  it('produces nothing until there is a pattern', async () => {
    await seedOrder('WO-1')
    await record('WO-1')
    const r = (await channels().proposeRules({})) as { proposals: unknown[] }
    expect(r.proposals).toEqual([])
  })

  it('proposes one rule for three rejections of the same thing, with its citations', async () => {
    await repeatedRejections()
    const r = (await channels().proposeRules({})) as {
      proposals: { id: string; citations: unknown[]; origin: string }[]
    }
    expect(r.proposals).toHaveLength(1)
    expect(r.proposals[0].citations).toHaveLength(3)
    expect(r.proposals[0].origin).toMatch(/^curator:/)
  })

  it('does not propose something already covered by a rule in force', async () => {
    await repeatedRejections()
    const first = (await channels().proposeRules({})) as { proposals: { id: string }[] }
    const again = (await channels([first.proposals[0].id]).proposeRules({})) as {
      proposals: unknown[]
    }
    expect(again.proposals).toEqual([])
  })

  it('rejects a malformed request', async () => {
    expect(await channels().proposeRules({ orderId: 7 })).toEqual({ error: 'Malformed request.' })
  })
})

describe('deciding a proposal', () => {
  async function firstProposalId(): Promise<string> {
    const r = (await channels().proposeRules({})) as { proposals: { id: string }[] }
    return r.proposals[0].id
  }

  it('accepting writes a rule that later work will load', async () => {
    await repeatedRejections()
    const id = await firstProposalId()
    const r = (await channels().decideProposal({ proposalId: id, accept: true })) as {
      ok: true
      file: string
    }
    expect(fs.existsSync(r.file)).toBe(true)
    expect(
      resolveRule(id, { dataRoot: root, repoPaths: [], builtInDir: path.resolve(root, 'nowhere') })
        .ok
    ).toBe(true)
  })

  it('declining records it and never offers it again', async () => {
    await repeatedRejections()
    const id = await firstProposalId()
    await channels().decideProposal({ proposalId: id, accept: false, reason: 'on purpose' })

    expect(await declinedProposals(root)).toEqual([id])
    const again = (await channels().proposeRules({})) as { proposals: unknown[] }
    expect(again.proposals).toEqual([])
  })

  it('declining adds no rule', async () => {
    await repeatedRejections()
    const id = await firstProposalId()
    await channels().decideProposal({ proposalId: id, accept: false })
    expect(fs.existsSync(path.join(root, 'rules', `${id}.yaml`))).toBe(false)
  })

  it('refuses a proposal the ledger no longer supports', async () => {
    await seedOrder('WO-1')
    const r = (await channels().decideProposal({
      proposalId: 'curator-made-up',
      accept: true,
    })) as { error: string }
    expect(r.error).toMatch(/no longer supports/)
  })

  it('rejects a malformed request', async () => {
    expect(await channels().decideProposal({ accept: true })).toEqual({
      error: 'Malformed request.',
    })
  })
})

describe('nothing is proposed unprompted (FR-076)', () => {
  it('the path a run writes decisions through cannot reach the curator', () => {
    // `record` is what a run calls after every decision. If it could produce a
    // proposal, proposals would arrive unasked — which is the failure this
    // requirement exists to prevent.
    const store = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'order', 'store.ts'),
      'utf8'
    )
    expect(store).not.toMatch(/curator/)
  })

  it('recording a decision returns nothing a caller could mistake for one', async () => {
    await repeatedRejections()
    const result = await createOrderStore(root).record({
      at: '2026-09-07T10:00:00.000Z',
      orderId: 'WO-1',
      actor: 'operator',
      action: 'review.rejected',
      subject: 'U-4',
      reason: 'the timeout is hardcoded rather than read from configuration',
      evidence: [],
    })
    expect(result).toBeUndefined()
  })

  it('proposals only ever come back from the channel the operator reaches', async () => {
    await repeatedRejections()
    // Four ledger entries now support a proposal, and it exists only when
    // asked for.
    const asked = (await channels().proposeRules({})) as { proposals: unknown[] }
    expect(asked.proposals).toHaveLength(1)
  })
})
