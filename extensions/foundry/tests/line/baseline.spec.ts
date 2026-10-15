import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  baselineSteps,
  proveEnvironment,
  readBaseline,
  recordedOnBase,
  writeBaseline,
} from '../../src/line/baseline.js'
import type { Baseline, BaselineDeps } from '../../src/line/baseline.js'
import { runStepOnBaseCheckout } from '../../src/line/lane-commands.js'
import type { RunContext } from '../../src/line/run-context.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { runtime } from '../../src/runtime/runtime-state.js'
import type { SupervisedRunner } from '../../src/runtime/supervised-runner.js'
import type { StepOutcome } from '../../src/verify/ladder.js'
import type { LedgerEntry } from '../../src/ledger/append.js'
import { probeToolchain } from '../../src/verify/toolchain-probe.js'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { partialFake } from '../../../../tests/support/fakes'
import { gitAt, realGit, seededRepository, temporaryDirectory } from '../helpers/foundry-host.js'

// The base branch proven while an order is shaped: the recorded result, and the
// final check taking it instead of running the command again.

const MISSING_PACKAGE_LOG = "Error: Cannot find package 'vitest' imported from /x\n"
let parent: string
let repo: string
let commands: Record<string, string>

beforeEach(async () => {
  parent = temporaryDirectory('baseline')
  repo = await seededRepository(parent)
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({
      scripts: { format: 'prettier --check .', lint: 'eslint .', test: 'vitest run', build: 'tsc' },
    })
  )
  fs.writeFileSync(path.join(repo, 'package-lock.json'), '{}')
  await gitAt(repo, 'add', '-A')
  await gitAt(repo, 'commit', '-q', '-m', 'scripts')
  const toolchain = probeToolchain(repo)
  commands = {
    Format: toolchain.format?.command ?? '',
    Lint: toolchain.lint?.command ?? '',
    Tests: toolchain.test?.command ?? '',
    Build: toolchain.build?.command ?? '',
  }
})

afterEach(() => {
  fs.rmSync(parent, { recursive: true, force: true })
})

function orderOn(repoPath: string): WorkOrder {
  return draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repoPath],
    now: '2026-09-06T10:00:00.000Z',
  })
}

interface Terminal {
  exitFor?: (command: string) => number | null
  logFor?: (command: string) => string
}

/** A terminal tab: runs `exitFor(command)` and writes `logFor(command)` to the log. */
function terminalRunner(terminal: Terminal, ran: string[]): BaselineDeps['runCommand'] {
  return async ({ command, logPath }) => {
    ran.push(command)
    if (logPath !== undefined) fs.writeFileSync(logPath, terminal.logFor?.(command) ?? '')
    return terminal.exitFor === undefined ? 0 : terminal.exitFor(command)
  }
}

function harness(terminal: Terminal = {}) {
  const ledger: LedgerEntry[] = []
  const ran: string[] = []
  const deps: BaselineDeps = {
    root: path.join(parent, 'data'),
    now: () => '2026-09-06T10:00:00.000Z',
    exec: realGit,
    workspaceOf: () => 'workspace-1',
    record: async (entry) => {
      ledger.push(entry)
    },
    runCommand: terminalRunner(terminal, ran),
  }
  return { deps, ledger, ran }
}

async function baselineAfter(h: ReturnType<typeof harness>): Promise<Baseline> {
  await proveEnvironment(orderOn(repo), h.deps)
  const baseline = await readBaseline(h.deps.root, 'WO-1')
  if (baseline === null) throw new Error('no baseline was written')
  return baseline
}

describe('proveEnvironment', () => {
  it('records a proven base and says so in the ledger when every check passes', async () => {
    const h = harness()
    const baseline = await baselineAfter(h)
    const head = (await gitAt(repo, 'rev-parse', 'main')).stdout.trim()
    expect(baseline).toMatchObject({ state: 'proven', baseBranch: 'main', commit: head })
    expect(baseline.steps.map((s) => [s.name, s.result])).toEqual([
      ['Format', 'pass'],
      ['Lint', 'pass'],
      ['Tests', 'pass'],
      ['Build', 'pass'],
    ])
    expect(h.ledger.map((e) => e.action)).toEqual(['environment.checking', 'environment.proven'])
    expect(h.ledger[0]).toMatchObject({ actor: 'rule:environment', subject: 'main' })
  })
})

describe('proveEnvironment on a failing base', () => {
  it('runs every check even after one fails, and names the failure with its evidence', async () => {
    const h = harness({
      exitFor: (c) => (c === commands.Tests ? 1 : 0),
      logFor: (c) => (c === commands.Tests ? 'line one\n1 test failed\n' : ''),
    })
    const baseline = await baselineAfter(h)
    expect(baseline.state).toBe('failing')
    expect(h.ran).toContain(commands.Build)
    const last = h.ledger[h.ledger.length - 1]
    expect(last?.action).toBe('environment.failing')
    expect(last?.reason).toBe(`Tests failed on main with exit code 1: \`${commands.Tests}\`.`)
    expect(last?.evidence).toEqual([
      expect.objectContaining({
        kind: 'stdout',
        exitCode: 1,
        excerpt: expect.stringContaining('1 test failed'),
      }),
    ])
  })
})

describe('proveEnvironment on a broken install', () => {
  it('reinstalls once and runs the checks again when a log shows a broken install', async () => {
    let testRuns = 0
    const h = harness({
      exitFor: (c) => (c === commands.Tests && ++testRuns === 1 ? 1 : 0),
      logFor: (c) => (c === commands.Tests ? MISSING_PACKAGE_LOG : ''),
    })
    const baseline = await baselineAfter(h)
    expect(h.ran.filter((c) => c === 'npm ci')).toHaveLength(1)
    expect(h.ran.filter((c) => c === commands.Format)).toHaveLength(2)
    expect(baseline).toMatchObject({ state: 'proven', mended: true })
  })
})

describe('proveEnvironment on a base that cannot be checked', () => {
  it('records a step that did not run as not measured, and is still proven', async () => {
    const h = harness({ exitFor: (c) => (c === commands.Build ? null : 0) })
    const baseline = await baselineAfter(h)
    expect(baseline.state).toBe('proven')
    expect(baseline.steps.find((s) => s.name === 'Build')?.result).toBe('not_measured')
  })

  it('records a plain reason when the base cannot be checked out', async () => {
    const h = harness()
    const order = orderOn(path.join(parent, 'missing'))
    await proveEnvironment(order, h.deps)
    const baseline = await readBaseline(h.deps.root, 'WO-1')
    expect(baseline?.state).toBe('failing')
    expect(h.ledger[h.ledger.length - 1]?.reason).toMatch(/^Could not check main: .+\.$/)
  })

  it('takes the base checkout away whether the checks passed or failed', async () => {
    await baselineAfter(harness({ exitFor: () => 1 }))
    const listed = (await gitAt(repo, 'worktree', 'list', '--porcelain')).stdout
    expect(listed.split('\n').filter((l) => l.startsWith('worktree '))).toHaveLength(1)
  })
})

describe('baselineSteps', () => {
  it('keeps only the checks the repository has', () => {
    const toolchain = probeToolchain(repo)
    expect(baselineSteps({ ...toolchain, lint: null, build: null }).map((s) => s.name)).toEqual([
      'Format',
      'Tests',
    ])
  })
})

const TESTS_FAILED: StepOutcome = {
  rung: 'L1',
  name: 'Tests',
  result: 'fail',
  reason: '',
  exitCode: 1,
  command: 'npm test',
}
const BUILD_NOT_RUN: StepOutcome = {
  ...TESTS_FAILED,
  name: 'Build',
  result: 'not_measured',
  exitCode: null,
  command: 'npm run build',
}

function recordedBaseline(over: Partial<Baseline> = {}): Baseline {
  return {
    state: 'failing',
    startedAt: 't',
    finishedAt: 't',
    baseBranch: 'main',
    commit: 'abc',
    logs: {},
    mended: false,
    steps: [TESTS_FAILED, BUILD_NOT_RUN],
    ...over,
  }
}

describe('recordedOnBase', () => {
  it('answers with the recorded exit code for the same command on the same commit', () => {
    expect(recordedOnBase(recordedBaseline(), 'npm test', 'abc')).toBe(1)
  })

  it('answers nothing for another commit, another command or a step that did not run', () => {
    expect(recordedOnBase(recordedBaseline(), 'npm test', 'def')).toBeNull()
    expect(recordedOnBase(recordedBaseline(), 'npm run lint', 'abc')).toBeNull()
    expect(recordedOnBase(recordedBaseline(), 'npm run build', 'abc')).toBeNull()
    expect(recordedOnBase(recordedBaseline({ commit: null }), 'npm test', null)).toBeNull()
    expect(recordedOnBase(null, 'npm test', 'abc')).toBeNull()
  })
})

const TESTS_STEP = {
  rung: 'L1',
  name: 'Tests',
  command: 'npm test',
  status: 'runnable',
  reason: '',
  check: 'test',
} as const

async function contextWithBaselineAt(commit: string): Promise<RunContext> {
  const root = path.join(parent, 'data')
  await writeBaseline(root, 'WO-1', recordedBaseline({ commit }))
  return partialFake<RunContext>({
    api: partialFake<ExtensionAPI>({}),
    root,
    order: orderOn(repo),
    exec: realGit,
    checkouts: new Map(),
    base: { current: null },
  })
}

describe('runStepOnBaseCheckout', () => {
  const runCommand = vi.fn<BaselineDeps['runCommand']>()

  beforeEach(() => {
    runCommand.mockReset().mockResolvedValue(0)
    runtime.supervisedRunner = partialFake<SupervisedRunner>({ runCommand })
  })
  afterEach(() => {
    runtime.supervisedRunner = null
  })

  it('returns the recorded code and writes why, without running the command', async () => {
    const head = (await gitAt(repo, 'rev-parse', 'main')).stdout.trim()
    const logPath = path.join(parent, 'logs', 'tests.log')
    const context = await contextWithBaselineAt(head)
    expect(await runStepOnBaseCheckout(context, TESTS_STEP, logPath)).toBe(1)
    expect(runCommand).not.toHaveBeenCalled()
    expect(fs.readFileSync(logPath, 'utf8')).toContain(
      `\`npm test\` already ran on main at ${head.slice(0, 7)} while the order was shaped (exit 1); not run again.`
    )
  })

  it('runs the command when the base has moved since it was recorded', async () => {
    const context = await contextWithBaselineAt('0'.repeat(40))
    await runStepOnBaseCheckout(context, TESTS_STEP, path.join(parent, 'logs', 'tests.log'))
    expect(runCommand).toHaveBeenCalledOnce()
    await gitAt(repo, 'worktree', 'prune')
  })
})
