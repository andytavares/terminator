import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSupervisionStore } from '../../../../src/renderer/stores/supervision.store.js'
import type { SupervisedSession } from '../../../../src/shared/types/supervision.js'

function session(over: Partial<SupervisedSession> = {}): SupervisedSession {
  return {
    id: 's1',
    workItemId: null,
    laneOrd: null,
    repoPath: '/repo',
    worktreePath: '/wt/s1',
    branch: 'feat/x',
    transcriptPath: '/tmp/s1.jsonl',
    runtimeState: 'working',
    stateSince: 1_000,
    lastToolActivityAt: 1_000,
    lastNetChangeAt: null,
    openShellCallId: null,
    turns: 0,
    costUsd: 0,
    contextPct: null,
    pendingPermission: null,
    diffSummary: { files: 0, added: 0, removed: 0 },
    autonomyLevel: 'edit',
    lastViewedAt: null,
    failure: null,
    ...over,
  }
}

beforeEach(() => {
  useSupervisionStore.setState({ sessions: [], loaded: false })
})

describe('loading', () => {
  it('pulls sessions from the main process', async () => {
    const listSessions = vi.fn().mockResolvedValue([session()])
    await useSupervisionStore.getState().load({ listSessions })
    expect(useSupervisionStore.getState().sessions).toHaveLength(1)
    expect(useSupervisionStore.getState().loaded).toBe(true)
  })

  it('marks itself loaded even when there are no sessions, so the UI can say so', () => {
    // An empty list and "not asked yet" are different states — the attention
    // surface must be able to assert "everything is fine" rather than imply it.
    return useSupervisionStore
      .getState()
      .load({ listSessions: vi.fn().mockResolvedValue([]) })
      .then(() => {
        expect(useSupervisionStore.getState().loaded).toBe(true)
        expect(useSupervisionStore.getState().sessions).toEqual([])
      })
  })

  it('leaves the previous list intact when the load fails', async () => {
    useSupervisionStore.setState({ sessions: [session()], loaded: true })
    await useSupervisionStore
      .getState()
      .load({ listSessions: vi.fn().mockRejectedValue(new Error('ipc down')) })
    expect(useSupervisionStore.getState().sessions).toHaveLength(1)
  })
})

describe('applying state changes', () => {
  it('updates the runtime state of a known session in place', () => {
    useSupervisionStore.setState({ sessions: [session()], loaded: true })
    useSupervisionStore.getState().applyStateChange({
      sessionId: 's1',
      to: 'needs_input',
      at: 2_000,
    })
    const [updated] = useSupervisionStore.getState().sessions
    expect(updated).toMatchObject({ runtimeState: 'needs_input', stateSince: 2_000 })
  })

  it('ignores a change for a session it does not know rather than inventing one', () => {
    useSupervisionStore.setState({ sessions: [session()], loaded: true })
    useSupervisionStore.getState().applyStateChange({ sessionId: 'ghost', to: 'failed', at: 2_000 })
    expect(useSupervisionStore.getState().sessions).toHaveLength(1)
    expect(useSupervisionStore.getState().sessions[0].runtimeState).toBe('working')
  })

  it('leaves other sessions untouched', () => {
    useSupervisionStore.setState({
      sessions: [session(), session({ id: 's2' })],
      loaded: true,
    })
    useSupervisionStore.getState().applyStateChange({ sessionId: 's1', to: 'ready', at: 2_000 })
    expect(useSupervisionStore.getState().sessions[1].runtimeState).toBe('working')
  })
})

describe('selectors', () => {
  it('counts what the status bar shows', () => {
    useSupervisionStore.setState({
      sessions: [
        session({ id: 'a', runtimeState: 'needs_input', stateSince: 1_000 }),
        session({ id: 'b', runtimeState: 'working' }),
        session({ id: 'c', runtimeState: 'ready' }),
        session({ id: 'd', runtimeState: 'failed' }),
      ],
      loaded: true,
    })
    expect(useSupervisionStore.getState().statusSummary(10_000)).toMatchObject({
      needsInput: 1,
      working: 1,
      awaitingReview: 1,
      failed: 1,
      oldestBlockedMs: 9_000,
    })
  })

  it('ranks what needs attention', () => {
    useSupervisionStore.setState({
      sessions: [
        session({ id: 'ready', runtimeState: 'ready', stateSince: 1_000 }),
        session({ id: 'blocked', runtimeState: 'needs_input', stateSince: 2_000 }),
      ],
      loaded: true,
    })
    expect(
      useSupervisionStore
        .getState()
        .attention(10_000)
        .map((i) => i.sessionId)
    ).toEqual(['blocked', 'ready'])
  })

  it('finds a session by id', () => {
    useSupervisionStore.setState({ sessions: [session()], loaded: true })
    expect(useSupervisionStore.getState().byId('s1')?.branch).toBe('feat/x')
    expect(useSupervisionStore.getState().byId('nope')).toBeNull()
  })
})
