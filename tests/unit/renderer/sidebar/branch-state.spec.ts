import { describe, it, expect } from 'vitest'
import { aggregateBranchState, countInState } from '../../../../src/renderer/sidebar/branch-state'
import { STATUS_ORDER } from '../../../../src/renderer/sidebar/view-model'
import type { AgentState, TerminalSession } from '../../../../src/shared/types/index'

const base: TerminalSession = {
  id: 's1',
  projectId: 'p1',
  tabTitle: 'Shell',
  status: 'active',
  type: 'agent',
  scrollbackLimit: 10000,
  createdAt: '2026-08-21T00:00:00.000Z',
  lastActivityAt: 0,
  agentState: 'idle',
}

const at = (...states: AgentState[]): TerminalSession[] =>
  states.map((agentState, i) => ({ ...base, id: `s${i}`, agentState }))

describe('aggregateBranchState', () => {
  // BS-1. The one case the severity order cannot answer on its own: folding an
  // empty list would land on the last entry, `exited`, and a branch you have
  // not opened yet is not a finished one.
  it('is idle for a branch with no terminals, never exited', () => {
    expect(aggregateBranchState([])).toBe('idle')
  })

  // BS-2. Waiting outranks everything, whatever else is running alongside it —
  // it is the only state that is blocked on the user.
  it.each([
    [['awaiting-input']],
    [['working', 'awaiting-input']],
    [['idle', 'awaiting-input', 'exited']],
    [['exited', 'working', 'idle', 'awaiting-input']],
  ] as const)('is awaiting-input whenever any terminal is: %j', (states) => {
    expect(aggregateBranchState(at(...(states as unknown as AgentState[])))).toBe('awaiting-input')
  })

  it.each([
    ['working beats idle and exited', ['idle', 'working', 'exited'], 'working'],
    ['idle beats exited', ['exited', 'idle'], 'idle'],
    ['all exited reads exited', ['exited', 'exited'], 'exited'],
    ['a single terminal reads its own state', ['working'], 'working'],
  ] as const)('%s', (_name, states, expected) => {
    expect(aggregateBranchState(at(...(states as unknown as AgentState[])))).toBe(expected)
  })

  // BS-3. The result is never invented — except for the empty case above, it is
  // always a state something on the branch is actually in.
  it('always returns a state one of its terminals is in', () => {
    const states = at('exited', 'idle', 'working')
    expect(states.map((s) => s.agentState)).toContain(aggregateBranchState(states))
  })

  // BS-4. Pure: no clock, no store, same answer every time.
  it('is deterministic', () => {
    const sessions = at('working', 'idle')
    expect(aggregateBranchState(sessions)).toBe(aggregateBranchState(sessions))
  })

  it('does not mutate the list it is given', () => {
    const sessions = at('exited', 'awaiting-input', 'idle')
    const before = sessions.map((s) => s.id)
    aggregateBranchState(sessions)
    expect(sessions.map((s) => s.id)).toEqual(before)
  })

  // The precedence is the sidebar's, the tab bar's and the board's at once, so
  // it must be the one constant, not a second copy that can drift from it.
  it('follows STATUS_ORDER exactly', () => {
    expect(STATUS_ORDER).toEqual(['awaiting-input', 'working', 'idle', 'exited'])
    for (let i = 0; i < STATUS_ORDER.length; i++) {
      const worseThanAllAfter = STATUS_ORDER.slice(i)
      expect(aggregateBranchState(at(...worseThanAllAfter))).toBe(STATUS_ORDER[i])
    }
  })
})

describe('countInState', () => {
  // BS-5. The count a row shows must agree with the glyph beside it, so it
  // counts the aggregate state rather than totalling the terminals.
  it('counts only the terminals in the given state', () => {
    const sessions = at('working', 'working', 'idle', 'exited')
    expect(countInState(sessions, 'working')).toBe(2)
    expect(countInState(sessions, 'idle')).toBe(1)
    expect(countInState(sessions, 'awaiting-input')).toBe(0)
  })

  it('is zero for an empty list', () => {
    expect(countInState([], 'idle')).toBe(0)
  })

  it('never reports zero for a non-empty branch own aggregate state', () => {
    const sessions = at('exited', 'working', 'idle')
    expect(countInState(sessions, aggregateBranchState(sessions))).toBeGreaterThanOrEqual(1)
  })
})
