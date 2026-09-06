import { describe, it, expect } from 'vitest'
import { laneViews, mayMergeLane } from '../../src/runtime/lane-coordination.js'
import type { CardLanes } from '../../src/runtime/lane-coordination.js'

function lane(over: Record<string, unknown> = {}) {
  return {
    ord: 1,
    repo: 'fluent',
    role: 'producer' as const,
    branch: 'feat/x',
    task_ids: [],
    blocks: [],
    blocked_by: [],
    ...over,
  }
}

function item(over: Partial<CardLanes> = {}): CardLanes {
  return {
    contract_version: 1,
    id: 'FLU-220',
    source: 'local',
    title: 'Unify session identity',
    created_at: '2026-07-27T09:04:11Z',
    phase: 'implement',
    artifacts: {},
    gates: {},
    lanes: [lane()],
    ...over,
  } as CardLanes
}

const threeLanes = item({
  contract: { summary: 'ULID', shared_files: ['proto/session.proto'] },
  lanes: [
    lane({ ord: 1, repo: 'fluent', role: 'producer', blocks: [2, 3] }),
    lane({ ord: 2, repo: 'cli-flow', role: 'consumer', blocked_by: [1] }),
    lane({ ord: 3, repo: 'forge', role: 'consumer', blocked_by: [1] }),
  ],
} as Partial<CardLanes>)

describe('lane views (FR-086, FR-087)', () => {
  it('returns lanes in merge order', () => {
    const shuffled = item({
      lanes: [lane({ ord: 3 }), lane({ ord: 1 }), lane({ ord: 2 })],
    } as Partial<CardLanes>)
    expect(laneViews(shuffled).map((v) => v.lane.ord)).toEqual([1, 2, 3])
  })

  it('flags the shared file on EVERY lane that touches it, not just the producer', () => {
    const views = laneViews(threeLanes)
    for (const view of views) expect(view.collisions).toEqual(['proto/session.proto'])
  })

  it('reports the lanes each one is blocked by', () => {
    expect(laneViews(threeLanes)[1].blockedBy).toEqual([1])
  })

  it('flags nothing for a single-lane item (FR-089)', () => {
    const views = laneViews(item())
    expect(views).toHaveLength(1)
    expect(views[0].collisions).toEqual([])
  })

  it('flags nothing when the item declares no shared files', () => {
    const noShared = item({
      lanes: [lane({ ord: 1, blocks: [2] }), lane({ ord: 2, blocked_by: [1] })],
    } as Partial<CardLanes>)
    expect(laneViews(noShared).every((v) => v.collisions.length === 0)).toBe(true)
  })
})

describe('merge ordering (FR-088, SC-006)', () => {
  it('allows the upstream lane to merge first', () => {
    expect(mayMergeLane(threeLanes, 1, [])).toMatchObject({ allowed: true })
  })

  it('refuses a downstream lane while its blocker is unmerged, and names the blocker', () => {
    const decision = mayMergeLane(threeLanes, 2, [])
    expect(decision.allowed).toBe(false)
    expect(decision.blockingLane).toBe(1)
    expect(decision.reason).toContain('fluent')
    expect(decision.reason).toContain('proto/session.proto')
  })

  it('allows the downstream lane once its blocker has merged', () => {
    expect(mayMergeLane(threeLanes, 2, [1])).toMatchObject({ allowed: true })
  })

  it('refuses every downstream lane, not just the first', () => {
    expect(mayMergeLane(threeLanes, 3, [])).toMatchObject({ allowed: false, blockingLane: 1 })
  })

  it('treats ordering as advisory when no shared file is involved', () => {
    // Two lanes touching nothing in common can land in any order.
    const noShared = item({
      lanes: [lane({ ord: 1, blocks: [2] }), lane({ ord: 2, blocked_by: [1] })],
    } as Partial<CardLanes>)
    expect(mayMergeLane(noShared, 2, [])).toMatchObject({ allowed: true })
  })

  it('reports an unknown lane rather than allowing it', () => {
    expect(mayMergeLane(threeLanes, 99, [])).toMatchObject({ allowed: false })
  })

  it('always allows a single-lane item to merge (FR-089)', () => {
    expect(mayMergeLane(item(), 1, [])).toMatchObject({ allowed: true })
  })
})
