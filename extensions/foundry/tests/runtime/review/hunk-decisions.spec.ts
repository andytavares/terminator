import { describe, it, expect } from 'vitest'
import { createDecisionSet, type Hunk } from '../../../src/runtime/review/hunk-decisions.js'

// The unit of decision is the hunk, not the file: one file routinely holds both
// the change you asked for and the one you did not.

const hunk = (id: string, file = 'src/a.ts'): Hunk => ({
  id,
  file,
  newStart: 1,
  lines: [' const a = 1', '+const b = 2'],
})

describe('deciding hunk by hunk', () => {
  it('is complete only when every hunk has been decided', () => {
    const set = createDecisionSet([hunk('h1'), hunk('h2')])
    set.decide('h1', 'accept')
    expect(set.isComplete()).toBe(false)
    set.decide('h2', 'reject')
    expect(set.isComplete()).toBe(true)
  })

  it('notices when everything was rejected — the branch keeps nothing', () => {
    const set = createDecisionSet([hunk('h1'), hunk('h2')])
    set.decide('h1', 'reject')
    set.decide('h2', 'reject')
    expect(set.isFullReject()).toBe(true)
  })

  it('is not a full rejection while anything was kept', () => {
    const set = createDecisionSet([hunk('h1'), hunk('h2')])
    set.decide('h1', 'accept')
    set.decide('h2', 'reject')
    expect(set.isFullReject()).toBe(false)
  })

  it('has nothing to complete when there were no hunks at all', () => {
    const set = createDecisionSet([])
    expect(set.isComplete()).toBe(true)
    expect(set.isFullReject()).toBe(false)
  })
})
