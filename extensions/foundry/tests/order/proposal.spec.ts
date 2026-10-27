import { describe, it, expect } from 'vitest'
import { builderUnit } from '../helpers/order-parts.js'
import {
  parseProposal,
  applyProposal,
  proposalJsonSchema,
  ProposalRejected,
} from '../../src/order/proposal.js'
import { draftOrder } from '../../src/order/draft.js'
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
  describe('taking', takingTests)
  describe('refusing', proposalRefusingTests)
  describe('empty proposals and unprovable criteria', emptyProposalsAndUnprovableCriteriaTests)
})

function takingTests() {
  it('takes criteria, a plan, a grade and budgets', () => {
    const proposal = parseProposal({
      acceptance: [CRITERION],
      risk: { grade: 'P1', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
      budgets: { agents: 2, wallClockMinutes: 45, tokens: null },
      note: 'first draft',
    })
    expect(proposal.acceptance).toHaveLength(1)
    expect(proposal.note).toBe('first draft')
  })
}

function proposalRefusingTests() {
  it('refuses a status, rather than quietly dropping it', () => {
    // An agent that tried it will try again, and the operator should know.
    expect(() => parseProposal({ status: 'agreed' })).toThrow(ProposalRejected)
  })

  it('refuses an id, a source or a provenance', () => {
    for (const field of ['id', 'source', 'provenance', 'context', 'redTeam']) {
      expect(() => parseProposal({ [field]: {} })).toThrow(ProposalRejected)
    }
  })

  it('says which field it refused and why', () => {
    expect(() => parseProposal({ acceptance: [{ id: 'AC-1' }] })).toThrow(/acceptance/)
  })
}

function emptyProposalsAndUnprovableCriteriaTests() {
  it('takes an empty proposal — an architect that changed nothing said so', () => {
    expect(parseProposal({}).note).toBe('')
  })

  it('refuses a criterion with no way to prove it', () => {
    expect(() =>
      parseProposal({ acceptance: [{ ...CRITERION, verify: { kind: 'test' } }] })
    ).toThrow(ProposalRejected)
  })
}

const SECOND_CRITERION = { ...CRITERION, id: 'AC-2', statement: 'a fresh token is accepted' }

describe('merging one in', () => {
  describe('untouched fields and budgets', untouchedFieldsAndBudgetsTests)
  describe('what it said', whatItSaidTests)
  describe('struck assumptions', proposalStruckAssumptionsTests)
  describe('answered questions', answeredQuestionsTests)
  describe('new assumptions and plans', newAssumptionsAndPlansTests)
  describe('lists sent in part', partialListsTests)
  describe('removing by id', removingByIdTests)
  describe('intent, risk and refusals', intentRiskAndRefusalsTests)
})

function untouchedFieldsAndBudgetsTests() {
  it('leaves alone what the proposal did not mention', () => {
    const before = order({ title: 'kept' })
    const after = applyProposal(before, parseProposal({ acceptance: [CRITERION] }), NOW)
    expect(after.title).toBe('kept')
    expect(after.status).toBe('draft')
    expect(after.id).toBe('WO-1')
  })

  it('never changes the budgets, which are the operator’s', () => {
    // The architect's contract carried an example budget, and whatever it
    // wrote replaced the configured one: an operator who set 25 files got 10.
    const before = order({
      budgets: { agents: 3, wallClockMinutes: 45, tokens: null },
    })
    const after = applyProposal(
      before,
      parseProposal({
        budgets: { agents: 2, wallClockMinutes: 45, tokens: null },
      }),
      NOW
    )
    expect(after.budgets).toEqual(before.budgets)
  })
}

function whatItSaidTests() {
  it('records what the architect said it changed', () => {
    const after = applyProposal(order(), parseProposal({ note: 'added AC-1' }), NOW)
    expect(after.provenance.decisions.at(-1)).toContain('added AC-1')
  })

  it('records something even when the architect said nothing', () => {
    const after = applyProposal(order(), parseProposal({}), NOW)
    expect(after.provenance.decisions.at(-1)).toContain('redrafted the plan')
  })
}

function proposalStruckAssumptionsTests() {
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
}

/** The question of which store to use, answered with `answer` or not yet. */
function whichStore(answer: string | null) {
  return {
    id: 'Q-1',
    text: 'which store?',
    why: '',
    options: [],
    recommended: null,
    answer,
    multiple: false,
    chosen: [],
    rank: 0,
    confidence: null,
  }
}

function answeredQuestionsTests() {
  it('keeps an answered question answered', () => {
    const before = order({ openQuestions: [whichStore('Redis')] })
    const after = applyProposal(before, parseProposal({ openQuestions: [whichStore(null)] }), NOW)
    expect(after.openQuestions[0].answer).toBe('Redis')
  })
}

function newAssumptionsAndPlansTests() {
  it('lets the architect add a new assumption', () => {
    const after = applyProposal(
      order(),
      parseProposal({ assumptions: [{ id: 'A-2', text: 'new', struck: false, affects: [] }] }),
      NOW
    )
    expect(after.assumptions.map((a) => a.id)).toEqual(['A-2'])
  })

  // The amending turn is told to send only what it changed. On WO-0927-d2b it
  // sent `plan.units` and `intent.nonGoals` alone, and every turn was refused
  // for the halves it had been told not to restate.
  it('merges a partial plan over the one on the order', () => {
    const before = order()
    const unit = builderUnit('U-9', { title: 'filter in the query', touches: ['src/'] })
    const after = applyProposal(before, parseProposal({ plan: { units: [unit] } }), NOW)
    expect(after.plan.units.map((u) => u.id)).toEqual(['U-9'])
    expect(after.plan.lanes).toEqual(before.plan.lanes)
  })
}

function partialListsTests() {
  it('keeps the criteria a partial list does not mention', () => {
    const before = order({ acceptance: [CRITERION, SECOND_CRITERION] })
    const reworded = { ...CRITERION, statement: 'an expired token gets a 401' }
    const after = applyProposal(before, parseProposal({ acceptance: [reworded] }), NOW)
    expect(after.acceptance.map((c) => [c.id, c.statement])).toEqual([
      ['AC-1', 'an expired token gets a 401'],
      ['AC-2', 'a fresh token is accepted'],
    ])
  })

  it('adds a criterion with a new id', () => {
    const before = order({ acceptance: [CRITERION] })
    const after = applyProposal(before, parseProposal({ acceptance: [SECOND_CRITERION] }), NOW)
    expect(after.acceptance.map((c) => c.id)).toEqual(['AC-1', 'AC-2'])
  })

  it('keeps the units a partial list does not mention', () => {
    const kept = builderUnit('U-1', { title: 'kept', touches: ['src/a.ts'] })
    const before = order({ plan: { ...order().plan, units: [kept] } })
    const added = builderUnit('U-2', { title: 'added', touches: ['src/b.ts'] })
    const after = applyProposal(before, parseProposal({ plan: { units: [added] } }), NOW)
    expect(after.plan.units.map((u) => u.id)).toEqual(['U-1', 'U-2'])
  })
}

function removingByIdTests() {
  it('drops the criteria and units the proposal names in remove', () => {
    const unit = builderUnit('U-1', { title: 'gone', touches: ['src/a.ts'] })
    const before = order({
      acceptance: [CRITERION, SECOND_CRITERION],
      plan: { ...order().plan, units: [unit] },
    })
    const proposal = parseProposal({ remove: { acceptance: ['AC-1'], units: ['U-1'] } })
    const after = applyProposal(before, proposal, NOW)
    expect(after.acceptance.map((c) => c.id)).toEqual(['AC-2'])
    expect(after.plan.units).toEqual([])
  })
}

function intentRiskAndRefusalsTests() {
  it('merges a partial intent over the one on the order', () => {
    const before = order({ intent: { problem: 'p', outcome: 'o', nonGoals: [] } })
    const after = applyProposal(
      before,
      parseProposal({ intent: { nonGoals: ['no provider change'] } }),
      NOW
    )
    expect(after.intent).toEqual({ problem: 'p', outcome: 'o', nonGoals: ['no provider change'] })
  })

  it('merges a partial risk over the one on the order', () => {
    const before = order()
    const after = applyProposal(before, parseProposal({ risk: { blastRadius: ['src/'] } }), NOW)
    expect(after.risk.grade).toBe(before.risk.grade)
    expect(after.risk.blastRadius).toEqual(['src/'])
  })

  it('refuses a merge that would produce an unreadable order', () => {
    // Readable as a proposal and unreadable as an order is a real difference,
    // and the next reader is the compile gate.
    const bad = { ...order(), plan: { units: [], lanes: [], sharedFiles: [] } }
    expect(() => applyProposal(bad as WorkOrder, parseProposal({}), NOW)).toThrow()
  })
}

describe('what an agent read, as opposed to what Foundry measured', () => {
  describe('findings', proposalFindingsTests)
  describe('the measured half', theMeasuredHalfTests)
  describe('leaving alone', leavingAloneTests)
})

function proposalFindingsTests() {
  it('takes the findings half of context', () => {
    const after = applyProposal(
      order(),
      parseProposal({
        findings: {
          entryPoints: ['src/auth/session.ts'],
          conventions: ['errors are returned, never thrown'],
          priorArt: ['abc123 widened the same row'],
        },
      }),
      NOW
    )
    expect(after.context.entryPoints).toEqual(['src/auth/session.ts'])
    expect(after.context.conventions).toEqual(['errors are returned, never thrown'])
    expect(after.context.priorArt).toEqual(['abc123 widened the same row'])
  })
}

function theMeasuredHalfTests() {
  it('refuses the measured half — a probe result is not the agent to rewrite', () => {
    // An agent that could rewrite the toolchain could tell the ladder a
    // command exists that does not.
    for (const field of ['repos', 'toolchain', 'houseDocs']) {
      expect(() => parseProposal({ findings: { [field]: [] } })).toThrow(ProposalRejected)
    }
  })

  it('refuses `context` itself', () => {
    expect(() => parseProposal({ context: {} })).toThrow(ProposalRejected)
  })
}

function leavingAloneTests() {
  it('leaves the measured half exactly as it was', () => {
    const before = order()
    const after = applyProposal(before, parseProposal({ findings: { conventions: ['x'] } }), NOW)
    expect(after.context.repos).toEqual(before.context.repos)
    expect(after.context.toolchain).toEqual(before.context.toolchain)
    expect(after.context.houseDocs).toEqual(before.context.houseDocs)
  })

  it('leaves findings alone when the proposal named none', () => {
    const before = order()
    const after = applyProposal(before, parseProposal({ note: 'x' }), NOW)
    expect(after.context.conventions).toEqual(before.context.conventions)
  })
}

describe('a lane branch the ticket fixed', () => {
  const lane = { ord: 1, repo: 'app', branch: '', role: null, blocks: [], blockedBy: [] }

  function seeded(): WorkOrder {
    const base = order()
    return {
      ...base,
      plan: { ...base.plan, lanes: [{ ...lane, repo: '/repos/app', branch: 'andrew/tav-15-x' }] },
    }
  }

  it('survives a proposal whose lane leaves the branch empty', () => {
    const proposal = parseProposal({ plan: { lanes: [{ ...lane, repo: '/repos/app' }] } })
    const next = applyProposal(seeded(), proposal, NOW)
    expect(next.plan.lanes[0].branch).toBe('andrew/tav-15-x')
  })

  it('yields to a branch the proposal actually names', () => {
    const proposal = parseProposal({
      plan: { lanes: [{ ...lane, repo: '/repos/app', branch: 'other' }] },
    })
    expect(applyProposal(seeded(), proposal, NOW).plan.lanes[0].branch).toBe('other')
  })
})

describe('the proposal as a JSON Schema', () => {
  it('names every key an agent may send, and nothing else', () => {
    const schema = proposalJsonSchema() as { properties: object; additionalProperties: boolean }
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        'acceptance',
        'assumptions',
        'budgets',
        'dismissFindings',
        'findings',
        'intent',
        'note',
        'openQuestions',
        'plan',
        'remove',
        'resolveFindings',
        'risk',
      ].sort()
    )
    expect(schema.additionalProperties).toBe(false)
  })
})
