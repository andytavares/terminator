import { describe, it, expect } from 'vitest'
import { parseProposal, applyProposal, ProposalRejected } from '../../src/order/proposal.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// What an agent is allowed to write into an order — which is not the order.
//
// An intake agent that could set `status` could agree its own work, and one
// that could rewrite `provenance` could erase how the order got that way.

const NOW = '2026-09-06T12:00:00.000Z'

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...draftOrder({
      id: 'WO-1',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/app'],
      now: '2026-09-06T10:00:00.000Z',
    }),
    ...over,
  }
}

const CRITERION = {
  id: 'AC-1',
  statement: 'an expired token is refused',
  priority: 'P0' as const,
  verify: { kind: 'test' as const, command: 'npm test', assert: 'exit_code == 0' },
  unverifiable: null,
}

describe('what a proposal may contain', () => {
  it('takes criteria, a plan, a grade and budgets', () => {
    const proposal = parseProposal({
      acceptance: [CRITERION],
      risk: { grade: 'P1', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
      budgets: { agents: 2, wallClockMinutes: 45, filesTouched: 12, tokens: null },
      note: 'first draft',
    })
    expect(proposal.acceptance).toHaveLength(1)
    expect(proposal.note).toBe('first draft')
  })

  it('refuses a status, rather than quietly dropping it', () => {
    // An agent that tried it will try again, and the operator should know.
    expect(() => parseProposal({ status: 'agreed' })).toThrow(ProposalRejected)
  })

  it('refuses an id, a source or a provenance', () => {
    for (const field of ['id', 'source', 'provenance', 'context', 'redTeam']) {
      expect(() => parseProposal({ [field]: {} }), field).toThrow(ProposalRejected)
    }
  })

  it('says which field it refused and why', () => {
    expect(() => parseProposal({ acceptance: [{ id: 'AC-1' }] })).toThrow(/acceptance/)
  })

  it('takes an empty proposal — an architect that changed nothing said so', () => {
    expect(parseProposal({}).note).toBe('')
  })

  it('refuses a criterion with no way to prove it', () => {
    expect(() =>
      parseProposal({ acceptance: [{ ...CRITERION, verify: { kind: 'test' } }] })
    ).toThrow(ProposalRejected)
  })
})

describe('merging one in', () => {
  it('leaves alone what the proposal did not mention', () => {
    const before = order({ title: 'kept' })
    const after = applyProposal(before, parseProposal({ acceptance: [CRITERION] }), NOW)
    expect(after.title).toBe('kept')
    expect(after.status).toBe('draft')
    expect(after.id).toBe('WO-1')
  })

  it('records what the architect said it changed', () => {
    const after = applyProposal(order(), parseProposal({ note: 'added AC-1' }), NOW)
    expect(after.provenance.decisions.at(-1)).toContain('added AC-1')
  })

  it('records something even when the architect said nothing', () => {
    const after = applyProposal(order(), parseProposal({}), NOW)
    expect(after.provenance.decisions.at(-1)).toContain('redrafted the plan')
  })

  it('keeps a struck assumption struck, however the architect restates it', () => {
    const before = order({
      assumptions: [{ id: 'A-1', text: 'sessions are in Redis', struck: true, affects: [] }],
    })
    const after = applyProposal(
      before,
      parseProposal({
        assumptions: [{ id: 'A-1', text: 'sessions are in Redis', struck: false, affects: [] }],
      }),
      NOW
    )
    expect(after.assumptions[0].struck).toBe(true)
  })

  it('keeps an answered question answered', () => {
    const before = order({
      openQuestions: [
        {
          id: 'Q-1',
          text: 'which store?',
          why: '',
          options: [],
          recommended: null,
          answer: 'Redis',
          rank: 0,
        },
      ],
    })
    const after = applyProposal(
      before,
      parseProposal({
        openQuestions: [
          {
            id: 'Q-1',
            text: 'which store?',
            why: '',
            options: [],
            recommended: null,
            answer: null,
            rank: 0,
          },
        ],
      }),
      NOW
    )
    expect(after.openQuestions[0].answer).toBe('Redis')
  })

  it('lets the architect add a new assumption', () => {
    const after = applyProposal(
      order(),
      parseProposal({ assumptions: [{ id: 'A-2', text: 'new', struck: false, affects: [] }] }),
      NOW
    )
    expect(after.assumptions.map((a) => a.id)).toEqual(['A-2'])
  })

  it('refuses a merge that would produce an unreadable order', () => {
    // Readable as a proposal and unreadable as an order is a real difference,
    // and the next reader is the compile gate.
    const bad = { ...order(), plan: { units: [], lanes: [], sharedFiles: [] } }
    expect(() => applyProposal(bad as WorkOrder, parseProposal({}), NOW)).toThrow()
  })
})
