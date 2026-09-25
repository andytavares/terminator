import { describe, it, expect } from 'vitest'
import { observationAt, replayClock, momentsOf } from '../../src/factory/replay.js'
import type { Timeline } from '../../src/factory/replay.js'
import type { Gate } from '../../src/gates/rules.js'
import type { RunGraph, RunNode } from '../../src/line/run-graph.js'
import type { ToolActivity } from '../../src/runtime/transcript-tailer.js'

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
  it('collects every recorded moment in order, gates included, without repeats', () => {
    expect(momentsOf(timeline, [gate(6000, 8000)])).toEqual([1000, 2000, 5000, 6000, 8000, 9000])
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
