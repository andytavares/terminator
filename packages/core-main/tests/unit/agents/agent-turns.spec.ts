import { describe, it, expect, beforeEach } from 'vitest'
import { clearTurn, currentTurns, setTurn } from '../../../src/agents/agent-turns'

beforeEach(() => {
  for (const { sessionId } of currentTurns()) clearTurn(sessionId)
})

describe('currentTurns', () => {
  it('remembers when a turn ended, for a window that opens or reloads afterwards', () => {
    setTurn('s1', true, 100)
    setTurn('s1', false, 900)
    expect(currentTurns()).toEqual([{ sessionId: 's1', inTurn: false, endedAt: 900 }])
  })

  it('reports no end for a session mid-turn or one that never started a turn', () => {
    setTurn('s1', true, 100)
    setTurn('s2', false, 200)
    expect(currentTurns()).toEqual([
      { sessionId: 's1', inTurn: true, endedAt: null },
      { sessionId: 's2', inTurn: false, endedAt: null },
    ])
  })
})
