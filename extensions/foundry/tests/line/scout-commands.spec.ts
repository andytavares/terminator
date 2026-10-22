import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { BaselineDeps } from '../../src/line/baseline.js'
import { proveScoutCommands } from '../../src/line/scout-commands.js'
import type { LedgerEntry } from '../../src/ledger/append.js'
import { draftOrder } from '../../src/order/draft.js'
import { createOrderStore } from '../../src/order/store.js'
import type { OrderStore } from '../../src/order/store.js'
import { readProfile, writeProfile } from '../../src/profile/store.js'
import { emptyProfile } from '../../src/profile/schema.js'
import { gitAt, realGit, seededRepository, temporaryDirectory } from '../helpers/foundry-host.js'

// A command the scout read out of the repository is proved on the base branch
// before anything trusts it, and never replaces a command someone else gave.

let parent: string
let repo: string
let root: string
let store: OrderStore
let ran: string[]

beforeEach(async () => {
  parent = temporaryDirectory('scout-commands')
  repo = await seededRepository(parent)
  root = path.join(parent, 'data')
  store = createOrderStore(root)
  ran = []
  const order = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-09-06T10:00:00.000Z',
  })
  await store.save(order)
})

afterEach(() => {
  fs.rmSync(parent, { recursive: true, force: true })
})

function depsExiting(exitFor: (command: string) => number | null) {
  const base: BaselineDeps = {
    root,
    now: () => '2026-09-06T10:00:00.000Z',
    exec: realGit,
    workspaceOf: () => 'workspace-1',
    record: store.record,
    runCommand: async ({ command, logPath }) => {
      ran.push(command)
      if (logPath !== undefined) fs.writeFileSync(logPath, '')
      return exitFor(command)
    },
  }
  return { base, store }
}

const lintProposal = { check: 'lint', command: 'make lint', evidence: 'Makefile:12' } as const

async function ledgerActions(): Promise<string[]> {
  return (await store.entries('WO-1')).map((entry: LedgerEntry) => entry.action)
}

describe('proveScoutCommands', () => {
  it('stores a command that exits 0 on the base, in the profile and on the order', async () => {
    await proveScoutCommands(
      'WO-1',
      [lintProposal],
      depsExiting(() => 0)
    )
    const profile = await readProfile(root, repo)
    expect(profile?.checks.lint).toEqual({
      command: 'make lint',
      source: 'scout',
      evidence: 'Makefile:12',
    })
    const head = (await gitAt(repo, 'rev-parse', 'main')).stdout.trim()
    expect(profile?.proof).toMatchObject({ commit: head, exitCodes: { 'make lint': 0 } })
    const order = await store.load('WO-1')
    expect(order?.context.toolchain.lint).toEqual({
      command: 'make lint',
      source: 'scout',
      evidence: 'Makefile:12',
    })
    expect(await ledgerActions()).toEqual(['scout.command.proved'])
  })
})

describe('proveScoutCommands on a command that does not hold', () => {
  it('stores nothing for a command that exits 1, and says so in the ledger', async () => {
    await proveScoutCommands(
      'WO-1',
      [lintProposal],
      depsExiting(() => 1)
    )
    expect(await readProfile(root, repo)).toBeNull()
    expect((await store.load('WO-1'))?.context.toolchain.lint).toBeNull()
    const [entry] = await store.entries('WO-1')
    expect(entry).toMatchObject({ action: 'scout.command.unproved', actor: 'role:scout' })
    expect(entry?.reason).toContain('exited 1')
  })

  it('stores nothing for a command that did not run to an exit', async () => {
    await proveScoutCommands(
      'WO-1',
      [lintProposal],
      depsExiting(() => null)
    )
    expect((await store.load('WO-1'))?.context.toolchain.lint).toBeNull()
    expect(await ledgerActions()).toEqual(['scout.command.unproved'])
  })
})

describe('proveScoutCommands beside commands already given', () => {
  it('never replaces a command the order already has, and does not run the proposal', async () => {
    const order = await store.load('WO-1')
    if (order === null) throw new Error('no order')
    const given = { command: 'npm run lint', source: 'repository' as const }
    await store.save({
      ...order,
      context: { ...order.context, toolchain: { ...order.context.toolchain, lint: given } },
    })
    await proveScoutCommands(
      'WO-1',
      [lintProposal],
      depsExiting(() => 0)
    )
    expect(ran).toEqual([])
    expect((await store.load('WO-1'))?.context.toolchain.lint).toEqual(given)
    expect(await ledgerActions()).toEqual(['scout.command.skipped'])
  })
})

describe('proveScoutCommands beside an operator command', () => {
  it('never replaces an operator command in the stored profile', async () => {
    const operator = { command: 'make check', source: 'operator' as const }
    await writeProfile(root, repo, {
      ...emptyProfile(repo),
      checks: { ...emptyProfile(repo).checks, lint: operator },
    })
    await proveScoutCommands(
      'WO-1',
      [lintProposal],
      depsExiting(() => 0)
    )
    expect((await readProfile(root, repo))?.checks.lint).toEqual(operator)
    expect(ran).toEqual([])
  })
})
