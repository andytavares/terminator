import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  propose,
  normaliseReason,
  citationRef,
  REPETITION_THRESHOLD,
  REJECTION_ACTIONS,
} from '../../src/ledger/curator.js'
import type { LedgerEntry } from '../../src/ledger/append.js'

// The factory learns from what you turn away — and only when you ask.
//
// A proposal is an argument, never an action: here is what you rejected, this
// many times, for the same reason, and here are the entries. An assistant that
// volunteers rules is one whose rules get accepted without being read.

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    at: '2026-09-06T10:00:00.000Z',
    orderId: 'WO-1',
    actor: 'operator',
    action: 'review.rejected',
    subject: 'U-1',
    reason: 'the timeout is hardcoded rather than read from configuration',
    evidence: [],
    ...over,
  }
}

/** The same complaint, from three different units, at three different times. */
function threeOfTheSame(): LedgerEntry[] {
  return [
    entry({
      at: '2026-09-01T10:00:00.000Z',
      subject: 'U-1',
      reason: '`U-1` hardcodes the timeout',
    }),
    entry({
      at: '2026-09-03T10:00:00.000Z',
      subject: 'U-7',
      reason: '`U-7` hardcodes the timeout',
    }),
    entry({
      at: '2026-09-05T10:00:00.000Z',
      subject: 'U-9',
      reason: '`U-9` hardcodes the timeout',
    }),
  ]
}

describe('normalising a stated reason', () => {
  it('treats the same complaint about different units as the same complaint', () => {
    expect(normaliseReason('U-4 hardcodes the timeout')).toBe(
      normaliseReason('U-9 hardcodes the timeout')
    )
  })

  it('strips backticked identifiers, which are exactly what differs', () => {
    expect(normaliseReason('`src/a.ts` is untested')).toBe(
      normaliseReason('`src/b.ts` is untested')
    )
  })

  it('strips paths and numbers', () => {
    expect(normaliseReason('src/auth/session.ts fails 3 tests')).toBe('fails tests')
  })

  it('keeps the words, which are the complaint', () => {
    expect(normaliseReason('The timeout is HARDCODED.')).toBe('the timeout is hardcoded')
  })

  it('is empty for a reason with nothing but identifiers in it', () => {
    expect(normaliseReason('U-4 src/a.ts 42')).toBe('')
  })
})

describe('proposing', () => {
  it('produces nothing from an empty ledger', () => {
    expect(propose({ entries: [] })).toEqual([])
  })

  it('produces nothing below the threshold — twice is a coincidence', () => {
    expect(propose({ entries: threeOfTheSame().slice(0, 2) })).toEqual([])
    expect(REPETITION_THRESHOLD).toBe(3)
  })

  it('proposes one rule for three rejections of the same thing', () => {
    const proposals = propose({ entries: threeOfTheSame() })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].occurrences).toBe(3)
  })

  it('cites the specific entries it derives from', () => {
    const [proposal] = propose({ entries: threeOfTheSame() })
    expect(proposal.citations.map((c) => c.subject)).toEqual(['U-1', 'U-7', 'U-9'])
    expect(proposal.citations.every((c) => c.reason !== '')).toBe(true)
  })

  it('carries the citations on the rule itself, so it can be judged later', () => {
    const [proposal] = propose({ entries: threeOfTheSame() })
    expect(proposal.origin).toMatch(/^curator:/)
    expect(proposal.origin).toContain('2026-09-01T10:00:00.000Z/U-1')
    expect(proposal.origin).toContain('2026-09-05T10:00:00.000Z/U-9')
  })

  it("uses the operator's own words, not a paraphrase", () => {
    const [proposal] = propose({ entries: threeOfTheSame() })
    expect(proposal.asserts).toBe('`U-9` hardcodes the timeout')
  })

  it('does not merge two different complaints into one rule', () => {
    const mixed = [
      ...threeOfTheSame(),
      entry({ at: '2026-09-02T10:00:00.000Z', reason: 'no test covers the new branch' }),
      entry({ at: '2026-09-04T10:00:00.000Z', reason: 'no test covers the new branch' }),
      entry({ at: '2026-09-06T10:00:00.000Z', reason: 'no test covers the new branch' }),
    ]
    const proposals = propose({ entries: mixed })
    expect(proposals).toHaveLength(2)
    expect(new Set(proposals.map((p) => p.id)).size).toBe(2)
  })

  it('puts the most repeated first', () => {
    const mixed = [
      ...threeOfTheSame(),
      ...Array.from({ length: 5 }, (_, n) =>
        entry({ at: `2026-09-0${n + 1}T11:00:00.000Z`, reason: 'no test covers the new branch' })
      ),
    ]
    expect(propose({ entries: mixed })[0].occurrences).toBe(5)
  })

  it('picks the rung from what the rejections were about', () => {
    const testy = Array.from({ length: 3 }, (_, n) =>
      entry({ at: `2026-09-0${n + 1}T10:00:00.000Z`, reason: 'no test covers the new branch' })
    )
    expect(propose({ entries: testy })[0].rung).toBe('L2')

    const secret = Array.from({ length: 3 }, (_, n) =>
      entry({ at: `2026-09-0${n + 1}T10:00:00.000Z`, reason: 'the secret is logged in plain text' })
    )
    expect(propose({ entries: secret })[0].rung).toBe('L5')

    const docs = Array.from({ length: 3 }, (_, n) =>
      entry({ at: `2026-09-0${n + 1}T10:00:00.000Z`, reason: 'the readme was not updated' })
    )
    expect(propose({ entries: docs })[0].rung).toBe('L6')

    const style = Array.from({ length: 3 }, (_, n) =>
      entry({ at: `2026-09-0${n + 1}T10:00:00.000Z`, reason: 'the icon carries a colour' })
    )
    expect(propose({ entries: style })[0].rung).toBe('L1')
  })

  it('falls back to the correctness rung for a complaint it cannot place', () => {
    expect(propose({ entries: threeOfTheSame() })[0].rung).toBe('L3')
  })
})

describe('what counts as a rejection', () => {
  it('ignores an approval, which is not a rejection however often it happens', () => {
    const approvals = Array.from({ length: 5 }, (_, n) =>
      entry({
        at: `2026-09-0${n + 1}T10:00:00.000Z`,
        action: 'gate.decided',
        reason: 'risk.p0 -> approve',
      })
    )
    expect(propose({ entries: approvals })).toEqual([])
  })

  it('counts a gate sent back', () => {
    const sentBack = Array.from({ length: 3 }, (_, n) =>
      entry({
        at: `2026-09-0${n + 1}T10:00:00.000Z`,
        action: 'gate.decided',
        reason: 'risk.p0 -> send_back: the token comparison is not constant time',
      })
    )
    expect(propose({ entries: sentBack })).toHaveLength(1)
  })

  it('ignores an action that is not a rejection at all', () => {
    const noise = Array.from({ length: 5 }, (_, n) =>
      entry({ at: `2026-09-0${n + 1}T10:00:00.000Z`, action: 'order.seeded' })
    )
    expect(propose({ entries: noise })).toEqual([])
  })

  it('ignores a rejection with no stated reason — there is nothing to learn', () => {
    const silent = Array.from({ length: 5 }, (_, n) =>
      entry({ at: `2026-09-0${n + 1}T10:00:00.000Z`, reason: '   ' })
    )
    expect(propose({ entries: silent })).toEqual([])
  })

  it('names the actions it reads, rather than reading everything', () => {
    expect(REJECTION_ACTIONS).toContain('review.rejected')
    expect(REJECTION_ACTIONS).not.toContain('order.agreed')
  })
})

describe('not offering the same thing twice', () => {
  it('skips a proposal the operator already turned down', () => {
    const [first] = propose({ entries: threeOfTheSame() })
    expect(propose({ entries: threeOfTheSame(), rejectedIds: [first.id] })).toEqual([])
  })

  it('skips one that is already a rule in force', () => {
    const [first] = propose({ entries: threeOfTheSame() })
    expect(propose({ entries: threeOfTheSame(), existingRuleIds: [first.id] })).toEqual([])
  })
})

describe('nothing is proposed unprompted (FR-076)', () => {
  it('the append path does not reach the curator', () => {
    // A comment naming it is fine; an import is not. Writing a decision down
    // must never be the thing that produces a proposal.
    const append = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'ledger', 'append.ts'),
      'utf8'
    )
    expect(append).not.toMatch(/^import .*curator/m)
    expect(append).not.toContain('propose(')
  })

  it('the curator schedules nothing and watches nothing', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'ledger', 'curator.ts'),
      'utf8'
    )
    for (const forbidden of ['setInterval', 'setTimeout', 'fs.watch', 'addEventListener']) {
      expect(source).not.toContain(forbidden)
    }
  })

  it('reads nothing on its own — every entry it sees was handed to it', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'ledger', 'curator.ts'),
      'utf8'
    )
    expect(source).not.toContain("from 'node:fs'")
  })
})

describe('citing a ledger line', () => {
  it('is stable, because the ledger is append-only', () => {
    expect(citationRef(entry())).toBe('2026-09-06T10:00:00.000Z/U-1')
  })
})
