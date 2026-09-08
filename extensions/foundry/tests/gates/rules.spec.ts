import { describe, it, expect } from 'vitest'
import {
  raiseGate,
  decide,
  applyDefault,
  isOverdue,
  GATE_RULES,
  UnattributedGateError,
  AlreadyDecidedError,
  ruleInWords,
} from '../../src/gates/rules.js'
import type { Gate, GateRuleId } from '../../src/gates/rules.js'
import {
  liveRules,
  isLive,
  silencedRules,
  UNCONDITIONAL,
  AUTONOMY_LEVELS,
} from '../../src/gates/autonomy.js'
import { rankOf, rankInbox, summariseInbox } from '../../src/gates/rank.js'

// A gate is a row raised by a named rule. If no rule fires, nothing stops —
// which is the whole difference between nought-to-two decisions per order and
// nine.

function gate(over: Partial<Parameters<typeof raiseGate>[0]> = {}): Gate {
  return raiseGate({
    id: 'G-1',
    rule: 'risk.p0',
    orderId: 'WO-1',
    summary: 'U-4 rewrites session token refresh',
    why: 'the diff touches src/main/auth/session.ts',
    at: '2026-09-06T10:00:00.000Z',
    ...over,
  })
}

describe('raiseGate', () => {
  it('carries the rule, the reason and what happens if it is ignored', () => {
    const g = gate()
    expect(g.rule).toBe('risk.p0')
    expect(g.why).toContain('session.ts')
    expect(g.defaultIfIgnored).toBe('hold')
  })

  it('refuses a gate that cannot say why it exists', () => {
    expect(() => gate({ why: '   ' })).toThrow(UnattributedGateError)
  })

  it('says why it refused, rather than failing silently', () => {
    expect(() => gate({ why: '' })).toThrow(/learn to dismiss/)
  })

  it.each(GATE_RULES)('%s offers options with stated consequences', (rule) => {
    const g = gate({ rule: rule as GateRuleId })
    expect(g.options.length).toBeGreaterThan(0)
    expect(g.options.every((o) => o.consequence.trim() !== '')).toBe(true)
  })

  it.each(GATE_RULES)('%s says what happens when nobody answers', (rule) => {
    const g = gate({ rule: rule as GateRuleId })
    expect(g.options.map((o) => o.id)).toContain(g.defaultIfIgnored)
  })

  it('never defaults the merge decision to anything that ships', () => {
    expect(gate({ rule: 'ready-for-review' }).defaultIfIgnored).toBe('hold')
  })

  it('starts undecided', () => {
    expect(gate().decision).toBeNull()
  })
})

describe('decide', () => {
  it('records the operator choice, the note and when', () => {
    const g = decide(gate(), 'approve', 'read the diff', '2026-09-06T11:00:00.000Z')
    expect(g.decision).toEqual({
      option: 'approve',
      by: 'operator',
      note: 'read the diff',
      at: '2026-09-06T11:00:00.000Z',
    })
  })

  it('refuses an option the gate never offered', () => {
    expect(() => decide(gate(), 'ship_it', '', 'now')).toThrow(/not one of the options/)
  })

  it('refuses to decide the same gate twice', () => {
    const once = decide(gate(), 'approve', '', 'now')
    expect(() => decide(once, 'send_back', '', 'later')).toThrow(AlreadyDecidedError)
  })
})

describe('applyDefault', () => {
  it('takes the stated default and records that nobody answered', () => {
    const g = applyDefault(gate(), '2026-09-06T12:00:00.000Z')
    expect(g.decision).toMatchObject({ option: 'hold', by: 'default' })
    expect(g.decision?.note).toContain('no answer')
  })

  it('leaves a gate the operator already answered alone', () => {
    const answered = decide(gate(), 'approve', '', 'now')
    expect(applyDefault(answered, 'later')).toEqual(answered)
  })
})

describe('isOverdue', () => {
  it('is not overdue without a deadline — some gates wait for ever, on purpose', () => {
    expect(isOverdue(gate(), '2099-01-01T00:00:00.000Z')).toBe(false)
  })

  it('is overdue once the deadline has passed', () => {
    const g = gate({ deadline: '2026-09-06T11:00:00.000Z' })
    expect(isOverdue(g, '2026-09-06T12:00:00.000Z')).toBe(true)
    expect(isOverdue(g, '2026-09-06T10:30:00.000Z')).toBe(false)
  })

  it('is never overdue once it has been decided', () => {
    const g = decide(gate({ deadline: '2026-09-06T11:00:00.000Z' }), 'approve', '', 'now')
    expect(isOverdue(g, '2099-01-01T00:00:00.000Z')).toBe(false)
  })
})

describe('autonomy', () => {
  it('keeps four rules live at every setting', () => {
    for (const level of AUTONOMY_LEVELS) {
      for (const rule of UNCONDITIONAL) expect(isLive(rule, level)).toBe(true)
    }
  })

  it('still requires a decision before anything is marked ready, even at the most permissive', () => {
    expect(isLive('ready-for-review', 'lights-out')).toBe(true)
  })

  it('stops at every unit boundary only when escorted', () => {
    expect(isLive('unit.boundary', 'escorted')).toBe(true)
    expect(isLive('unit.boundary', 'standard')).toBe(false)
    expect(isLive('unit.boundary', 'lights-out')).toBe(false)
  })

  it('asks about a repeat failure and a new dependency at standard, and not at lights-out', () => {
    for (const rule of [
      'verify.repeat-fail',
      'new-dependency',
      'critical-path',
      'forge-defect',
    ] as GateRuleId[]) {
      expect(isLive(rule, 'standard')).toBe(true)
      expect(isLive(rule, 'lights-out')).toBe(false)
    }
  })

  it('makes every rule live when escorted', () => {
    expect(liveRules('escorted').size).toBe(GATE_RULES.length)
  })

  it('says what each setting is not asking about', () => {
    expect(silencedRules('escorted')).toEqual([])
    expect(silencedRules('lights-out')).toContain('unit.boundary')
    expect(silencedRules('lights-out')).not.toContain('risk.p0')
  })
})

describe('ranking', () => {
  function ranked(over: Partial<Parameters<typeof raiseGate>[0]> & { blockedUnits?: number } = {}) {
    return gate(over)
  }

  it('ranks a decision that unblocks more work above one that unblocks less', () => {
    const many = ranked({ id: 'G-many', blockedUnits: 3 })
    const few = ranked({ id: 'G-few', blockedUnits: 0 })
    expect(rankOf(many)).toBeGreaterThan(rankOf(few))
  })

  it('ranks by risk when the amount of blocked work is the same', () => {
    const worse = ranked({ id: 'G-p0', riskGrade: 'P0', blockedUnits: 1 })
    const milder = ranked({ id: 'G-p3', riskGrade: 'P3', blockedUnits: 1 })
    expect(rankOf(worse)).toBeGreaterThan(rankOf(milder))
  })

  it('puts a P0 holding three units above a P0 holding none', () => {
    const busy = ranked({ id: 'a', riskGrade: 'P0', blockedUnits: 3 })
    const idle = ranked({ id: 'b', riskGrade: 'P0', blockedUnits: 0 })
    expect(rankInbox([idle, busy]).map((g) => g.id)).toEqual(['a', 'b'])
  })

  it('still ranks a gate that blocks nothing above zero', () => {
    expect(rankOf(ranked({ blockedUnits: 0, riskGrade: 'P3' }))).toBeGreaterThan(0)
  })

  it('leaves decided gates out of the queue', () => {
    const answered = decide(ranked({ id: 'done' }), 'approve', '', 'now')
    expect(rankInbox([answered, ranked({ id: 'open' })]).map((g) => g.id)).toEqual(['open'])
  })

  it('breaks a tie by which was raised first', () => {
    const first = ranked({ id: 'first', at: '2026-09-06T10:00:00.000Z' })
    const second = ranked({ id: 'second', at: '2026-09-06T11:00:00.000Z' })
    expect(rankInbox([second, first]).map((g) => g.id)).toEqual(['first', 'second'])
  })

  it('summarises what is waiting and what was decided without anyone', () => {
    const automatic = applyDefault(ranked({ id: 'auto' }), 'now')
    const summary = summariseInbox([
      ranked({ id: 'a', orderId: 'WO-1' }),
      ranked({ id: 'b', orderId: 'WO-2' }),
      automatic,
    ])
    expect(summary).toEqual({ waiting: 2, orders: 2, automatic: 1 })
  })

  it('summarises an empty inbox as nothing waiting', () => {
    expect(summariseInbox([])).toEqual({ waiting: 0, orders: 0, automatic: 0 })
  })
})

// ── A run whose agents are gone ─────────────────────────────────────────
//
// The one rule that must never be silenced by the autonomy dial. Every other
// rule asks about work; this one says the work stopped. Hiding it at
// lights-out is precisely the failure it exists to end: a run that looked
// busy for hours and had died when the application closed.

describe('run.interrupted', () => {
  it('is live at every autonomy setting', () => {
    for (const level of AUTONOMY_LEVELS) expect(isLive('run.interrupted', level)).toBe(true)
  })

  it('is never silenced', () => {
    for (const level of AUTONOMY_LEVELS) {
      expect(silencedRules(level)).not.toContain('run.interrupted')
    }
  })

  it('offers picking the run back up, and stopping it', () => {
    const gate = raiseGate({
      id: 'g',
      rule: 'run.interrupted',
      orderId: 'WO-1',
      summary: 's',
      why: 'w',
      at: '2026-09-06T10:00:00.000Z',
    })
    expect(gate.options.map((o) => o.id)).toEqual(['resume', 'stop', 'hold'])
  })

  it('holds rather than restarting agents nobody asked for', () => {
    const gate = raiseGate({
      id: 'g',
      rule: 'run.interrupted',
      orderId: 'WO-1',
      summary: 's',
      why: 'w',
      at: '2026-09-06T10:00:00.000Z',
    })
    expect(gate.defaultIfIgnored).toBe('hold')
  })

  it('says what it is in words somebody who did not write it can read', () => {
    expect(ruleInWords('run.interrupted')).toMatch(/agents/)
  })
})
