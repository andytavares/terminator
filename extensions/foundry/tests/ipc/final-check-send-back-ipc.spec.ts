/**
 * "Send back" on the final check, end to end.
 *
 * The final check fails after every node has passed, so its gate names no
 * node to retry. Retrying nothing only re-ran the same failing check; the
 * decision instead gives the failure to the nodes that wrote the work and
 * reopens everything after them. That lives in the inbox's `act` closure, so
 * this drives it through `activate` with a stubbed runner.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

import { makeTempDir } from '../../../../tests/support/temp-dir'
import { fakeHost, type FoundryHost } from '../helpers/foundry-host.js'
import { activateFoundry } from '../helpers/foundry-activation.js'
import { builderUnit } from '../helpers/order-parts.js'
import { agentNode } from '../helpers/run-nodes.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import { raiseGate } from '../../src/gates/rules.js'
import type { Gate } from '../../src/gates/rules.js'
import type { Evidence } from '../../src/verify/verdict.js'
import type { RunGraph, RunNode } from '../../src/line/run-graph.js'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}))

/** Agents that start and never finish: the reopened nodes stay where they were put. */
const runner = {
  start: vi.fn(),
  resolve: vi.fn(),
  handBackToTerminal: vi.fn(),
  interrupt: vi.fn(),
  stop: vi.fn().mockReturnValue(true),
  send: vi.fn().mockReturnValue(true),
  terminalFor: vi.fn().mockReturnValue(null),
  watchable: vi.fn().mockReturnValue([]),
  dispose: vi.fn(),
}

vi.mock('../../src/runtime/supervised-runner.js', () => ({
  createSupervisedRunner: () => runner,
}))

vi.mock('../../src/runtime/control-server.js', () => ({
  createControlServer: vi.fn().mockResolvedValue({
    url: 'http://127.0.0.1:1/pretooluse',
    eventUrl: 'http://127.0.0.1:1/event',
    token: 'token',
    register: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  }),
}))

let dataDir = ''
let host: FoundryHost
const call = (channel: string, payload: unknown = {}) => host.call(channel, payload)
// One order per test: the run a send-back resumes is still in flight when the
// test ends, and this process runs one execution per order.
let orderId = ''
let orders = 0
const orderDir = (): string => path.join(dataDir, 'orders', orderId)

const AT = '2026-09-06T10:00:00.000Z'

/** Every node passed: the builder and the scribe wrote the work, the inspector read it. */
function passedGraph(): RunGraph {
  const passed = (id: string, over: Partial<RunNode>): RunNode =>
    agentNode(id, { state: 'passed', attempts: 1, startedAt: AT, endedAt: AT, ...over })
  return {
    orderId,
    recipe: 'direct',
    nodes: [
      passed('build:U-1', { stepId: 'build', role: 'builder', unitIds: ['U-1'], lane: 1 }),
      passed('docs', { role: 'scribe', dependsOn: ['build:U-1'] }),
      passed('inspect', { role: 'inspector', dependsOn: ['build:U-1'] }),
    ],
  }
}

function finalCheckGate(id: string, evidence: readonly Evidence[]): Gate {
  return raiseGate({
    id,
    rule: 'verify.repeat-fail',
    orderId,
    nodeId: null,
    summary: 'the final check failed',
    why: 'npm test failed on the merged lanes',
    evidence,
    at: AT,
  })
}

async function seedFailedFinalCheck(gates: readonly Gate[]): Promise<void> {
  dataDir = makeTempDir('fdry-final-check-')
  const base = draftOrder({
    id: orderId,
    title: 'Make the thing work',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: AT,
  })
  await createOrderStore(dataDir).save({
    ...base,
    status: 'running',
    recipe: 'direct',
    plan: { ...base.plan, units: [builderUnit('U-1', { title: 'the first bit' })] },
  })
  fs.writeFileSync(path.join(orderDir(), 'run-graph.json'), JSON.stringify(passedGraph()))
  fs.writeFileSync(path.join(orderDir(), 'gates.json'), JSON.stringify(gates))
}

/** The graph once the executor the resume hands it to has started the reopened nodes. */
async function sentBack(): Promise<RunGraph> {
  await vi.waitFor(() => expect(runner.start).toHaveBeenCalled())
  return JSON.parse(fs.readFileSync(path.join(orderDir(), 'run-graph.json'), 'utf8')) as RunGraph
}

const node = (graph: RunGraph, id: string): RunNode | undefined =>
  graph.nodes.find((n) => n.id === id)

beforeAll(async () => {
  host = fakeHost(() => dataDir)
  host.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
  await activateFoundry(host)
})

beforeEach(() => {
  orderId = `WO-${++orders}`
  runner.start.mockReset()
  runner.start.mockImplementation(() => new Promise(() => {}))
})

describe('sending a failed final check back', () => {
  describe('who gets it', whoGetsItTests)
  describe('what they are told', whatTheyAreToldTests)
})

function whoGetsItTests() {
  it('gives the failure to every node that wrote the work, and reopens what came after', async () => {
    await seedFailedFinalCheck([finalCheckGate('G-final', [])])
    await call('foundry:inbox.decide', { gateId: 'G-final', option: 'send_back' })

    const graph = await sentBack()
    expect(node(graph, 'build:U-1')?.feedback).toHaveLength(1)
    expect(node(graph, 'docs')?.feedback).toHaveLength(1)
    expect(node(graph, 'inspect')?.feedback).toEqual([])
    expect(node(graph, 'inspect')?.state).not.toBe('passed')
  })

  it('counts the send-backs before this one, so the builder knows how often it has failed', async () => {
    const earlier = {
      ...finalCheckGate('G-earlier', []),
      decision: { option: 'send_back', by: 'operator' as const, at: AT, note: '' },
    }
    await seedFailedFinalCheck([earlier, finalCheckGate('G-final', [])])
    await call('foundry:inbox.decide', { gateId: 'G-final', option: 'send_back' })

    const graph = await sentBack()
    expect(node(graph, 'build:U-1')?.feedback[0]?.attempt).toBe(2)
  })
}

/** What the final check printed before it failed. */
const FAILED_OUTPUT: Evidence = {
  kind: 'stdout',
  exitCode: 1,
  excerpt: '2 tests failed',
  path: '/logs/final.log',
}

function whatTheyAreToldTests() {
  it('hands over why the check failed with its output, exit code and log', async () => {
    await seedFailedFinalCheck([finalCheckGate('G-final', [FAILED_OUTPUT])])
    await call('foundry:inbox.decide', { gateId: 'G-final', option: 'send_back' })

    expect(node(await sentBack(), 'build:U-1')?.feedback).toEqual([
      {
        from: 'final check',
        attempt: 1,
        source: 'check',
        command: null,
        exitCode: 1,
        excerpt: 'npm test failed on the merged lanes\n\n2 tests failed',
        logPath: '/logs/final.log',
      },
    ])
  })

  it('hands over only why, when the check left no output', async () => {
    await seedFailedFinalCheck([finalCheckGate('G-final', [])])
    await call('foundry:inbox.decide', { gateId: 'G-final', option: 'send_back' })

    expect(node(await sentBack(), 'build:U-1')?.feedback[0]).toMatchObject({
      exitCode: null,
      excerpt: 'npm test failed on the merged lanes',
      logPath: null,
    })
  })
}

/** A step's own check failed twice: its gate names the node it holds. */
function stepGate(id: string): Gate {
  return raiseGate({
    id,
    rule: 'verify.repeat-fail',
    orderId,
    nodeId: 'docs',
    summary: 'docs failed twice',
    why: 'the docs check failed',
    evidence: [],
    at: AT,
  })
}

describe('sending a step back', () => {
  it('retries the step its gate names, and leaves the others as they were', async () => {
    await seedFailedFinalCheck([stepGate('G-step')])
    await call('foundry:inbox.decide', { gateId: 'G-step', option: 'send_back' })

    const graph = await sentBack()
    expect(node(graph, 'docs')?.state).not.toBe('passed')
    expect(node(graph, 'docs')?.feedback).toEqual([])
    expect(node(graph, 'build:U-1')?.state).toBe('passed')
  })
})
