import { describe, it, expect } from 'vitest'
import { composeAgentPrompt } from '../../../../src/main/supervision/workitems/compose-agent-prompt.js'
import { buildEntityIndex } from '../../../../src/main/supervision/query/entity-index.js'
import {
  evaluateStall,
  DEFAULT_THRESHOLDS,
} from '../../../../src/main/supervision/stall/evaluate-stall.js'
import { createLaneBindings } from '../../../../src/main/supervision/workitems/lane-bindings.js'
import type { WorkItemContract } from '../../../../src/main/supervision/workitems/contract-schema.js'
import type { SupervisedSession } from '../../../../src/shared/types/supervision.js'

function item(over: Partial<WorkItemContract> = {}): WorkItemContract {
  return {
    contract_version: 1,
    id: 'FLU-220',
    source: 'local',
    title: 'Unify session identity',
    created_at: '2026-07-27T09:04:11Z',
    phase: 'implement',
    artifacts: { spec: 'specs/012/spec.md', plan: 'specs/012/plan.md' },
    gates: {},
    lanes: [
      {
        ord: 1,
        repo: 'fluent',
        role: 'producer',
        branch: 'feat/x',
        task_ids: ['T001', 'T002'],
        blocks: [2],
        blocked_by: [],
      },
      {
        ord: 2,
        repo: 'forge',
        role: 'consumer',
        branch: 'feat/x',
        task_ids: ['T009'],
        blocks: [],
        blocked_by: [1],
      },
    ],
    ...over,
  } as WorkItemContract
}

describe('agent prompt composition (FR-039)', () => {
  it('gives the agent its lane tasks and the artefact paths', () => {
    const prompt = composeAgentPrompt({ item: item(), laneOrd: 1 })
    expect(prompt).toContain('T001, T002')
    expect(prompt).toContain('specs/012/spec.md')
    expect(prompt).toContain('specs/012/plan.md')
  })

  it('gives each lane only its own tasks', () => {
    expect(composeAgentPrompt({ item: item(), laneOrd: 2 })).toContain('T009')
    expect(composeAgentPrompt({ item: item(), laneOrd: 2 })).not.toContain('T001')
  })

  it('names the repository the lane belongs to', () => {
    expect(composeAgentPrompt({ item: item(), laneOrd: 2 })).toContain('forge')
  })

  it('names shared contract files, because changing one ripples across lanes', () => {
    const withShared = item({
      contract: { summary: 'SessionId = ULID', shared_files: ['proto/session.proto'] },
    } as Partial<WorkItemContract>)
    const prompt = composeAgentPrompt({ item: withShared, laneOrd: 1 })
    expect(prompt).toContain('proto/session.proto')
    expect(prompt).toContain('SessionId = ULID')
  })

  it('tells a consumer lane not to change the shared contract itself', () => {
    const withShared = item({
      contract: { shared_files: ['proto/session.proto'] },
    } as Partial<WorkItemContract>)
    expect(composeAgentPrompt({ item: withShared, laneOrd: 2 })).toContain(
      'do not change the shared contract'
    )
  })

  it('degrades to the bare instruction for ad-hoc work (FR-081)', () => {
    expect(composeAgentPrompt({ item: null, laneOrd: null, instruction: 'fix the flake' })).toBe(
      'fix the flake'
    )
  })

  it('degrades cleanly when the lane is not in the work item', () => {
    expect(composeAgentPrompt({ item: item(), laneOrd: 99, instruction: 'x' })).toBe('x')
  })

  it('appends an extra steer alongside a work item', () => {
    const prompt = composeAgentPrompt({ item: item(), laneOrd: 1, instruction: 'start with tests' })
    expect(prompt).toContain('T001')
    expect(prompt).toContain('start with tests')
  })
})

function session(over: Partial<SupervisedSession> = {}): SupervisedSession {
  return {
    id: 's1',
    workItemId: null,
    laneOrd: null,
    repoPath: '/repos/fluent',
    worktreePath: '/wt/FLU-220-fluent',
    branch: 'feat/session-ulid',
    transcriptPath: '/tmp/s1.jsonl',
    runtimeState: 'working',
    stateSince: 0,
    lastToolActivityAt: 0,
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

describe('entity index (FR-026)', () => {
  const index = buildEntityIndex({
    sessions: [session()],
    workItems: [item()],
    commands: [{ id: 'toggle-shadow', label: 'Toggle shadow mode' }],
  })

  it('covers all five entity kinds in one list', () => {
    expect(new Set(index.map((e) => e.kind))).toEqual(
      new Set(['session', 'worktree', 'repository', 'workItem', 'command'])
    )
  })

  it('indexes a worktree in its own right, since opening one is a real action', () => {
    expect(index.find((e) => e.kind === 'worktree')?.label).toBe('FLU-220-fluent')
  })

  it('indexes a work item by id with its title as detail', () => {
    expect(index.find((e) => e.kind === 'workItem')).toMatchObject({
      label: 'FLU-220',
      detail: 'Unify session identity',
    })
  })

  it('deduplicates repositories seen through several sources', () => {
    const repos = index.filter((e) => e.kind === 'repository')
    expect(new Set(repos.map((r) => r.id)).size).toBe(repos.length)
  })

  it('is empty for an empty console', () => {
    expect(buildEntityIndex({ sessions: [], workItems: [], commands: [] })).toEqual([])
  })
})

describe('compaction gap is not a stall (spec Edge Cases)', () => {
  it('does not fire while the agent is inside a long command, however long the gap', () => {
    // Context compaction shows up as a gap in observed activity. The exemption
    // covers the case that matters — an agent working inside one long call —
    // and terminal states cannot stall at all.
    const facts = {
      sessionId: 's1',
      runtimeState: 'working' as const,
      lastToolActivityAt: 0,
      lastNetChangeAt: 0,
      openShellStartedAt: 0,
      recentToolPaths: [],
      recentNetChange: 1,
      recentReverts: 0,
    }
    expect(evaluateStall(facts, DEFAULT_THRESHOLDS, 60 * 60_000)).toBeNull()
  })

  it('does not fire for a session that has already finished', () => {
    const facts = {
      sessionId: 's1',
      runtimeState: 'ready' as const,
      lastToolActivityAt: 0,
      lastNetChangeAt: 0,
      openShellStartedAt: null,
      recentToolPaths: [],
      recentNetChange: 1,
      recentReverts: 0,
    }
    expect(evaluateStall(facts, DEFAULT_THRESHOLDS, 60 * 60_000)).toBeNull()
  })
})

describe('a lane bound twice (spec Edge Cases)', () => {
  it('replaces rather than accumulating, so a lane never has two live sessions', () => {
    const store = (() => {
      let value: unknown
      return { get: () => value, set: (v: unknown) => (value = v) }
    })()
    const bindings = createLaneBindings(store)
    bindings.bind('FLU-220', 1, 'first', 1_000)
    bindings.bind('FLU-220', 1, 'second', 2_000)
    expect(bindings.forWorkItem('FLU-220')).toHaveLength(1)
    expect(bindings.forLane('FLU-220', 1)?.sessionId).toBe('second')
    // The replaced session is no longer reachable through the lane it held.
    expect(bindings.forSession('first')).toBeNull()
  })
})

describe('the entity index has one row per identity', () => {
  const session = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    workItemId: null,
    laneOrd: null,
    repoPath: '/repos/fluent',
    worktreePath: '/wt/shared',
    branch: 'feat/x',
    transcriptPath: null,
    runtimeState: 'working' as const,
    stateSince: 1,
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
    failure: null,
    ...over,
  })

  it('lists a shared worktree once, not once per session', () => {
    const index = buildEntityIndex({
      sessions: [session(), session({ id: 's2' }), session({ id: 's3' })],
      workItems: [],
      commands: [],
    })
    expect(index.filter((e) => e.kind === 'worktree')).toHaveLength(1)
  })

  it('lists a repository backing several sessions once', () => {
    const index = buildEntityIndex({
      sessions: [session(), session({ id: 's2', worktreePath: '/wt/other' })],
      workItems: [],
      commands: [],
    })
    expect(index.filter((e) => e.kind === 'repository')).toHaveLength(1)
  })

  it('still lists each distinct session', () => {
    const index = buildEntityIndex({
      sessions: [session(), session({ id: 's2' })],
      workItems: [],
      commands: [],
    })
    expect(index.filter((e) => e.kind === 'session')).toHaveLength(2)
  })
})
