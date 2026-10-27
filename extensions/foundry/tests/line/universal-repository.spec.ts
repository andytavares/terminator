import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, gitAt, temporaryDirectory, execSucceeded } from '../helpers/foundry-host.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate, settleFoundryWork } from '../helpers/foundry-activation.js'
import { agentsAnswer, agreedLineOrder, checks, repositoryWithRemote } from '../helpers/line-run.js'
import { ledgerActions } from '../helpers/order-ledger.js'
import { theRunner } from '../helpers/supervision-mocks.js'
import { createOrderStore } from '../../src/order/store.js'
import { createGateStore } from '../../src/gates/store.js'
import { orderStoreAt } from '../../src/state/live-index.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { eventually } from '../../../../tests/support/eventually'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))

let dataDir = ''
let repo = ''
let control = ''
let host: FoundryHost
/** Each command the runner ran, once it ended, with where it ran. */
const finished: { command: string; where: string; exitCode: number | null }[] = []

beforeAll(async () => {
  vi.stubEnv('HOME', path.join(temporaryDirectory('universal-home'), 'home'))
  host = fakeHost(() => dataDir)
  await activateFoundry(host)
})

// Each test's proofs and runs end before the next test, or the spec's folder, goes.
afterEach(settleFoundryWork)

// Each order starts its base-branch proof, which writes into the spec's folder until it ends.

afterAll(async () => {
  await deactivate()
  vi.unstubAllEnvs()
})

/** The runner as the application has it: the command really runs, in the checkout it was given. */
function runForReal(input: unknown): Promise<number | null> {
  const { command, worktreePath, logPath } = input as {
    command: string
    worktreePath: string
    logPath?: string
  }
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', command], { cwd: worktreePath }, (error, stdout, stderr) => {
      if (logPath !== undefined) fs.writeFileSync(logPath, stdout + stderr)
      const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : null
      finished.push({ command, where: worktreePath, exitCode })
      resolve(exitCode)
    })
  })
}

beforeEach(async () => {
  const parent = temporaryDirectory('universal-repository')
  dataDir = path.join(parent, 'records')
  control = path.join(parent, 'exit-codes')
  repo = await repositoryWithRemote(parent)
  finished.length = 0
  agentsAnswer(theRunner, parent)
  host.gh.mockImplementation(async ({ args }: { args: string[] }) => {
    const verb = `${args[0]} ${args[1]}`
    if (verb === 'pr list') return execSucceeded('[]')
    if (verb === 'pr create') return execSucceeded('https://github.com/owner/app/pull/7\n')
    if (verb === 'pr checks') return execSucceeded(checks('pass'))
    return execSucceeded('')
  })
  theRunner.runCommand.mockReset().mockImplementation(runForReal)
})

/** Commits `files` (name to text) to main and pushes it; a name ending in `*` is executable. */
async function commitToMain(files: Record<string, string>): Promise<void> {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(repo, name.replace(/\*$/, ''))
    fs.writeFileSync(file, text, { mode: name.endsWith('*') ? 0o755 : 0o644 })
  }
  await gitAt(repo, 'add', '-A')
  await gitAt(repo, 'commit', '-q', '-m', 'add the repository')
  await gitAt(repo, 'push', '-q', 'origin', 'main')
}

/** A repository with no manifest: only a README and a script whose `test` exits as `control` says. */
async function glyphRepository(): Promise<void> {
  await commitToMain({
    'README.md': 'Run the tests with `./glyph test`\n',
    'glyph*': [
      '#!/bin/sh',
      `control="${control}"`,
      'case "$1" in',
      '  test)',
      '    code=$(head -n 1 "$control")',
      '    rest=$(tail -n +2 "$control")',
      '    if [ -n "$rest" ]; then printf \'%s\\n\' "$rest" > "$control"; fi',
      '    exit "$code" ;;',
      '  *) exit 2 ;;',
      'esac',
      '',
    ].join('\n'),
  })
}

// The exits of the next `./glyph test` runs; the last repeats. The recipe's own check
// step runs it first, so a leading 0 leaves the rest to the final check.
function glyphExits(...codes: number[]): void {
  fs.writeFileSync(control, `${codes.join('\n')}\n`)
}

async function createOrder(): Promise<WorkOrder> {
  const created = (await host.call('foundry:order.create', {
    source: { kind: 'typed', text: 'Make the greeting friendlier' },
    repoPaths: [repo],
  })) as { order: WorkOrder }
  return created.order
}

/** The environment is proven on the base branch in the background; its runs are not the order's. */
async function untilBaseProven(command: string): Promise<void> {
  await eventually(() =>
    expect(finished.some((run) => run.command === command && run.where.endsWith('@baseline'))).toBe(
      true
    )
  )
}

async function runAgreed(created: WorkOrder): Promise<void> {
  const agreed = agreedLineOrder(repo, { id: created.id, context: created.context })
  await orderStoreAt(dataDir).save(agreed)
  expect(await host.call('foundry:run.start', { id: agreed.id, recipe: 'direct' })).toMatchObject({
    started: true,
  })
}

const statusOf = async (id: string) => (await createOrderStore(dataDir).load(id))?.status
const gateRules = async () => (await createGateStore(dataDir).list()).map((gate) => gate.rule)
const runsInLanes = (command: string) =>
  finished.filter((run) => run.command === command && !run.where.endsWith('@baseline'))

async function glyphRepositoryWithOperatorTest(): Promise<void> {
  glyphExits(0)
  await glyphRepository()
  await host.call('foundry:profile-save', { repoPath: repo, checks: { test: './glyph test' } })
}

describe('a repository with a script and no manifest', () => {
  beforeEach(glyphRepositoryWithOperatorTest)

  it('carries the operator command in the order, as the operator’s', async () => {
    const order = await createOrder()
    expect(order.context.toolchain.test).toEqual({ command: './glyph test', source: 'operator' })
  })

  it('ships the draft when the script exits 0', async () => {
    const order = await createOrder()
    await untilBaseProven('./glyph test')
    await runAgreed(order)
    await eventually(async () => expect(await statusOf(order.id)).toBe('shipped'))
    expect(runsInLanes('./glyph test').map((run) => run.exitCode)).toContain(0)
  })
})

// A pass on the exact commit is reused by the final check (verify/pass-cache.ts), so the
// script fails from the recipe's own check on, and its rework fails too.
describe('a script that keeps failing after the base passed', () => {
  beforeEach(glyphRepositoryWithOperatorTest)

  it('stops at a gate when the script exits 1', async () => {
    const order = await createOrder()
    await untilBaseProven('./glyph test')
    glyphExits(1)
    await runAgreed(order)
    await eventually(async () => expect(await gateRules()).toContain('verify.repeat-fail'))
    expect(await statusOf(order.id)).not.toBe('shipped')
    expect(runsInLanes('./glyph test').at(-1)?.exitCode).toBe(1)
  })
})

describe('a repository with only a Makefile', () => {
  it('takes `make test` as a hint, runs it for real, and ships on its exit code', async () => {
    await commitToMain({ Makefile: 'test:\n\t@echo the suite passed\n' })
    const order = await createOrder()
    expect(order.context.toolchain.test).toMatchObject({ command: 'make test', source: 'hint' })
    await untilBaseProven('make test')
    await runAgreed(order)
    await eventually(async () => expect(await statusOf(order.id)).toBe('shipped'))
    expect(runsInLanes('make test').map((run) => run.exitCode)).toContain(0)
  })
})

describe('a repository with nothing to read', () => {
  it('measures no check and reports none as passed', async () => {
    const order = await createOrder()
    expect(Object.values(order.context.toolchain)).toEqual(
      Object.values(order.context.toolchain).map(() => null)
    )
    await runAgreed(order)
    await eventually(async () => expect(await gateRules()).toContain('ready-for-review'))
    expect(finished).toEqual([])
    expect(await ledgerActions(dataDir)).not.toContain('step.passed')
  })
})
