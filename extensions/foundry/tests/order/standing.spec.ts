import { describe, it, expect } from 'vitest'
import { standingOf, readStanding } from '../../src/order/standing.js'
import { raiseGate } from '../../src/gates/rules.js'
import type { Gate } from '../../src/gates/rules.js'
import type { RunGraph, RunNode } from '../../src/line/run-graph.js'
import type { StandingInput } from '../../src/order/standing.js'
import type { WorkOrder } from '../../src/order/schema.js'

// One answer to "what is this order doing, and whose move is it".
//
// It exists because every surface used to work that out for itself from
// whatever it happened to have: the order list read a draft-time compile
// result and so told the operator a halted run was "ready to hand off", the
// Floor read the graph and drew `building` chips for an agent sitting at a
// terminal prompt, and the one undecided gate that had stopped the line was
// named on neither.

function node(over: Partial<RunNode> & Pick<RunNode, 'id'>): RunNode {
  return {
    stepId: over.id,
    kind: 'agent',
    state: 'waiting',
    unitIds: [],
    lane: null,
    role: null,
    dependsOn: [],
    attempts: 0,
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    ...over,
  }
}

function graph(nodes: RunNode[]): RunGraph {
  return { orderId: 'WO-1', recipe: 'direct', nodes }
}

function gate(over: Partial<Parameters<typeof raiseGate>[0]> = {}): Gate {
  return raiseGate({
    id: 'WO-1-budget.exceeded-1',
    rule: 'budget.exceeded',
    orderId: 'WO-1',
    summary: 'Make all text red has gone past its wall clock budget',
    why: 'The order budgets 90 and this run is at 90.',
    at: '2026-09-09T18:12:21.514Z',
    ...over,
  })
}

function input(over: Partial<StandingInput> = {}): StandingInput {
  return {
    status: 'running',
    graph: graph([node({ id: 'build', state: 'running' }), node({ id: 'ship' })]),
    gates: [],
    asks: 0,
    orphaned: [],
    stalls: 0,
    openQuestions: 0,
    failures: 0,
    stranded: 0,
    intakeRefused: null,
    ...over,
  }
}

describe('standingOf', () => {
  it('counts finished steps out of every step, and says who is working', () => {
    const standing = standingOf(
      input({
        graph: graph([
          node({ id: 'a', state: 'passed' }),
          node({ id: 'b', state: 'skipped' }),
          node({ id: 'c', state: 'running' }),
          node({ id: 'd', state: 'waiting' }),
        ]),
      })
    )
    expect(standing.kind).toBe('working')
    expect(standing.turn).toBe('foundry')
    expect(standing.done).toBe(2)
    expect(standing.total).toBe(4)
    expect(standing.detail).toContain('2 of 4')
  })

  // The defect this whole module exists for. A running order's row read
  // "ready to hand off" from a draft-time compile result, which is 0 for every
  // running order for ever, so the badge was a constant wearing a status.
  it('never calls a running order ready to hand off', () => {
    const standing = standingOf(input())
    expect(standing.kind).not.toBe('done')
    expect(standing.label).not.toContain('hand off')
  })

  it('is halted, and names the gate, when an undecided gate stopped the line', () => {
    const standing = standingOf(input({ gates: [gate()] }))
    expect(standing.kind).toBe('halted')
    expect(standing.turn).toBe('you')
    expect(standing.gateId).toBe('WO-1-budget.exceeded-1')
  })

  // A decided gate is history. It stopped nothing, so it says nothing.
  it('ignores a gate that has already been answered', () => {
    const decided: Gate = {
      ...gate(),
      decision: { option: 'raise', by: 'operator', note: '', at: '2026-09-09T18:20:00.000Z' },
    }
    expect(standingOf(input({ gates: [decided] })).kind).toBe('working')
  })

  // Both stop the line; the gate stops all of it. Precedence is how much is
  // blocked, so the gate is what the operator is told about first.
  it('puts a gate ahead of a held tool call', () => {
    expect(standingOf(input({ gates: [gate()], asks: 2 })).kind).toBe('halted')
  })

  it('is adrift when the graph calls a step running and nothing is', () => {
    const standing = standingOf(input({ orphaned: ['build'] }))
    expect(standing.kind).toBe('adrift')
    expect(standing.turn).toBe('you')
  })

  it('is asking when an agent is holding a tool call', () => {
    const standing = standingOf(input({ asks: 1 }))
    expect(standing.kind).toBe('asking')
    expect(standing.turn).toBe('you')
    expect(standing.detail).toContain('1 agent')
  })

  // The failure that killed the run this whole change came out of. A tool call
  // nobody answered in time is handed back to the terminal's own prompt, and an
  // unattended run never reaches it — so the agent's process stays alive, the
  // graph goes on saying `running`, and the surface drew a working build for
  // two hours over an agent that had stopped and could not say so.
  it('is stranded when an agent was handed back to its terminal', () => {
    const standing = standingOf(input({ stranded: 1 }))
    expect(standing.kind).toBe('stranded')
    expect(standing.turn).toBe('you')
    expect(standing.detail).toMatch(/terminal/)
  })

  // A live held call is answerable from the surface in one click; a handed-back
  // one can only be answered by going to the terminal. Cheapest first.
  it('puts a call it can still answer ahead of one it cannot', () => {
    expect(standingOf(input({ asks: 1, stranded: 1 })).kind).toBe('asking')
  })

  it('is stalled when a run stopped making progress without asking', () => {
    const standing = standingOf(input({ stalls: 1 }))
    expect(standing.kind).toBe('stalled')
    expect(standing.turn).toBe('you')
  })

  it('is failed when a step failed and no gate covers it', () => {
    const standing = standingOf(input({ graph: graph([node({ id: 'a', state: 'failed' })]) }))
    expect(standing.kind).toBe('failed')
    expect(standing.turn).toBe('you')
  })

  it('counts the questions a draft order is still asking', () => {
    const standing = standingOf(input({ status: 'draft', graph: null, openQuestions: 3 }))
    expect(standing.kind).toBe('shaping')
    expect(standing.turn).toBe('you')
    expect(standing.label).toContain('3')
  })

  it('leaves a draft with nothing to answer on Foundry', () => {
    const standing = standingOf(input({ status: 'draft', graph: null }))
    expect(standing.kind).toBe('shaping')
    expect(standing.turn).toBe('foundry')
  })

  // The checks a draft has not cleared are the architect's to clear, not the
  // operator's — but they are the answer to "how far off is this", which the
  // row said as "blocked by 3" and would otherwise have stopped saying.
  it('says how many checks a draft has left, without calling it your move', () => {
    const standing = standingOf(input({ status: 'draft', graph: null, failures: 3 }))
    expect(standing.turn).toBe('foundry')
    expect(standing.detail).toContain('3')
  })

  // A refusal moves nothing. Before it was an input here, a draft whose
  // architect had been refused an hour earlier stood exactly where one being
  // actively drafted stood — "Foundry is still shaping this", turn `foundry` —
  // and the only surface that could have said otherwise said that.
  it('hands a draft back when its last intake turn was refused', () => {
    const standing = standingOf(
      input({
        status: 'draft',
        graph: null,
        failures: 1,
        intakeRefused: 'acceptance.5.verify.evidence.1: Invalid enum value.',
      })
    )
    expect(standing.turn).toBe('you')
    expect(standing.headline).toMatch(/refused/i)
    expect(standing.detail).toContain('Invalid enum value')
  })

  // Ahead of the questions, and deliberately: answering one writes an answer
  // onto a document nothing is reading, so a screen that led with the
  // questions would be pointing at the one move that does not help.
  it('says the refusal before it says the open questions', () => {
    const standing = standingOf(
      input({ status: 'draft', graph: null, openQuestions: 3, intakeRefused: 'nope' })
    )
    expect(standing.headline).toMatch(/refused/i)
  })

  it('is ready when an order is agreed and no graph exists yet', () => {
    const standing = standingOf(input({ status: 'agreed', graph: null }))
    expect(standing.kind).toBe('ready')
    expect(standing.turn).toBe('foundry')
  })

  it('is done when the order shipped', () => {
    const standing = standingOf(input({ status: 'shipped' }))
    expect(standing.kind).toBe('done')
    expect(standing.turn).toBe('foundry')
  })

  // A running order with no graph on disk is not "0 of 0 steps": that reads as
  // finished. It has not started.
  it('does not read as finished when there is no graph', () => {
    const standing = standingOf(input({ graph: null }))
    expect(standing.kind).toBe('ready')
    expect(standing.total).toBe(0)
  })

  // Every kind carries a sentence and a badge. A standing that renders as an
  // empty band is the defect all over again.
  it('always says something', () => {
    const cases: StandingInput[] = [
      input(),
      input({ gates: [gate()] }),
      input({ asks: 1 }),
      input({ stranded: 1 }),
      input({ orphaned: ['build'] }),
      input({ stalls: 1 }),
      input({ graph: graph([node({ id: 'a', state: 'failed' })]) }),
      input({ status: 'draft', graph: null, openQuestions: 2 }),
      input({ status: 'draft', graph: null }),
      input({ status: 'draft', graph: null, intakeRefused: 'acceptance.5: Invalid enum value.' }),
      input({ status: 'agreed', graph: null }),
      input({ status: 'shipped' }),
    ]
    expect(cases).toHaveLength(12)
    for (const one of cases) {
      const standing = standingOf(one)
      expect(standing.label.trim()).not.toBe('')
      expect(standing.headline.trim()).not.toBe('')
      expect(standing.detail.trim()).not.toBe('')
    }
  })
})

describe('readStanding', () => {
  // One assembly point for the inputs, so the order list and the Floor cannot
  // disagree about where the same order stands — which is the defect, stated
  // as a rule.
  it('assembles from the sources it is given', async () => {
    const standing = await readStanding(
      { id: 'WO-1', status: 'running', openQuestions: [] } as unknown as WorkOrder,
      {
        graphFor: async () => graph([node({ id: 'a', state: 'passed' }), node({ id: 'b' })]),
        gatesFor: async () => [gate()],
      }
    )
    expect(standing.kind).toBe('halted')
    expect(standing.done).toBe(1)
    expect(standing.total).toBe(2)
  })

  it('stands somewhere with no sources at all', async () => {
    const standing = await readStanding(
      { id: 'WO-1', status: 'draft', openQuestions: [] } as unknown as WorkOrder,
      {}
    )
    expect(standing.kind).toBe('shaping')
    expect(standing.detail.trim()).not.toBe('')
  })

  // Which nodes nothing is running is a runtime fact, not a record on disk, so
  // the caller owns the answer and this only has to ask for it.
  it('asks the caller which nodes nothing is running', async () => {
    const standing = await readStanding(
      { id: 'WO-1', status: 'running', openQuestions: [] } as unknown as WorkOrder,
      {
        graphFor: async () => graph([node({ id: 'a', state: 'running' })]),
        orphansFor: () => ['a'],
      }
    )
    expect(standing.kind).toBe('adrift')
  })
})
