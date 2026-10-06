import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { readTimeline } from '../../src/factory/timeline-store.js'
import { observationAt, replayClock, momentsOf } from '../../src/factory/replay.js'
import type { Timeline } from '../../src/factory/replay.js'
import type { Gate } from '../../src/gates/rules.js'
import type { RunGraph, RunNode } from '../../src/line/run-graph.js'
import type { ToolActivity } from '../../src/runtime/transcript-tailer.js'

const REAL_TIMELINE = '/Users/atavares/repos/orders/WO-1006-6b5/run-timeline.jsonl'

function node(id: string, over: Partial<RunNode> = {}): RunNode {
  return {
    id,
    stepId: id,
    kind: 'agent',
    state: 'waiting',
    unitIds: [],
    lane: null,
    role: 'builder',
    dependsOn: [],
    attempts: 0,
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    ...over,
  }
}

const base: RunGraph = {
  orderId: 'WO-1',
  recipe: 'standard',
  nodes: [
    node('a'),
    node('b', { dependsOn: ['a'] }),
    node('g', { kind: 'gate', dependsOn: ['b'] }),
  ],
}

function tool(
  at: number,
  sessionId: string,
  callId: string,
  kind: ToolActivity['kind'] = 'tool_started'
) {
  return {
    at,
    sessionId,
    activity: { kind, toolName: 'Read', callId, isShell: false, path: null, at } as ToolActivity,
  }
}

const timeline: Timeline = {
  frames: [
    { at: 1000, nodes: [{ id: 'a', state: 'running', attempts: 1, sessionId: 's-a' }] },
    {
      at: 5000,
      nodes: [
        { id: 'a', state: 'passed', attempts: 1, sessionId: 's-a' },
        { id: 'b', state: 'running', attempts: 1, sessionId: 's-b' },
      ],
    },
  ],
  tools: [tool(2000, 's-a', 'c1'), tool(6000, 's-b', 'c2'), tool(9000, 'ghost', 'c3')],
}

function gate(raisedAt: number, decidedAt: number | null): Gate {
  return {
    id: 'g-1',
    rule: 'merge',
    orderId: 'WO-1',
    nodeId: 'g',
    summary: 'Merge?',
    why: 'Checks passed.',
    evidence: [],
    options: [],
    defaultIfIgnored: 'hold',
    deadline: null,
    blockedUnits: 1,
    riskGrade: 'P2',
    raisedAt: new Date(raisedAt).toISOString(),
    decision:
      decidedAt === null
        ? null
        : { option: 'approve', at: new Date(decidedAt).toISOString(), actor: 'operator' },
  } as unknown as Gate
}

describe('observationAt', () => {
  it('shows the states of the latest frame at or before the moment', () => {
    const at3 = observationAt(timeline, [], base, 3000)
    expect(at3.graph.nodes.map((n) => [n.id, n.state])).toEqual([
      ['a', 'running'],
      ['b', 'waiting'],
      ['g', 'waiting'],
    ])
    const at7 = observationAt(timeline, [], base, 7000)
    expect(at7.graph.nodes.find((n) => n.id === 'b')?.state).toBe('running')
    expect(at7.graph.nodes.find((n) => n.id === 'b')?.sessionId).toBe('s-b')
  })

  it('starts from the first frame for a moment before anything was recorded', () => {
    const early = observationAt(timeline, [], base, 0)
    expect(early.graph.nodes.find((n) => n.id === 'a')?.state).toBe('running')
  })

  it('gives each node the tool calls its own session made up to that moment', () => {
    const at7 = observationAt(timeline, [], base, 7000)
    expect(at7.activity.a?.map((t) => t.callId)).toEqual(['c1'])
    expect(at7.activity.b?.map((t) => t.callId)).toEqual(['c2'])
    // a session no node ever carried belongs to nobody
    expect(Object.values(observationAt(timeline, [], base, 10000).activity).flat()).toHaveLength(2)
    expect(observationAt(timeline, [], base, 1500).activity).toEqual({})
  })

  it('holds a gate as waiting only between being raised and being decided', () => {
    const gates = [gate(6000, 8000)]
    expect(observationAt(timeline, gates, base, 5500).waiting).toEqual([])
    expect(observationAt(timeline, gates, base, 7000).waiting.map((g) => g.id)).toEqual(['g-1'])
    expect(observationAt(timeline, gates, base, 9000).waiting).toEqual([])
    expect(observationAt(timeline, [gate(6000, null)], base, 99999).waiting).toHaveLength(1)
  })

  it('replays no liveness it cannot know: nothing orphaned, nobody stranded', () => {
    const at = observationAt(timeline, [], base, 7000)
    expect(at.orphaned).toEqual([])
    expect(at.stranded).toEqual([])
  })
})

describe('momentsOf', () => {
  it('collects every moment that shows something, gates included, from a second before the first movement', () => {
    // the 9000 call belongs to a session no step carried, so it adds nothing
    expect(momentsOf(timeline, [gate(6000, 8000)])).toEqual([0, 1000, 2000, 5000, 6000, 8000])
  })

  it('drops shaping-session tool calls and everything before the first node leaves waiting', () => {
    const shaping: Timeline = {
      frames: [
        { at: 10_000, nodes: [{ id: 'a', state: 'waiting', attempts: 0, sessionId: null }] },
        { at: 50_000, nodes: [{ id: 'a', state: 'running', attempts: 1, sessionId: 's-a' }] },
      ],
      tools: [
        tool(1_000, 'scout', 'x1'),
        tool(20_000, 'architect', 'x2'),
        tool(51_000, 's-a', 'c1'),
      ],
    }
    expect(momentsOf(shaping, [gate(5_000, null)])).toEqual([49_000, 50_000, 51_000])
    const clock = replayClock(momentsOf(shaping, []), 6000)
    expect(clock.duration).toBe(2000)
    expect(clock.toReal(0)).toBe(49_000)
  })

  it('keeps every moment when nothing ever left waiting', () => {
    const idle: Timeline = {
      frames: [{ at: 100, nodes: [{ id: 'a', state: 'waiting', attempts: 0, sessionId: null }] }],
      tools: [],
    }
    expect(momentsOf(idle, [])).toEqual([100])
  })
})

describe.skipIf(!existsSync(REAL_TIMELINE))('momentsOf on a recorded run', () => {
  it('plays far shorter than every recorded moment would, with no quiet lead-in', async () => {
    const recorded = await readTimeline(dirname(REAL_TIMELINE))
    const all = new Set([...recorded.frames.map((f) => f.at), ...recorded.tools.map((t) => t.at)])
    const kept = momentsOf(recorded, [])
    expect(kept.length).toBeLessThan(all.size)
    const first = recorded.frames.find((f) => f.nodes.some((n) => n.state !== 'waiting'))
    expect(kept[0]).toBe((first?.at ?? 0) - 1000)
  })
})

describe('replayClock', () => {
  it('plays short gaps at their real length and caps long ones', () => {
    const clock = replayClock([1000, 2000, 60_000, 61_000], 6000)
    // 1 s + capped 6 s + 1 s
    expect(clock.duration).toBe(8000)
    expect(clock.toReal(0)).toBe(1000)
    expect(clock.toReal(1000)).toBe(2000)
    expect(clock.toReal(4000)).toBe(31_000)
    expect(clock.toReal(7000)).toBe(60_000)
    expect(clock.toReal(8000)).toBe(61_000)
  })

  it('clamps outside the recording and survives a single moment', () => {
    const clock = replayClock([1000, 2000], 6000)
    expect(clock.toReal(-5)).toBe(1000)
    expect(clock.toReal(99999)).toBe(2000)
    const single = replayClock([4000], 6000)
    expect(single.duration).toBe(0)
    expect(single.toReal(10)).toBe(4000)
    expect(replayClock([], 6000).duration).toBe(0)
  })
})

describe('a replay of CI', () => {
  const pull = (buckets: ('pass' | 'pending')[]) => [
    {
      url: 'https://github.com/a/b/pull/1',
      checks: buckets.map((bucket, i) => ({
        name: `check-${i}`,
        bucket,
        link: '',
        workflow: 'CI',
      })),
    },
  ]
  const withCi: Timeline = {
    ...timeline,
    ci: [
      { at: 5500, round: 0, max: 2, status: 'watching', pulls: pull(['pass', 'pending']) },
      { at: 7500, round: 1, max: 2, status: 'green', pulls: pull(['pass', 'pass']) },
    ],
  }

  it('shows no CI before the first recorded state, and none for a recording without any', () => {
    expect(observationAt(withCi, [], base, 5000).ci).toBeNull()
    expect(observationAt(timeline, [], base, 9000).ci).toBeNull()
  })

  it('rebuilds the CI state the run had at that moment', () => {
    const waiting = observationAt(withCi, [], base, 6000).ci
    expect(waiting?.status).toBe('watching')
    expect(waiting?.pulls[0].checks.map((c) => c.bucket)).toEqual(['pass', 'pending'])
    const done = observationAt(withCi, [], base, 8000).ci
    expect(done?.round).toBe(1)
    expect(done?.pulls[0].checks.map((c) => c.bucket)).toEqual(['pass', 'pass'])
  })

  it('counts each recorded CI change as a moment worth showing', () => {
    expect(momentsOf(withCi, [])).toEqual([0, 1000, 2000, 5000, 5500, 6000, 7500])
  })
})

describe.skipIf(!existsSync(REAL_TIMELINE))('a recorded run', () => {
  it('has no CI line to replay yet, which is not an error', async () => {
    const recorded = await readTimeline(dirname(REAL_TIMELINE))
    expect(observationAt(recorded, [], base, Date.now()).ci).toBeNull()
  })
})
