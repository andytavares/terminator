import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { proveEnvironment, readBaseline } from '../../src/line/baseline.js'
import type { BaselineDeps } from '../../src/line/baseline.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { readProfile } from '../../src/profile/store.js'
import { gitAt, realGit, seededRepository, temporaryDirectory } from '../helpers/foundry-host.js'

// The proof runs what the order carries, in the order the ladder reads it, and
// leaves its exit codes in the repository's profile.

let parent: string
let repo: string

beforeEach(async () => {
  parent = temporaryDirectory('baseline-order')
  repo = await seededRepository(parent)
})

afterEach(() => {
  fs.rmSync(parent, { recursive: true, force: true })
})

function orderCarrying(context: Partial<WorkOrder['context']>): WorkOrder {
  const order = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...order, context: { ...order.context, ...context } }
}

const entry = (command: string) => ({ command, source: 'operator' as const })

function harness(exitFor: (command: string) => number | null = () => 0) {
  const ran: string[] = []
  const deps: BaselineDeps = {
    root: path.join(parent, 'data'),
    now: () => '2026-09-06T10:00:00.000Z',
    exec: realGit,
    workspaceOf: () => 'workspace-1',
    record: async () => undefined,
    runCommand: async ({ command, logPath }) => {
      ran.push(command)
      if (logPath !== undefined) fs.writeFileSync(logPath, '')
      return exitFor(command)
    },
  }
  return { deps, ran }
}

const context = (): Partial<WorkOrder['context']> => ({
  toolchain: {
    format: null,
    lint: entry('make lint'),
    test: entry('make test'),
    coverage: null,
    e2e: null,
    build: entry('make build'),
  },
  environment: {
    prepare: 'make setup',
    share: [],
    pictures: null,
    paths: { interface: [], manifests: [], lockfiles: [], formatting: [] },
    additional: [{ name: 'Types', command: 'make types', rung: 'L1' }],
  },
})

describe('proveEnvironment from the order', () => {
  it('prepares the checkout, then runs the checks, then the additional ones', async () => {
    const h = harness()
    await proveEnvironment(orderCarrying(context()), h.deps)
    expect(h.ran).toEqual(['make setup', 'make lint', 'make test', 'make build', 'make types'])
    const baseline = await readBaseline(h.deps.root, 'WO-1')
    expect(baseline?.steps.map((step) => step.name)).toEqual([
      'Prepare the checkout',
      'Lint',
      'Tests',
      'Build',
      'Types',
    ])
  })
})

describe('proveEnvironment from an order with little to run', () => {
  it('does not look at the checkout for commands the order lacks', async () => {
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }))
    await gitAt(repo, 'add', '-A')
    await gitAt(repo, 'commit', '-q', '-m', 'scripts')
    const h = harness()
    await proveEnvironment(orderCarrying({}), h.deps)
    expect(h.ran).toEqual([])
    expect((await readBaseline(h.deps.root, 'WO-1'))?.state).toBe('failing')
  })

  it('does not call a base proven when only the preparation passed', async () => {
    const h = harness()
    const prepareOnly = { environment: { ...context().environment!, additional: [] } }
    await proveEnvironment(orderCarrying(prepareOnly), h.deps)
    expect((await readBaseline(h.deps.root, 'WO-1'))?.state).toBe('failing')
  })
})

describe('proveEnvironment and the repository profile', () => {
  it('writes the exit codes and the commit into the repository profile', async () => {
    const h = harness((command) => (command === 'make test' ? 1 : 0))
    await proveEnvironment(orderCarrying(context()), h.deps)
    const head = (await gitAt(repo, 'rev-parse', 'main')).stdout.trim()
    const profile = await readProfile(h.deps.root, repo)
    expect(profile?.proof).toMatchObject({
      commit: head,
      exitCodes: {
        'make setup': 0,
        'make lint': 0,
        'make test': 1,
        'make build': 0,
        'make types': 0,
      },
    })
  })
})
