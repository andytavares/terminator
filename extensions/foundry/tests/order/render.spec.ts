import { describe, it, expect } from 'vitest'
import { renderOrder } from '../../src/order/render.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The rendering is a view, never the truth. It has to read well in the
// application, in a bare terminal and as a tracker comment, which is why it is
// plain markdown — the least decorated version is the one that survives all
// three.

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
    acceptance: [
      {
        id: 'AC-1',
        statement: 'a full-width row renders its final glyph',
        priority: 'P0',
        verify: { kind: 'test', command: 'npx vitest run', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'widen the row',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/a.css'],
          verify: [],
        },
      ],
    },
    ...over,
  }
}

describe('renderOrder', () => {
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

  it('reports a passing order as ready to hand off', () => {
    expect(renderOrder(order())).toContain('All six checks pass')
  })

  it('lists each failing check with what is wrong', () => {
    const out = renderOrder(order({ acceptance: [] }))
    expect(out).toContain('**coverage**')
    expect(out).toContain('no acceptance criteria')
  })

  it('shows unresolved red-team findings and hides settled ones', () => {
    const o = order({
      redTeam: [
        { id: 'RT-1', severity: 'high', text: 'ambiguous', status: 'open', reason: '' },
        { id: 'RT-2', severity: 'low', text: 'settled thing', status: 'resolved', reason: '' },
      ],
    })
    const out = renderOrder(o)
    expect(out).toContain('RT-1')
    expect(out).not.toContain('settled thing')
  })

  it('shows unanswered questions and hides answered ones', () => {
    const o = order({
      openQuestions: [
        {
          id: 'Q-1',
          text: 'still open?',
          why: '',
          options: [],
          recommended: null,
          answer: null,
          rank: 1,
        },
        {
          id: 'Q-2',
          text: 'already settled?',
          why: '',
          options: [],
          recommended: null,
          answer: 'yes',
          rank: 1,
        },
      ],
    })
    const out = renderOrder(o)
    expect(out).toContain('still open?')
    expect(out).not.toContain('already settled?')
  })

  it('states the budgets, including an uncapped token spend', () => {
    expect(renderOrder(order())).toContain('tokens uncapped')
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
})
