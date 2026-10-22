/**
 * Where the Line's executor meets the application: real checkouts cut from a
 * real repository, a runner that answers the way the supervised runner does,
 * and the records the run leaves behind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { builderUnit } from '../helpers/order-parts.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  fakeHost,
  fakeRunner,
  gitAt,
  seededRepository,
  temporaryDirectory,
  type FoundryHost,
} from '../helpers/foundry-host.js'
import { buildExecutorDeps } from '../../src/line/executor-deps.js'
import { runtime, strandedAgents, pendingPermissions } from '../../src/runtime/runtime-state.js'
import { createSupervision } from '../../src/runtime/supervision.js'
import { createOrderStore } from '../../src/order/store.js'
import { createGateStore } from '../../src/gates/store.js'
import { raiseGate } from '../../src/gates/rules.js'
import { draftOrder } from '../../src/order/draft.js'
import { buildRunGraph, withNode, type RunGraph, type RunNode } from '../../src/line/run-graph.js'
import { resolveRecipe } from '../../src/recipe/resolve.js'
import { resolveSources } from '../../src/workspace-root.js'
import { checkoutPath } from '../../src/line/worktree.js'
import { transcriptPathFor } from '../../src/runtime/claude-launch.js'
import { readObservedFiles } from '../../src/line/observed-files.js'
import { orderDir } from '../../src/data-root.js'
import type { Recipe } from '../../src/recipe/parse.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { LadderStep } from '../../src/verify/ladder.js'
import type { ExecutorDeps } from '../../src/line/executor.js'
import { ledgerActions, orderLedger } from '../helpers/order-ledger.js'

let root: string
let repo: string
let host: FoundryHost
let runner: ReturnType<typeof fakeRunner>
let order: WorkOrder
let recipe: Recipe
let graph: RunGraph

function agreed(repoPath: string): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Make it red',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repoPath],
    now: '2026-10-12T10:00:00.000Z',
  })
  return {
    ...base,
    status: 'running',
    recipe: 'direct',
    plan: {
      ...base.plan,
      units: [builderUnit('U-1', { title: 'red text', touches: ['src/a.ts'] })],
    },
  }
}

beforeEach(async () => {
  const parent = temporaryDirectory('fdry-executor')
  vi.stubEnv('HOME', path.join(parent, 'home'))
  root = path.join(parent, 'records')
  repo = await seededRepository(parent)
  host = fakeHost(() => root)
  runner = fakeRunner()
  runtime.supervisedRunner = runner as never
  runtime.supervision = createSupervision({
    api: host.api,
    stateDir: path.join(parent, 'state'),
    onFeedChange: () => undefined,
  })
  order = agreed(repo)
  await createOrderStore(root).save(order)
  const resolved = resolveRecipe('direct', resolveSources(host.api, root))
  if (!resolved.ok) throw new Error(resolved.reason)
  recipe = resolved.resolved.value
  graph = buildRunGraph(order, recipe)
})

afterEach(() => {
  runtime.supervisedRunner = null
  runtime.supervision = null
  strandedAgents.clear()
  vi.unstubAllEnvs()
})

const builderNode = (): RunNode => graph.nodes.find((node) => node.role === 'builder') as RunNode

function runInput(over: Partial<Parameters<ExecutorDeps['run']>[0]> = {}) {
  return {
    node: builderNode(),
    role: 'builder',
    prompt: 'make the text red',
    resumeSessionId: undefined,
    readOnly: false,
    modelTier: 'deep' as const,
    effort: null,
    mayUseTool: () => true,
    outputPath: null,
    outputsDir: null,
    skillsMount: null,
    ...over,
  }
}

type StartInput = {
  worktreePath: string
  model: string
  addDirs?: string[]
  autoDecide: (tool: string, input: unknown) => { allow: boolean } | 'mode' | null
  onRegistered: (run: { sessionId: string; transcriptFrom: number }) => void
  onTurnEnd: (turns: number) => void
  onEnd: (exitCode: number | null) => void
  onPending: (pending: Record<string, unknown>) => void
  onResolved: (requestId: string, outcome: string) => void
  onAutoDenied: (tool: string, reason: string) => void
}

/** The runner starts the agent and hands back the callbacks it was given. */
function agentStarts(sessionId: string): { started: Promise<StartInput> } {
  let give: (input: StartInput) => void = () => undefined
  const started = new Promise<StartInput>((resolve) => (give = resolve))
  runner.start.mockImplementation((async (input: StartInput) => {
    input.onRegistered({ sessionId, transcriptFrom: 0 })
    give(input)
    return {
      sessionId,
      transcriptFrom: 0,
      terminalSessionId: `term-${sessionId}`,
      transcriptPath: path.join(root, `${sessionId}.jsonl`),
    }
  }) as never)
  return { started }
}

describe('an agent node', () => {
  describe('launching', launchingTests)
  describe('folders it may reach', foldersItMayReachTests)
  describe('failing and never starting', failingAndNeverStartingTests)
  describe('asking about a tool', askingAboutAToolTests)
  describe('refused tools', refusedToolsTests)
  describe('resuming', executorDepsResumingTests)
})

const step: LadderStep = {
  rung: 'L2',
  name: 'test',
  command: 'npm test',
  status: 'runnable',
  reason: '',
  check: 'test',
}

function launchingTests() {
  it('runs in the lane checkout under the records location, and is over when its turn ends', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const { started } = agentStarts('builder-1')
    const onStarted = vi.fn()
    const running = deps.run(runInput({ onStarted }))
    const input = await started
    expect(input.worktreePath).toBe(checkoutPath(root, order, 'app'))
    expect(onStarted).toHaveBeenCalledWith('builder-1')

    input.onTurnEnd(1)
    expect(await running).toEqual({ sessionId: 'builder-1', exitCode: 0, transcriptFrom: 0 })
    expect(runner.stop).toHaveBeenCalledWith('builder-1')
    // The lane's conversation is offered to the next node of the same role, never another.
    await vi.waitFor(() => expect(deps.sessionFor(1, 'builder')).toBe('builder-1'))
    expect(deps.sessionFor(1, 'verifier')).toBeUndefined()
    expect(runtime.supervision?.runs.get('builder-1')?.worktreePath).toBe(input.worktreePath)
  })

  it('launches a fast role on the small model', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const { started } = agentStarts('scribe-1')
    void deps.run(runInput({ role: 'scribe', modelTier: 'fast' }))
    expect((await started).model).toBe('haiku')
  })
}

function foldersItMayReachTests() {
  it('lets the agent reach its outputs folder, so it can publish what it wrote there', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const { started } = agentStarts('author-1')
    void deps.run(runInput({ outputsDir: '/orders/WO-1/outputs', skillsMount: '/mnt/skills' }))
    expect((await started).addDirs).toEqual(['/mnt/skills', '/orders/WO-1/outputs'])
  })

  it('adds no folder to a node with no skills and no outputs', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const { started } = agentStarts('builder-2')
    void deps.run(runInput())
    expect((await started).addDirs).toBeUndefined()
  })
}

function failingAndNeverStartingTests() {
  it('that ends with a failure is archived as stopped and reports its exit status', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const { started } = agentStarts('builder-2')
    const running = deps.run(runInput())
    const input = await started
    await vi.waitFor(() => expect(runtime.supervision?.runs.get('builder-2')).not.toBeNull())
    input.onEnd(3)
    expect((await running).exitCode).toBe(3)
    expect(runtime.supervision?.snapshot().history[0]).toMatchObject({
      sessionId: 'builder-2',
      outcome: 'stopped',
    })
  })

  it('reports nothing measured when the agent never started, or the runtime is not running', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    runner.start.mockResolvedValueOnce(null)
    expect((await deps.run(runInput())).exitCode).toBeNull()
    runner.start.mockRejectedValueOnce(new Error('no terminal'))
    expect((await deps.run(runInput())).exitCode).toBeNull()
    runtime.supervisedRunner = null
    expect(await deps.run(runInput())).toEqual({
      sessionId: `${builderNode().id}-unstarted`,
      exitCode: null,
    })
  })
}

function askingAboutAToolTests() {
  it('that asks about a tool is held for the operator and said so in the feed', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const { started } = agentStarts('builder-3')
    void deps.run(runInput())
    const input = await started
    strandedAgents.set('builder-3', { orderId: 'WO-1', sessionId: 'builder-3', at: 0 })
    input.onPending({
      sessionId: 'builder-3',
      requestId: 'req-1',
      toolName: 'Bash',
      summary: 'curl example.com',
      detail: null,
      at: Date.now(),
    })
    expect(pendingPermissions.sessionFor('req-1')).toBe('builder-3')
    expect(strandedAgents.has('builder-3')).toBe(false)
    const feed = runtime.supervision?.feed.list().map((entry) => entry.summary)
    expect(feed).toContain('asked about Bash: waiting for a decision')

    // Nobody answered: the call went to the terminal's own prompt, and the agent waits there.
    input.onResolved('req-1', 'handback')
    expect(pendingPermissions.sessionFor('req-1')).toBeNull()
    expect(strandedAgents.get('builder-3')).toMatchObject({ orderId: 'WO-1' })
  })
}

function refusedToolsTests() {
  it('that is refused a tool says so in the feed', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const { started } = agentStarts('verifier-1')
    void deps.run(runInput({ role: 'verifier', readOnly: true }))
    const input = await started
    expect(
      input.autoDecide('Write', { file_path: path.join(input.worktreePath, 'src/a.ts') })
    ).toMatchObject({ allow: false })
    input.onAutoDenied('Write', 'a verifier does not edit')
    expect(runtime.supervision?.feed.list().map((entry) => entry.summary)).toContain(
      'refused Write: a verifier does not edit'
    )
  })
}

function executorDepsResumingTests() {
  it('carries on the conversation a resumed run recorded on its graph', async () => {
    const resumed = withNode(graph, builderNode().id, { sessionId: 'earlier-builder' })
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph: resumed })
    expect(deps.sessionFor(1, 'builder')).toBe('earlier-builder')
  })

  it('ends the previous process of a conversation before it is resumed', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    let live = true
    runner.terminalFor.mockImplementation(() =>
      live ? { terminalSessionId: 'tab-1', projectId: 'p-1' } : null
    )
    runner.stop.mockImplementation(() => {
      live = false
      return true
    })
    await deps.endSession('builder-old')
    expect(runner.stop).toHaveBeenCalledWith('builder-old', 'continuing the lane in its next step')
  })
}

describe('a check rung', () => {
  describe('running and re-running', runningAndReRunningTests)
  describe('nothing to measure and the base branch', nothingToMeasureAndTheBaseBranchTests)
})

function runningAndReRunningTests() {
  it('runs in a terminal of its own, and is not run again on the same commit once it passed', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const log = path.join(root, 'logs', 'test.log')
    expect(await deps.runStep(step, log)).toBe(0)
    expect(runner.runCommand).toHaveBeenCalledTimes(1)
    expect(await deps.runStep(step, log)).toBe(0)
    expect(runner.runCommand).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(log, 'utf8')).toContain('already passed on this exact commit')
  })

  it('runs a repeat fresh, though the same commit already passed', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const log = path.join(root, 'logs', 'test.log')
    await deps.runStep(step, log)
    expect(await deps.runStep(step, log, { fresh: true })).toBe(0)
    expect(runner.runCommand).toHaveBeenCalledTimes(2)
  })

  it('runs again once the checkout changed', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    await deps.runStep(step, path.join(root, 'test.log'))
    fs.writeFileSync(path.join(checkoutPath(root, order, 'app'), 'new.txt'), 'x')
    await deps.runStep(step, path.join(root, 'test.log'))
    expect(runner.runCommand).toHaveBeenCalledTimes(2)
  })
}

function nothingToMeasureAndTheBaseBranchTests() {
  it('measures nothing when there is no command or no runtime', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    expect(await deps.runStep({ ...step, command: null }, '/x.log')).toBeNull()
    expect(await deps.runStepOnBase({ ...step, command: null }, '/x.log')).toBeNull()
    runtime.supervisedRunner = null
    expect(await deps.runStep(step, '/x.log')).toBeNull()
    expect(await deps.runStepOnBase(step, '/x.log')).toBeNull()
    expect(await deps.reinstall('change', '/x.log')).toBeNull()
    expect(
      await deps.runCommand({ node: builderNode(), command: 'make', title: 't', logPath: '/x' })
    ).toBeNull()
  })

  it('runs on the base branch in a checkout of its own, which is taken away again', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    runner.runCommand.mockResolvedValueOnce(1)
    expect(await deps.runStepOnBase(step, path.join(root, 'base.log'))).toBe(1)
    const ran = runner.runCommand.mock.calls[0][0] as { worktreePath: string; title: string }
    expect(ran.title).toBe('test on main')
    expect(ran.worktreePath).not.toBe(checkoutPath(root, order, 'app'))
    expect(fs.existsSync(ran.worktreePath)).toBe(true)
    await deps.releaseBase()
    expect(fs.existsSync(ran.worktreePath)).toBe(false)
  })
}

describe('a recipe command', () => {
  it('runs a recipe command in the lane checkout', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    runner.runCommand.mockResolvedValueOnce(2)
    expect(
      await deps.runCommand({
        node: builderNode(),
        command: 'make lint',
        title: 'lint',
        logPath: path.join(root, 'lint.log'),
      })
    ).toBe(2)
    expect(runner.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'make lint',
        worktreePath: checkoutPath(root, order, 'app'),
      })
    )
  })
})

describe('a reinstall', () => {
  it("reinstalls with the order's prepare command, and does nothing without one", async () => {
    const log = path.join(root, 'install.log')
    const bare = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    expect(await bare.deps.reinstall('change', log)).toBeNull()
    expect(await bare.deps.reinstall('base', log)).toBeNull()
    expect(runner.runCommand).not.toHaveBeenCalled()

    const { deps } = await buildWithPrepare('make deps')
    runner.runCommand.mockClear()
    expect(await deps.reinstall('change', log)).toBe(0)
    expect(runner.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'make deps' })
    )
  })
})

const withPrepare = (prepare: string): WorkOrder => ({
  ...order,
  context: { ...order.context, environment: { ...order.context.environment, prepare } },
})

const buildWithPrepare = (prepare: string) =>
  buildExecutorDeps(host.api, { root, order: withPrepare(prepare), recipe, graph })

describe('preparing a lane checkout', () => {
  it('runs the order prepare once, in a tab of its own, in a new checkout only', async () => {
    const prepared = withPrepare('make deps')
    await buildExecutorDeps(host.api, { root, order: prepared, recipe, graph })
    expect(runner.runCommand).toHaveBeenCalledTimes(1)
    expect(runner.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'make deps',
        worktreePath: checkoutPath(root, order, 'app'),
        title: 'Prepare the checkout',
      })
    )
    expect(await ledgerActions(root)).toContain('checkout.prepared')

    await buildExecutorDeps(host.api, { root, order: prepared, recipe, graph })
    expect(runner.runCommand).toHaveBeenCalledTimes(1)
  })

  it('runs nothing when the order has no prepare command', async () => {
    await buildExecutorDeps(host.api, { root, order, recipe, graph })
    expect(runner.runCommand).not.toHaveBeenCalled()
  })
})

describe('a checkout that could not be prepared', () => {
  it('records the exit code of a prepare that failed, and measures no check in that lane', async () => {
    runner.runCommand.mockResolvedValueOnce(2)
    const { deps } = await buildWithPrepare('make deps')
    const entries = await orderLedger(root)
    expect(entries.find((entry) => entry.action === 'checkout.prepare-failed')?.reason).toContain(
      'exited 2'
    )
    const log = path.join(root, 'logs', 'test.log')
    expect(await deps.runStep(step, log)).toBeNull()
    expect(runner.runCommand).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(log, 'utf8')).toContain(
      'not measured: the checkout could not be prepared'
    )
  })

  it('counts a prepare that could not run as a failed prepare', async () => {
    runtime.supervisedRunner = null
    const { deps } = await buildWithPrepare('make deps')
    expect(await ledgerActions(root)).toContain('checkout.prepare-failed')
    runtime.supervisedRunner = runner as never
    expect(await deps.runStep(step, path.join(root, 'test.log'))).toBeNull()
  })
})

describe('committing a node', () => {
  it('commits what the agent left, and calls an untouched tree clean', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const node = { ...builderNode(), startedAt: new Date(Date.now() + 60_000).toISOString() }
    expect(await deps.commitNode({ node, message: 'nothing' })).toEqual({ kind: 'clean' })
    fs.writeFileSync(path.join(checkoutPath(root, order, 'app'), 'red.css'), 'a { color: red }')
    expect((await deps.commitNode({ node, message: 'red' })).kind).toBe('committed')
  })

  it('counts a commit the agent made itself as a change', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const checkout = checkoutPath(root, order, 'app')
    const node = { ...builderNode(), startedAt: new Date(Date.now() - 60_000).toISOString() }
    fs.writeFileSync(path.join(checkout, 'red.css'), 'a { color: red }')
    await gitAt(checkout, 'add', '-A')
    await gitAt(checkout, 'commit', '-q', '-m', 'agent did it')
    expect(await deps.commitNode({ node, message: 'red' })).toEqual({ kind: 'committed' })
  })
})

const outputPath = (): string => path.join(orderDir(root, 'WO-1'), 'scout.json')

describe('what a rung hands back', () => {
  describe('nothing written', nothingWrittenTests)
  describe('what it wrote', whatItWroteTests)
})

function nothingWrittenTests() {
  it('is nothing when the rung wrote nothing', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    expect(
      await deps.collect({
        nodeId: 'scout',
        role: 'scout',
        outputPath: outputPath(),
        sessionId: null,
        lane: null,
      })
    ).toBeNull()
  })
}

/** What collecting the scout's rung is handed: it ran in no session this spec started. */
const scoutCollecting = () => ({
  nodeId: 'scout',
  role: 'scout',
  outputPath: outputPath(),
  sessionId: null,
  lane: null,
})

function whatItWroteTests() {
  it('goes onto the order when it is readable', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    fs.writeFileSync(
      outputPath(),
      JSON.stringify({ findings: { entryPoints: ['src/theme.ts'] }, note: 'read it' })
    )
    const input = scoutCollecting()
    const collected = await deps.collect(input)
    expect(collected?.note).toBe('read it')
    expect((await createOrderStore(root).load('WO-1'))?.context.entryPoints).toEqual([
      'src/theme.ts',
    ])
  })

  it('is refused on the record when it is not readable', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    fs.writeFileSync(outputPath(), 'not json')
    const input = scoutCollecting()
    expect(await deps.collect(input)).toBeNull()
    expect(await ledgerActions(root)).toContain('rung.refused')
  })
}

const PUBLISHED_LINK = 'https://claude.ai/artifact/YJeSCmFWK1GJC8X9ZXUpVf'
const authorOutput = (): string => path.join(orderDir(root, 'WO-1'), 'author.json')

function handBack(url: string): void {
  fs.writeFileSync(
    authorOutput(),
    JSON.stringify({ document: { path: '/tmp/report.html', url, location: 'published' } })
  )
}

function transcriptOf(entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify({ message: { content: [entry] } })).join('\n')
}

function sessionPublished(sessionId: string, url: string): void {
  const file = transcriptPathFor(checkoutPath(root, order, 'app'), sessionId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const input = { file_path: '/tmp/report.html' }
  fs.writeFileSync(
    file,
    transcriptOf([
      { type: 'tool_use', id: 'u1', name: 'Artifact', input },
      {
        type: 'tool_result',
        tool_use_id: 'u1',
        content: `Published /tmp/report.html at ${url} (Version 1, version id 1-ab)`,
      },
    ])
  )
}

async function collectAuthor(lane: number | null = 1) {
  const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
  const input = { nodeId: 'author', role: 'author', outputPath: authorOutput() }
  return deps.collect({ ...input, sessionId: 'sess-1', lane })
}

const savedDocument = async () => (await createOrderStore(root).load('WO-1'))?.document

function publishedDocumentTests() {
  it('is collected and saved when its session published that link', async () => {
    sessionPublished('sess-1', PUBLISHED_LINK)
    handBack(PUBLISHED_LINK)
    expect((await collectAuthor())?.document?.url).toBe(PUBLISHED_LINK)
    expect((await savedDocument())?.url).toBe(PUBLISHED_LINK)
  })

  it('is refused, on the record and unsaved, when its session never published the link', async () => {
    sessionPublished('sess-1', PUBLISHED_LINK)
    handBack('https://claude.ai/artifact/madeUpByTheAgent')
    expect(await collectAuthor()).toBeNull()
    expect(await ledgerActions(root)).toEqual(
      expect.arrayContaining(['document.link_unconfirmed', 'rung.refused'])
    )
    expect(await savedDocument()).toBeNull()
  })

  it('reads only the transcript in the author’s own lane', async () => {
    sessionPublished('sess-1', PUBLISHED_LINK)
    handBack(PUBLISHED_LINK)
    expect(await collectAuthor(2)).toBeNull()
  })

  it('is refused when the session left no transcript', async () => {
    handBack(PUBLISHED_LINK)
    expect(await collectAuthor()).toBeNull()
    expect(await ledgerActions(root)).toContain('document.link_unconfirmed')
  })
}

describe('a published document', publishedDocumentTests)

describe('the run’s records', () => {
  describe('gates', executorDepsGatesTests)
  describe('verdicts', executorDepsVerdictsTests)
  describe('the graph', executorDepsTheGraphTests)
  describe('measuring the change', measuringTheChangeTests)
})

function executorDepsGatesTests() {
  it('raises a gate on the inbox and names it on the ledger', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    await deps.raise(
      raiseGate({
        id: 'WO-1-conflict',
        rule: 'refinery.conflict',
        orderId: 'WO-1',
        summary: 's',
        why: 'it no longer rebases',
        evidence: [],
        at: '2026-10-12T10:00:00.000Z',
      })
    )
    expect((await createGateStore(root).list()).map((gate) => gate.id)).toEqual(['WO-1-conflict'])
    expect(await ledgerActions(root)).toContain('gate.raised')
  })
}

function executorDepsVerdictsTests() {
  it('records a verdict and nothing for any other event', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    deps.onEvent({
      type: 'verdict',
      verdict: {
        criterionId: 'AC-1',
        result: 'fail',
        reason: 'still blue',
        evidence: [],
        producedBy: { role: 'verifier' },
      },
    } as never)
    deps.onEvent({ type: 'wave', nodes: [] } as never)
    await deps.record('run.note', 'WO-1', 'a line')
    await vi.waitFor(async () =>
      expect((await ledgerActions(root)).sort()).toEqual(['run.note', 'verify.verdict'])
    )
    const entries = await createOrderStore(root).entries('WO-1')
    expect(entries.find((entry) => entry.action === 'verify.verdict')?.reason).toBe(
      'fail: still blue'
    )
  })
}

function executorDepsTheGraphTests() {
  it('writes the graph on every change, and the files a checkout changed once a step settles', async () => {
    const { deps } = await buildExecutorDeps(host.api, { root, order, recipe, graph })
    const checkout = checkoutPath(root, order, 'app')
    fs.mkdirSync(path.join(checkout, 'src'))
    fs.writeFileSync(path.join(checkout, 'src', 'a.ts'), 'export const red = 1\n')
    await gitAt(checkout, 'add', '-A')
    await gitAt(checkout, 'commit', '-q', '-m', 'red')

    await deps.persist(graph)
    expect(await readObservedFiles(root, 'WO-1')).toEqual([])
    await deps.persist(withNode(graph, builderNode().id, { state: 'passed' }))
    expect(await readObservedFiles(root, 'WO-1')).toEqual(['src/a.ts'])
    expect(
      JSON.parse(
        fs.readFileSync(path.join(orderDir(root, 'WO-1'), 'run-graph.json'), 'utf8')
      ).nodes.find((node: RunNode) => node.role === 'builder').state
    ).toBe('passed')
  })
}

function measuringTheChangeTests() {
  it('measures what the work changed, leaving lockfiles out of the line count', async () => {
    const { paths } = order.context.environment
    const withLockfiles = {
      ...order,
      context: {
        ...order.context,
        environment: {
          ...order.context.environment,
          paths: { ...paths, lockfiles: ['package-lock.json'] },
        },
      },
    }
    const { deps } = await buildExecutorDeps(host.api, {
      root,
      order: withLockfiles,
      recipe,
      graph,
    })
    const checkout = checkoutPath(root, order, 'app')
    fs.writeFileSync(path.join(checkout, 'a.ts'), 'one\ntwo\n')
    fs.writeFileSync(path.join(checkout, 'package-lock.json'), '{\n}\n')
    await gitAt(checkout, 'add', '-A')
    await gitAt(checkout, 'commit', '-q', '-m', 'work')
    const change = await deps.observedChange()
    expect([...change.changedFiles].sort()).toEqual(['a.ts', 'package-lock.json'])
    expect(change.linesChanged).toBe(2)
    expect((await deps.observe()).elapsedMinutes).toBeLessThan(1)
  })
}
