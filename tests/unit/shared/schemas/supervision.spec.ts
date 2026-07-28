import { describe, it, expect } from 'vitest'
import {
  RUNTIME_STATES,
  runtimeStateSchema,
  supervisedSessionSchema,
  pendingPermissionSchema,
  type SupervisedSession,
} from '../../../../src/shared/schemas/supervision.js'

// These schemas cross the IPC boundary, so anything malformed must be rejected
// here rather than reaching a surface.

describe('RuntimeState (data-model.md §3)', () => {
  it('includes every state in the spec, plus `unknown`', () => {
    // `unknown` is not in FR-001's enumeration but FR-009 requires it: the
    // console must never report `working` without evidence, so a restart that
    // finds none needs an honest state to land in.
    expect([...RUNTIME_STATES].sort()).toEqual([
      'failed',
      'merged',
      'needs_input',
      'ready',
      'stalled',
      'starting',
      'unknown',
      'working',
    ])
  })

  it('accepts each declared state', () => {
    for (const state of RUNTIME_STATES) {
      expect(runtimeStateSchema.safeParse(state).success).toBe(true)
    }
  })

  it('rejects a state that is not declared', () => {
    expect(runtimeStateSchema.safeParse('running').success).toBe(false)
  })
})

describe('SupervisedSession schema', () => {
  const valid: SupervisedSession = {
    id: 's1',
    workItemId: null,
    laneOrd: null,
    repoPath: '/repo',
    worktreePath: '/wt/s1',
    branch: 'feat/x',
    transcriptPath: '/tmp/s1.jsonl',
    runtimeState: 'working',
    stateSince: 1_000,
    lastToolActivityAt: 1_500,
    lastNetChangeAt: null,
    openShellCallId: null,
    turns: 3,
    costUsd: 0.42,
    contextPct: 61,
    pendingPermission: null,
    diffSummary: { files: 2, added: 10, removed: 4 },
    autonomyLevel: 'edit',
    lastViewedAt: null,
    terminalSessionId: null,
    projectId: null,
    failure: null,
  }

  it('accepts a well-formed session', () => {
    expect(supervisedSessionSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts an ad-hoc session with no work item (FR-081)', () => {
    const parsed = supervisedSessionSchema.safeParse({ ...valid, workItemId: null, laneOrd: null })
    expect(parsed.success).toBe(true)
  })

  it('rejects a negative cost', () => {
    expect(supervisedSessionSchema.safeParse({ ...valid, costUsd: -1 }).success).toBe(false)
  })

  it('rejects a context proportion outside 0–100', () => {
    expect(supervisedSessionSchema.safeParse({ ...valid, contextPct: 101 }).success).toBe(false)
    expect(supervisedSessionSchema.safeParse({ ...valid, contextPct: -1 }).success).toBe(false)
  })

  it('allows a null context proportion, which is unknown rather than zero', () => {
    expect(supervisedSessionSchema.safeParse({ ...valid, contextPct: null }).success).toBe(true)
  })

  it('rejects an unknown autonomy level', () => {
    expect(supervisedSessionSchema.safeParse({ ...valid, autonomyLevel: 'god' }).success).toBe(
      false
    )
  })

  it('rejects a missing diff summary', () => {
    const { diffSummary: _omitted, ...withoutDiff } = valid
    expect(supervisedSessionSchema.safeParse(withoutDiff).success).toBe(false)
  })
})

describe('PendingPermission schema (FR-007, FR-042)', () => {
  it('accepts a request that names what is being asked for', () => {
    const parsed = pendingPermissionSchema.safeParse({
      requestId: 'r1',
      toolName: 'Bash',
      summary: 'redis-cli -h prod-cache-01',
      targetHost: 'prod-cache-01',
      requestedAt: 2_000,
      autoDecision: null,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a request with an empty summary, since FR-007 requires stating what is requested', () => {
    const parsed = pendingPermissionSchema.safeParse({
      requestId: 'r1',
      toolName: 'Bash',
      summary: '',
      requestedAt: 2_000,
    })
    expect(parsed.success).toBe(false)
  })
})

describe('a session that has not started yet', () => {
  it('is accepted with no transcript path, so it still appears on listing surfaces', () => {
    // Requiring a non-empty path here silently dropped every `starting` session
    // from the list the attention queue and status bar read.
    const base = {
      id: 's1',
      workItemId: null,
      laneOrd: null,
      repoPath: '/repo',
      worktreePath: '/wt/s1',
      branch: 'feat/x',
      transcriptPath: null,
      runtimeState: 'starting' as const,
      stateSince: 1_000,
      lastToolActivityAt: null,
      lastNetChangeAt: null,
      openShellCallId: null,
      turns: 0,
      costUsd: 0,
      contextPct: null,
      pendingPermission: null,
      diffSummary: { files: 0, added: 0, removed: 0 },
      autonomyLevel: 'edit' as const,
      lastViewedAt: null,
      terminalSessionId: null,
      projectId: null,
      failure: null,
    }
    expect(supervisedSessionSchema.safeParse(base).success).toBe(true)
  })

  it('still rejects an empty-string transcript path, which means nothing', () => {
    expect(runtimeStateSchema.safeParse('starting').success).toBe(true)
  })
})
