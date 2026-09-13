import { describe, it, expect } from 'vitest'
import { forgeSteps, openingStep } from '../../src/forge/steps.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { CheckId, CompileResult } from '../../src/order/compile.js'

// The Forge is walked in order: what is asked, the plan, the red team, the
// shape of work, the tracker, hand-off. Each failing check belongs to the step
// where it is cleared, so the step list doubles as a map of what is blocking.

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...draftOrder({
      id: 'WO-1',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/a'],
      now: '2026-09-06T10:00:00.000Z',
    }),
    ...over,
  }
}

const CRITERION = {
  id: 'AC-1',
  statement: 'a',
  priority: 'P1' as const,
  verify: { kind: 'test' as const, command: 'npm test', assert: 'exit_code == 0' },
  unverifiable: null,
}

function failing(...checks: CheckId[]): CompileResult {
  return {
    ok: checks.length === 0,
    failures: checks.map((check) => ({ check, detail: check, subjectIds: [] })),
  }
}

const ALL = { shape: true, tracker: true }

describe('the steps of the Forge', () => {
  it('runs from what is asked to hand-off, in that order', () => {
    expect(forgeSteps(failing(), ALL).map((s) => s.id)).toEqual([
      'intent',
      'plan',
      'redTeam',
      'shape',
      'tracker',
      'handOff',
    ])
  })

  it('leaves out a step there is nothing to decide in', () => {
    expect(forgeSteps(failing(), { shape: false, tracker: false }).map((s) => s.id)).toEqual([
      'intent',
      'plan',
      'redTeam',
      'handOff',
    ])
  })

  it('puts each failing check on the step that clears it', () => {
    const steps = forgeSteps(failing('verifiable', 'budgets', 'redTeam'), ALL)
    const blocking = Object.fromEntries(steps.map((s) => [s.id, s.blocking]))
    expect(blocking.plan).toEqual(['verifiable', 'budgets'])
    expect(blocking.redTeam).toEqual(['redTeam'])
    expect(blocking.intent).toEqual([])
    expect(blocking.shape).toEqual([])
  })

  // The questions have their own band above every step; hand-off lists all six.
  it('puts open questions on no step', () => {
    const steps = forgeSteps(failing('questions'), ALL)
    expect(steps.every((s) => s.blocking.length === 0)).toBe(true)
  })
})

describe('where an order opens', () => {
  it('opens a draft with no criteria on what is asked, where the plan gets drafted', () => {
    const shown = order()
    expect(openingStep(shown, forgeSteps(failing('coverage', 'redTeam'), ALL))).toBe('intent')
  })

  it('opens a drafted order on the first step that is blocking', () => {
    const shown = order({ acceptance: [CRITERION] })
    expect(openingStep(shown, forgeSteps(failing('redTeam', 'coverage'), ALL))).toBe('plan')
    expect(openingStep(shown, forgeSteps(failing('redTeam'), ALL))).toBe('redTeam')
  })

  it('opens an order with nothing blocking on hand-off', () => {
    const shown = order({ acceptance: [CRITERION] })
    expect(openingStep(shown, forgeSteps(failing(), ALL))).toBe('handOff')
  })

  it('opens an order that was already handed off on hand-off', () => {
    const shown = order({ status: 'agreed' })
    expect(openingStep(shown, forgeSteps(failing('coverage'), ALL))).toBe('handOff')
  })
})
