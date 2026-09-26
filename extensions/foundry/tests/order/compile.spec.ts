import { describe, it, expect } from 'vitest'
import { compileOrder, agreeOrder, CHECK_IDS } from '../../src/order/compile.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The six checks. "Ironed out" stops being a feeling and becomes a green light
// nobody has to argue about.
//
// Every check has teeth on purpose. A check that cannot fail is decoration,
// and decoration in a gate is worse than no gate — it teaches you to trust a
// green you have not earned.

function complete(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-0101-aaa',
    title: 'Terminal clips the last glyph',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    acceptance: [
      {
        id: 'AC-1',
        statement: 'a full-width row renders its final glyph',
        priority: 'P0',
        verify: { kind: 'test', command: 'npx vitest run', assert: 'exit_code == 0' },
        unverifiable: null,
      },
      // The unit touches a stylesheet, and a command cannot say whether the
      // glyph renders — which is the whole of FR-040, and the reason this
      // fixture used to be refused by the check that enforces it.
      {
        id: 'AC-2',
        statement: 'the last column is not clipped, in the running application',
        priority: 'P1',
        verify: { kind: 'screenshot', target: 'a full-width terminal row' },
        unverifiable: null,
      },
    ],
    risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'widen the row container',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1', 'AC-2'],
          touches: ['src/styles.css'],
          verify: [],
        },
      ],
    },
    ...over,
  }
}

function failures(order: WorkOrder): string[] {
  return compileOrder(order).failures.map((f) => f.check)
}

describe('compileOrder', () => {
  it('passes a complete order with no failures at all', () => {
    const result = compileOrder(complete())
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('knows exactly five checks', () => {
    expect(CHECK_IDS).toHaveLength(5)
  })

  describe('1 — no open questions', () => {
    it('fails while a question is unanswered', () => {
      const order = complete({
        openQuestions: [
          {
            id: 'Q-1',
            text: 'does the web client render rows?',
            why: '',
            options: [],
            recommended: null,
            answer: null,
            rank: 1,
          },
        ],
      })
      expect(failures(order)).toContain('questions')
    })

    it('passes once every question is answered', () => {
      const order = complete({
        openQuestions: [
          { id: 'Q-1', text: 'q', why: '', options: [], recommended: null, answer: 'no', rank: 1 },
        ],
      })
      expect(failures(order)).not.toContain('questions')
    })

    it('names the question that is holding it up', () => {
      const order = complete({
        openQuestions: [
          { id: 'Q-7', text: 'q', why: '', options: [], recommended: null, answer: null, rank: 1 },
        ],
      })
      const f = compileOrder(order).failures.find((x) => x.check === 'questions')
      expect(f?.subjectIds).toEqual(['Q-7'])
    })
  })

  describe('2 — every criterion is falsifiable', () => {
    it('fails a criterion whose command is empty', () => {
      const order = complete()
      order.acceptance[0].verify = { kind: 'command', command: ' ', assert: 'exit_code == 0' }
      expect(failures(order)).toContain('verifiable')
    })

    it('accepts a judge with a rubric and named evidence', () => {
      const order = complete()
      order.acceptance[0].verify = {
        kind: 'judge',
        rubric: 'measure rendered ink',
        evidence: ['screenshot'],
      }
      expect(failures(order)).not.toContain('verifiable')
    })

    it('accepts a criterion explicitly accepted as unverifiable, because that was a decision', () => {
      const order = complete()
      order.acceptance[0].verify = { kind: 'command', command: '', assert: 'x' }
      order.acceptance[0].unverifiable = { accepted: true, reason: 'nothing can run this here' }
      expect(failures(order)).not.toContain('verifiable')
    })

    // Measured on WO-0910-1fb, an order whose whole content was "make all text
    // red". The picture check fired because the plan touched CSS, and the
    // architect closed it by inventing three screenshot criteria naming five
    // extension views in two themes. Five criteria became eight, coverage then
    // pulled every one of those views into the unit's `touches`, and a
    // one-line ask became a 41-file plan the builder spent 53 minutes on.
    //
    // The check asks for a picture. It has never asked for three, and the
    // failure it hands the architect is the only place that can say so.
    it('says one picture closes it, on a surface the plan already touches', () => {
      const order = complete()
      order.acceptance = order.acceptance.filter((c) => c.verify.kind !== 'screenshot')
      order.plan.units[0].satisfies = order.acceptance.map((c) => c.id)
      const detail =
        compileOrder(order).failures.find((f) => f.check === 'verifiable')?.detail ?? ''
      expect(detail).toContain('One')
      expect(detail).toMatch(/already touches|already changes/)
      expect(detail).toContain('“widen the row container” changes what a person sees')
      expect(detail).not.toContain('U-1')
    })

    it('names the criterion that cannot be proven', () => {
      const order = complete()
      order.acceptance[0].verify = { kind: 'test', command: '', assert: 'x' }
      const f = compileOrder(order).failures.find((x) => x.check === 'verifiable')
      expect(f?.subjectIds).toEqual(['AC-1'])
    })
  })

  describe('3 — coverage, both directions', () => {
    it('fails when a criterion has no unit', () => {
      const order = complete()
      order.plan.units[0].satisfies = []
      expect(failures(order)).toContain('coverage')
    })

    it('fails when a unit satisfies no criterion', () => {
      const order = complete()
      order.plan.units.push({
        id: 'U-2',
        title: 'extra',
        role: 'builder',
        lane: 1,
        dependsOn: [],
        satisfies: [],
        touches: [],
        verify: [],
      })
      const f = compileOrder(order).failures.find((x) => x.check === 'coverage')
      expect(f?.subjectIds).toContain('U-2')
    })

    // The detail is read by a person on the Plan step. "Nothing in the plan
    // builds AC-1" names a code only an agent can look up.
    it('quotes the uncovered criterion, not its id', () => {
      const order = complete()
      order.plan.units[0].satisfies = ['AC-2']
      const f = compileOrder(order).failures.find((x) => x.check === 'coverage')
      expect(f?.detail).toContain('“a full-width row renders its final glyph”')
      expect(f?.detail).not.toContain('AC-1')
    })

    it('quotes the orphan unit and a dangling claim by title, not id', () => {
      const order = complete()
      order.plan.units.push({
        id: 'U-2',
        title: 'rename the config key',
        role: 'builder',
        lane: 1,
        dependsOn: [],
        satisfies: [],
        touches: [],
        verify: [],
      })
      order.plan.units[0].satisfies.push('AC-9')
      const f = compileOrder(order).failures.find((x) => x.check === 'coverage')
      expect(f?.detail).toContain('“rename the config key” satisfies no criterion.')
      expect(f?.detail).toContain(
        '“widen the row container” claims a criterion that does not exist'
      )
      expect(f?.detail).not.toMatch(/U-\d/)
    })

    it('fails an order with no criteria at all', () => {
      expect(failures(complete({ acceptance: [] }))).toContain('coverage')
    })

    it('names both the uncovered criterion and the orphan unit in one failure', () => {
      const order = complete()
      // AC-3, because the fixture already carries the screenshot criterion
      // FR-040 requires of a change to a stylesheet.
      order.acceptance.push({
        id: 'AC-3',
        statement: 'x',
        priority: 'P1',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      })
      order.plan.units.push({
        id: 'U-2',
        title: 'extra',
        role: 'builder',
        lane: 1,
        dependsOn: [],
        satisfies: [],
        touches: [],
        verify: [],
      })
      const f = compileOrder(order).failures.find((x) => x.check === 'coverage')
      expect(f?.subjectIds).toEqual(expect.arrayContaining(['AC-3', 'U-2']))
    })
  })

  describe('4 — risk graded against the plan', () => {
    it('fails when units touch files but nothing was declared as the blast radius', () => {
      const order = complete({
        risk: { grade: 'P2', triggers: [], blastRadius: [], criticalPaths: [] },
      })
      expect(failures(order)).toContain('risk')
    })

    it('fails when a unit touches something outside the declared blast radius', () => {
      const order = complete()
      order.plan.units[0].touches = ['src/styles.css', 'scripts/release.sh']
      expect(failures(order)).toContain('risk')
      const f = compileOrder(order).failures.find((x) => x.check === 'risk')
      expect(f?.detail).toContain('scripts/release.sh')
    })

    it('passes when every touched path is inside the blast radius', () => {
      const order = complete()
      order.plan.units[0].touches = ['src/a.css', 'src/b.ts']
      expect(failures(order)).not.toContain('risk')
    })

    it('does not demand a blast radius from a plan that touches nothing yet', () => {
      const order = complete({
        risk: { grade: 'P3', triggers: [], blastRadius: [], criticalPaths: [] },
      })
      order.plan.units[0].touches = []
      expect(failures(order)).not.toContain('risk')
    })
  })

  describe('5 — the adversarial pass is resolved', () => {
    it('fails while a finding is still open', () => {
      const order = complete({
        redTeam: [{ id: 'RT-1', severity: 'high', text: 'ambiguous', status: 'open', reason: '' }],
      })
      expect(failures(order)).toContain('redTeam')
    })

    it('passes a resolved finding', () => {
      const order = complete({
        redTeam: [{ id: 'RT-1', severity: 'high', text: 'x', status: 'resolved', reason: '' }],
      })
      expect(failures(order)).not.toContain('redTeam')
    })

    it('passes a finding explicitly accepted with a reason', () => {
      const order = complete({
        redTeam: [
          { id: 'RT-1', severity: 'low', text: 'x', status: 'accepted', reason: 'out of scope' },
        ],
      })
      expect(failures(order)).not.toContain('redTeam')
    })
  })

  // ADR 056: a count of files is not a budget. It refused plans for being
  // honest about their size and halted runs that had already done the work.
  it('does not hold a plan to a count of files, however many it touches', () => {
    const order = complete()
    order.risk.blastRadius = ['src/']
    order.plan.units[0].touches = Array.from({ length: 200 }, (_, i) => `src/f${i}.css`)
    expect(compileOrder(order).ok).toBe(true)
  })

  it('reports every failing check at once, not the first', () => {
    const order = complete({
      acceptance: [],
      openQuestions: [
        { id: 'Q-1', text: 'q', why: '', options: [], recommended: null, answer: null, rank: 1 },
      ],
      redTeam: [{ id: 'RT-1', severity: 'low', text: 'x', status: 'open', reason: '' }],
    })
    const checks = failures(order)
    expect(checks).toEqual(expect.arrayContaining(['questions', 'coverage', 'redTeam']))
  })
})

describe('agreeOrder', () => {
  it('moves a complete order to agreed and stamps when', () => {
    const r = agreeOrder(complete(), '2026-09-06T11:00:00.000Z')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.order.status).toBe('agreed')
      expect(r.order.agreedAt).toBe('2026-09-06T11:00:00.000Z')
    }
  })

  it('leaves an incomplete order exactly as it was', () => {
    const before = complete({ acceptance: [] })
    const r = agreeOrder(before, '2026-09-06T11:00:00.000Z')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.result.failures.length).toBeGreaterThan(0)
      expect(before.status).toBe('draft')
      expect(before.agreedAt).toBeNull()
    }
  })

  it('refuses to agree an order that is not a draft', () => {
    const agreed = complete({ status: 'running' })
    const r = agreeOrder(agreed, '2026-09-06T11:00:00.000Z')
    expect(r.ok).toBe(false)
  })
})
