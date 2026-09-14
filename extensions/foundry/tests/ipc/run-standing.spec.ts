import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunChannels } from '../../src/ipc/run-channels.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/schema.js'
import { raiseGate } from '../../src/gates/rules.js'
import type { OrderStore } from '../../src/order/store.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { Standing } from '../../src/order/standing.js'
import type { Gate } from '../../src/gates/rules.js'

// What `run.observe` has to hand a surface before that surface can say what to
// do next. Before this it returned the graph and nothing else, so the Floor
// could draw chips and could not name the gate that had halted the line.

const builtInDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let dataRoot: string
let repo: string
let store: OrderStore

interface Observed {
  standing: Standing
  waiting: Gate[]
}

function channels(over: { gates?: Gate[]; asks?: number; stalls?: number } = {}) {
  return createRunChannels({
    store,
    dataRoot: () => dataRoot,
    sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
    now: () => '2026-09-06T10:00:00.000Z',
    gatesFor: async () => over.gates ?? [],
    asksFor: () => over.asks ?? 0,
    stallsFor: () => over.stalls ?? 0,
  })
}

async function markAllPassed(orderId: string): Promise<void> {
  const file = path.join(dataRoot, 'orders', orderId, 'run-graph.json')
  const graph = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    orderId: string
    recipe: string
    nodes: Array<Record<string, unknown>>
  }
  fs.writeFileSync(
    file,
    JSON.stringify({ ...graph, nodes: graph.nodes.map((n) => ({ ...n, state: 'passed' })) })
  )
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'agreed',
    acceptance: [
      {
        id: 'AC-1',
        statement: 'a',
        priority: 'P1',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'a',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/a'],
          verify: [],
        },
      ],
    },
    ...over,
  }
}

function gate(over: Partial<Parameters<typeof raiseGate>[0]> = {}): Gate {
  return raiseGate({
    id: 'WO-1-budget.exceeded-1',
    rule: 'budget.exceeded',
    orderId: 'WO-1',
    summary: 'x has gone past its wall clock budget',
    why: 'The order budgets 90 and this run is at 90.',
    at: '2026-09-06T11:30:00.000Z',
    ...over,
  })
}

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-standing-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-standing-repo-'))
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
  store = createOrderStore(dataRoot)
})

describe('what run.observe says about where an order stands', () => {
  it('carries a standing with the graph', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    const view = (await channels().observe({ id: 'WO-1' })) as Observed
    expect(view.standing.total).toBeGreaterThan(0)
    expect(view.standing.detail.trim()).not.toBe('')
  })

  // The whole point. A halted run has to arrive at the surface already saying
  // it is halted and already carrying the gate, or the surface has to go and
  // find out — which is what none of them did.
  it('is halted, and hands over the gate holding it', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    const view = (await channels({ gates: [gate()] }).observe({ id: 'WO-1' })) as Observed
    expect(view.standing.kind).toBe('halted')
    expect(view.standing.turn).toBe('you')
    expect(view.waiting.map((g) => g.id)).toEqual(['WO-1-budget.exceeded-1'])
  })

  it('hands over no gate, and is not halted, once one is decided', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    const decided: Gate = {
      ...gate(),
      decision: { option: 'raise', by: 'operator', note: '', at: '2026-09-06T11:40:00.000Z' },
    }
    const view = (await channels({ gates: [decided] }).observe({ id: 'WO-1' })) as Observed
    expect(view.standing.kind).not.toBe('halted')
    expect(view.waiting).toEqual([])
  })

  it('is asking when an agent is holding a tool call', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    const view = (await channels({ asks: 2 }).observe({ id: 'WO-1' })) as Observed
    expect(view.standing.kind).toBe('asking')
  })

  it('is stalled when a run stopped making progress', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    const view = (await channels({ stalls: 1 }).observe({ id: 'WO-1' })) as Observed
    expect(view.standing.kind).toBe('stalled')
  })

  // A host with no supervision runtime supplies none of these. It still has to
  // get a standing back rather than a crash or a blank band.
  it('still stands somewhere with no runtime to ask', async () => {
    await store.save(order())
    const bare = createRunChannels({
      store,
      dataRoot: () => dataRoot,
      sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
      now: () => '2026-09-06T10:00:00.000Z',
    })
    await bare.start({ id: 'WO-1' })
    const view = (await bare.observe({ id: 'WO-1' })) as Observed
    expect(view.standing.label.trim()).not.toBe('')
    expect(view.waiting).toEqual([])
  })

  // The WO-0913-0bd shape: every node in the graph finished, but the ledger's
  // tail says the run went on to fail — here, opening the pull request.
  // Before `runFailureFor` was wired in, this read `working`/"Between steps.
  // Nothing is running right now.", a dead end naming no move.
  it('is stopped when the ledger ends in a run failure and every step passed', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    await markAllPassed('WO-1')
    await store.record({
      at: '2026-09-13T10:05:00.000Z',
      orderId: 'WO-1',
      actor: 'rule:line',
      action: 'run.complete',
      subject: 'WO-1',
      reason: '',
      evidence: [],
    })
    await store.record({
      at: '2026-09-13T10:05:01.000Z',
      orderId: 'WO-1',
      actor: 'rule:line',
      action: 'run.failed',
      subject: 'WO-1',
      reason: 'Opening the pull request for terminator failed: ',
      evidence: [],
    })

    const view = (await channels().observe({ id: 'WO-1' })) as Observed
    expect(view.standing.kind).toBe('stopped')
    expect(view.standing.turn).toBe('you')
    expect(view.standing.label).toBe('not shipped')
    expect(view.standing.detail).toContain('Opening the pull request')
  })

  // Resuming records `run.resumed`, so a run that failed once and is retried
  // stops reading `stopped` while the retry is in flight.
  it('clears a stopped standing once the run is resumed', async () => {
    await store.save(order())
    await channels().start({ id: 'WO-1' })
    await store.record({
      at: '2026-09-13T10:05:01.000Z',
      orderId: 'WO-1',
      actor: 'rule:line',
      action: 'run.failed',
      subject: 'WO-1',
      reason: 'no worktree could be prepared',
      evidence: [],
    })

    let view = (await channels().observe({ id: 'WO-1' })) as Observed
    expect(view.standing.kind).toBe('stopped')

    const withExecute = createRunChannels({
      store,
      dataRoot: () => dataRoot,
      sources: () => ({ dataRoot, repoPaths: [repo], builtInDir }),
      now: () => '2026-09-13T10:10:00.000Z',
      execute: async () => undefined,
    })
    await withExecute.resume({ id: 'WO-1' })
    view = (await channels().observe({ id: 'WO-1' })) as Observed
    expect(view.standing.kind).not.toBe('stopped')
  })
})
