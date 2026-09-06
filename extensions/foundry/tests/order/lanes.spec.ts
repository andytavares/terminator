import { describe, it, expect } from 'vitest'
import {
  sharedFilesFor,
  collidingLanes,
  planLanes,
  laneViews,
  mayMergeLane,
} from '../../src/order/lanes.js'
import { compileOrder, agreeOrder } from '../../src/order/compile.js'
import { draftOrder } from '../../src/order/schema.js'
import type { PlanUnit, WorkOrder } from '../../src/order/schema.js'

// Lanes come from the agreed order, not from a file an agent wrote.
//
// The whole point of deriving the collisions rather than reading a declared
// list is that a declaration about collisions is exactly the kind of claim
// that is quietly wrong — and the cost of it being wrong is a merge conflict
// discovered at merge time.

function unit(over: Partial<PlanUnit> = {}): PlanUnit {
  return {
    id: 'U-1',
    title: 'x',
    role: 'builder',
    lane: 1,
    dependsOn: [],
    satisfies: ['AC-1'],
    touches: [],
    verify: [],
    ...over,
  }
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'ULID session identity',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/proto', '/repos/cli'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    intent: { problem: 'p', outcome: 'o', nonGoals: [] },
    risk: { grade: 'P2', triggers: [], blastRadius: ['proto/', 'src/'], criticalPaths: [] },
    acceptance: [
      {
        id: 'AC-1',
        statement: 'a session id is a ULID',
        priority: 'P1',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    plan: {
      ...base.plan,
      lanes: [
        { ord: 1, repo: 'proto', branch: '', role: null, blocks: [], blockedBy: [] },
        { ord: 2, repo: 'cli', branch: '', role: null, blocks: [], blockedBy: [] },
      ],
      units: [
        unit({ id: 'U-1', lane: 1, touches: ['proto/session.proto'] }),
        unit({ id: 'U-2', lane: 2, touches: ['proto/session.proto', 'src/client.ts'] }),
      ],
      sharedFiles: [],
    },
    ...over,
  }
}

/** The same order with lane 1 declared the owner of the shared change. */
function withProducer(base: WorkOrder = order()): WorkOrder {
  return {
    ...base,
    plan: {
      ...base.plan,
      lanes: base.plan.lanes.map((lane) => (lane.ord === 1 ? { ...lane, role: 'producer' } : lane)),
    },
  }
}

/** One repository, one lane. Nothing below should apply to it. */
function single(): WorkOrder {
  const base = order()
  return {
    ...base,
    plan: {
      ...base.plan,
      lanes: [{ ord: 1, repo: 'app', branch: '', role: null, blocks: [], blockedBy: [] }],
      units: [unit({ id: 'U-1', lane: 1, touches: ['src/a.ts', 'src/b.ts'] })],
    },
  }
}

describe('detecting a collision', () => {
  it('finds the file two lanes both change', () => {
    expect(sharedFilesFor(order())).toEqual(['proto/session.proto'])
  })

  it('does not call a file shared because two units in one lane touch it', () => {
    const oneLane = order({
      plan: {
        ...order().plan,
        units: [
          unit({ id: 'U-1', lane: 1, touches: ['src/a.ts'] }),
          unit({ id: 'U-2', lane: 1, touches: ['src/a.ts'] }),
        ],
      },
    })
    expect(sharedFilesFor(oneLane)).toEqual([])
  })

  it('finds nothing for a single-lane order, however many files it touches', () => {
    expect(sharedFilesFor(single())).toEqual([])
  })

  it('finds nothing when two lanes touch nothing in common', () => {
    const apart = order({
      plan: {
        ...order().plan,
        units: [
          unit({ id: 'U-1', lane: 1, touches: ['proto/a.proto'] }),
          unit({ id: 'U-2', lane: 2, touches: ['src/b.ts'] }),
        ],
      },
    })
    expect(sharedFilesFor(apart)).toEqual([])
  })

  it('names every lane party to a collision', () => {
    expect(collidingLanes(order(), ['proto/session.proto'])).toEqual([1, 2])
  })

  it('is derived from the plan, not from what the order declared', () => {
    // A lying declaration is ignored, which is the point of deriving it.
    const lying = order({ plan: { ...order().plan, sharedFiles: ['nothing/real.ts'] } })
    expect(sharedFilesFor(lying)).toEqual(['proto/session.proto'])
  })
})

describe('compiling an order with a collision', () => {
  it('refuses one where nobody owns the shared change', () => {
    const result = compileOrder(order())
    expect(result.ok).toBe(false)
    expect(result.failures.map((f) => f.check)).toContain('coverage')
  })

  it('names the file and the lanes, so the operator can act on it', () => {
    const detail = compileOrder(order()).failures.find((f) => f.check === 'coverage')?.detail ?? ''
    expect(detail).toContain('proto/session.proto')
    expect(detail).toContain('proto')
    expect(detail).toContain('cli')
  })

  it('names the units that touch it', () => {
    const failure = compileOrder(order()).failures.find((f) => f.check === 'coverage')
    expect(failure?.subjectIds).toEqual(['U-1', 'U-2'])
  })

  it('passes once one lane is declared the producer', () => {
    expect(compileOrder(withProducer()).ok).toBe(true)
  })

  it('refuses two producers of the same shared change', () => {
    const two = withProducer()
    const both: WorkOrder = {
      ...two,
      plan: {
        ...two.plan,
        lanes: two.plan.lanes.map((lane) => ({ ...lane, role: 'producer' as const })),
      },
    }
    expect(compileOrder(both).failures.some((f) => f.detail.includes('2 lanes'))).toBe(true)
  })

  it('never asks a single-lane order about producers (FR-068)', () => {
    expect(compileOrder(single()).ok).toBe(true)
  })

  it('does not hide a real coverage gap behind the lane question', () => {
    const gap = order({ acceptance: [...order().acceptance], plan: { ...order().plan, units: [] } })
    const detail = compileOrder(gap).failures.find((f) => f.check === 'coverage')?.detail ?? ''
    expect(detail).toContain('AC-1')
  })
})

describe('writing the merge order down at agreement', () => {
  it('records the derived collisions on the agreed order', () => {
    const agreed = agreeOrder(withProducer(), '2026-09-06T12:00:00.000Z')
    expect(agreed.ok && agreed.order.plan.sharedFiles).toEqual(['proto/session.proto'])
  })

  it('holds every consumer behind the producer', () => {
    const agreed = agreeOrder(withProducer(), '2026-09-06T12:00:00.000Z')
    if (!agreed.ok) throw new Error('expected the order to agree')
    expect(agreed.order.plan.lanes[0]).toMatchObject({ role: 'producer', blocks: [2] })
    expect(agreed.order.plan.lanes[1]).toMatchObject({ role: 'consumer', blockedBy: [1] })
  })

  it('leaves a single-lane order with nothing to wait for', () => {
    const agreed = agreeOrder(single(), '2026-09-06T12:00:00.000Z')
    if (!agreed.ok) throw new Error('expected the order to agree')
    expect(agreed.order.plan.lanes[0]).toMatchObject({ blocks: [], blockedBy: [] })
    expect(agreed.order.plan.sharedFiles).toEqual([])
  })

  it('clears a stale hold left over from an earlier plan', () => {
    const stale = single()
    const withStale: WorkOrder = {
      ...stale,
      plan: {
        ...stale.plan,
        lanes: [{ ...stale.plan.lanes[0], blockedBy: [9], blocks: [9] }],
      },
    }
    expect(planLanes(withStale).plan.lanes[0]).toMatchObject({ blocks: [], blockedBy: [] })
  })

  it('leaves lanes alone when nobody owns the collision', () => {
    // Compile refuses this anyway; planLanes must not invent an ordering.
    expect(planLanes(order()).plan.lanes.every((lane) => lane.blockedBy.length === 0)).toBe(true)
  })
})

describe('what a surface shows', () => {
  const planned = planLanes(withProducer())

  it('puts the lanes in merge order', () => {
    const shuffled: WorkOrder = {
      ...planned,
      plan: { ...planned.plan, lanes: [...planned.plan.lanes].reverse() },
    }
    expect(laneViews(shuffled).map((v) => v.lane.ord)).toEqual([1, 2])
  })

  it('flags the shared file on every lane that touches it, not just the producer', () => {
    expect(laneViews(planned).length).toBeGreaterThan(1)
    for (const view of laneViews(planned)) {
      expect(view.collisions).toEqual(['proto/session.proto'])
    }
  })

  it('reports which lanes each one waits on', () => {
    expect(laneViews(planned)[1].blockedBy).toEqual([1])
  })

  it('flags nothing at all for a single-lane order', () => {
    const views = laneViews(planLanes(single()))
    expect(views).toHaveLength(1)
    expect(views[0].collisions).toEqual([])
    expect(views[0].blockedBy).toEqual([])
  })
})

describe('holding a merge (FR-067)', () => {
  const planned = planLanes(withProducer())

  it('lets the producer merge whenever it is ready', () => {
    expect(mayMergeLane(planned, 1, [])).toMatchObject({ allowed: true })
  })

  it('holds the consumer until the producer has merged', () => {
    const decision = mayMergeLane(planned, 2, [])
    expect(decision.allowed).toBe(false)
    expect(decision.blockingLane).toBe(1)
    expect(decision.reason).toContain('proto/session.proto')
  })

  it('releases the consumer once the producer has', () => {
    expect(mayMergeLane(planned, 2, [1])).toMatchObject({ allowed: true })
  })

  it('holds nothing when the lanes share nothing', () => {
    const apart: WorkOrder = { ...planned, plan: { ...planned.plan, sharedFiles: [] } }
    expect(mayMergeLane(apart, 2, [])).toMatchObject({ allowed: true })
  })

  it('refuses a lane this order does not have, rather than allowing it', () => {
    expect(mayMergeLane(planned, 99, [])).toMatchObject({ allowed: false, blockingLane: null })
  })

  it('costs a single-lane order nothing (FR-068)', () => {
    expect(mayMergeLane(planLanes(single()), 1, [])).toMatchObject({ allowed: true })
  })
})

describe('a change somebody can see needs a picture of it (FR-040)', () => {
  function uiOrder(over: Partial<WorkOrder> = {}): WorkOrder {
    const base = order()
    return {
      ...base,
      plan: {
        ...base.plan,
        lanes: [{ ord: 1, repo: 'proto', branch: '', role: null, blocks: [], blockedBy: [] }],
        units: [unit({ id: 'U-1', lane: 1, touches: ['src/components/Inbox.tsx'] })],
        sharedFiles: [],
      },
      risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
      ...over,
    }
  }

  it('refuses one whose criteria are all commands', () => {
    const result = compileOrder(uiOrder())
    expect(result.ok).toBe(false)
    expect(result.failures.find((f) => f.check === 'verifiable')?.detail).toMatch(
      /picture of the running application/
    )
  })

  it('accepts a screenshot criterion', () => {
    const withPicture = uiOrder({
      acceptance: [
        {
          id: 'AC-1',
          statement: 'the row renders',
          priority: 'P1',
          verify: { kind: 'screenshot', target: 'the inbox' },
          unverifiable: null,
        },
      ],
    })
    expect(compileOrder(withPicture).ok).toBe(true)
  })

  it('accepts a judge that names a screenshot as its evidence', () => {
    const judged = uiOrder({
      acceptance: [
        {
          id: 'AC-1',
          statement: 'the row reads at a glance',
          priority: 'P1',
          verify: { kind: 'judge', rubric: 'is it legible', evidence: ['screenshot'] },
          unverifiable: null,
        },
      ],
    })
    expect(compileOrder(judged).ok).toBe(true)
  })

  it('takes the same escape every criterion has, in writing', () => {
    const accepted = uiOrder({
      acceptance: [
        {
          id: 'AC-1',
          statement: 'it looks right',
          priority: 'P1',
          verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
          unverifiable: { accepted: true, reason: 'no display in this environment' },
        },
      ],
    })
    expect(compileOrder(accepted).ok).toBe(true)
  })

  it('asks nothing of a change nobody looks at', () => {
    const backend = uiOrder({
      plan: {
        ...uiOrder().plan,
        units: [unit({ id: 'U-1', lane: 1, touches: ['src/main/auth.ts'] })],
      },
    })
    expect(compileOrder(backend).ok).toBe(true)
  })

  it('names the units that change what is seen', () => {
    const failure = compileOrder(uiOrder()).failures.find((f) => f.check === 'verifiable')
    expect(failure?.subjectIds).toEqual(['U-1'])
  })
})
