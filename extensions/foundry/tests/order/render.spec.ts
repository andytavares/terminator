import { describe, it, expect } from 'vitest'
import { builderUnit, testCriterion } from '../helpers/order-parts.js'
import { renderOrder } from '../../src/order/render.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The rendering is a view, never the truth. It has to read well in the
// application, in a bare terminal and as a tracker comment, which is why it is
// plain markdown — the least decorated version is the one that survives all
// three.

/** The row's last glyph: a command proves it renders, a screenshot that it is not clipped. */
function glyphCriteria(): WorkOrder['acceptance'] {
  return [
    testCriterion('AC-1', {
      statement: 'a full-width row renders its final glyph',
      priority: 'P0',
      verify: { kind: 'test', command: 'npx vitest run', assert: 'exit_code == 0' },
    }),
    testCriterion('AC-2', {
      statement: 'the last column is not clipped, in the running application',
      verify: { kind: 'screenshot', target: 'a full-width row' },
    }),
  ]
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-0913-c71',
    title: 'Terminal clips the last glyph',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    intent: {
      problem: 'rows are clipped',
      outcome: 'rows render fully',
      nonGoals: ['scrollbar styling'],
    },
    risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    acceptance: glyphCriteria(),
    plan: {
      ...base.plan,
      units: [
        builderUnit('U-1', {
          title: 'widen the row',
          satisfies: ['AC-1', 'AC-2'],
          touches: ['src/a.css'],
        }),
      ],
    },
    ...over,
  }
}

describe('renderOrder', () => {
  describe('the head', theHeadTests)
  describe('criteria', criteriaTests)
  describe('the plan', thePlanTests)
  describe('coverage', coverageTests)
  describe('non-goals and assumptions', nonGoalsAndAssumptionsTests)
  describe('checks', checksTests)
  describe('blocking findings', blockingFindingsTests)
  describe('notes', notesTests)
  describe('settled findings', settledFindingsTests)
  describe('questions', questionsTests)
  describe('budgets and empty drafts', budgetsAndEmptyDraftsTests)
})

function theHeadTests() {
  it('leads with the title and the identifying facts', () => {
    const out = renderOrder(order())
    expect(out).toContain('# Terminal clips the last glyph')
    expect(out).toContain('WO-0913-c71')
    expect(out).toContain('risk P2')
  })

  it('names the source issue when there is one', () => {
    const out = renderOrder(
      order({ source: { kind: 'tracker', tracker: 'linear', key: 'TAV-42', url: 'u' } })
    )
    expect(out).toContain('linear TAV-42')
  })

  it('says nothing about a source when the idea was typed', () => {
    expect(renderOrder(order())).not.toContain('Source:')
  })
}

function thePlanTests() {
  it('names what a unit waits on, and what it touches', () => {
    const o = order()
    o.plan.units = [
      ...o.plan.units,
      builderUnit('U-2', { title: 'trim the gutter', dependsOn: ['U-1'], satisfies: ['AC-2'] }),
    ]
    const out = renderOrder(o)
    expect(out).toContain(
      '- **U-2** trim the gutter — builder, lane 1 · after U-1 · satisfies AC-2'
    )
    expect(out).toContain(
      '- **U-1** widen the row — builder, lane 1 · satisfies AC-1, AC-2\n  - touches: src/a.css'
    )
  })

  it('says a unit satisfies nothing rather than leaving the list blank', () => {
    const o = order()
    o.plan.units[0].satisfies = []
    expect(renderOrder(o)).toContain('satisfies _nothing_')
  })
}

function criteriaTests() {
  it('shows every criterion with the thing that proves it', () => {
    const out = renderOrder(order())
    expect(out).toContain('**AC-1** (P0) a full-width row renders its final glyph')
    expect(out).toContain('`npx vitest run`')
  })

  it('says plainly when a criterion was accepted as unprovable', () => {
    const o = order()
    o.acceptance[0].unverifiable = { accepted: true, reason: 'no runner exists here' }
    expect(renderOrder(o)).toContain('accepted as unverifiable — no runner exists here')
  })

  it('renders each kind of proof in its own terms', () => {
    const o = order()
    o.acceptance[0].verify = { kind: 'judge', rubric: 'measure ink', evidence: ['screenshot'] }
    expect(renderOrder(o)).toContain('judge · "measure ink" · evidence: screenshot')
    o.acceptance[0].verify = { kind: 'artifact', path: 'dist/a.js', assert: 'exists' }
    expect(renderOrder(o)).toContain('artifact · dist/a.js · exists')
    o.acceptance[0].verify = { kind: 'screenshot', target: 'terminal pane' }
    expect(renderOrder(o)).toContain('screenshot · terminal pane')
  })
}

function coverageTests() {
  it('plots coverage as a grid a reader can scan', () => {
    const out = renderOrder(order())
    expect(out).toContain('| AC-1 | ● |')
  })

  it('marks a gap in the grid rather than hiding it', () => {
    const o = order()
    o.plan.units[0].satisfies = []
    expect(renderOrder(o)).toContain('| AC-1 | · |')
  })

  it('says there is nothing to plot when the plan is empty', () => {
    expect(renderOrder(order({ acceptance: [], plan: { ...order().plan, units: [] } }))).toContain(
      'Nothing to plot yet'
    )
  })
}

function nonGoalsAndAssumptionsTests() {
  it('lists what the order deliberately does not do', () => {
    expect(renderOrder(order())).toContain('scrollbar styling')
  })

  it('shows live assumptions and omits struck ones', () => {
    const o = order({
      assumptions: [
        { id: 'A-1', text: 'xterm 5.x', struck: false, affects: [] },
        { id: 'A-2', text: 'fix belongs in the component', struck: true, affects: [] },
      ],
    })
    const out = renderOrder(o)
    expect(out).toContain('xterm 5.x')
    expect(out).not.toContain('fix belongs in the component')
  })
}

function checksTests() {
  it('reports a passing order as ready to hand off', () => {
    expect(renderOrder(order())).toContain('All checks pass')
  })

  it('lists each failing check with what is wrong', () => {
    const out = renderOrder(order({ acceptance: [] }))
    expect(out).toContain('**coverage**')
    expect(out).toContain('no acceptance criteria')
  })
}

function blockingFindingsTests() {
  it('shows an open blocking finding under its own heading', () => {
    const o = order({
      redTeam: [
        {
          id: 'RT-1',
          severity: 'high',
          text: 'ambiguous',
          status: 'open',
          reason: '',
          category: 'wrong-outcome',
          round: 0,
        },
      ],
    })
    const out = renderOrder(o)
    expect(out).toContain('## Red team — blocking')
    expect(out).toContain('RT-1')
    expect(out).toContain('(wrong-outcome, high)')
  })
}

function notesTests() {
  it('shows an open non-blocking finding as a note, not a blocker', () => {
    const o = order({
      redTeam: [
        {
          id: 'RT-2',
          severity: 'low',
          text: 'no ADR for this',
          status: 'open',
          reason: '',
          category: 'process',
          round: 0,
        },
      ],
    })
    const out = renderOrder(o)
    expect(out).toContain('## Red team — notes')
    expect(out).toContain('RT-2')
    expect(out).not.toContain('## Red team — blocking')
  })
}

function settledFindingsTests() {
  it('shows a settled finding with its status and reason, headline only', () => {
    const o = order({
      redTeam: [
        {
          id: 'RT-3',
          severity: 'low',
          text: 'settled thing\n\n- the evidence',
          status: 'resolved',
          reason: 'fixed in the redraft',
          category: 'process',
          round: 0,
        },
      ],
    })
    const out = renderOrder(o)
    expect(out).toContain('## Red team — settled')
    expect(out).toContain('RT-3')
    expect(out).toContain('resolved: fixed in the redraft')
    expect(out).toContain('settled thing')
    expect(out).not.toContain('the evidence')
  })
}

type Question = WorkOrder['openQuestions'][number]

const question = (id: string, text: string, answer: string | null): Question => ({
  id,
  text,
  why: '',
  options: [],
  recommended: null,
  answer,
  rank: 1,
  confidence: null,
})

function questionsTests() {
  it('shows unanswered questions and hides answered ones', () => {
    const o = order({
      openQuestions: [
        question('Q-1', 'still open?', null),
        question('Q-2', 'already settled?', 'yes'),
      ],
    })
    const out = renderOrder(o)
    expect(out).toContain('still open?')
    expect(out).not.toContain('already settled?')
  })
}

function budgetsAndEmptyDraftsTests() {
  it('states the budgets, including an uncapped token spend', () => {
    expect(renderOrder(order())).toContain('tokens uncapped')
  })

  it('says a budget has no limit rather than printing null', () => {
    const out = renderOrder(
      order({ budgets: { agents: null, wallClockMinutes: 30, tokens: null } })
    )
    expect(out).toContain('agents unlimited · 30 minutes')
    expect(out).not.toContain('files')
    expect(out).not.toContain('null')
  })

  it('renders an empty draft without throwing', () => {
    const empty = draftOrder({
      id: 'WO-1',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/a'],
      now: '2026-09-06T10:00:00.000Z',
    })
    expect(() => renderOrder(empty)).not.toThrow()
    expect(renderOrder(empty)).toContain('No criteria yet')
  })
}
