import { describe, it, expect } from 'vitest'
import { BellAndBusySource } from '../../../../src/renderer/sidebar/agent-state'
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
