import { describe, it, expect } from 'vitest'
import {
  rankAttention,
  summariseStatus,
} from '../../../../src/shared/supervision/rank-attention.js'
import type { SupervisedSession } from '../../../../src/shared/types/supervision.js'

// The PRD's strongest structural observation: the Attention Queue, the Standup
// Feed and the palette are three renderings of one question — what needs me,
// ranked. Built once, as a pure function.

function session(over: Partial<SupervisedSession> = {}): SupervisedSession {
  return {
    id: 's1',
    workItemId: null,
    laneOrd: null,
    repoPath: '/repo-a',
    worktreePath: '/wt/s1',
    branch: 'feat/x',
    transcriptPath: '/tmp/s1.jsonl',
    runtimeState: 'working',
    stateSince: 1_000,
    lastToolActivityAt: 1_000,
    lastNetChangeAt: null,
    openShellCallId: null,
    turns: 1,
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

const blocked = session({
  id: 'blocked',
  runtimeState: 'needs_input',
  stateSince: 5_000,
  pendingPermission: {
    requestId: 'r1',
    toolName: 'Bash',
    summary: 'redis-cli -h prod-cache-01',
    requestedAt: 5_000,
  },
})
const stalled = session({ id: 'stalled', runtimeState: 'stalled', stateSince: 4_000 })
const failed = session({ id: 'failed', runtimeState: 'failed', stateSince: 3_000 })
const ready = session({ id: 'ready', runtimeState: 'ready', stateSince: 2_000 })
const working = session({ id: 'working', runtimeState: 'working' })

describe('ranking (FR-022)', () => {
  it('orders blocking requests, then stalls, then failures, then work awaiting review', () => {
    const ranked = rankAttention([ready, working, failed, stalled, blocked], 10_000)
    expect(ranked.map((i) => i.sessionId)).toEqual(['blocked', 'stalled', 'failed', 'ready'])
  })

  it('excludes sessions that need nothing', () => {
    expect(rankAttention([working], 10_000)).toEqual([])
  })

  it('does not group by repository — a blocked session in one repo outranks a stall in another', () => {
    const otherRepo = session({ ...stalled, id: 'stalled-b', repoPath: '/repo-b' })
    const ranked = rankAttention([otherRepo, blocked], 10_000)
    expect(ranked.map((i) => i.sessionId)).toEqual(['blocked', 'stalled-b'])
  })

  it('breaks ties by age, oldest first — the one waiting longest needs you most', () => {
    const older = session({ id: 'older', runtimeState: 'stalled', stateSince: 1_000 })
    const newer = session({ id: 'newer', runtimeState: 'stalled', stateSince: 8_000 })
    expect(rankAttention([newer, older], 10_000).map((i) => i.sessionId)).toEqual([
      'older',
      'newer',
    ])
  })

  it('reports how long each item has been waiting', () => {
    expect(rankAttention([stalled], 10_000)[0].waitingMs).toBe(6_000)
  })

  it('carries the permission request, so it can be answered without opening the session (FR-023)', () => {
    expect(rankAttention([blocked], 10_000)[0].pendingPermission?.summary).toContain('redis-cli')
  })

  it('states why each item needs attention', () => {
    const reasons = rankAttention([blocked, stalled, failed, ready], 10_000).map((i) => i.reason)
    expect(reasons).toEqual(['needs_input', 'stalled', 'failed', 'ready'])
  })

  it('treats an unknown session as needing attention — silence about it would be a lie', () => {
    const unknown = session({ id: 'unknown', runtimeState: 'unknown', stateSince: 100 })
    expect(rankAttention([unknown], 10_000).map((i) => i.sessionId)).toEqual(['unknown'])
  })

  it('returns an empty list for no sessions at all', () => {
    expect(rankAttention([], 10_000)).toEqual([])
  })

  it('does not mutate its input', () => {
    const input = [ready, blocked]
    const snapshot = JSON.parse(JSON.stringify(input))
    rankAttention(input, 10_000)
    expect(input).toEqual(snapshot)
  })
})

describe('status summary (FR-025)', () => {
  it('counts each state the status bar shows', () => {
    expect(summariseStatus([blocked, stalled, failed, ready, working], 10_000)).toMatchObject({
      needsInput: 1,
      working: 1,
      awaitingReview: 1,
      failed: 1,
    })
  })

  it('reports the age of the oldest blocked session', () => {
    const olderBlocked = session({ ...blocked, id: 'b2', stateSince: 1_000 })
    expect(summariseStatus([blocked, olderBlocked], 10_000).oldestBlockedMs).toBe(9_000)
  })

  it('reports null rather than zero when nothing is blocked', () => {
    expect(summariseStatus([working], 10_000).oldestBlockedMs).toBeNull()
  })

  it('counts a stalled session as blocked for the oldest-blocked figure', () => {
    // Stalled is blocked on the operator too, it just did not ask.
    expect(summariseStatus([stalled], 10_000).oldestBlockedMs).toBe(6_000)
  })

  it('is all zeros for no sessions', () => {
    expect(summariseStatus([], 10_000)).toEqual({
      needsInput: 0,
      working: 0,
      awaitingReview: 0,
      failed: 0,
      oldestBlockedMs: null,
    })
  })
})

describe('shared view types', () => {
  it('declares the four review steps in the order the flow runs them', async () => {
    const { REVIEW_STEPS } = await import('../../../../src/shared/supervision/view-types.js')
    // Intent first is the point — it is the step every diff viewer skips.
    expect([...REVIEW_STEPS]).toEqual(['intent', 'risk', 'structure', 'tests'])
  })
})

describe('the failure reason travels with the item (FR-034)', () => {
  it('carries the setup output onto the queue', () => {
    const failed = session({
      runtimeState: 'failed',
      failure: { step: 'setup', exitCode: 3, output: 'lockfile is out of date' },
    })
    const [item] = rankAttention([failed], 10_000)
    expect(item.failure).toMatchObject({ step: 'setup', exitCode: 3 })
  })

  it('is null for a session that did not fail', () => {
    const [item] = rankAttention([session({ runtimeState: 'needs_input' })], 10_000)
    expect(item.failure).toBeNull()
  })
})
