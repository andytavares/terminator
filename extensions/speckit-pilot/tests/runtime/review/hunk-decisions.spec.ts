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
  it('starts with nothing decided', () => {
    const set = createDecisionSet([hunk('h1'), hunk('h2')])
    expect(set.isComplete()).toBe(false)
    expect(set.acceptedHunks()).toEqual([])
  })

  it('records an acceptance', () => {
    const set = createDecisionSet([hunk('h1')])
    set.decide('h1', 'accept')
    expect(set.decisionFor('h1')).toBe('accept')
    expect(set.acceptedHunks().map((h) => h.id)).toEqual(['h1'])
  })

  it('records a rejection', () => {
    const set = createDecisionSet([hunk('h1')])
    set.decide('h1', 'reject')
    expect(set.decisionFor('h1')).toBe('reject')
    expect(set.acceptedHunks()).toEqual([])
  })

  it('lets a decision be changed before the review is finished', () => {
    const set = createDecisionSet([hunk('h1')])
    set.decide('h1', 'accept')
    set.decide('h1', 'reject')
    expect(set.decisionFor('h1')).toBe('reject')
  })

  it('ignores a decision about a hunk it does not have', () => {
    const set = createDecisionSet([hunk('h1')])
    expect(() => set.decide('never-seen', 'accept')).not.toThrow()
    expect(set.decisionFor('never-seen')).toBeNull()
  })

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

  it('groups decisions by file, which is how a review is read', () => {
    const set = createDecisionSet([hunk('h1', 'src/a.ts'), hunk('h2', 'src/b.ts')])
    set.decide('h1', 'accept')
    set.decide('h2', 'reject')
    expect(set.byFile()).toEqual([
      { file: 'src/a.ts', accepted: ['h1'], rejected: [] },
      { file: 'src/b.ts', accepted: [], rejected: ['h2'] },
    ])
  })

  it('has nothing to complete when there were no hunks at all', () => {
    const set = createDecisionSet([])
    expect(set.isComplete()).toBe(true)
    expect(set.isFullReject()).toBe(false)
  })
})
