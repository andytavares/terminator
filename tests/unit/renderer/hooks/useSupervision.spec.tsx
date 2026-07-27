import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSupervision } from '../../../../src/renderer/hooks/useSupervision.js'
import { useSupervisionStore } from '../../../../src/renderer/stores/supervision.store.js'
import type { SupervisedSession } from '../../../../src/shared/types/supervision.js'

// The hook is the only thing binding the substrate to the surfaces. Every
// callback below is a button somewhere; an untested one is a button that does
// nothing.

function session(over: Partial<SupervisedSession> = {}): SupervisedSession {
  return {
    id: 's1',
    workItemId: null,
    laneOrd: null,
    repoPath: '/repos/fluent',
    worktreePath: '/wt/FLU-220-fluent',
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
    ...over,
  }
}

const REVIEW_DETAIL = {
  item: {
    sessionId: 's1',
    repoPath: '/repos/fluent',
    branch: 'feat/x',
    grade: 'P0' as const,
    gradeTrigger: 'touches auth',
    diffSummary: { files: 1, added: 2, removed: 0 },
    step: 'intent' as const,
    queuedAt: 1_000,
  },
  intent: null,
  hunks: [{ id: 'h1', file: 'src/auth/token.ts', newStart: 1, lines: ['+x'] }],
}

function makeBridge(over: Record<string, unknown> = {}) {
  return {
    listSessions: vi.fn().mockResolvedValue([session()]),
    onStateChanged: vi.fn().mockReturnValue(vi.fn()),
    onWorkItemsChanged: vi.fn().mockReturnValue(vi.fn()),
    resolvePermission: vi.fn().mockResolvedValue(undefined),
    setShadowMode: vi.fn().mockResolvedValue(undefined),
    judgeFiring: vi.fn().mockResolvedValue(undefined),
    openInEditor: vi.fn().mockResolvedValue(undefined),
    listFeed: vi
      .fn()
      .mockResolvedValue([
        { id: 'f1', at: 1_000, sessionId: 's1', author: 'agent' as const, summary: 'did a thing' },
      ]),
    listFirings: vi.fn().mockResolvedValue({
      firings: [],
      precision: { total: 0, judged: 0, incorrect: 0, incorrectRate: null },
    }),
    listReview: vi.fn().mockResolvedValue([REVIEW_DETAIL.item]),
    listUnattendedMerges: vi.fn().mockResolvedValue([]),
    entityIndex: vi
      .fn()
      .mockResolvedValue([{ id: 'remote', kind: 'session' as const, label: 'remote' }]),
    listWorkItems: vi.fn().mockResolvedValue({
      items: [{ item: { id: 'FLU-220', title: 'Unify session identity' }, phase: 'implement' }],
      unreadable: [],
      conflicts: [],
      canAct: true,
    }),
    replyToSession: vi.fn().mockResolvedValue(undefined),
    getReviewDetail: vi.fn().mockResolvedValue(REVIEW_DETAIL),
    decideHunk: vi.fn().mockResolvedValue(undefined),
    advanceReview: vi.fn().mockResolvedValue(undefined),
    getLanes: vi.fn().mockResolvedValue({
      lanes: [],
      mergedOrds: [1],
      staleOrds: [2],
      blockedReasons: { 3: 'lane 1 has not merged' },
    }),
    mergeLane: vi.fn().mockResolvedValue(undefined),
    getProvisioning: vi
      .fn()
      .mockResolvedValue({ worktreePath: '/wt/x', ports: null, setup: null, skipped: [] }),
    getSinceLastLooked: vi.fn().mockResolvedValue({
      lastViewedAt: 500,
      entries: [],
      stateChanges: [{ to: 'needs_input', at: 900 }],
      diffDelta: { files: 2, added: 30, removed: 4 },
    }),
    producerAction: vi.fn().mockResolvedValue({ ok: true, reason: null }),
    assign: vi.fn().mockResolvedValue({ ok: true, sessionId: 's9', worktreePath: '/wt/s9' }),
    intake: vi.fn().mockResolvedValue({ ok: true, id: 'FLU-221' }),
    getDigest: vi
      .fn()
      .mockResolvedValue({ from: 0, to: 1, entryCount: 4, sessionCount: 2, bySession: [] }),
    precheckBackpressure: vi
      .fn()
      .mockResolvedValue({ allowed: false, unreviewed: 4, limit: 3, reason: '4 unreviewed' }),
    ...over,
  }
}

let bridge: ReturnType<typeof makeBridge>

function install(over: Record<string, unknown> = {}): void {
  bridge = makeBridge(over)
  ;(globalThis as { electronAPI?: unknown }).electronAPI = { supervision: bridge }
}

beforeEach(() => {
  useSupervisionStore.setState({ sessions: [], loaded: false })
  install()
})

afterEach(() => {
  delete (globalThis as { electronAPI?: unknown }).electronAPI
  vi.useRealTimers()
})

describe('loading through the bridge', () => {
  it('loads every surface on mount, so nothing renders empty by default', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(bridge.listSessions).toHaveBeenCalled()
    expect(bridge.listFeed).toHaveBeenCalled()
    expect(bridge.listReview).toHaveBeenCalled()
    expect(bridge.listWorkItems).toHaveBeenCalled()
    expect(bridge.listFirings).toHaveBeenCalled()
    expect(bridge.listUnattendedMerges).toHaveBeenCalled()
  })

  it('subscribes to pushed state changes rather than relying on the poll (SC-001)', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(bridge.onStateChanged).toHaveBeenCalled()

    const handler = bridge.onStateChanged.mock.calls[0][0] as () => void
    bridge.listSessions.mockClear()
    act(() => handler())
    await waitFor(() => expect(bridge.listSessions).toHaveBeenCalled())
  })

  it('unsubscribes and clears its timers on unmount', async () => {
    const unsubscribe = vi.fn()
    install({ onStateChanged: vi.fn().mockReturnValue(unsubscribe) })
    const { result, unmount } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('does nothing at all when there is no bridge, rather than throwing', () => {
    delete (globalThis as { electronAPI?: unknown }).electronAPI
    const { result } = renderHook(() => useSupervision())
    expect(result.current.loaded).toBe(false)
    expect(result.current.screenProps.feed).toEqual([])
  })

  it('shows the refusal only while it would actually refuse a start (FR-053)', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.screenProps.backpressure).not.toBeNull())
    expect(result.current.screenProps.backpressure).toMatchObject({ unreviewed: 4 })
  })

  it('hides the refusal when the queue is under the limit', async () => {
    install({
      precheckBackpressure: vi.fn().mockResolvedValue({ allowed: true, unreviewed: 1, limit: 3 }),
    })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.screenProps.backpressure).toBeNull()
  })
})

describe('permission decisions', () => {
  it('approves through the bridge', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onApprove('s1', 'r1'))
    expect(bridge.resolvePermission).toHaveBeenCalledWith({
      sessionId: 's1',
      requestId: 'r1',
      decision: 'allow',
    })
  })

  it('denies through the bridge', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onDeny('s1', 'r1'))
    expect(bridge.resolvePermission).toHaveBeenCalledWith({
      sessionId: 's1',
      requestId: 'r1',
      decision: 'deny',
    })
  })
})

describe('opening a session', () => {
  it('pulls the review, provisioning and since-you-last-looked detail', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onOpenSession('s1'))
    await waitFor(() => expect(result.current.screenProps.activeReview).not.toBeNull())
    expect(bridge.getProvisioning).toHaveBeenCalledWith({ sessionId: 's1' })
    expect(result.current.screenProps.lastViewedAt).toBe(500)
  })

  it('tells the shell, so it can focus the session tab', async () => {
    // Passed in rather than broadcast on a window event: a listener that does
    // not exist should be a compile error, not silence.
    const onOpenSessionInShell = vi.fn()
    const { result } = renderHook(() => useSupervision({ onOpenSessionInShell }))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onOpenSession('s1'))
    expect(onOpenSessionInShell).toHaveBeenCalledWith('s1')
  })
})

describe('per-hunk decisions (FR-052)', () => {
  it('records the decision locally and sends it to the main process', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onOpenSession('s1'))
    await waitFor(() => expect(result.current.screenProps.activeReview).not.toBeNull())

    act(() => result.current.screenProps.onDecideHunk('h1', 'accept'))
    expect(result.current.screenProps.decisionFor('h1')).toBe('accept')
    expect(bridge.decideHunk).toHaveBeenCalledWith({
      sessionId: 's1',
      hunkId: 'h1',
      decision: 'accept',
    })
  })

  it('reports no decision for a hunk nobody judged', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.screenProps.decisionFor('nope')).toBeNull()
  })

  it('does not send a decision when no session is open', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onDecideHunk('h1', 'reject'))
    expect(bridge.decideHunk).not.toHaveBeenCalled()
    expect(result.current.screenProps.decisionFor('h1')).toBe('reject')
  })
})

describe('advancing the review flow', () => {
  it('advances and re-reads the detail, so the step actually moves', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onOpenSession('s1'))
    await waitFor(() => expect(result.current.screenProps.activeReview).not.toBeNull())

    bridge.getReviewDetail.mockClear()
    act(() => result.current.screenProps.onAdvanceReview())
    await waitFor(() => expect(bridge.getReviewDetail).toHaveBeenCalled())
    expect(bridge.advanceReview).toHaveBeenCalledWith({ sessionId: 's1' })
  })

  it('does nothing when no session is open', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onAdvanceReview())
    expect(bridge.advanceReview).not.toHaveBeenCalled()
  })
})

describe('lanes', () => {
  it('loads a work item lanes when one is opened', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onOpenWorkItem('FLU-220'))
    await waitFor(() => expect(result.current.screenProps.staleOrds).toEqual([2]))
    expect(result.current.screenProps.mergedOrds).toEqual([1])
    expect(result.current.screenProps.blockedReasons).toEqual({ 3: 'lane 1 has not merged' })
  })

  it('merges a lane and re-reads the lane state', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onOpenWorkItem('FLU-220'))
    await waitFor(() => expect(bridge.getLanes).toHaveBeenCalled())

    bridge.getLanes.mockClear()
    act(() => result.current.screenProps.onMergeLane(1))
    await waitFor(() => expect(bridge.getLanes).toHaveBeenCalled())
    expect(bridge.mergeLane).toHaveBeenCalledWith({ workItemId: 'FLU-220', ord: 1 })
  })

  it('does not merge when no work item is open', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onMergeLane(1))
    expect(bridge.mergeLane).not.toHaveBeenCalled()
  })
})

describe('the feed', () => {
  it('replies to a session through the bridge', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onReply('s1', 'what is wrong?'))
    expect(bridge.replyToSession).toHaveBeenCalledWith({
      sessionId: 's1',
      message: 'what is wrong?',
    })
  })

  it('mutes and unmutes a session', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onToggleMute('s1'))
    expect(result.current.screenProps.mutedSessions).toEqual(['s1'])
    act(() => result.current.screenProps.onToggleMute('s1'))
    expect(result.current.screenProps.mutedSessions).toEqual([])
  })
})

describe('stall controls', () => {
  it('defaults shadow mode on, so a new install never acts on an unproven stall', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.screenProps.shadowMode).toBe(true)
  })

  it('turns shadow mode off through the bridge', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onSetShadowMode(false))
    expect(result.current.screenProps.shadowMode).toBe(false)
    expect(bridge.setShadowMode).toHaveBeenCalledWith({ value: false })
  })

  it('records a judgement on a firing', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onJudge('f1', 'incorrect'))
    expect(bridge.judgeFiring).toHaveBeenCalledWith({ firingId: 'f1', judgement: 'incorrect' })
  })
})

describe('the entity index', () => {
  it('prefers the index the main process built', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.screenProps.entities).toHaveLength(1))
    expect(result.current.screenProps.entities[0].id).toBe('remote')
  })

  it('falls back to a local derivation before the first call returns', async () => {
    install({ entityIndex: undefined })
    useSupervisionStore.setState({ sessions: [session()], loaded: true })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const kinds = result.current.screenProps.entities.map((entity) => entity.kind)
    expect(kinds).toContain('session')
    expect(kinds).toContain('worktree')
    expect(kinds).toContain('repository')
    expect(kinds).toContain('command')
  })

  it('includes work items in the local derivation', async () => {
    install({ entityIndex: undefined })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() =>
      expect(result.current.screenProps.entities.some((e) => e.kind === 'workItem')).toBe(true)
    )
  })

  it('opens the session it was given, rather than announcing and doing nothing', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onChooseEntity({ id: 's1', kind: 'session', label: 'x' }))
    await waitFor(() => expect(bridge.getReviewDetail).toHaveBeenCalledWith({ sessionId: 's1' }))
  })

  it('opens the lanes of a chosen work item', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() =>
      result.current.screenProps.onChooseEntity({ id: 'FLU-220', kind: 'workItem', label: 'x' })
    )
    await waitFor(() => expect(bridge.getLanes).toHaveBeenCalledWith({ workItemId: 'FLU-220' }))
  })

  it('toggles shadow mode from the palette', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() =>
      result.current.screenProps.onChooseEntity({
        id: 'toggle-shadow',
        kind: 'command',
        label: 'Toggle stall shadow mode',
      })
    )
    expect(bridge.setShadowMode).toHaveBeenCalledWith({ value: false })
  })

  it('opens the session that owns a chosen worktree', async () => {
    useSupervisionStore.setState({ sessions: [session()], loaded: true })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() =>
      result.current.screenProps.onChooseEntity({
        id: '/wt/FLU-220-fluent',
        kind: 'worktree',
        label: 'x',
      })
    )
    await waitFor(() => expect(bridge.getReviewDetail).toHaveBeenCalledWith({ sessionId: 's1' }))
  })

  it('tells the shell after navigating', async () => {
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useSupervision({ onNavigate }))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const entity = { id: 's1', kind: 'session' as const, label: 'x' }
    act(() => result.current.screenProps.onChooseEntity(entity))
    expect(onNavigate).toHaveBeenCalledWith(entity)
  })
})

describe('assignment controls', () => {
  it('dismisses the refusal on override (FR-054)', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.screenProps.backpressure).not.toBeNull())
    act(() => result.current.screenProps.onOverrideBackpressure())
    expect(result.current.screenProps.backpressure).toBeNull()
  })

  it('dismisses the refusal on cancel', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.screenProps.backpressure).not.toBeNull())
    act(() => result.current.screenProps.onCancelAssign())
    expect(result.current.screenProps.backpressure).toBeNull()
  })

  it('changes the autonomy level chosen at assign time (FR-041)', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.screenProps.autonomy).toBe('edit')
    act(() => result.current.screenProps.onAutonomyChange('ship'))
    expect(result.current.screenProps.autonomy).toBe('ship')
  })

  it('hands the worktree off to the editor for the open session', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onOpenSession('s1'))
    act(() => result.current.screenProps.onOpenInEditor())
    expect(bridge.openInEditor).toHaveBeenCalledWith({ sessionId: 's1' })
  })

  it('does not hand off when no session is open', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onOpenInEditor())
    expect(bridge.openInEditor).not.toHaveBeenCalled()
  })
})

describe('the attention panel', () => {
  it('toggles open and closed', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.attentionOpen).toBe(false)
    act(() => result.current.toggleAttention())
    expect(result.current.attentionOpen).toBe(true)
    act(() => result.current.toggleAttention())
    expect(result.current.attentionOpen).toBe(false)
  })

  it('exposes the ranked queue and the summary the status bar renders', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(Array.isArray(result.current.attention)).toBe(true)
    expect(result.current.summary).toHaveProperty('working')
  })
})

describe('a bridge that implements only listSessions', () => {
  // Every other method is optional on the bridge; a partial one must not throw.
  function minimal(): void {
    ;(globalThis as { electronAPI?: unknown }).electronAPI = {
      supervision: { listSessions: vi.fn().mockResolvedValue([session()]) },
    }
  }

  it('still loads', async () => {
    minimal()
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
  })

  it('survives every callback being invoked', async () => {
    minimal()
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => {
      const props = result.current.screenProps
      props.onApprove('s1', 'r1')
      props.onDeny('s1', 'r1')
      props.onOpenSession('s1')
      props.onOpenWorkItem('FLU-220')
      props.onReply('s1', 'hi')
      props.onSetShadowMode(false)
      props.onJudge('f1', 'correct')
    })
    act(() => {
      const props = result.current.screenProps
      props.onDecideHunk('h1', 'accept')
      props.onAdvanceReview()
      props.onMergeLane(1)
      props.onOpenInEditor()
    })
    expect(result.current.loaded).toBe(true)
  })
})

// FR-083/FR-084 end to end from the surface: without these the gate can never
// be satisfied, and a session bound to a work item could never start.

describe('acting on a work item gate', () => {
  it('approves a gate through the producer', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onApproveGate('FLU-220', 'spec_approved_by_human')
    })
    expect(bridge.producerAction).toHaveBeenCalledWith({
      workItemId: 'FLU-220',
      action: 'approveGate',
      args: ['FLU-220', 'spec_approved_by_human'],
    })
  })

  it('rejects a gate with the notes attached', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onRejectGate('FLU-220', 'plan_approved_by_human', 'too broad')
    })
    expect(bridge.producerAction).toHaveBeenCalledWith({
      workItemId: 'FLU-220',
      action: 'rejectGate',
      args: ['FLU-220', 'plan_approved_by_human', 'too broad'],
    })
  })

  it('sends work back to a phase with the notes', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onSendBack('FLU-220', 'specify', 'missing acceptance criteria')
    })
    expect(bridge.producerAction).toHaveBeenCalledWith({
      workItemId: 'FLU-220',
      action: 'sendBack',
      args: ['FLU-220', 'specify', 'missing acceptance criteria'],
    })
  })

  it('advances the phase', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onAdvancePhase('FLU-220')
    })
    expect(bridge.producerAction).toHaveBeenCalledWith({
      workItemId: 'FLU-220',
      action: 'advancePhase',
      args: ['FLU-220'],
    })
  })

  it('re-reads the board once the action lands, so the gate chip updates', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    bridge.listWorkItems.mockClear()
    await act(async () => {
      result.current.screenProps.onApproveGate('FLU-220', 'spec_approved_by_human')
    })
    await waitFor(() => expect(bridge.listWorkItems).toHaveBeenCalled())
  })

  it('reports a producer that refused, rather than swallowing it (FR-078)', async () => {
    install({
      producerAction: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'speckit-pilot does not provide sending work back',
      }),
    })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onSendBack('FLU-220', 'specify', 'notes')
    })
    await waitFor(() =>
      expect(result.current.screenProps.actionError).toBe(
        'speckit-pilot does not provide sending work back'
      )
    )
  })

  it('says so when no producer is wired at all', async () => {
    install({ producerAction: undefined })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onApproveGate('FLU-220', 'spec_approved_by_human')
    })
    expect(result.current.screenProps.actionError).toMatch(/No producer is registered/)
  })

  it('dismisses the error', async () => {
    install({ producerAction: undefined })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onApproveGate('FLU-220', 'x')
    })
    act(() => result.current.screenProps.onDismissActionError())
    expect(result.current.screenProps.actionError).toBeNull()
  })
})

describe('the progress digest (FR-028)', () => {
  it('loads on mount, so deferred progress is somewhere to read', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.screenProps.digest).not.toBeNull())
    expect(result.current.screenProps.digest?.entryCount).toBe(4)
  })

  it('asks for the window it advertises', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(bridge.getDigest).toHaveBeenCalledWith({
      windowMs: result.current.screenProps.digestWindowMinutes * 60_000,
    })
  })

  it('refreshes on request', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    bridge.getDigest.mockClear()
    act(() => result.current.screenProps.onRefreshDigest())
    await waitFor(() => expect(bridge.getDigest).toHaveBeenCalled())
  })

  it('leaves the digest empty on a console that provides none', async () => {
    install({ getDigest: undefined })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onRefreshDigest())
    expect(result.current.screenProps.digest).toBeNull()
  })
})

// FR-071: the board must reflect a producer's write without the operator
// refreshing anything. The watcher exists to say so; polling is the backstop.

describe('a producer writing a work item', () => {
  it('re-reads the board when the watcher fires', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(bridge.onWorkItemsChanged).toHaveBeenCalled()

    const handler = bridge.onWorkItemsChanged.mock.calls[0][0] as () => void
    bridge.listWorkItems.mockClear()
    act(() => handler())
    await waitFor(() => expect(bridge.listWorkItems).toHaveBeenCalled())
  })

  it('unsubscribes from the watcher on unmount', async () => {
    const off = vi.fn()
    install({ onWorkItemsChanged: vi.fn().mockReturnValue(off) })
    const { result, unmount } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    unmount()
    expect(off).toHaveBeenCalled()
  })
})

// The front door. Everything else in the console supervises what this creates;
// before it existed the substrate had nothing to watch.

describe('starting an agent', () => {
  it('assigns with the autonomy level chosen at assign time (FR-041)', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onAutonomyChange('build'))
    await act(async () => {
      result.current.screenProps.onAssign({ repoPath: '/repos/fluent', branch: 'feat/x' })
    })
    expect(bridge.assign).toHaveBeenCalledWith({
      repoPath: '/repos/fluent',
      branch: 'feat/x',
      autonomyLevel: 'build',
    })
  })

  it('reports where the session started', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onAssign({ repoPath: '/r', branch: 'b' })
    })
    await waitFor(() =>
      expect(result.current.screenProps.assignResult).toMatchObject({ worktreePath: '/wt/s9' })
    )
  })

  it('surfaces a refusal by the review queue as the refusal dialog (FR-053)', async () => {
    install({
      assign: vi.fn().mockResolvedValue({
        ok: false,
        reason: '4 unreviewed',
        backpressure: { allowed: false, unreviewed: 4, limit: 3, reason: '4 unreviewed' },
      }),
    })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onAssign({ repoPath: '/r', branch: 'b' })
    })
    await waitFor(() =>
      expect(result.current.screenProps.backpressure).toMatchObject({ unreviewed: 4 })
    )
  })

  it('reports a refusal that is not backpressure, rather than failing silently', async () => {
    install({
      assign: vi.fn().mockResolvedValue({ ok: false, reason: 'setup exited 1' }),
    })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onAssign({ repoPath: '/r', branch: 'b' })
    })
    await waitFor(() =>
      expect(result.current.screenProps.assignResult).toMatchObject({ reason: 'setup exited 1' })
    )
  })

  it('says so on a build that cannot start agents at all', async () => {
    install({ assign: undefined })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onAssign({ repoPath: '/r', branch: 'b' }))
    expect(result.current.screenProps.assignResult).toMatchObject({ ok: false })
  })

  it('is not busy once the attempt settles', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onAssign({ repoPath: '/r', branch: 'b' })
    })
    await waitFor(() => expect(result.current.screenProps.assigning).toBe(false))
  })
})

describe('bringing in a ticket (FR-068)', () => {
  it('takes a ticket url', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onIntake({ url: 'https://linear.app/x' })
    })
    expect(bridge.intake).toHaveBeenCalledWith({ url: 'https://linear.app/x' })
    await waitFor(() => expect(result.current.screenProps.intakeResult?.id).toBe('FLU-221'))
  })

  it('re-reads the board so the queued item appears without a refresh', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    bridge.listWorkItems.mockClear()
    await act(async () => {
      result.current.screenProps.onIntake({ filePath: '/specs/idea.md' })
    })
    await waitFor(() => expect(bridge.listWorkItems).toHaveBeenCalled())
  })

  it('reports a refusal rather than swallowing it', async () => {
    install({ intake: vi.fn().mockResolvedValue({ ok: false, reason: 'not a recognised URL' }) })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      result.current.screenProps.onIntake({ url: 'nonsense' })
    })
    await waitFor(() =>
      expect(result.current.screenProps.intakeResult).toMatchObject({ ok: false })
    )
  })

  it('says so on a build that cannot take tickets in', async () => {
    install({ intake: undefined })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onIntake({ url: 'x' }))
    expect(result.current.screenProps.intakeResult).toMatchObject({ ok: false })
  })
})

describe('which lane an assignment binds to', () => {
  it('binds to the first lane nothing has merged and nothing is blocking (FR-088)', async () => {
    install({
      getLanes: vi.fn().mockResolvedValue({
        lanes: [
          { lane: { ord: 1 }, collisions: [], blockedBy: [] },
          { lane: { ord: 2 }, collisions: [], blockedBy: [1] },
        ],
        mergedOrds: [],
        staleOrds: [],
        blockedReasons: { 2: 'lane 1 must merge first' },
      }),
    })
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onOpenWorkItem('FLU-220'))
    await waitFor(() => expect(result.current.screenProps.selectedLaneOrd).toBe(1))
    expect(result.current.screenProps.selectedWorkItemId).toBe('FLU-220')
  })

  it('binds to nothing when no work item is open', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.screenProps.selectedWorkItemId).toBeNull()
    expect(result.current.screenProps.selectedLaneOrd).toBeNull()
  })
})

describe('what changed since you last looked (FR-036)', () => {
  it('carries the state changes and the diff delta, not just the feed', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.screenProps.onOpenSession('s1'))
    await waitFor(() => expect(result.current.screenProps.sinceStateChanges).toHaveLength(1))
    expect(result.current.screenProps.sinceDiffDelta).toMatchObject({ files: 2, added: 30 })
  })

  it('starts empty before a session is opened', async () => {
    const { result } = renderHook(() => useSupervision())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.screenProps.sinceStateChanges).toEqual([])
    expect(result.current.screenProps.sinceDiffDelta).toBeNull()
  })
})
