import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { keepScoutCommands } from '../../src/line/scout-commands.js'
import type { LedgerEntry } from '../../src/ledger/append.js'
import { draftOrder } from '../../src/order/draft.js'
import { createOrderStore } from '../../src/order/store.js'
import type { OrderStore } from '../../src/order/store.js'
import { readProfile, writeProfile } from '../../src/profile/store.js'
import { emptyProfile } from '../../src/profile/schema.js'
import { seededRepository, temporaryDirectory } from '../helpers/foundry-host.js'

// A command the scout read out of the repository fills a check that has none, unproven
// and never run on the base (ADR 137); it never replaces a command someone else gave.

let parent: string
let repo: string
let root: string
let store: OrderStore

beforeEach(async () => {
  parent = temporaryDirectory('scout-commands')
  repo = await seededRepository(parent)
  root = path.join(parent, 'data')
  store = createOrderStore(root)
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

function keepDeps() {
  return { root, now: () => '2026-09-06T10:00:00.000Z', store }
}

const lintProposal = { check: 'lint', command: 'make lint', evidence: 'Makefile:12' } as const

async function ledgerActions(): Promise<string[]> {
  return (await store.entries('WO-1')).map((entry: LedgerEntry) => entry.action)
}

describe('keepScoutCommands', () => {
  it('keeps a proposal for an empty check unproven, in the profile and on the order, running nothing', async () => {
    await keepScoutCommands('WO-1', [lintProposal], keepDeps())
    const kept = { command: 'make lint', source: 'scout', evidence: 'Makefile:12' }
    const profile = await readProfile(root, repo)
    expect(profile?.checks.lint).toEqual(kept)
    expect(profile?.proof).toBeNull()
    expect((await store.load('WO-1'))?.context.toolchain.lint).toEqual(kept)
    const [entry] = await store.entries('WO-1')
    expect(entry).toMatchObject({ action: 'scout.command.kept', actor: 'role:scout' })
    expect(entry?.reason).toBe("Kept the scout's `make lint` for lint, not run.")
  })
})

/** The store, with the architect's draft landing after the scout last read and before it writes. */
function storeWithADraftLandingMidway(): OrderStore {
  let landed = false
  let loads = 0
  const land = async (id: string): Promise<void> => {
    if (landed) return
    landed = true
    await store.update(id, (o) => ({ ...o, title: 'drafted by the architect' }))
  }
  return {
    ...store,
    // The scout's reads: its first picks the proposals, a second is the one it would write over.
    load: async (id) => {
      const loaded = await store.load(id)
      loads += 1
      if (loads === 2) await land(id)
      return loaded
    },
    update: async (id, change) => {
      await land(id)
      return store.update(id, change)
    },
  }
}

describe('keepScoutCommands beside a draft written at the same time', () => {
  it('keeps both the draft and the command', async () => {
    await keepScoutCommands('WO-1', [lintProposal], {
      ...keepDeps(),
      store: storeWithADraftLandingMidway(),
    })
    const saved = await store.load('WO-1')
    expect(saved?.title).toBe('drafted by the architect')
    expect(saved?.context.toolchain.lint?.command).toBe('make lint')
  })
})

describe('keepScoutCommands beside commands already given', () => {
  it('never replaces a command the order already has, and does not run the proposal', async () => {
    const order = await store.load('WO-1')
    if (order === null) throw new Error('no order')
    const given = { command: 'npm run lint', source: 'repository' as const }
    await store.save({
      ...order,
      context: { ...order.context, toolchain: { ...order.context.toolchain, lint: given } },
    })
    await keepScoutCommands('WO-1', [lintProposal], keepDeps())
    expect((await store.load('WO-1'))?.context.toolchain.lint).toEqual(given)
    expect(await ledgerActions()).toEqual(['scout.command.skipped'])
  })
})

describe('keepScoutCommands beside an operator command', () => {
  it('never replaces an operator command in the stored profile', async () => {
    const operator = { command: 'make check', source: 'operator' as const }
    await writeProfile(root, repo, {
      ...emptyProfile(repo),
      checks: { ...emptyProfile(repo).checks, lint: operator },
    })
    await keepScoutCommands('WO-1', [lintProposal], keepDeps())
    expect((await readProfile(root, repo))?.checks.lint).toEqual(operator)
  })
})

describe('keepScoutCommands beside an operator removal', () => {
  it('never fills a check the operator said has no command', async () => {
    const removed = { command: null, source: 'operator' as const }
    await writeProfile(root, repo, {
      ...emptyProfile(repo),
      checks: { ...emptyProfile(repo).checks, lint: removed },
    })
    await keepScoutCommands('WO-1', [lintProposal], keepDeps())
    expect((await readProfile(root, repo))?.checks.lint).toEqual(removed)
    expect((await store.load('WO-1'))?.context.toolchain.lint).toBeNull()
    expect(await ledgerActions()).toEqual(['scout.command.skipped'])
  })
})
