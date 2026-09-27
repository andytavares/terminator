import { describe, it, expect } from 'vitest'
import { forgeDefectAnswer } from '../../src/gates/act-decision.js'

// "Answer" on a `forge-defect` gate used to call `runs.resume` no matter
// what — but the finding that raised the gate already sent the order back to
// `draft` (`amendOrder`), and `resume` refuses anything that isn't `running`.
// The button did nothing. This is the decision that replaces it: read the
// order first, and only resume when there's a run left to resume.

describe('forgeDefectAnswer', () => {
  it('converges with every open finding when the order was sent back to draft', () => {
    const result = forgeDefectAnswer({
      order: { status: 'draft' },
      fixMessage: '- RT-2 (regression, high) — drops canceled tickets',
      gateRule: 'forge-defect',
    })
    expect(result).toEqual({
      kind: 'converge',
      message: '- RT-2 (regression, high) — drops canceled tickets',
    })
  })

  it('names the gate as why, when there is no fix message to hand the architect', () => {
    const result = forgeDefectAnswer({
      order: { status: 'draft' },
      fixMessage: null,
      gateRule: 'forge-defect',
    })
    expect(result.kind).toBe('converge')
    expect(result.kind === 'converge' && result.message).toContain('forge-defect')
  })

  it('resumes when the order is still running', () => {
    expect(
      forgeDefectAnswer({
        order: { status: 'running' },
        fixMessage: null,
        gateRule: 'forge-defect',
      })
    ).toEqual({ kind: 'resume' })
  })

  it('resumes when the order cannot be found, same as every other gate today', () => {
    expect(forgeDefectAnswer({ order: null, fixMessage: null, gateRule: 'forge-defect' })).toEqual({
      kind: 'resume',
    })
  })
})
