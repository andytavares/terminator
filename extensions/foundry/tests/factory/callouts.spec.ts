import { describe, it, expect } from 'vitest'
import { calloutFor, interruptionsFor, stateWord } from '../../src/factory/callouts.js'
import type { FactoryEvent } from '../../src/factory/events.js'
import type { Gate } from '../../src/gates/rules.js'
import type { NodeState, RunGraph, RunNode } from '../../src/line/run-graph.js'

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

const graph: RunGraph = {
  orderId: 'WO-1',
  recipe: 'standard',
  nodes: [
    node('build', { state: 'running', sessionId: 's-build' }),
    node('ship', { kind: 'gate', role: 'foreman' }),
  ],
}
const labels = { build: 'Build the API', ship: 'Ship it' }

function gate(over: Partial<Gate> = {}): Gate {
  return {
    id: 'g-1',
    rule: 'merge',
    orderId: 'WO-1',
    nodeId: 'ship',
    summary: 'Merge the pull request?',
    why: 'Every check passed.',
    evidence: [],
    options: [
      { id: 'approve', label: 'Approve', consequence: 'Merges.' },
      { id: 'hold', label: 'Hold', consequence: 'Waits.' },
    ],
    defaultIfIgnored: 'hold',
    deadline: null,
    blockedUnits: 1,
    riskGrade: 'P2',
    ...over,
  } as Gate
}

describe('calloutFor', () => {
  const at = (event: FactoryEvent) => calloutFor(event, labels, 1000)

  it('anchors a step that finishes to its own station, marked done', () => {
    expect(at({ kind: 'node-state', nodeId: 'build', from: 'running', to: 'passed' })).toEqual({
      id: 'build@1000',
      nodeId: 'build',
      tone: 'done',
      text: 'Done',
      at: 1000,
    })
  })

  it('says a failure out loud, with the attempt it was on left to the nameplate', () => {
    expect(
      at({ kind: 'node-state', nodeId: 'build', from: 'running', to: 'failed' })
    ).toMatchObject({
      tone: 'fail',
      text: 'Failed',
    })
  })

  it('stays quiet for bookkeeping moves nobody needs to see', () => {
    expect(at({ kind: 'node-state', nodeId: 'build', from: 'waiting', to: 'ready' })).toBeNull()
    expect(
      at({ kind: 'tool', nodeId: 'build', prop: 'desk', callId: 'c', open: true, at: 0 })
    ).toBeNull()
    expect(
      at({ kind: 'tool', nodeId: 'build', prop: 'rack', callId: 'c', open: false, at: 0 })
    ).toBeNull()
    expect(at({ kind: 'stranded', nodeId: 'build', on: true })).toBeNull()
    expect(at({ kind: 'gate', nodeId: 'ship', waiting: true })).toBeNull()
  })

  it('names the tool errand in plain words', () => {
    expect(
      at({ kind: 'tool', nodeId: 'build', prop: 'archive', callId: 'c', open: true, at: 0 })
    ).toMatchObject({ tone: 'tool', text: 'Reading files' })
    expect(
      at({ kind: 'tool', nodeId: 'build', prop: 'rack', callId: 'c', open: true, at: 0 })
    ).toMatchObject({ tone: 'tool', text: 'Running a command' })
  })

  it('puts a handoff on the station receiving the work, naming where it came from', () => {
    expect(
      at({ kind: 'handoff', fromNodeId: 'build', toNodeId: 'ship', targetStarted: false })
    ).toMatchObject({ nodeId: 'ship', tone: 'handoff', text: 'Work in from Build the API' })
  })

  it('falls back to the node id when a step has no label', () => {
    expect(
      calloutFor({ kind: 'handoff', fromNodeId: 'x', toNodeId: 'ship', targetStarted: true }, {}, 0)
    ).toMatchObject({ text: 'Work in from x' })
  })

  it('puts a rework on the station taking the failure back, naming the check', () => {
    expect(at({ kind: 'rework', fromNodeId: 'ship', toNodeId: 'build', round: 1 })).toMatchObject({
      nodeId: 'build',
      tone: 'fail',
      text: 'Sent back: Ship it failed',
    })
  })

  it('covers every other event kind', () => {
    expect(at({ kind: 'node-state', nodeId: 'build', from: 'ready', to: 'running' })?.text).toBe(
      'Started'
    )
    expect(
      at({ kind: 'node-state', nodeId: 'build', from: 'running', to: 'verifying' })?.text
    ).toBe('Checking')
    expect(at({ kind: 'node-state', nodeId: 'build', from: 'ready', to: 'blocked' })?.tone).toBe(
      'fail'
    )
    expect(at({ kind: 'node-state', nodeId: 'build', from: 'ready', to: 'skipped' })?.text).toBe(
      'Skipped'
    )
    expect(at({ kind: 'node-state', nodeId: 'build', from: null, to: 'waiting' })).toBeNull()
    expect(at({ kind: 'orphaned', nodeId: 'build' })).toMatchObject({
      tone: 'fail',
      text: 'Agent gone',
    })
    expect(at({ kind: 'stranded', nodeId: 'build', on: false })?.text).toBe('Back to work')
    expect(at({ kind: 'gate', nodeId: 'ship', waiting: false })).toMatchObject({
      tone: 'done',
      text: 'Gate cleared',
    })
    expect(at({ kind: 'rework', fromNodeId: 'ship', toNodeId: 'build', round: 1 })).toMatchObject({
      tone: 'fail',
    })
  })

  it('puts a CI round callout at the exit station', () => {
    expect(at({ kind: 'ci-round', round: 2, max: 3 })).toMatchObject({
      nodeId: 'ci',
      tone: 'start',
      text: 'Round 2 of 3',
    })
  })

  it('says a failed check failed, at the exit station', () => {
    expect(at({ kind: 'ci-check', name: 'test', bucket: 'fail' })).toMatchObject({
      nodeId: 'ci',
      tone: 'fail',
      text: 'test failed',
    })
    expect(at({ kind: 'ci-check', name: 'test', bucket: 'cancel' })).toMatchObject({
      tone: 'fail',
    })
  })

  it('says a passing check passed, at the exit station', () => {
    expect(at({ kind: 'ci-check', name: 'lint', bucket: 'pass' })).toMatchObject({
      nodeId: 'ci',
      tone: 'done',
      text: 'lint passed',
    })
  })

  it('stays quiet for a check still in flight', () => {
    expect(at({ kind: 'ci-check', name: 'test', bucket: 'pending' })).toBeNull()
    expect(at({ kind: 'ci-check', name: 'test', bucket: 'skipping' })).toBeNull()
  })
})

describe('interruptionsFor', () => {
  it('pins a held tool call to the station whose agent is holding it', () => {
    const [ask] = interruptionsFor({
      graph,
      waiting: [],
      stranded: [],
      pending: [
        { requestId: 'r-1', sessionId: 's-build', toolName: 'Bash', summary: 'rm -rf dist' },
      ],
    })
    expect(ask).toEqual({
      kind: 'ask',
      id: 'r-1',
      nodeId: 'build',
      title: 'Wants to run Bash',
      detail: 'rm -rf dist',
      prose: false,
    })
  })

  it("marks an agent's question as prose, to be shown as markdown", () => {
    const [ask] = interruptionsFor({
      graph,
      waiting: [],
      stranded: [],
      pending: [
        { requestId: 'r-1', sessionId: 's-build', toolName: 'AskUserQuestion', summary: 'Which?' },
      ],
    })
    expect(ask).toMatchObject({ kind: 'ask', prose: true })
  })

  it('pins a gate to its node, with its options and whether it needs a number', () => {
    const [g] = interruptionsFor({ graph, waiting: [gate()], stranded: [], pending: [] })
    expect(g).toMatchObject({
      kind: 'gate',
      id: 'g-1',
      nodeId: 'ship',
      title: 'Merge the pull request?',
      detail: 'Every check passed.',
      needsInbox: false,
    })
    expect(g.kind === 'gate' && g.options.map((o) => o.id)).toEqual(['approve', 'hold'])
  })

  it('sends a budget raise to the Inbox, which is where the number is typed', () => {
    const [g] = interruptionsFor({
      graph,
      waiting: [gate({ breach: { kind: 'wall-clock', limit: 60, spent: 61 } as never })],
      stranded: [],
      pending: [],
    })
    expect(g).toMatchObject({ kind: 'gate', needsInbox: true })
  })

  it('pins an agent parked at its terminal, unless a held call already says so', () => {
    expect(interruptionsFor({ graph, waiting: [], stranded: ['s-build'], pending: [] })).toEqual([
      {
        kind: 'stranded',
        id: 's-build',
        nodeId: 'build',
        title: 'Waiting at its terminal',
        detail: 'A question went unanswered in time. Answer it in the terminal.',
      },
    ])
    const both = interruptionsFor({
      graph,
      waiting: [],
      stranded: ['s-build'],
      pending: [{ requestId: 'r-1', sessionId: 's-build', toolName: 'Edit', summary: 'a.ts' }],
    })
    expect(both.map((i) => i.kind)).toEqual(['ask'])
  })

  it('keeps an interruption whose session matches no node, anchored nowhere', () => {
    const [ask] = interruptionsFor({
      graph,
      waiting: [],
      stranded: [],
      pending: [{ requestId: 'r-2', sessionId: 'ghost', toolName: 'Read', summary: 'x' }],
    })
    expect(ask.nodeId).toBeNull()
  })
})

describe('stateWord', () => {
  it('has a word for every node state', () => {
    const states: NodeState[] = [
      'waiting',
      'ready',
      'running',
      'verifying',
      'passed',
      'failed',
      'blocked',
      'skipped',
    ]
    const words = states.map(stateWord)
    expect(new Set(words).size).toBe(states.length)
    expect(stateWord('running')).toBe('Working')
    expect(stateWord('waiting')).toBe('Queued')
  })
})
