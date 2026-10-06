import { describe, it, expect } from 'vitest'
import { stepFacts } from '../../src/factory/step-facts.js'
import type { RunGraph, RunNode } from '../../src/line/run-graph.js'
import type { Gate } from '../../src/gates/rules.js'

function node(id: string, over: Partial<RunNode> = {}): RunNode {
  return {
    id,
    stepId: id,
    kind: 'agent',
    state: 'passed',
    unitIds: [],
    lane: null,
    role: null,
    dependsOn: [],
    attempts: 1,
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
    node('inspect'),
    node('scribe'),
    node('integrate', { kind: 'join', dependsOn: ['inspect', 'scribe'] }),
    node('ship', { kind: 'gate', state: 'running', dependsOn: ['integrate'] }),
  ],
}
const labels = { inspect: 'Inspector', scribe: 'Scribe', integrate: 'Integrate', ship: 'Ship' }

function readyGate(): Gate {
  return { rule: 'ready-for-review', nodeId: 'ship', summary: 'Mark the draft ready?' } as Gate
}

const ci = (buckets: string[]) => ({
  pulls: [{ checks: buckets.map((bucket, i) => ({ name: `c${i}`, bucket })) }],
})

describe('factory/step-facts', () => {
  it('has nothing to say about an agent step', () => {
    expect(
      stepFacts({ node: graph.nodes[0], graph, labels, pulls: [], ci: null, waiting: [] })
    ).toBeNull()
  })

  it('says which stations a join joined', () => {
    expect(
      stepFacts({ node: graph.nodes[2], graph, labels, pulls: [], ci: null, waiting: [] })
    ).toEqual(['Joined Inspector and Scribe'])
  })

  it('says a join not yet passed is still joining', () => {
    const waiting = { ...graph.nodes[2], state: 'running' as const }
    expect(stepFacts({ node: waiting, graph, labels, pulls: [], ci: null, waiting: [] })).toEqual([
      'Joins Inspector and Scribe',
    ])
  })

  it('says what the ship gate decided', () => {
    expect(
      stepFacts({
        node: graph.nodes[3],
        graph,
        labels,
        pulls: [{ repo: 'a/b', url: 'u', number: 233 }],
        ci: ci(['pass', 'pass', 'pending']) as never,
        waiting: [readyGate()],
      })
    ).toEqual(['Draft opened · #233', 'Checks · 2 of 3 passed', 'Waiting on you · mark ready?'])
  })

  it('leaves out the pull request line when the observation carries none', () => {
    expect(
      stepFacts({
        node: graph.nodes[3],
        graph,
        labels,
        pulls: undefined,
        ci: ci(['pass']) as never,
        waiting: [],
      })
    ).toEqual(['Checks · 1 of 1 passed'])
  })

  it('names any other open gate by its own question', () => {
    const other = { rule: 'budget.exceeded', nodeId: 'ship', summary: 'Raise the budget?' } as Gate
    expect(
      stepFacts({ node: graph.nodes[3], graph, labels, pulls: [], ci: null, waiting: [other] })
    ).toEqual(['Waiting on you · Raise the budget?'])
  })
})
