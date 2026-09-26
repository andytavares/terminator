import { describe, it, expect } from 'vitest'
import { diffObservation, toolProp, describeEvent, gateNodeId } from '../../src/factory/events.js'
import type { Observation, FactoryEvent } from '../../src/factory/events.js'
import { buildRunGraph, withNode } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { RunGraph } from '../../src/line/run-graph.js'
import { raiseGate } from '../../src/gates/rules.js'
import type { Gate } from '../../src/gates/rules.js'
import type { ToolActivity } from '../../src/runtime/transcript-tailer.js'
import type { CiState } from '../../src/line/ci-state.js'

// diffObservation is the honesty rule made concrete: a scene may move only for
// one of these reasons, and never twice for the same underlying change. Every
// test here either proves an event fires exactly once, or that a poll which
// changed nothing produces none.

const RECIPE = `
schemaVersion: 1
id: standard
steps:
  - id: a
    kind: agent
    role: builder
  - id: b
    kind: agent
    role: builder
    after: [a]
  - id: g
    kind: gate
    rule: ready-for-review
    options: [mark_ready, hold]
    defaultIfIgnored: hold
    after: [b]
`

function order(): WorkOrder {
  return draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
}

function graph(): RunGraph {
  const parsed = parseRecipe(RECIPE, 'standard.yaml')
  if (!parsed.ok) throw new Error(parsed.reason)
  return buildRunGraph(order(), parsed.value)
}

function obs(g: RunGraph, over: Partial<Observation> = {}): Observation {
  return { graph: g, orphaned: [], stranded: [], waiting: [], activity: {}, ci: null, ...over }
}

function ci(over: Partial<CiState> = {}): CiState {
  return {
    round: 1,
    max: 3,
    status: 'watching',
    pulls: [],
    reason: '',
    at: '2026-09-06T10:00:00.000Z',
    ...over,
  }
}

function activity(over: Partial<ToolActivity> = {}): ToolActivity {
  return {
    kind: 'tool_started',
    toolName: 'Read',
    callId: 'c1',
    isShell: false,
    path: null,
    at: 0,
    ...over,
  }
}

function gate(over: { id: string; nodeId: string | null }): Gate {
  return raiseGate({
    id: over.id,
    rule: 'unit.boundary',
    orderId: 'WO-1',
    nodeId: over.nodeId,
    summary: 'Continue?',
    why: 'a unit finished',
    at: '2026-09-06T10:00:00.000Z',
  })
}

describe('toolProp', () => {
  it.each(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'])('%s reads the archive', (toolName) => {
    expect(toolProp(toolName, false)).toBe('archive')
  })

  it('a shell call goes to the rack, regardless of its name', () => {
    expect(toolProp('Read', true)).toBe('rack')
    expect(toolProp('Bash', true)).toBe('rack')
  })

  it('everything else is desk work', () => {
    expect(toolProp('Edit', false)).toBe('desk')
    expect(toolProp('Write', false)).toBe('desk')
  })
})

describe('diffObservation', () => {
  it('returns no events on first load — settling is not a change', () => {
    expect(diffObservation(null, obs(graph()))).toEqual([])
  })

  it('returns no events when nothing about the observation changed', () => {
    const g = graph()
    expect(diffObservation(obs(g), obs(g))).toEqual([])
  })

  it('emits a node-state event for a changed node, and only that node', () => {
    const g = graph()
    const g2 = withNode(g, 'a', { state: 'running' })
    const events = diffObservation(obs(g), obs(g2))
    expect(events).toEqual([{ kind: 'node-state', nodeId: 'a', from: 'waiting', to: 'running' }])
  })

  it('emits one node-state event per changed node', () => {
    const g = graph()
    const g2 = withNode(withNode(g, 'a', { state: 'running' }), 'b', { state: 'running' })
    const events = diffObservation(obs(g), obs(g2))
    expect(events).toHaveLength(2)
  })

  it('emits orphaned only for a node newly orphaned', () => {
    const g = graph()
    const first = diffObservation(obs(g, { orphaned: [] }), obs(g, { orphaned: ['a'] }))
    expect(first).toEqual([{ kind: 'orphaned', nodeId: 'a' }])

    const repeat = diffObservation(obs(g, { orphaned: ['a'] }), obs(g, { orphaned: ['a'] }))
    expect(repeat).toEqual([])
  })

  it('emits stranded on when a session newly appears, off when it leaves', () => {
    const g = withNode(graph(), 'a', { sessionId: 's1' })
    const on = diffObservation(obs(g, { stranded: [] }), obs(g, { stranded: ['s1'] }))
    expect(on).toEqual([{ kind: 'stranded', nodeId: 'a', on: true }])

    const off = diffObservation(obs(g, { stranded: ['s1'] }), obs(g, { stranded: [] }))
    expect(off).toEqual([{ kind: 'stranded', nodeId: 'a', on: false }])
  })

  it('a stranded session with no matching node in the graph produces no event', () => {
    const g = graph()
    const events = diffObservation(obs(g, { stranded: [] }), obs(g, { stranded: ['ghost'] }))
    expect(events).toEqual([])
  })

  it('emits a tool event for a new activity, by callId+kind, and not for a repeat', () => {
    const g = graph()
    const started = activity({ kind: 'tool_started', callId: 'c1', toolName: 'Read', at: 100 })
    const prev = obs(g, { activity: {} })
    const next = obs(g, { activity: { a: [started] } })
    expect(diffObservation(prev, next)).toEqual([
      { kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c1', open: true, at: 100 },
    ])

    // the same call, seen again, is not a new event
    expect(diffObservation(next, next)).toEqual([])
  })

  it('emits a tool-close event, open:false, for a tool_finished', () => {
    const g = graph()
    const finished = activity({ kind: 'tool_finished', callId: 'c1', toolName: '', at: 200 })
    const events = diffObservation(
      obs(g, { activity: {} }),
      obs(g, { activity: { a: [finished] } })
    )
    expect(events).toEqual([
      { kind: 'tool', nodeId: 'a', prop: 'desk', callId: 'c1', open: false, at: 200 },
    ])
  })

  it('emits a handoff when the source becomes passed while the target is ready or running', () => {
    const g = graph()
    const before = withNode(g, 'b', { state: 'ready' })
    const after = withNode(before, 'a', { state: 'passed' })
    const events = diffObservation(obs(before), obs(after))
    expect(events).toContainEqual({
      kind: 'handoff',
      fromNodeId: 'a',
      toNodeId: 'b',
      targetStarted: false,
    })
  })

  it('hands work off to a step that has not started, so it can queue there', () => {
    const g = graph()
    const after = withNode(g, 'a', { state: 'passed' })
    const events = diffObservation(obs(g), obs(after))
    expect(events).toContainEqual({
      kind: 'handoff',
      fromNodeId: 'a',
      toNodeId: 'b',
      targetStarted: false,
    })
  })

  it('marks the handoff started when the next step is already running', () => {
    const g = graph()
    const before = withNode(g, 'b', { state: 'running' })
    const after = withNode(before, 'a', { state: 'passed' })
    const events = diffObservation(obs(before), obs(after))
    expect(events).toContainEqual({
      kind: 'handoff',
      fromNodeId: 'a',
      toNodeId: 'b',
      targetStarted: true,
    })
  })

  it('does not re-emit a handoff for a source that was already passed', () => {
    const g = withNode(graph(), 'a', { state: 'passed' })
    const before = withNode(g, 'b', { state: 'waiting' })
    const after = withNode(g, 'b', { state: 'ready' })
    const events = diffObservation(obs(before), obs(after))
    expect(events.some((e) => e.kind === 'handoff')).toBe(false)
  })

  it('emits gate on/off, resolving a null nodeId to the first open gate node', () => {
    const g = graph()
    const raised = gate({ id: 'gate-1', nodeId: null })
    const on = diffObservation(obs(g, { waiting: [] }), obs(g, { waiting: [raised] }))
    expect(on).toEqual([{ kind: 'gate', nodeId: 'g', waiting: true }])

    const off = diffObservation(obs(g, { waiting: [raised] }), obs(g, { waiting: [] }))
    expect(off).toEqual([{ kind: 'gate', nodeId: 'g', waiting: false }])
  })

  it('resolves an explicit gate.nodeId over the fallback', () => {
    const g = graph()
    const raised = gate({ id: 'gate-1', nodeId: 'b' })
    const events = diffObservation(obs(g, { waiting: [] }), obs(g, { waiting: [raised] }))
    expect(events).toEqual([{ kind: 'gate', nodeId: 'b', waiting: true }])
  })

  it('gateNodeId falls back to null when there is no open gate node at all', () => {
    const parsed = parseRecipe(
      `
schemaVersion: 1
id: nogate
steps:
  - id: a
    kind: agent
    role: builder
`,
      'nogate.yaml'
    )
    if (!parsed.ok) throw new Error(parsed.reason)
    const g = buildRunGraph(order(), parsed.value)
    expect(gateNodeId(gate({ id: 'gate-1', nodeId: null }), g)).toBe(null)
  })
})

describe('diffObservation: rework', () => {
  it('emits a rework when a node’s feedback grows from 0 to 1', () => {
    const g = graph()
    const after = withNode(g, 'a', {
      feedback: [
        {
          from: 'b',
          attempt: 1,
          source: 'check',
          command: 'npm test',
          exitCode: 1,
          excerpt: 'FAIL',
          logPath: null,
        },
      ],
    })
    const events = diffObservation(obs(g), obs(after))
    expect(events).toContainEqual({ kind: 'rework', fromNodeId: 'b', toNodeId: 'a', round: 1 })
  })

  it('emits nothing when feedback is unchanged', () => {
    const feedback = [
      {
        from: 'b',
        attempt: 1,
        source: 'check' as const,
        command: 'npm test',
        exitCode: 1,
        excerpt: 'FAIL',
        logPath: null,
      },
    ]
    const g = withNode(graph(), 'a', { feedback })
    const events = diffObservation(obs(g), obs(g))
    expect(events.some((e) => e.kind === 'rework')).toBe(false)
  })

  it('emits nothing when the previous observation is null, even with feedback present', () => {
    const g = withNode(graph(), 'a', {
      feedback: [
        {
          from: 'b',
          attempt: 1,
          source: 'check',
          command: null,
          exitCode: null,
          excerpt: 'FAIL',
          logPath: null,
        },
      ],
    })
    expect(diffObservation(null, obs(g))).toEqual([])
  })
})

describe('describeEvent', () => {
  const labels = { a: 'Builder', b: 'Reviewer' }

  it.each<[FactoryEvent, string]>([
    [
      { kind: 'node-state', nodeId: 'a', from: 'waiting', to: 'running' },
      'Builder is now running.',
    ],
    [{ kind: 'orphaned', nodeId: 'a' }, "Builder's agent is gone."],
    [{ kind: 'stranded', nodeId: 'a', on: true }, 'Builder is waiting on you.'],
    [{ kind: 'stranded', nodeId: 'a', on: false }, 'Builder is back to work.'],
    [
      { kind: 'tool', nodeId: 'a', prop: 'archive', callId: 'c1', open: true, at: 0 },
      'Builder is using the archive.',
    ],
    [
      { kind: 'tool', nodeId: 'a', prop: 'rack', callId: 'c1', open: false, at: 0 },
      'Builder is done with the rack.',
    ],
    [
      { kind: 'handoff', fromNodeId: 'a', toNodeId: 'b', targetStarted: false },
      'Builder handed off to Reviewer.',
    ],
    [{ kind: 'gate', nodeId: 'a', waiting: true }, 'Builder is waiting at the gate.'],
    [{ kind: 'gate', nodeId: 'a', waiting: false }, "Builder's gate cleared."],
    [
      { kind: 'rework', fromNodeId: 'b', toNodeId: 'a', round: 2 },
      'Reviewer sent Builder back (round 2).',
    ],
  ])('describes %o as %s', (event, sentence) => {
    expect(describeEvent(event, labels)).toBe(sentence)
  })

  it('falls back to the node id when there is no label', () => {
    expect(describeEvent({ kind: 'orphaned', nodeId: 'zzz' }, {})).toBe("zzz's agent is gone.")
  })

  it.each<[FactoryEvent, string]>([
    [{ kind: 'ci-round', round: 2, max: 3 }, 'CI round 2 of 3.'],
    [{ kind: 'ci-check', name: 'test', bucket: 'fail' }, 'test is now fail.'],
  ])('describes %o as %s', (event, sentence) => {
    expect(describeEvent(event, labels)).toBe(sentence)
  })
})

describe('CI events', () => {
  it('raises no event before there is CI to report', () => {
    const g = graph()
    expect(diffObservation(obs(g), obs(g))).toEqual([])
  })

  it('raises a ci-round event when a fresh CI state first appears', () => {
    const g = graph()
    const events = diffObservation(obs(g), obs(g, { ci: ci({ round: 1, max: 3 }) }))
    expect(events).toContainEqual({ kind: 'ci-round', round: 1, max: 3 })
  })

  it('raises a ci-round event only when the round grows', () => {
    const g = graph()
    const prev = obs(g, { ci: ci({ round: 1 }) })
    const same = diffObservation(prev, obs(g, { ci: ci({ round: 1 }) }))
    expect(same.some((e) => e.kind === 'ci-round')).toBe(false)

    const grown = diffObservation(prev, obs(g, { ci: ci({ round: 2 }) }))
    expect(grown).toContainEqual({ kind: 'ci-round', round: 2, max: 3 })
  })

  it('raises a ci-check event for a new check, and for one whose bucket changed', () => {
    const g = graph()
    const prev = obs(g, {
      ci: ci({
        pulls: [
          { url: 'u', checks: [{ name: 'test', bucket: 'pending', link: 'l', workflow: 'w' }] },
        ],
      }),
    })
    const next = obs(g, {
      ci: ci({
        pulls: [
          {
            url: 'u',
            checks: [
              { name: 'test', bucket: 'fail', link: 'l', workflow: 'w' },
              { name: 'lint', bucket: 'pass', link: 'l', workflow: 'w' },
            ],
          },
        ],
      }),
    })
    const events = diffObservation(prev, next)
    expect(events).toContainEqual({ kind: 'ci-check', name: 'test', bucket: 'fail' })
    expect(events).toContainEqual({ kind: 'ci-check', name: 'lint', bucket: 'pass' })
  })

  it('raises nothing when a check reports the same bucket again', () => {
    const g = graph()
    const state = ci({
      pulls: [{ url: 'u', checks: [{ name: 'test', bucket: 'pass', link: 'l', workflow: 'w' }] }],
    })
    const events = diffObservation(obs(g, { ci: state }), obs(g, { ci: state }))
    expect(events.some((e) => e.kind === 'ci-check')).toBe(false)
  })
})
