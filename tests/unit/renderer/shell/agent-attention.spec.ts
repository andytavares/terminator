import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { trackStateChanges, SETTLE_MS } from '../../../../src/renderer/shell/agent-attention'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import type { TerminalSession } from '../../../../src/shared/types/index'

const terminalSession = (patch: Partial<TerminalSession> = {}): TerminalSession => ({
  id: 's1',
  projectId: 'p1',
  tabTitle: 'claude',
  status: 'active',
  type: 'agent',
  scrollbackLimit: 1000,
  createdAt: '2026-10-18T09:00:00.000Z',
  lastActivityAt: 0,
  agentState: 'idle',
  ...patch,
})

function putSessionState(patch: Partial<TerminalSession>): void {
  useSessionStore.setState({ sessions: new Map([['s1', terminalSession(patch)]]) })
}

let sent: Array<{ sessionId: string; state: string }>
let stop: () => void

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  useSessionStore.setState({ sessions: new Map() })
  putSessionState({})
  stop = trackStateChanges((r) => sent.push({ sessionId: r.sessionId, state: r.state }))
})
afterEach(() => {
  stop()
  vi.useRealTimers()
})

describe('trackStateChanges', () => {
  it('reports a state once it has held for the settle time', () => {
    putSessionState({ busy: true })
    vi.advanceTimersByTime(SETTLE_MS - 1)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(sent).toEqual([{ sessionId: 's1', state: 'working' }])
  })

  it('reports one per transition, not one per flicker', () => {
    vi.advanceTimersByTime(SETTLE_MS)
    sent = []
    putSessionState({ busy: true })
    putSessionState({ busy: false })
    putSessionState({ busy: true })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(sent).toEqual([{ sessionId: 's1', state: 'working' }])
  })
})

describe('trackStateChanges — asks and exits', () => {
  it('reports an agent ask as awaiting-input', () => {
    putSessionState({ busy: true })
    vi.advanceTimersByTime(SETTLE_MS)
    putSessionState({ busy: true, agentAsk: { message: 'Allow?', since: 'x' } })
    vi.advanceTimersByTime(SETTLE_MS)
    expect(sent.map((r) => r.state)).toEqual(['working', 'awaiting-input'])
  })

  it('reports exited at once when the session leaves the store', () => {
    vi.advanceTimersByTime(SETTLE_MS)
    sent = []
    useSessionStore.setState({ sessions: new Map() })
    expect(sent).toEqual([{ sessionId: 's1', state: 'exited' }])
  })
})
