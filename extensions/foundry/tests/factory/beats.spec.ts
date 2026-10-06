import { describe, it, expect } from 'vitest'
import {
  createBeats,
  schedule,
  release,
  MIN_DWELL_MS,
  MAX_LAG_MS,
  STROKE_MS,
} from '../../src/factory/beats.js'
import type { BeatNode } from '../../src/factory/beats.js'
import type { FactoryEvent } from '../../src/factory/events.js'
import type { NodeState } from '../../src/line/run-graph.js'

const nodes: BeatNode[] = [
  { id: 'doc', kind: 'agent', dependsOn: [] },
  { id: 'integrate', kind: 'join', dependsOn: ['doc'] },
  { id: 'ship', kind: 'run', dependsOn: ['integrate'] },
]

function passed(nodeId: string, from: NodeState = 'running'): FactoryEvent {
  return { kind: 'node-state', nodeId, from, to: 'passed' }
}

function drain(
  start: ReturnType<typeof createBeats>,
  fromMs: number,
  toMs: number
): { at: number; event: FactoryEvent }[] {
  const out: { at: number; event: FactoryEvent }[] = []
  let beats = start
  for (let t = fromMs; t <= toMs; t += 10) {
    const r = release(beats, t)
    beats = r.beats
    for (const event of r.events) out.push({ at: t, event })
  }
  return out
}

const settled = (): ReturnType<typeof createBeats> =>
  createBeats({ doc: 'running', integrate: 'waiting', ship: 'waiting' })

describe('beat scheduler', () => {
  it('releases a first event at once and holds a step behind its feeder for the minimum dwell', () => {
    const events: FactoryEvent[] = [
      passed('doc'),
      { kind: 'node-state', nodeId: 'integrate', from: 'waiting', to: 'running' },
    ]
    const beats = schedule(settled(), events, nodes, 1000)
    const now = release(beats, 1000)
    expect(now.events.map((e) => e.kind === 'node-state' && e.nodeId)).toEqual(['doc'])
    expect(release(now.beats, 1000 + MIN_DWELL_MS - 1).events).toEqual([])
    const later = release(now.beats, 1000 + MIN_DWELL_MS)
    expect(later.events).toEqual([events[1]])
    expect(later.beats.shown.integrate).toBe('running')
  })

  it('spaces a chain that passed within 2ms, in order, one dwell apart', () => {
    const events = [passed('doc'), passed('integrate', 'waiting'), passed('ship', 'waiting')]
    const beats = schedule(settled(), events, nodes, 5000)
    const seen = drain(beats, 5000, 5000 + 4 * MIN_DWELL_MS)
      .filter((s) => s.event.kind === 'node-state' && s.event.to === 'passed')
      .map((s) => [(s.event as { nodeId: string }).nodeId, s.at])
    expect(seen.map(([id]) => id)).toEqual(['doc', 'integrate', 'ship'])
    const times = seen.map(([, at]) => at as number)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(MIN_DWELL_MS)
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(MIN_DWELL_MS)
  })

  it('never drops an event: everything scheduled is released eventually', () => {
    const events = [passed('doc'), passed('integrate', 'waiting'), passed('ship', 'waiting')]
    const beats = schedule(settled(), events, nodes, 0)
    const out = drain(beats, 0, 60_000)
    expect(out.map((o) => o.event.kind === 'node-state' && o.event.nodeId)).toContain('ship')
    const end = release(beats, 60_000)
    expect(end.beats.held).toEqual([])
  })

  it('caps lag at 10s: a long chain compresses so the scene catches up', () => {
    const chain: BeatNode[] = Array.from({ length: 8 }, (_, i) => ({
      id: `n${i}`,
      kind: 'agent',
      dependsOn: i === 0 ? [] : [`n${i - 1}`],
    }))
    const events = chain.map((n) => passed(n.id, 'waiting'))
    const beats = schedule(createBeats({}), events, chain, 1000)
    expect(Math.max(...beats.held.map((h) => h.due)) - 1000).toBeLessThanOrEqual(MAX_LAG_MS)
    const out = drain(beats, 1000, 1000 + MAX_LAG_MS)
    expect(out).toHaveLength(8)
    expect(out.map((o) => (o.event as { nodeId: string }).nodeId)).toEqual(chain.map((n) => n.id))
  })

  it('is deterministic: the same events at the same times release the same beats', () => {
    const events = [passed('doc'), passed('integrate', 'waiting'), passed('ship', 'waiting')]
    const run = (): unknown =>
      drain(schedule(settled(), events, nodes, 777), 777, 20_000).map((o) => [o.at, o.event])
    expect(run()).toEqual(run())
  })

  it('lets events with no step to wait on straight through', () => {
    const ci: FactoryEvent = { kind: 'ci-round', round: 1, max: 3 }
    const beats = schedule(settled(), [passed('doc'), passed('integrate', 'waiting'), ci], nodes, 0)
    expect(release(beats, 0).events).toContainEqual(ci)
  })

  it("holds a step's tool calls and handoff behind its own held events", () => {
    const tool: FactoryEvent = {
      kind: 'tool',
      nodeId: 'integrate',
      prop: 'desk',
      callId: 'c1',
      open: true,
      at: 0,
    }
    const beats = schedule(
      settled(),
      [
        passed('doc'),
        { kind: 'node-state', nodeId: 'integrate', from: 'waiting', to: 'running' },
        tool,
      ],
      nodes,
      0
    )
    const first = release(beats, 0)
    expect(first.events).toHaveLength(1)
    expect(release(first.beats, MIN_DWELL_MS).events).toHaveLength(2)
  })

  it('reports a handoff as parked until the step it feeds is shown started', () => {
    const handoff: FactoryEvent = {
      kind: 'handoff',
      fromNodeId: 'doc',
      toNodeId: 'integrate',
      targetStarted: true,
    }
    const beats = schedule(
      settled(),
      [
        passed('doc'),
        { kind: 'node-state', nodeId: 'integrate', from: 'waiting', to: 'running' },
        handoff,
      ],
      nodes,
      0
    )
    const out = release(beats, 0).events.find((e) => e.kind === 'handoff')
    expect(out).toMatchObject({ targetStarted: false })
  })

  it('shows a join that passes unseen running for one stroke first', () => {
    const beats = schedule(settled(), [passed('integrate', 'waiting')], nodes, 0)
    const out = drain(beats, 0, 3000)
    expect(out.map((o) => (o.event as { to: NodeState }).to)).toEqual(['running', 'passed'])
    expect(out[1].at - out[0].at).toBeGreaterThanOrEqual(STROKE_MS)
  })

  it('does not stroke a join that was already seen running, nor a non-join', () => {
    const seen = createBeats({ integrate: 'running' })
    const a = schedule(seen, [passed('integrate')], nodes, 0)
    expect(a.held).toHaveLength(1)
    const b = schedule(settled(), [passed('doc', 'waiting')], nodes, 0)
    expect(b.held).toHaveLength(1)
  })
})
