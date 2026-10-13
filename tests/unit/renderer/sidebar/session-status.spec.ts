import { describe, it, expect } from 'vitest'
import { statusPresentationForState } from '../../../../src/renderer/sidebar/session-status'
import type { AgentState } from '../../../../src/shared/types/index'

const ALL_STATES: AgentState[] = ['working', 'awaiting-input', 'idle', 'exited']

describe('statusPresentationForState — the resting state of a session row', () => {
  it.each<[AgentState, string, string]>([
    ['working', 'play', 'Running'],
    ['idle', 'circle', 'Idle'],
    ['awaiting-input', 'pause', 'Waiting on you'],
    ['exited', 'circle-x', 'Exited'],
  ])('maps %s to the %s glyph labelled "%s"', (state, icon, label) => {
    const p = statusPresentationForState(state)
    expect(p.icon).toBe(icon)
    expect(p.label).toBe(label)
  })

  it('emphasises only the state that is blocked on the user', () => {
    for (const state of ALL_STATES) {
      expect(statusPresentationForState(state).emphasises).toBe(state === 'awaiting-input')
    }
  })
})
