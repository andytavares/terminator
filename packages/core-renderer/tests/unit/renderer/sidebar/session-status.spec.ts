import { describe, it, expect } from 'vitest'
import { statusPresentationForState } from '../../../../src/sidebar/session-status'
import type { AgentState } from '../../../../../core-shared/src/types/index'

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

  it.each<[AgentState, boolean]>([
    ['awaiting-input', true],
    ['working', false],
    ['idle', false],
    ['exited', false],
  ])('emphasises %s: %s, as only the state blocked on the user stands out', (state, emphasises) => {
    expect(statusPresentationForState(state).emphasises).toBe(emphasises)
  })
})
