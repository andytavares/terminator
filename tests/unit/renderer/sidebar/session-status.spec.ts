import { describe, it, expect } from 'vitest'
import { statusPresentationFor } from '../../../../src/renderer/sidebar/session-status'
import type { AgentState, TerminalSession } from '../../../../src/shared/types/index'

const ALL_STATES: AgentState[] = ['working', 'awaiting-input', 'idle', 'exited']

function session(agentState: AgentState): TerminalSession {
  return {
    id: 's1',
    projectId: 'p1',
    tabTitle: 'tests',
    status: 'active',
    type: 'agent',
    scrollbackLimit: 10000,
    createdAt: '2026-08-27T00:00:00.000Z',
    lastActivityAt: 0,
    agentState,
  }
}

describe('statusPresentationFor — the resting state of a session row', () => {
  it.each<[AgentState, string, string]>([
    ['working', 'play', 'Running'],
    ['idle', 'circle', 'Idle'],
    ['awaiting-input', 'pause', 'Waiting on you'],
    ['exited', 'circle-x', 'Exited'],
  ])('maps %s to the %s glyph labelled "%s"', (state, icon, label) => {
    const p = statusPresentationFor(session(state))
    expect(p.icon).toBe(icon)
    expect(p.label).toBe(label)
  })

  it('emphasises only the state that is blocked on the user', () => {
    for (const state of ALL_STATES) {
      expect(statusPresentationFor(session(state)).emphasises).toBe(state === 'awaiting-input')
    }
  })

  it('does not mutate the session it is given', () => {
    const s = session('idle')
    const snapshot = JSON.stringify(s)
    statusPresentationFor(s)
    expect(JSON.stringify(s)).toBe(snapshot)
  })

  it('reads nothing but agentState — selection is the row surface, never the glyph', () => {
    // Two sessions differing in every field except state must present identically.
    const a = { ...session('idle'), id: 'a', tabTitle: 'one', lastActivityAt: 0 }
    const b = { ...session('idle'), id: 'b', tabTitle: 'two', lastActivityAt: 999_999 }
    expect(statusPresentationFor(a)).toEqual(statusPresentationFor(b))
  })
})
