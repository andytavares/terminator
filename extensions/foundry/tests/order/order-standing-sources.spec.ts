import { describe, it, expect } from 'vitest'
import { orderStandingSources } from '../../src/order/order-standing-sources.js'
import { draftOrder } from '../../src/order/draft.js'
import type { LedgerEntry } from '../../src/ledger/append.js'
import type { OrderStore } from '../../src/order/store.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The standing inputs that come from the order and its ledger, built once so
// the Forge's list, the Inbox and the tab badge read one answer.

function entry(over: Partial<LedgerEntry> & Pick<LedgerEntry, 'action'>): LedgerEntry {
  return {
    at: '2026-10-08T02:05:25.594Z',
    orderId: 'WO-1',
    actor: 'role:architect',
    subject: 'WO-1',
    reason: '',
    evidence: [],
    ...over,
  }
}

function storeWith(entries: LedgerEntry[]): OrderStore {
  return { entries: async () => entries } as unknown as OrderStore
}

function draft(): WorkOrder {
  return draftOrder({
    id: 'WO-1',
    title: 'render html in comments',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repo'],
    now: '2026-10-08T01:52:01.208Z',
  })
}

describe('orderStandingSources', () => {
  it('names the first check a draft has not cleared, in its own words', () => {
    const sources = orderStandingSources(storeWith([]))
    const blocker = sources.blockerFor?.(draft())
    expect(blocker).not.toBeNull()
    expect(blocker?.trim()).not.toBe('')
    expect(sources.failuresFor?.(draft())).toBeGreaterThan(0)
  })

  it('reads a red-team refusal as why intake stopped', async () => {
    const sources = orderStandingSources(
      storeWith([
        entry({ action: 'review.started', subject: 'rt', reason: 'round 1' }),
        entry({ action: 'red-team.refused', reason: 'the red-team wrote nothing' }),
      ])
    )
    expect(await sources.intakeRefusedFor?.('WO-1')).toBe('the red-team wrote nothing')
  })

  it('reads a refused start as the run failure', async () => {
    const sources = orderStandingSources(
      storeWith([entry({ action: 'run.refused', reason: 'no runtime' })])
    )
    expect(await sources.runFailureFor?.('WO-1')).toBe('no runtime')
  })
})
