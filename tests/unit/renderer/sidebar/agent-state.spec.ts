import { describe, it, expect } from 'vitest'
import { BellAndBusySource, inferredAskSignal } from '../../../../src/renderer/sidebar/agent-state'
import type { TerminalSession } from '../../../../src/shared/types/index'

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

const derive = (patch: Partial<TerminalSession>) =>
  new BellAndBusySource().derive({ ...base, ...patch })

describe('BellAndBusySource', () => {
  it.each([
    ['exited when the process has closed', { status: 'closed' as const }, 'exited'],
    ['awaiting-input when the bell rang', { bellCount: 1 }, 'awaiting-input'],
    ['working when bytes are flowing', { busy: true }, 'working'],
    ['idle when nothing is happening', {}, 'idle'],
  ])('derives %s', (_label, patch, expected) => {
    expect(derive(patch)).toBe(expected)
  })

  it('prefers exited over every other signal — a dead process needs nothing', () => {
    expect(derive({ status: 'closed', bellCount: 3, busy: true })).toBe('exited')
  })

  it('prefers awaiting-input over working — the safer reading of an ambiguous signal', () => {
    expect(derive({ bellCount: 1, busy: true })).toBe('awaiting-input')
  })

  it('treats a zero bell count as no bell', () => {
    expect(derive({ bellCount: 0 })).toBe('idle')
  })

  it('treats an undefined bell count as no bell', () => {
    expect(derive({ bellCount: undefined })).toBe('idle')
  })

  it('treats backgrounded as a live status, not exited', () => {
    expect(derive({ status: 'backgrounded' })).toBe('idle')
  })

  it('reports working for a backgrounded session that is still producing output', () => {
    expect(derive({ status: 'backgrounded', busy: true })).toBe('working')
  })
})

describe('BellAndBusySource — a visible choice prompt (054)', () => {
  const prompt = {
    question: 'Do you want to create a.txt?',
    options: [{ number: 1, label: 'Yes' }],
  }

  it('reads a session showing a numbered choice as waiting on you, bell or no bell', () => {
    expect(derive({ choicePrompt: prompt })).toBe('awaiting-input')
    expect(derive({ choicePrompt: prompt, busy: true })).toBe('awaiting-input')
  })

  it('still reads a closed session as exited', () => {
    expect(derive({ choicePrompt: prompt, status: 'closed' })).toBe('exited')
  })
})

describe('BellAndBusySource — the agent’s own turn', () => {
  it('reads a hooked agent in a turn that prints nothing as working', () => {
    expect(derive({ agentTurn: true, busy: false })).toBe('working')
  })

  it('reads a hooked agent between turns as idle even while bytes flow', () => {
    expect(derive({ agentTurn: false, busy: true })).toBe('idle')
  })

  it('reads a terminal that never reported a hook by its bytes', () => {
    expect(derive({ busy: true })).toBe('working')
    expect(derive({ busy: false })).toBe('idle')
  })

  it('still reads a reported ask, a bell or a choice as waiting, whatever the turn', () => {
    const ask = { message: 'Allow Bash?', since: '2026-10-18T10:00:00.000Z' }
    expect(derive({ agentTurn: true, agentAsk: ask })).toBe('awaiting-input')
    expect(derive({ agentTurn: true, bellCount: 1 })).toBe('awaiting-input')
    expect(derive({ agentTurn: false, status: 'closed' })).toBe('exited')
  })
})

describe('inferredAskSignal', () => {
  it('names the guess behind an ask, the bell first, and nothing when the agent asked', () => {
    const prompt = { question: 'Create a.txt?', options: [{ number: 1, label: 'Yes' }] }
    expect(inferredAskSignal({ ...base, bellCount: 1, choicePrompt: prompt })).toBe('bell')
    expect(inferredAskSignal({ ...base, choicePrompt: prompt })).toBe('choice')
    expect(inferredAskSignal(base)).toBeNull()
    const agentAsk = { message: 'Allow?', since: '2026-10-18T10:00:00.000Z' }
    expect(inferredAskSignal({ ...base, bellCount: 1, agentAsk })).toBeNull()
  })
})
