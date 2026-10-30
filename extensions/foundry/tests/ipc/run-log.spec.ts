/** The run log: every station's words, the ledger and the command logs, merged in time order. */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, temporaryDirectory, type FoundryHost } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate, settleFoundryWork } from '../helpers/foundry-activation.js'
import { orderStoreAt, writeGraph } from '../../src/state/live-index.js'
import { draftOrder } from '../../src/order/draft.js'
import { orderDir } from '../../src/data-root.js'
import type { RunGraph, RunNode } from '../../src/line/run-graph.js'
import { partialFake } from '../../../../tests/support/fakes'
import type { RunLogLine } from '../../src/ipc/run-log.js'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))

const { runtime } = await import('../../src/runtime/runtime-state.ts')

let dataDir = ''
let host: FoundryHost

beforeAll(async () => {
  vi.stubEnv('HOME', temporaryDirectory('fdry-home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

afterEach(settleFoundryWork)

afterAll(async () => {
  await deactivate()
  vi.unstubAllEnvs()
})

const at = (second: number): string => `2026-10-12T10:00:${String(second).padStart(2, '0')}.000Z`

function transcript(name: string, lines: [number, string, string][]): string {
  const file = path.join(dataDir, `${name}.jsonl`)
  const entries = lines.map(([second, type, text]) => ({
    type: 'assistant',
    timestamp: at(second),
    message: {
      content: [
        type === 'tool'
          ? { type: 'tool_use', name: 'Bash', input: { command: text } }
          : { type: 'text', text },
      ],
    },
  }))
  fs.writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  return file
}

function stationNode(id: string, role: string, sessionId: string | null): RunNode {
  return partialFake<RunNode>({
    id,
    stepId: id,
    kind: 'agent',
    role,
    unitIds: [],
    sessionId,
    worktreePath: '/repos/app',
  })
}

function watch(sessionId: string, transcriptPath: string): void {
  runtime.supervision?.runs.add({
    sessionId,
    featureDir: orderDir(dataDir, 'WO-1'),
    phase: 'builder',
    worktreePath: '/repos/app',
    branch: 'foundry/WO-1',
    baseBranch: 'main',
    terminalSessionId: `term-${sessionId}`,
    transcriptPath,
    startedAt: Date.now(),
  })
}

async function seed(nodes: RunNode[]): Promise<void> {
  await writeGraph(dataDir, partialFake<RunGraph>({ orderId: 'WO-1', recipe: 'direct', nodes }))
}

const readLog = async (limit?: number): Promise<RunLogLine[]> =>
  ((await host.call('foundry:run-log', { orderId: 'WO-1', limit })) as { lines: RunLogLine[] })
    .lines

beforeEach(async () => {
  dataDir = temporaryDirectory('fdry-run-log')
  await orderStoreAt(dataDir).save(
    draftOrder({
      id: 'WO-1',
      title: 'Make it red',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/app'],
      now: at(0),
    })
  )
})

const runsFolder = (): string => path.join(orderDir(dataDir, 'WO-1'), 'runs')
const heads = (lines: RunLogLine[]): string[] => lines.map((line) => line.text.split(' · ')[0])

async function seedTwoStationsAndTheLedger(): Promise<void> {
  watch(
    's-build',
    transcript('build', [
      [1, 'text', 'reading tokens'],
      [4, 'tool', 'ls'],
    ])
  )
  watch('s-check', transcript('check', [[3, 'text', 'checking']]))
  await seed([stationNode('n1', 'builder', 's-build'), stationNode('n2', 'verifier', 's-check')])
  await orderStoreAt(dataDir).record({
    at: at(2),
    orderId: 'WO-1',
    actor: 'operator',
    action: 'approve',
    subject: 'plan',
    reason: 'looks right',
    evidence: [],
  })
}

describe('the run log', () => {
  describe('merging', mergingTests)
  describe('limits and growth', limitsTests)
  describe('a long command log', longCommandLogTests)
})

function mergingTests() {
  it('merges two stations and the ledger in time order, named by station', async () => {
    await seedTwoStationsAndTheLedger()
    const lines = (await readLog()).filter((line) => line.kind !== 'command')
    expect(lines.map((line) => [line.station, line.kind, line.text])).toEqual([
      ['builder', 'say', 'reading tokens'],
      ['operator', 'decision', 'approve · looks right'],
      ['verifier', 'say', 'checking'],
      ['builder', 'tool', 'Bash: ls'],
    ])
  })

  it('adds a command log as a header line and its lines', async () => {
    fs.mkdirSync(runsFolder(), { recursive: true })
    fs.writeFileSync(path.join(runsFolder(), 'lint.log'), 'ok\ndone\n')
    const lines = await readLog()
    expect(heads(lines)).toEqual(['lint.log', 'ok', 'done'])
    expect(lines.map((line) => line.logPath)).toEqual(
      Array(3).fill(path.join(runsFolder(), 'lint.log'))
    )
  })

  it('adds nothing for a node that has no session', async () => {
    await seed([stationNode('n1', 'builder', null)])
    expect(await readLog()).toEqual([])
  })
}

function limitsTests() {
  it('keeps the newest lines when there are more than the limit', async () => {
    watch(
      's-build',
      transcript('build', [
        [1, 'text', 'one'],
        [2, 'text', 'two'],
        [3, 'text', 'three'],
      ])
    )
    await seed([stationNode('n1', 'builder', 's-build')])
    expect((await readLog(2)).map((line) => line.text)).toEqual(['two', 'three'])
  })

  it('shows the new lines of a log that grew since the last read', async () => {
    fs.mkdirSync(runsFolder(), { recursive: true })
    fs.writeFileSync(path.join(runsFolder(), 'test.log'), 'first\n')
    expect(heads(await readLog())).toEqual(['test.log', 'first'])
    fs.appendFileSync(path.join(runsFolder(), 'test.log'), 'second\n')
    expect(heads(await readLog())).toEqual(['test.log', 'first', 'second'])
  })

  it('refuses a limit past the maximum', async () => {
    expect(await host.call('foundry:run-log', { orderId: 'WO-1', limit: 5001 })).toEqual({
      lines: [],
    })
  })
}

function longCommandLogTests() {
  it('keeps what the stations said when a newer command log is longer than the limit', async () => {
    await seedTwoStationsAndTheLedger()
    fs.mkdirSync(runsFolder(), { recursive: true })
    const suite = Array.from({ length: 600 }, (_, i) => `test ${i}`).join('\n')
    fs.writeFileSync(path.join(runsFolder(), 'e2e.log'), `${suite}\n`)
    const lines = await readLog(10)
    expect(lines.filter((line) => line.kind !== 'command').map((line) => line.text)).toEqual([
      'reading tokens',
      'approve · looks right',
      'checking',
      'Bash: ls',
    ])
    const body = lines.filter((line) => line.kind === 'command').slice(1)
    expect(body).toHaveLength(200)
    expect(body.at(-1)?.text).toBe('test 599')
  })
}
