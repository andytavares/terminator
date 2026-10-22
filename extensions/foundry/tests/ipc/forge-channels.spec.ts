import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { queueEntry } from '../helpers/queue-entries.js'
import { builderUnit, openQuestion, testCriterion } from '../helpers/order-parts.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { dispatchChannel } from '@terminator/extension-sdk'
import { createForgeChannels, forgeChannelSpecs } from '../../src/ipc/forge-channels.js'
import type { ForgeDeps } from '../../src/ipc/forge-channels.js'
import { quietForgeSeams } from './forge-deps.js'
import { writeBaseline } from '../../src/line/baseline.js'
import { baseStep, provenBaseline } from '../helpers/environment.js'
import { createOrderStore } from '../../src/order/store.js'
import { raiseGate } from '../../src/gates/rules.js'
import { writeCiState } from '../../src/line/ci-state.js'
import type { Standing } from '../../src/order/standing.js'
import type { OrderStore } from '../../src/order/store.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { CompileResult } from '../../src/order/compile.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'

let root: string
let repo: string
let store: OrderStore

interface OrderView {
  order: WorkOrder
  compile: CompileResult
  changed: string[]
  unavailableChecks?: string[]
}

function forgeDeps(over: Partial<ForgeDeps> = {}): ForgeDeps {
  return { store, now: () => NOW, ...quietForgeSeams(() => root), ...over }
}

/** A compile payload as the channel's schema leaves it: one the operator asked for. */
const compiling = (id: string, commit: boolean) => ({ id, commit, automatic: false })

function channels(readIssue?: ReturnType<typeof vi.fn>) {
  return createForgeChannels(forgeDeps({ readIssue: readIssue as never }))
}

/** Through the channel's own schema, as the renderer's request arrives. */
function sendThroughSchema(channel: string, payload: unknown): Promise<unknown> {
  const spec = forgeChannelSpecs(channels()).find((row) => row.channel === channel)
  if (spec === undefined) throw new Error(`no channel ${channel}`)
  return Promise.resolve(dispatchChannel(spec, payload))
}

beforeEach(() => {
  root = makeTempDir('foundry-ipc-')
  repo = makeTempDir('foundry-ipc-repo-')
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ scripts: { test: 'vitest run' } })
  )
  store = createOrderStore(root)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('foundry:order.create', () => {
  describe('the draft', theDraftTests)
  describe('the ledger and the same issue', theLedgerAndTheSameIssueTests)
})

async function seeded(): Promise<WorkOrder> {
  const r = (await channels().create({
    source: { kind: 'typed', text: 'x' },
    repoPaths: [repo],
  })) as OrderView
  const withExtras: WorkOrder = {
    ...r.order,
    assumptions: [{ id: 'A-1', text: 'single repo', struck: false, affects: ['U-1'] }],
    openQuestions: [
      {
        id: 'Q-1',
        text: 'does it?',
        why: '',
        options: ['No', 'Yes'],
        recommended: 0,
        answer: null,
        rank: 1,
        confidence: null,
        multiple: false,
        chosen: [],
      },
    ],
  }
  await store.save(withExtras)
  return withExtras
}

function theDraftTests() {
  it('returns a saved draft with its checks already evaluated', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'rows are clipped at the right edge' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.status).toBe('draft')
    expect(r.compile.ok).toBe(false)
    expect(await store.load(r.order.id)).not.toBeNull()
  })

  it('reports which checks this repository cannot run', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.unavailableChecks).toContain('coverage')
  })

  it('runs the adversarial pass on the very first draft', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.redTeam.length).toBeGreaterThan(0)
  })
}

function theLedgerAndTheSameIssueTests() {
  it('records the seeding in the ledger', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const ledger = path.join(root, 'orders', r.order.id, 'ledger.jsonl')
    expect(fs.readFileSync(ledger, 'utf8')).toContain('order.seeded')
  })

  it('offers the existing order rather than seeding the same issue twice', async () => {
    const readIssue = vi.fn(async () => ({
      key: 'TAV-42',
      title: 'Clipping',
      description: 'd',
      url: 'u',
      branchName: null,
    }))
    const c = channels(readIssue)
    const first = (await c.create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-42' },
      repoPaths: [repo],
    })) as OrderView
    const second = (await c.create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-42' },
      repoPaths: [repo],
    })) as { existing: { id: string } }
    expect(second.existing.id).toBe(first.order.id)
  })
}

describe('foundry:order.turn', () => {
  describe('strikes and answers', strikesAndAnswersTests)
  describe('persisting and recording', persistingAndRecordingTests)
  describe('free text and unknown orders', freeTextAndUnknownOrdersTests)
})

function strikesAndAnswersTests() {
  it('strikes an assumption and says exactly what has to be redrawn', async () => {
    const order = await seeded()
    const r = (await channels().turn({ id: order.id, strike: 'A-1' })) as OrderView
    expect(r.changed).toEqual(['U-1'])
    expect(r.order.assumptions[0].struck).toBe(true)
  })

  it('answers a multiple-choice question by the indices of its options', async () => {
    const order = await seeded()
    const r = (await channels().turn({
      id: order.id,
      answer: { questionId: 'Q-1', option: [1, 0] },
    })) as OrderView
    expect(r.order.openQuestions[0]).toMatchObject({ chosen: [0, 1], answer: 'No; Yes' })
    expect((await store.load(order.id))?.openQuestions[0].chosen).toEqual([0, 1])
  })

  it('answers a question by the index of its option', async () => {
    const order = await seeded()
    const r = (await channels().turn({
      id: order.id,
      answer: { questionId: 'Q-1', option: 1 },
    })) as OrderView
    expect(r.order.openQuestions[0].answer).toBe('Yes')
  })
}

function persistingAndRecordingTests() {
  it('persists the turn rather than only returning it', async () => {
    const order = await seeded()
    await channels().turn({ id: order.id, strike: 'A-1' })
    expect((await store.load(order.id))?.assumptions[0].struck).toBe(true)
  })

  it('records every turn in the ledger', async () => {
    const order = await seeded()
    await channels().turn({ id: order.id, answer: { questionId: 'Q-1', option: 0 } })
    const ledger = fs.readFileSync(path.join(root, 'orders', order.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('question.answered')
  })
}

function freeTextAndUnknownOrdersTests() {
  it('hands free text to the architect and leaves the order unchanged', async () => {
    const order = await seeded()
    const converge = vi.fn(async () => ({ ok: true as const, sessionId: 'sess-arch' }))
    const c = createForgeChannels(forgeDeps({ converge }))
    const before = await store.load(order.id)

    const r = (await c.turn({ id: order.id, message: 'what about resize?' })) as OrderView & {
      converging: string
      error?: string
    }

    expect(converge).toHaveBeenCalledWith(
      expect.objectContaining({ id: order.id }),
      'what about resize?',
      expect.any(Function)
    )
    expect(r.error).toBeUndefined()
    expect(r.converging).toBe('sess-arch')
    expect(r.changed).toEqual([])
    expect(await store.load(order.id)).toEqual(before)
  })

  it('reports an order it cannot find', async () => {
    expect(await channels().turn({ id: 'WO-nope', strike: 'A-1' })).toEqual({
      error: 'No order WO-nope.',
    })
  })
}

describe('foundry:order.compile', () => {
  describe('previewing and agreeing', previewingAndAgreeingTests)
  describe('the ledger', forgeChannelsTheLedgerTests)
  describe('unknown orders and no refinery', unknownOrdersAndNoRefineryTests)
  describe('the refinery advisory', forgeChannelsTheRefineryAdvisoryTests)
})

function previewingAndAgreeingTests() {
  it('previews the checks without committing when asked not to', async () => {
    const order = await completeOrder()
    const r = (await channels().compile(compiling(order.id, false))) as OrderView
    expect(r.compile.ok).toBe(true)
    expect((await store.load(order.id))?.status).toBe('draft')
  })

  it('agrees a complete order and stamps when', async () => {
    const order = await completeOrder()
    const r = (await channels().compile(compiling(order.id, true))) as OrderView
    expect(r.order.status).toBe('agreed')
    expect((await store.load(order.id))?.agreedAt).toBe('2026-09-06T10:00:00.000Z')
  })

  it('leaves an incomplete order a draft and names what is missing', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const out = (await channels().compile(compiling(r.order.id, true))) as OrderView
    expect(out.compile.ok).toBe(false)
    expect(out.order.status).toBe('draft')
    expect(out.compile.failures.map((f) => f.check)).toContain('coverage')
  })
}

function forgeChannelsTheLedgerTests() {
  it('records the agreement in the ledger', async () => {
    const order = await completeOrder()
    await channels().compile(compiling(order.id, true))
    expect(fs.readFileSync(path.join(root, 'orders', order.id, 'ledger.jsonl'), 'utf8')).toContain(
      'order.agreed'
    )
  })

  // A released order agreed again after an amendment was Foundry's doing, and
  // the ledger has to say so rather than credit the operator with a click.
  it('records an automatic agreement as Foundry\u2019s, with why', async () => {
    const order = await completeOrder()
    await channels().compile({ id: order.id, commit: true, automatic: true })
    const agreed = fs
      .readFileSync(path.join(root, 'orders', order.id, 'ledger.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { action: string; actor: string; reason: string })
      .find((e) => e.action === 'order.agreed')
    expect(agreed?.actor).toBe('rule:forge')
    expect(agreed?.reason).toMatch(/released/)
  })
}

function unknownOrdersAndNoRefineryTests() {
  it('reports an order it cannot find', async () => {
    expect(await channels().compile(compiling('WO-nope', true))).toEqual({
      error: 'No order WO-nope.',
    })
  })

  it('carries no advisory when nothing has wired the refinery', async () => {
    const order = await completeOrder()
    const r = (await channels().compile(compiling(order.id, true))) as OrderView & {
      advisory: string | null
    }
    expect(r.advisory).toBeNull()
  })
}

function forgeChannelsTheRefineryAdvisoryTests() {
  it('advises when the newly agreed order overlaps an in-flight one', async () => {
    const order = await completeOrder()
    const c = createForgeChannels(
      forgeDeps({
        queueEntries: async () => [
          {
            orderId: 'WO-earlier',
            title: 'Earlier work',
            repo: order.context.repos[0]?.name ?? '',
            base: order.context.repos[0]?.baseBranch ?? 'main',
            agreedAt: '2026-09-01T00:00:00.000Z',
            files: ['src/a.ts'],
            merged: false,
          },
        ],
      })
    )
    const r = (await c.compile(compiling(order.id, true))) as OrderView & {
      advisory: string | null
    }
    expect(r.advisory).toContain('WO-earlier')
  })
}

describe('foundry:order.list', () => {
  describe('nothing and no queue', nothingAndNoQueueTests)
  describe('the queue position', forgeChannelsTheQueuePositionTests)
  describe('checks and running orders', checksAndRunningOrdersTests)
  describe('halted orders', haltedOrdersTests)
  describe('open questions', forgeChannelsOpenQuestionsTests)
  describe('when it was made', whenItWasMadeTests)
  describe('finished checks and pulls', finishedChecksAndPullsTests)
  describe('the document handed back', documentOnTheRowTests)
  describe('the open gate', theOpenGateTests)
  describe('no CI yet', noCiYetTests)
  describe('the CI round', theCiRoundTests)
})

function nothingAndNoQueueTests() {
  it('lists nothing before any order is seeded', async () => {
    expect(await channels().list()).toEqual({ orders: [] })
  })

  it('carries no queue field when nothing has wired the refinery', async () => {
    await channels().create({ source: { kind: 'typed', text: 'first idea' }, repoPaths: [repo] })
    const r = (await channels().list()) as { orders: { queue: unknown }[] }
    expect(r.orders[0]?.queue).toBeNull()
  })
}

function forgeChannelsTheQueuePositionTests() {
  it('carries the queue position when the refinery is wired and this order overlaps another', async () => {
    const seeded = (await channels().create({
      source: { kind: 'typed', text: 'first idea' },
      repoPaths: [repo],
    })) as OrderView
    const c = createForgeChannels(
      forgeDeps({
        queueEntries: async () => [
          queueEntry(seeded.order.id, {
            title: seeded.order.title,
            agreedAt: '2026-09-02T00:00:00.000Z',
          }),
          queueEntry('WO-earlier', { title: 'Earlier work' }),
        ],
      })
    )
    const r = (await c.list()) as { orders: { id: string; queue: { position: number } | null }[] }
    const row = r.orders.find((o) => o.id === seeded.order.id)
    expect(row?.queue?.position).toBe(2)
  })
}

function checksAndRunningOrdersTests() {
  it('lists each order with where its checks stand', async () => {
    const c = channels()
    await c.create({ source: { kind: 'typed', text: 'first idea' }, repoPaths: [repo] })
    const r = (await c.list()) as { orders: { title: string; status: string; failures: number }[] }
    expect(r.orders).toHaveLength(1)
    expect(r.orders[0].title).toContain('first idea')
    expect(r.orders[0].status).toBe('draft')
    // A fresh draft has nothing planned yet, so at least coverage is failing.
    expect(r.orders[0].failures).toBeGreaterThan(0)
  })

  // The row used to read `failures === 0 ? 'ready to hand off' : ...`, and
  // `failures` is a draft-time compile result that is zero for every running
  // order for ever. Every running order therefore claimed to be ready to hand
  // off — including one halted at an undecided gate two hours earlier.
  it('never says a running order is ready to hand off', async () => {
    const c = channels()
    const seeded = (await c.create({
      source: { kind: 'typed', text: 'first idea' },
      repoPaths: [repo],
    })) as OrderView
    const loaded = await store.load(seeded.order.id)
    if (loaded === null) throw new Error('the order this test needs was not saved')
    await store.save({ ...loaded, status: 'running' })

    const r = (await c.list()) as { orders: { standing: Standing }[] }
    expect(r.orders).toHaveLength(1)
    expect(r.orders[0].standing.label).not.toContain('hand off')
    expect(r.orders[0].standing.kind).not.toBe('done')
  })
}

function haltedOrdersTests() {
  it('says a halted order is halted, and whose move it is', async () => {
    const held = raiseGate({
      id: 'G-1',
      rule: 'budget.exceeded',
      orderId: 'WO-x',
      summary: 'past its wall clock budget',
      why: 'the order budgets 90 and this run is at 90',
      at: '2026-09-06T11:30:00.000Z',
    })
    const c = createForgeChannels(forgeDeps({ standingSources: { gatesFor: async () => [held] } }))
    const seeded = (await c.create({
      source: { kind: 'typed', text: 'first idea' },
      repoPaths: [repo],
    })) as OrderView
    const loaded = await store.load(seeded.order.id)
    if (loaded === null) throw new Error('the order this test needs was not saved')
    await store.save({ ...loaded, status: 'running' })

    const r = (await c.list()) as { orders: { standing: Standing }[] }
    expect(r.orders).toHaveLength(1)
    expect(r.orders[0].standing.kind).toBe('halted')
    expect(r.orders[0].standing.turn).toBe('you')
    expect(r.orders[0].standing.gateId).toBe('G-1')
  })
}

function forgeChannelsOpenQuestionsTests() {
  // A draft's standing is the questions it is asking, which is the count the
  // tab badge sends the operator here to find.
  it('counts the questions a draft is still asking', async () => {
    const c = channels()
    const seeded = (await c.create({
      source: { kind: 'typed', text: 'first idea' },
      repoPaths: [repo],
    })) as OrderView
    const loaded = await store.load(seeded.order.id)
    if (loaded === null) throw new Error('the order this test needs was not saved')
    await store.save({
      ...loaded,
      openQuestions: [openQuestion('Q-1', { text: 'a?', options: ['x', 'y'], recommended: 0 })],
    })

    const r = (await c.list()) as { orders: { standing: Standing; openQuestions: number }[] }
    expect(r.orders[0].standing.kind).toBe('shaping')
    expect(r.orders[0].standing.turn).toBe('you')
    expect(r.orders[0].openQuestions).toBe(1)
  })
}

function whenItWasMadeTests() {
  // The Factory sorts its cards newest first, and only the row reaches it.
  it('carries when each order was made', async () => {
    const c = createForgeChannels(forgeDeps())
    await c.create({ source: { kind: 'typed', text: 'first idea' }, repoPaths: [repo] })

    const r = (await c.list()) as { orders: { createdAt: string }[] }
    expect(r.orders[0].createdAt).toBe(NOW)
  })
}

/** CI watching one pull request: one check passed, one pending, one failed. */
function watchingThreeChecks(url: string) {
  const checks = [
    { name: 'lint', bucket: 'pass', link: '', workflow: 'ci' },
    { name: 'test', bucket: 'pending', link: '', workflow: 'ci' },
    { name: 'build', bucket: 'fail', link: '', workflow: 'ci' },
  ] as const
  return {
    round: 0,
    max: 2,
    status: 'watching' as const,
    pulls: [{ url, checks: [...checks] }],
    reason: '',
    at: NOW,
  }
}

/** Puts the order in a run that opened the pull request at `url`. */
async function runningWithPull(orderId: string, url: string): Promise<void> {
  const loaded = await store.load(orderId)
  if (loaded === null) throw new Error('the order this test needs was not saved')
  await store.save({ ...loaded, status: 'running' })
  const dir = path.join(root, 'orders', orderId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'pulls.json'), JSON.stringify([{ url, repo: 'r', cwd: '/c' }]))
}

function finishedChecksAndPullsTests() {
  it('counts the checks that have finished, and links the pull requests', async () => {
    const c = createForgeChannels(forgeDeps({ dataRoot: () => root }))
    const seeded = (await c.create({
      source: { kind: 'typed', text: 'first idea' },
      repoPaths: [repo],
    })) as OrderView
    const url = 'https://github.com/andytavares/terminator/pull/233'
    await writeCiState(root, seeded.order.id, watchingThreeChecks(url))
    await runningWithPull(seeded.order.id, url)

    const r = (await c.list()) as {
      orders: {
        ci: { checks: { done: number; total: number } }
        pulls: { number: number; url: string }[]
      }[]
    }
    expect(r.orders[0].ci.checks).toEqual({ done: 2, total: 3 })
    expect(r.orders[0].pulls).toEqual([{ number: 233, url }])
  })
}

function theOpenGateTests() {
  it('hands the row the open gate whose move is yours, and nothing for another', async () => {
    const held = raiseGate({
      id: 'G-1',
      rule: 'ready-for-review',
      orderId: 'WO-x',
      summary: 'Mark the pull requests ready',
      why: 'the work shipped as drafts',
      at: '2026-09-06T11:30:00.000Z',
    })
    const c = createForgeChannels(forgeDeps({ standingSources: { gatesFor: async () => [held] } }))
    const seeded = (await c.create({
      source: { kind: 'typed', text: 'first idea' },
      repoPaths: [repo],
    })) as OrderView
    const loaded = await store.load(seeded.order.id)
    if (loaded === null) throw new Error('the order this test needs was not saved')
    await store.save({ ...loaded, status: 'shipped' })

    const r = (await c.list()) as {
      orders: { gate: { id: string; options: { id: string }[] } | null }[]
    }
    expect(r.orders[0].gate?.id).toBe('G-1')
    expect(r.orders[0].gate?.options[0].id).toBe('mark_ready')

    await store.save({ ...loaded, status: 'running' })
    const none = createForgeChannels(forgeDeps())
    const again = (await none.list()) as { orders: { gate: unknown }[] }
    expect(again.orders[0].gate).toBeNull()
  })
}

function noCiYetTests() {
  it('says an order has no CI yet when nothing has shipped', async () => {
    const c = createForgeChannels(forgeDeps({ dataRoot: () => root }))
    const seeded = (await c.create({
      source: { kind: 'typed', text: 'first idea' },
      repoPaths: [repo],
    })) as OrderView
    const r = (await c.list()) as { orders: { id: string; ci: unknown }[] }
    expect(r.orders.find((o) => o.id === seeded.order.id)?.ci).toBeNull()
  })
}

function theCiRoundTests() {
  it("reports a shipped order's CI round and status", async () => {
    const c = createForgeChannels(forgeDeps({ dataRoot: () => root }))
    const seeded = (await c.create({
      source: { kind: 'typed', text: 'first idea' },
      repoPaths: [repo],
    })) as OrderView
    await writeCiState(root, seeded.order.id, {
      round: 2,
      max: 3,
      status: 'red',
      pulls: [],
      reason: '',
      at: NOW,
    })
    const r = (await c.list()) as {
      orders: { id: string; ci: { status: string; round: number; max: number } }[]
    }
    const row = r.orders.find((o) => o.id === seeded.order.id)
    expect(row?.ci).toEqual({
      status: 'red',
      round: 2,
      max: 3,
      reason: '',
      checks: { done: 0, total: 0 },
    })
  })
}

describe('channel edge cases', () => {
  describe('tracker issues and repositories', trackerIssuesAndRepositoriesTests)
  describe('compile flags and agreed orders', compileFlagsAndAgreedOrdersTests)
  describe('unknown questions and no tracker', unknownQuestionsAndNoTrackerTests)
})

function trackerIssuesAndRepositoriesTests() {
  it('reports an issue the tracker cannot return', async () => {
    const c = channels(vi.fn(async () => null))
    expect(
      await c.create({
        source: { kind: 'tracker', tracker: 'linear', key: 'TAV-99' },
        repoPaths: [repo],
      })
    ).toEqual({ error: 'Could not read TAV-99 from linear.' })
  })

  it('refuses to seed with no repository, without writing anything', async () => {
    const r = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [],
    })) as { error: string }
    expect(r.error).toMatch(/at least one repository/)
    expect(await store.list()).toEqual([])
  })

  it('defaults to Linear when a tracker source names no tracker', async () => {
    const readIssue = vi.fn(async () => null)
    await channels(readIssue).create({
      source: { kind: 'tracker', key: 'TAV-1' },
      repoPaths: [repo],
    })
    expect(readIssue).toHaveBeenCalledWith('linear', 'TAV-1')
  })
}

function compileFlagsAndAgreedOrdersTests() {
  it('treats a compile with no commit flag as a preview', async () => {
    const seeded = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    // Through the channel's schema, which is what supplies the missing flag.
    const r = (await sendThroughSchema('foundry:order.compile', {
      id: seeded.order.id,
    })) as OrderView
    expect(r.order.status).toBe('draft')
  })

  it('refuses to agree an order that is no longer a draft', async () => {
    const seeded = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    await store.save({ ...seeded.order, status: 'running' })
    const r = (await channels().compile(compiling(seeded.order.id, true))) as OrderView
    expect(r.compile.ok).toBe(false)
  })
}

function unknownQuestionsAndNoTrackerTests() {
  it('ignores an answer to a question that does not exist', async () => {
    const seeded = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const r = (await channels().turn({
      id: seeded.order.id,
      answer: { questionId: 'Q-nope', option: 'x' },
    })) as OrderView
    expect(r.order.openQuestions).toEqual([])
  })

  it('seeds without a tracker reader at all', async () => {
    const c = createForgeChannels(forgeDeps())
    const r = (await c.create({
      source: { kind: 'typed', text: 'no tracker here' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.id).toBeTruthy()
  })
}

// The write-back seams. Everything below builds its own channel set, because
// what is being asserted is what the seams are handed and when.

const NOW = '2026-09-06T10:00:00.000Z'

/** An order that will pass all six checks, so `commit: true` actually agrees. */
async function agreeable(): Promise<WorkOrder> {
  const seed = (await channels().create({
    source: { kind: 'typed', text: 'rows are clipped at the right edge' },
    repoPaths: [repo],
  })) as OrderView
  const done: WorkOrder = {
    ...seed.order,
    id: 'WO-1',
    // Seeded as typed and then pointed at an issue, because seeding from a
    // tracker needs a reader and what is under test here is the write-back.
    source: {
      kind: 'tracker',
      tracker: 'linear',
      key: 'TAV-42',
      url: 'https://linear.app/tav/issue/TAV-42',
    },
    intent: { problem: 'p', outcome: 'rows render fully', nonGoals: ['scrollbars'] },
    risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    acceptance: [testCriterion('AC-1', { statement: 'a full-width row renders its final glyph' })],
    plan: {
      ...seed.order.plan,
      units: [builderUnit('U-1', { title: 'widen', satisfies: ['AC-1'], touches: ['src/a.ts'] })],
    },
    redTeam: seed.order.redTeam.map((f) => ({ ...f, status: 'resolved' as const })),
  }
  await writeBaseline(root, done.id, provenBaseline())
  return done
}

describe('the capability check at agreement (FR-059a)', () => {
  describe('asking at agreement', askingAtAgreementTests)
  describe('tracker failures', forgeChannelsTrackerFailuresTests)
  describe('agreeing twice', agreeingTwiceTests)
  describe('writing back', writingBackTests)
})

function askingAtAgreementTests() {
  it('asks what the tracker can do when the order is agreed, not when a write is due', async () => {
    const capability = vi.fn(async () => ({
      transitions: 'unsupported' as const,
      states: [],
      unreachable: [],
    }))
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels(forgeDeps({ capability }))

    const result = (await channels.compile(compiling('WO-1', true))) as {
      capability?: { transitions: string }
    }
    expect(capability).toHaveBeenCalled()
    expect(result.capability?.transitions).toBe('unsupported')
  })

  it('asks nothing when the order is only being checked, not handed off', async () => {
    const capability = vi.fn(async () => ({
      transitions: 'supported' as const,
      states: [],
      unreachable: [],
    }))
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels(forgeDeps({ capability }))

    await channels.compile(compiling('WO-1', false))
    expect(capability).not.toHaveBeenCalled()
  })
}

function forgeChannelsTrackerFailuresTests() {
  it('agrees the order even when the tracker cannot be reached', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels(
      forgeDeps({ capability: async () => Promise.reject(new Error('offline')) })
    )

    const result = (await channels.compile(compiling('WO-1', true))) as {
      order: WorkOrder
    }
    expect(result.order.status).toBe('agreed')
  })

  it('agrees the order even when the summary comment fails', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels(
      forgeDeps({ onAgreed: async () => Promise.reject(new Error('rate limited')) })
    )

    const result = (await channels.compile(compiling('WO-1', true))) as {
      order: WorkOrder
    }
    expect(result.order.status).toBe('agreed')
    expect((await store.load('WO-1'))?.status).toBe('agreed')
  })
}

function agreeingTwiceTests() {
  it('does not agree an order a second time, and says why', async () => {
    const onAgreed = vi.fn(async () => undefined)
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels(forgeDeps({ onAgreed }))
    await channels.compile(compiling('WO-1', true))

    const again = (await channels.compile(compiling('WO-1', true))) as {
      compile: { ok: boolean; failures: { detail: string }[] }
    }
    expect(again.compile.ok).toBe(false)
    expect(again.compile.failures[0].detail).toBe(
      'Only a draft can be agreed; this order is agreed.'
    )
    expect(onAgreed).toHaveBeenCalledTimes(1)
  })
}

function writingBackTests() {
  it('writes the agreed order back to the issue', async () => {
    const onAgreed = vi.fn(async () => undefined)
    const store = createOrderStore(root)
    await store.save(await agreeable())
    await createForgeChannels(forgeDeps({ onAgreed })).compile(compiling('WO-1', true))
    expect(onAgreed).toHaveBeenCalledWith(expect.objectContaining({ status: 'agreed' }))
  })
}

describe('the intent-to-state mapping (FR-060)', () => {
  describe('the states', theStatesTests)
  describe('no tracker or a failing one', noTrackerOrAFailingOneTests)
  describe('overrides', forgeChannelsOverridesTests)
  describe('refusals', forgeChannelsRefusalsTests)
})

function theStatesTests() {
  it('offers the tracker states and the mapping as it stands', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels(
      forgeDeps({
        capability: async () => ({
          transitions: 'supported' as const,
          states: [
            { id: 'st-review', name: 'In Review', intent: 'in_review' as const, available: true },
          ],
          unreachable: [],
        }),
      })
    )

    const result = (await channels.states({ id: 'WO-1' })) as {
      capability: { states: { id: string }[] }
      mapping: Record<string, string | null>
    }
    expect(result.capability.states[0].id).toBe('st-review')
    expect(result.mapping.in_review).toBeNull()
  })
}

function noTrackerOrAFailingOneTests() {
  it('reports no issue when the host has no tracker connection at all', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const result = (await createForgeChannels(forgeDeps()).states({
      id: 'WO-1',
    })) as { capability: { transitions: string } }
    expect(result.capability.transitions).toBe('no_issue')
  })

  it('reports the tracker own failure rather than pretending it has no states', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const result = (await createForgeChannels(
      forgeDeps({ capability: async () => Promise.reject(new Error('offline')) })
    ).states({ id: 'WO-1' })) as { error: string }
    expect(result.error).toBe('offline')
  })
}

function forgeChannelsOverridesTests() {
  it('stores the operator override and keeps it', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels(forgeDeps())

    await channels.mapState({ id: 'WO-1', intent: 'in_review', optionId: 'st-progress' })
    expect((await store.load('WO-1'))?.stateMapping.in_review).toBe('st-progress')
  })

  it('puts an intent back to whatever the tracker resolves', async () => {
    const store = createOrderStore(root)
    await store.save(await agreeable())
    const channels = createForgeChannels(forgeDeps())

    await channels.mapState({ id: 'WO-1', intent: 'done', optionId: 'st-done' })
    await channels.mapState({ id: 'WO-1', intent: 'done', optionId: null })
    expect((await store.load('WO-1'))?.stateMapping.done).toBeNull()
  })
}

function forgeChannelsRefusalsTests() {
  it('refuses an intent that is not one of the three', async () => {
    await createOrderStore(root).save(await agreeable())
    expect(
      await sendThroughSchema('foundry:order.mapState', {
        id: 'WO-1',
        intent: 'shipped',
        optionId: 'x',
      })
    ).toEqual({ error: 'Malformed request.' })
  })

  it('reports an order it cannot find', async () => {
    const channels = createForgeChannels(forgeDeps({ store: createOrderStore(root) }))
    expect(await channels.mapState({ id: 'WO-nope', intent: 'done', optionId: null })).toEqual({
      error: 'No order WO-nope.',
    })
    expect(await channels.states({ id: 'WO-nope' })).toEqual({ error: 'No order WO-nope.' })
  })
}

describe('foundry:order.converge — the half that was missing', () => {
  describe('starting', startingTests)
  describe('recording', forgeChannelsRecordingTests)
  describe('refused proposals', refusedProposalsTests)
  describe('the last turn', theLastTurnTests)
  describe('a running turn', forgeChannelsARunningTurnTests)
  describe('a refused draft in the list', aRefusedDraftInTheListTests)
  describe('non-drafts and unknown orders', nonDraftsAndUnknownOrdersTests)
})

/** Two open questions and two blocking findings: everything one settle can decide. */
const UNSETTLED: Pick<WorkOrder, 'openQuestions' | 'redTeam'> = {
  openQuestions: [
    {
      id: 'Q-1',
      text: 'which token?',
      why: '',
      options: ['a', 'b'],
      recommended: 0,
      answer: null,
      rank: 1,
      confidence: null,
      multiple: false,
      chosen: [],
    },
    {
      id: 'Q-2',
      text: 'which clock?',
      why: '',
      options: ['server', 'client'],
      recommended: 0,
      answer: null,
      rank: 1,
      confidence: null,
      multiple: false,
      chosen: [],
    },
  ],
  redTeam: [
    {
      id: 'RT-1',
      severity: 'high',
      category: 'wrong-outcome',
      text: 'finding one is wrong',
      status: 'open',
      reason: '',
      round: 0,
    },
    {
      id: 'RT-2',
      severity: 'high',
      category: 'regression',
      text: 'finding two breaks something',
      status: 'open',
      reason: '',
      round: 0,
    },
  ],
}

async function withQuestionsAndFindings(): Promise<WorkOrder> {
  const seed = (await channels().create({
    source: { kind: 'typed', text: 'x' },
    repoPaths: [repo],
  })) as OrderView
  const withExtras: WorkOrder = { ...seed.order, ...UNSETTLED }
  await store.save(withExtras)
  return withExtras
}

function startingTests() {
  it('starts the architect and answers straight away, rather than holding the bridge', async () => {
    const seed = await drafted()
    const converge = vi.fn(async () => ({ ok: true as const, sessionId: 'sess-arch' }))
    const c = createForgeChannels(forgeDeps({ converge }))

    const r = (await c.converge({ id: seed.order.id })) as OrderView & { converging: string }
    expect(converge).toHaveBeenCalled()
    // An architect takes minutes. A channel that waited for one would hold the
    // bridge for all of them, and the surface would spin with no way to see
    // what the agent was doing.
    expect(r.converging).toBe('sess-arch')
    expect(r.order.acceptance).toEqual([])
  })

  it('names the session, so the surface can take the operator to it', async () => {
    const seed = await drafted()
    const c = createForgeChannels(
      forgeDeps({ converge: async () => ({ ok: true, sessionId: 'sess-arch' }) })
    )
    const r = (await c.converge({ id: seed.order.id })) as { converging: string }
    expect(r.converging).toBe('sess-arch')
  })
}

function forgeChannelsRecordingTests() {
  it('records that it started, and what it was asked', async () => {
    const seed = await drafted()
    const c = createForgeChannels(
      forgeDeps({ converge: async () => ({ ok: true, sessionId: 'sess-arch' }) })
    )
    await c.converge({ id: seed.order.id, message: 'tighten AC-2' })
    const ledger = fs.readFileSync(path.join(root, 'orders', seed.order.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('converge.started')
    expect(ledger).toContain('tighten AC-2')
  })
}

function refusedProposalsTests() {
  it('returns the order untouched, and why, when the proposal was refused', async () => {
    const seed = await drafted()
    const c = createForgeChannels(
      forgeDeps({
        converge: async () => ({ ok: false, reason: 'the architect could not be started' }),
      })
    )
    const r = (await c.converge({ id: seed.order.id })) as OrderView & { error: string }
    expect(r.error).toBe('the architect could not be started')
    expect(r.order.acceptance).toEqual([])
  })

  it('records a refusal, so a run of bad proposals is visible afterwards', async () => {
    const seed = await drafted()
    const c = createForgeChannels(
      forgeDeps({ converge: async () => ({ ok: false, reason: 'no runtime' }) })
    )
    await c.converge({ id: seed.order.id })
    const ledger = fs.readFileSync(path.join(root, 'orders', seed.order.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('converge.refused')
  })
}

function theLastTurnTests() {
  // The half that was missing after that. A refusal was recorded and read by
  // nothing: the Forge polls `order.compile`, which handed back the document
  // and the checks, and a refusal changes neither — so the surface went on
  // saying the architect was working over a turn that had ended.
  it('carries how the last turn ended on the read the Forge polls', async () => {
    const seed = await drafted()
    const c = createForgeChannels(
      forgeDeps({
        converge: async () => ({ ok: false, reason: 'acceptance.5: Invalid enum value.' }),
      })
    )
    await c.converge({ id: seed.order.id })

    const r = (await c.compile(compiling(seed.order.id, false))) as {
      intake: { kind: string; reason?: string }
    }
    expect(r.intake.kind).toBe('refused')
    expect(r.intake.reason).toBe('acceptance.5: Invalid enum value.')
  })
}

function forgeChannelsARunningTurnTests() {
  it('says a turn is running the moment it starts one', async () => {
    const seed = await drafted()
    const c = createForgeChannels(
      forgeDeps({ converge: async () => ({ ok: true, sessionId: 'sess-arch' }) })
    )
    // On this call and not only on the next poll: the surface reads whether a
    // turn is in flight from here, and would otherwise sit idle.
    const started = (await c.converge({ id: seed.order.id, message: 'close the gap' })) as {
      intake: { kind: string; sessionId?: string }
    }
    // With what it was asked, so the surface can show the ask that started it.
    expect(started.intake).toEqual({
      kind: 'running',
      at: NOW,
      sessionId: 'sess-arch',
      asked: 'close the gap',
      actor: 'architect',
      trigger: 'you',
      round: null,
      autoTurn: null,
    })

    const polled = (await c.compile(compiling(seed.order.id, false))) as {
      intake: { kind: string }
    }
    expect(polled.intake.kind).toBe('running')
  })
}

function aRefusedDraftInTheListTests() {
  // The order list said "Foundry is still shaping this" about an order nothing
  // had touched for an hour, because a draft's standing had no idea intake had
  // ever run.
  it('hands a refused draft back to the operator in the list', async () => {
    const seed = await drafted()
    const c = createForgeChannels(
      forgeDeps({
        converge: async () => ({ ok: false, reason: 'acceptance.5: Invalid enum value.' }),
      })
    )
    await c.converge({ id: seed.order.id })

    const listed = (await c.list()) as {
      orders: Array<{ id: string; standing: { turn: string; headline: string } }>
    }
    const row = listed.orders.find((o) => o.id === seed.order.id)
    expect(row?.standing.turn).toBe('you')
    expect(row?.standing.headline).toMatch(/refused/i)
  })
}

function nonDraftsAndUnknownOrdersTests() {
  it('refuses to converge an order that is no longer a draft', async () => {
    const done = await agreeable()
    await store.save({ ...done, status: 'running' })
    const c = createForgeChannels(
      forgeDeps({ converge: async () => ({ ok: true, sessionId: 's' }) })
    )
    expect(await c.converge({ id: 'WO-1' })).toEqual({
      error: 'Only a draft can be converged; this order is running.',
    })
  })

  it('reports an order it cannot find', async () => {
    const c = createForgeChannels(
      forgeDeps({ converge: async () => ({ ok: true, sessionId: 's' }) })
    )
    expect(await c.converge({ id: 'WO-nope' })).toEqual({ error: 'No order WO-nope.' })
  })
}

// The batch that replaces seven serial turns: an answer and an accept change
// the order directly and need no turn; a fix or an ask is folded into the one
// turn `converge` starts once, naming every finding it carries.
describe('foundry:order.converge — settling everything in one submit', () => {
  describe('answers and accepts', answersAndAcceptsTests)
  describe('fixes and asks', fixesAndAsksTests)
  describe('a blank reason', aBlankReasonTests)
})

function answersAndAcceptsTests() {
  it('applies every answer and every accept, with no architect turn', async () => {
    const order = await withQuestionsAndFindings()
    const converge = vi.fn(async () => ({ ok: true as const, sessionId: 's' }))
    const c = createForgeChannels(forgeDeps({ converge }))

    const r = (await c.converge({
      id: order.id,
      settle: {
        answers: [
          { questionId: 'Q-1', option: 1 },
          { questionId: 'Q-2', option: 0 },
        ],
        accepts: [{ findingId: 'RT-2', reason: 'priced in' }],
      },
    })) as OrderView

    expect(converge).not.toHaveBeenCalled()
    expect(r.order.openQuestions[0].answer).toBe('b')
    expect(r.order.openQuestions[1].answer).toBe('server')
    expect(r.order.redTeam.find((f) => f.id === 'RT-2')).toMatchObject({
      status: 'accepted',
      reason: 'priced in',
    })

    const saved = await store.load(order.id)
    expect(saved?.openQuestions[0].answer).toBe('b')
    expect(saved?.redTeam.find((f) => f.id === 'RT-2')?.status).toBe('accepted')

    const ledger = fs.readFileSync(path.join(root, 'orders', order.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('question.answered')
    expect(ledger).toContain('finding.accepted')
  })
}

function fixesAndAsksTests() {
  it('folds every fix and ask into exactly one converge call naming every finding', async () => {
    const order = await withQuestionsAndFindings()
    const converge = vi.fn<ForgeDeps['converge']>(async () => ({
      ok: true as const,
      sessionId: 'sess-arch',
    }))
    const c = createForgeChannels(forgeDeps({ converge }))

    await c.converge({
      id: order.id,
      settle: {
        asks: ['RT-1'],
        fixes: [{ findingId: 'RT-2', how: 'do it this way' }],
      },
    })

    expect(converge).toHaveBeenCalledTimes(1)
    const [, message] = converge.mock.calls[0]
    expect(message).toContain('RT-1')
    expect(message).toContain('finding one is wrong')
    expect(message).toContain('RT-2')
    expect(message).toContain('finding two breaks something')
    expect(message).toContain('do it this way')
    expect(message).toContain('resolveFindings')
  })
}

function aBlankReasonTests() {
  it('refuses the whole settle on a blank accept reason, applying nothing', async () => {
    const order = await withQuestionsAndFindings()
    const converge = vi.fn(async () => ({ ok: true as const, sessionId: 's' }))
    const c = createForgeChannels(forgeDeps({ converge }))

    const r = (await c.converge({
      id: order.id,
      settle: {
        answers: [{ questionId: 'Q-1', option: 1 }],
        accepts: [{ findingId: 'RT-2', reason: '   ' }],
      },
    })) as OrderView & { error: string }

    expect(r.error).toMatch(/costs a written reason/)
    expect(converge).not.toHaveBeenCalled()

    const saved = await store.load(order.id)
    expect(saved?.openQuestions[0].answer).toBeNull()
    expect(saved?.redTeam.find((f) => f.id === 'RT-2')?.status).toBe('open')
  })
}

describe('free text reaches the architect', () => {
  describe('intake', intakeTests)
  describe('other turns and empty text', otherTurnsAndEmptyTextTests)
})

async function withFinding() {
  const seed = (await channels().create({
    source: { kind: 'typed', text: 'x' },
    repoPaths: [repo],
  })) as OrderView
  expect(seed.order.redTeam.length).toBeGreaterThan(0)
  return seed.order
}

function intakeTests() {
  it('goes to intake rather than nowhere', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const converge = vi.fn(async () => ({ ok: true as const, sessionId: 's' }))
    const c = createForgeChannels(forgeDeps({ converge }))

    await c.turn({ id: seed.order.id, message: 'the second unit is not needed' })
    expect(converge).toHaveBeenCalledWith(
      expect.anything(),
      'the second unit is not needed',
      expect.any(Function)
    )
  })
}

function otherTurnsAndEmptyTextTests() {
  it('leaves striking an assumption and answering a question alone', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const converge = vi.fn(async () => ({ ok: true as const, sessionId: 's' }))
    const c = createForgeChannels(forgeDeps({ converge }))

    await c.turn({ id: seed.order.id, strike: seed.order.assumptions[0]?.id ?? 'A-1' })
    expect(converge).not.toHaveBeenCalled()
  })

  it('does nothing for empty text', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const converge = vi.fn(async () => ({ ok: true as const, sessionId: 's' }))
    const c = createForgeChannels(forgeDeps({ converge }))

    await c.turn({ id: seed.order.id, message: '   ' })
    expect(converge).not.toHaveBeenCalled()
  })
}

describe('clearing an adversarial finding — the other thing that blocked the gate', () => {
  describe('fixing by decree and accepting', fixingByDecreeAndAcceptingTests)
  describe('reasons and records', reasonsAndRecordsTests)
  describe('unblocking compile', unblockingCompileTests)
})

/** A draft with one criterion whose proof is a command that does not exist. */
async function withCriterion() {
  const seed = (await channels().create({
    source: { kind: 'typed', text: 'x' },
    repoPaths: [repo],
  })) as OrderView
  const order = seed.order
  const withAc: WorkOrder = {
    ...order,
    acceptance: [
      {
        id: 'AC-1',
        statement: 'the row does not clip its last glyph',
        priority: 'P0',
        verify: { kind: 'screenshot', target: 'the terminal row' },
        unverifiable: null,
      },
    ],
  }
  await store.save(withAc)
  return withAc
}

function fixingByDecreeAndAcceptingTests() {
  // Fixing one is the architect's, told how: an operator "Fixed" with nothing
  // behind it cleared the gate without changing the order.
  it('refuses to mark one fixed by decree', async () => {
    const o = await withFinding()
    const r = (await sendThroughSchema('foundry:order.turn', {
      id: o.id,
      finding: { id: o.redTeam[0].id, decision: 'resolved' },
    })) as { error?: string }
    expect(r.error).toBeDefined()
    expect((await store.load(o.id))?.redTeam[0].status).toBe('open')
  })

  it('accepts one, with the reason it stands', async () => {
    const o = await withFinding()
    const r = (await channels().turn({
      id: o.id,
      finding: { id: o.redTeam[0].id, decision: 'accepted', reason: 'the risk is priced in' },
    })) as OrderView
    expect(r.order.redTeam[0]).toMatchObject({
      status: 'accepted',
      reason: 'the risk is priced in',
    })
  })
}

function reasonsAndRecordsTests() {
  it('refuses to accept one without a reason — a shrug is not a decision', async () => {
    const o = await withFinding()
    const r = (await channels().turn({
      id: o.id,
      finding: { id: o.redTeam[0].id, decision: 'accepted', reason: '   ' },
    })) as OrderView & { error: string }
    expect(r.error).toMatch(/costs a written reason/)
    expect(r.order.redTeam[0].status).toBe('open')
  })

  it('records who cleared it and why', async () => {
    const o = await withFinding()
    await channels().turn({
      id: o.id,
      finding: { id: o.redTeam[0].id, decision: 'accepted', reason: 'priced in' },
    })
    const ledger = fs.readFileSync(path.join(root, 'orders', o.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('finding.accepted')
    expect(ledger).toContain('priced in')
  })
}

function unblockingCompileTests() {
  it('unblocks the compile check once every finding is cleared', async () => {
    const o = await withFinding()
    for (const finding of o.redTeam) {
      await channels().turn({
        id: o.id,
        finding: { id: finding.id, decision: 'accepted', reason: 'priced in' },
      })
    }
    // The one check this used to fail for ever, because nothing could clear a
    // finding.
    const compiled = (await channels().compile(compiling(o.id, false))) as {
      compile: { failures: { check: string }[] }
    }
    expect(compiled.compile.failures.map((f) => f.check)).not.toContain('redTeam')
  })
}

describe('accepting a criterion as unverifiable — the escape nothing could reach', () => {
  describe('recording the acceptance', recordingTheAcceptanceTests)
  describe('refused acceptances', refusedAcceptancesTests)
  describe('who accepted', whoAcceptedTests)
  describe('the falsifiable check', theFalsifiableCheckTests)
})

function recordingTheAcceptanceTests() {
  it('records the acceptance on the criterion, with the reason', async () => {
    const o = await withCriterion()
    const r = (await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-1', reason: 'no display in this environment' },
    })) as OrderView
    expect(r.order.acceptance[0].unverifiable).toEqual({
      accepted: true,
      reason: 'no display in this environment',
    })
    expect((await store.load(o.id))?.acceptance[0].unverifiable?.accepted).toBe(true)
  })

  it('says which part of the document moved, so the operator sees the redraw', async () => {
    const o = await withCriterion()
    const r = (await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-1', reason: 'nothing here can run it' },
    })) as OrderView
    expect(r.changed).toContain('acceptance')
  })
}

function refusedAcceptancesTests() {
  it('refuses one without a reason — the same shrug the finding refuses', async () => {
    const o = await withCriterion()
    const r = (await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-1', reason: '   ' },
    })) as OrderView & { error: string }
    expect(r.error).toMatch(/costs a reason/)
    expect(r.order.acceptance[0].unverifiable).toBeNull()
  })

  it('refuses a criterion this order does not have', async () => {
    const o = await withCriterion()
    const r = (await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-9', reason: 'because' },
    })) as OrderView & { error: string }
    expect(r.error).toMatch(/No criterion AC-9/)
  })
}

function whoAcceptedTests() {
  it('records who accepted it and why', async () => {
    const o = await withCriterion()
    await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-1', reason: 'no display in this environment' },
    })
    const ledger = fs.readFileSync(path.join(root, 'orders', o.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('criterion.unverifiable')
    expect(ledger).toContain('no display in this environment')
  })
}

/** The failure an operator meets: a unit changes a file a person looks at, and no criterion asks
 * for a picture of it. The other half of this check — a criterion with no proof at all —
 * cannot survive the schema, so this is the one the escape has to answer. */
function blockedOnAPicture(o: WorkOrder): WorkOrder {
  const proof = { kind: 'command' as const, command: 'npm test', assert: 'ok' }
  const unit = builderUnit('U-1', {
    title: 'redraw the row',
    satisfies: ['AC-1'],
    touches: ['src/components/Row.tsx'],
  })
  return {
    ...o,
    acceptance: [{ ...o.acceptance[0], verify: proof }],
    plan: { ...o.plan, units: [unit] },
  }
}

function theFalsifiableCheckTests() {
  it('clears the falsifiable check, which is the whole point of the escape', async () => {
    const o = await withCriterion()
    await store.save(blockedOnAPicture(o))

    const before = (await channels().compile(compiling(o.id, false))) as {
      compile: { failures: { check: string }[] }
    }
    expect(before.compile.failures.map((f) => f.check)).toContain('verifiable')

    await channels().turn({
      id: o.id,
      unverifiable: { criterionId: 'AC-1', reason: 'there is no display in this environment' },
    })

    const after = (await channels().compile(compiling(o.id, false))) as {
      compile: { failures: { check: string }[] }
    }
    expect(after.compile.failures.map((f) => f.check)).not.toContain('verifiable')
  })
}

describe('turning a write-back off for one order (FR-062)', () => {
  describe('choosing', forgeChannelsChoosingTests)
  describe('recording, refusing and unknown orders', recordingRefusingAndUnknownOrdersTests)
})

async function seed(): Promise<OrderView> {
  return (await channels().create({
    source: { kind: 'typed', text: 'x' },
    repoPaths: [repo],
  })) as OrderView
}

function forgeChannelsChoosingTests() {
  it('keeps what the operator chose', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const r = (await channels().setWriteBack({
      id: seed.order.id,
      writeBack: ['summary_comment'],
    })) as OrderView

    expect(r.order.writeBack).toEqual(['summary_comment'])
    expect((await store.load(seed.order.id))?.writeBack).toEqual(['summary_comment'])
  })

  it('takes none at all', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    const r = (await channels().setWriteBack({ id: seed.order.id, writeBack: [] })) as OrderView
    expect(r.order.writeBack).toEqual([])
  })
}

function recordingRefusingAndUnknownOrdersTests() {
  it('records the choice, and says what it means when it is nothing', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    await channels().setWriteBack({ id: seed.order.id, writeBack: [] })
    const ledger = fs.readFileSync(path.join(root, 'orders', seed.order.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('writeback.configured')
    expect(ledger).toContain('nothing is written back')
  })

  it('refuses a write-back this build does not have', async () => {
    const seed = (await channels().create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    expect(
      await sendThroughSchema('foundry:order.writeBack', {
        id: seed.order.id,
        writeBack: ['everything'],
      })
    ).toEqual({ error: 'Malformed request.' })
  })

  it('reports an order it cannot find', async () => {
    expect(await channels().setWriteBack({ id: 'WO-nope', writeBack: [] })).toEqual({
      error: 'No order WO-nope.',
    })
  })
}

// The configured budgets were a default the operator could not see or change
// on any one order, and the architect could replace them. They are set here.
describe('setting one order’s budgets', () => {
  describe('keeping the choice', keepingTheChoiceTests)
  describe('recording and zero limits', recordingAndZeroLimitsTests)
  describe('non-drafts and unknown budget orders', nonDraftsAndUnknownBudgetOrdersTests)
})

async function seededWith(deps: Partial<Parameters<typeof createForgeChannels>[0]>) {
  const c = createForgeChannels(forgeDeps({ ...deps }))
  return (await c.create({
    source: { kind: 'typed', text: 'change the session refresh' },
    repoPaths: [repo],
  })) as OrderView
}

function keepingTheChoiceTests() {
  it('keeps what the operator chose, including no limit, and leaves tokens alone', async () => {
    const { order } = await seed()
    const r = (await channels().setBudgets({
      id: order.id,
      budgets: { agents: 1, wallClockMinutes: null },
    })) as OrderView
    const expected = { agents: 1, wallClockMinutes: null, tokens: null }
    expect(r.order.budgets).toEqual(expected)
    expect((await store.load(order.id))?.budgets).toEqual(expected)
  })

  // ADR 056: there is no files budget to set.
  it('refuses a files budget', async () => {
    const { order } = await seed()
    expect(
      await sendThroughSchema('foundry:order.budgets', {
        id: order.id,
        budgets: { agents: 3, wallClockMinutes: 45, filesTouched: 25 },
      })
    ).toEqual({ error: 'Malformed request.' })
  })
}

function recordingAndZeroLimitsTests() {
  it('records the choice in words', async () => {
    const { order } = await seed()
    await channels().setBudgets({
      id: order.id,
      budgets: { agents: 2, wallClockMinutes: 30 },
    })
    const ledger = fs.readFileSync(path.join(root, 'orders', order.id, 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('budgets.configured')
    expect(ledger).toContain('2 agents · 30 minutes')
  })

  it('refuses a limit of zero', async () => {
    const { order } = await seed()
    expect(
      await sendThroughSchema('foundry:order.budgets', {
        id: order.id,
        budgets: { agents: 0, wallClockMinutes: 45 },
      })
    ).toEqual({ error: 'Malformed request.' })
  })
}

function nonDraftsAndUnknownBudgetOrdersTests() {
  // A running order's budgets change at its budget gate, where the run is
  // resumed against them; changed here, nothing would read them until then.
  it('refuses an order that is no longer a draft', async () => {
    const { order } = await seed()
    await store.save({ ...order, status: 'running' })
    const r = (await channels().setBudgets({
      id: order.id,
      budgets: { agents: 3, wallClockMinutes: 45 },
    })) as { error: string }
    expect(r.error).toContain('running')
  })

  it('reports an order it cannot find', async () => {
    expect(
      await channels().setBudgets({
        id: 'WO-nope',
        budgets: { agents: 3, wallClockMinutes: 45 },
      })
    ).toEqual({ error: 'No order WO-nope.' })
  })
}

// A setting that reaches nothing is a control the operator can move while the
// factory ignores it. Both of these were registered and read by nobody: every
// order got 3 agents / 45 minutes / 25 files regardless, and a critical path
// the operator declared never made it onto an order's risk.

describe('what configuration a new order starts with', () => {
  describe('configured budgets', configuredBudgetsTests)
  describe('reading every order', readingEveryOrderTests)
  describe('critical paths', criticalPathsTests)
})

const DESCRIPTION = [
  '# Summary',
  'Make all text in the application red',
  '',
  '# Acceptance Criteria',
  '- [ ] All text in the application is red',
  '- [ ] The heading is red too',
].join('\n')
const issue = () =>
  vi.fn(async () => ({
    key: 'TAV-14',
    title: 'Make all text in the application red',
    description: DESCRIPTION,
    url: 'https://linear.app/x/TAV-14',
    branchName: null,
  }))

function configuredBudgetsTests() {
  it('takes the budgets the operator configured (FR-030)', async () => {
    const r = await seededWith({
      budgetDefaults: () => ({ agents: 1, wallClockMinutes: 10 }),
    })
    expect(r.order.budgets).toMatchObject({ agents: 1, wallClockMinutes: 10 })
  })

  it('takes a configured budget of no limit', async () => {
    const r = await seededWith({
      budgetDefaults: () => ({ agents: null, wallClockMinutes: 10 }),
    })
    expect(r.order.budgets).toMatchObject({ agents: null, wallClockMinutes: 10 })
  })

  it('falls back to the schema defaults when nothing is configured', async () => {
    const r = await seededWith({})
    expect(r.order.budgets).toMatchObject({ agents: 3, wallClockMinutes: 45 })
  })
}

function readingEveryOrderTests() {
  it('reads the budgets on every order, not once when the extension started', async () => {
    let agents = 1
    const c = createForgeChannels(
      forgeDeps({ budgetDefaults: () => ({ agents, wallClockMinutes: 45 }) })
    )
    const first = (await c.create({
      source: { kind: 'typed', text: 'first' },
      repoPaths: [repo],
    })) as OrderView
    agents = 5
    const second = (await c.create({
      source: { kind: 'typed', text: 'second' },
      repoPaths: [repo],
    })) as OrderView
    expect(first.order.budgets.agents).toBe(1)
    expect(second.order.budgets.agents).toBe(5)
  })
}

function criticalPathsTests() {
  it("carries the operator's declared critical paths onto the order's risk (FR-043)", async () => {
    const r = await seededWith({ criticalPaths: () => ['src/main/auth/**', 'src/main/billing/**'] })
    expect(r.order.risk.criticalPaths).toEqual(['src/main/auth/**', 'src/main/billing/**'])
  })

  it("reads the critical paths of the order's repositories, a workspace-scoped list", async () => {
    const byRepository: Record<string, string[]> = { [repo]: ['src/main/auth/**'] }
    const r = await seededWith({
      criticalPaths: (repoPaths) => repoPaths.flatMap((path) => byRepository[path] ?? []),
    })
    expect(r.order.risk.criticalPaths).toEqual(['src/main/auth/**'])
  })

  it('declares none when the operator declared none — never inferred', async () => {
    const r = await seededWith({})
    expect(r.order.risk.criticalPaths).toEqual([])
  })
}

// A ticket that states its acceptance criteria, taken at its word. The
// description arrived whole in `intent.problem` and nothing read it, so an
// order seeded from a ticket with a heading literally called "Acceptance
// Criteria" opened saying "No criteria yet" to the person who had just
// written them.
describe('an order seeded from a ticket that states its criteria', () => {
  describe('stated criteria', statedCriteriaTests)
  describe('nothing stated', forgeChannelsNothingStatedTests)
})

function statedCriteriaTests() {
  it('starts from the criteria the ticket already stated', async () => {
    const r = (await channels(issue()).create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-14' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.acceptance.map((c) => c.statement)).toEqual([
      'All text in the application is red',
      'The heading is red too',
    ])
  })

  it('still needs a plan, because coverage runs both ways', async () => {
    // The point of the guard: lifting criteria must not let an order hand off
    // without the architect. A criterion no unit satisfies fails the compile
    // exactly as an order with no criteria at all did.
    const r = (await channels(issue()).create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-14' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.compile.ok).toBe(false)
    expect(r.order.plan.units).toEqual([])
  })

  it('keeps the description whole as well, so nothing is lost in the lifting', async () => {
    const r = (await channels(issue()).create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-14' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.intent.problem).toContain('# Dev Hints'.slice(0, 1))
    expect(r.order.intent.problem).toContain('# Summary')
  })
}

function forgeChannelsNothingStatedTests() {
  it('takes nothing from a ticket that states nothing', async () => {
    const bare = vi.fn(async () => ({
      key: 'TAV-15',
      title: 'Something',
      description: 'Just do the thing.',
      url: '',
      branchName: null,
    }))
    const r = (await channels(bare).create({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-15' },
      repoPaths: [repo],
    })) as OrderView
    expect(r.order.acceptance).toEqual([])
  })
}

async function drafted() {
  return channels().create({
    source: { kind: 'typed', text: 'expired tokens are accepted' },
    repoPaths: [repo],
  }) as Promise<OrderView>
}

async function completeOrder(): Promise<WorkOrder> {
  const r = (await channels().create({
    source: { kind: 'typed', text: 'x' },
    repoPaths: [repo],
  })) as OrderView
  const done: WorkOrder = {
    ...r.order,
    intent: { problem: 'p', outcome: 'rows render fully', nonGoals: ['scrollbars'] },
    risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    acceptance: [testCriterion('AC-1', { statement: 'a full-width row renders its final glyph' })],
    plan: {
      ...r.order.plan,
      units: [builderUnit('U-1', { title: 'widen', satisfies: ['AC-1'], touches: ['src/a.ts'] })],
    },
    redTeam: r.order.redTeam.map((f) => ({ ...f, status: 'resolved' as const })),
  }
  await store.save(done)
  await writeBaseline(root, done.id, provenBaseline())
  return done
}

describe('the backend facts every Forge response carries', () => {
  describe('compile and converge', compileAndConvergeTests)
  describe('who agreed', whoAgreedTests)
})

function compileAndConvergeTests() {
  it('carries loop, agreed and turnEndedAt on compile, alongside intake', async () => {
    const seed = await drafted()
    const r = (await channels().compile(compiling(seed.order.id, false))) as OrderView & {
      loop: { rounds: unknown[]; heldAt: null; exhausted: boolean }
      agreed: unknown
      turnEndedAt: string | null
    }
    expect(r.loop).toEqual({ rounds: [], heldAt: null, exhausted: false })
    expect(r.agreed).toBeNull()
    expect(r.turnEndedAt).toBeNull()
  })

  it('carries them on a running converge answer too', async () => {
    const seed = await drafted()
    const c = createForgeChannels(
      forgeDeps({ converge: async () => ({ ok: true as const, sessionId: 'sess-arch' }) })
    )
    const r = (await c.converge({ id: seed.order.id, message: 'go' })) as OrderView & {
      loop: unknown
      agreed: unknown
      turnEndedAt: unknown
    }
    expect(r.loop).toBeDefined()
    expect(r.agreed).toBeNull()
    expect(r.turnEndedAt).toBeNull()
  })
}

function whoAgreedTests() {
  it('says who agreed the order once it is agreed', async () => {
    const order = await completeOrder()
    const r = (await channels().compile(compiling(order.id, true))) as OrderView & {
      agreed: { at: string; by: string } | null
    }
    expect(r.compile.ok).toBe(true)
    expect(r.agreed).toEqual({ at: NOW, by: 'you' })
  })
}

describe('foundry:order.compile — who agrees', () => {
  it('records the operator even when a caller names the rule, since only a person hands off', async () => {
    const order = await completeOrder()
    const r = (await sendThroughSchema('foundry:order.compile', {
      id: order.id,
      commit: true,
      actor: 'rule:forge',
    })) as OrderView & { agreed: { by: string } | null }
    expect(r.agreed).toEqual({ at: NOW, by: 'you' })

    const entries = await store.entries(order.id)
    const agreedEntry = entries.find((e) => e.action === 'order.agreed')
    expect(agreedEntry?.actor).toBe('operator')
    expect(agreedEntry?.reason).toBe('all checks pass')
  })

  it('defaults to the operator, with the plain reason', async () => {
    const order = await completeOrder()
    await channels().compile(compiling(order.id, true))

    const entries = await store.entries(order.id)
    const agreedEntry = entries.find((e) => e.action === 'order.agreed')
    expect(agreedEntry?.actor).toBe('operator')
    expect(agreedEntry?.reason).toBe('all checks pass')
  })
})

describe('foundry:order.recipe', () => {
  describe('choosing', choosingARecipeTests)
  describe('refusals', recipeRefusalsTests)
})

function choosingARecipeTests() {
  it('sets the recipe and records who chose it', async () => {
    const seed = await drafted()
    const c = channels()
    const r = (await c.recipe({ id: seed.order.id, recipe: 'direct' })) as OrderView
    expect(r.order.recipe).toBe('direct')

    const entries = await store.entries(seed.order.id)
    const last = entries[entries.length - 1]
    expect(last.action).toBe('recipe.chosen')
    expect(last.reason).toBe('direct')
  })

  it('records "the proposal" when the choice is cleared', async () => {
    const seed = await drafted()
    const c = channels()
    await c.recipe({ id: seed.order.id, recipe: 'direct' })
    await c.recipe({ id: seed.order.id, recipe: null })

    const entries = await store.entries(seed.order.id)
    const last = entries[entries.length - 1]
    expect(last.reason).toBe('the proposal')
  })
}

function recipeRefusalsTests() {
  it('refuses on anything but a draft', async () => {
    const seed = await drafted()
    const c = channels()
    await store.save({ ...seed.order, status: 'agreed' })
    const r = (await c.recipe({ id: seed.order.id, recipe: 'direct' })) as { error?: string }
    expect(r.error).toBe('Only a draft can have its shape chosen; this order is agreed.')
  })

  it('refuses an order it has no record of', async () => {
    expect(await channels().recipe({ id: 'WO-nope', recipe: 'direct' })).toEqual({
      error: 'No order WO-nope.',
    })
  })
}

describe('foundry:order.hold', () => {
  it('records a hold and releases it, calling onReleased only on release', async () => {
    const seed = await drafted()
    const onReleased = vi.fn()
    const c = createForgeChannels(forgeDeps({ onReleased }))

    await c.hold({ id: seed.order.id, held: true })
    expect(onReleased).not.toHaveBeenCalled()
    let entries = await store.entries(seed.order.id)
    expect(entries[entries.length - 1].action).toBe('review.held')

    await c.hold({ id: seed.order.id, held: false })
    expect(onReleased).toHaveBeenCalledTimes(1)
    entries = await store.entries(seed.order.id)
    expect(entries[entries.length - 1].action).toBe('review.released')
  })

  it('errors on an unknown order', async () => {
    const c = channels()
    const r = (await c.hold({ id: 'WO-nope', held: true })) as { error?: string }
    expect(r.error).toBe('No order WO-nope.')
  })
})

describe('the base branch check', () => {
  describe('starting and reading', startingAndReadingTests)
  describe('readingTests', readingTests)
  describe('the moves', theMovesTests)
  describe('theMoveErrorsTests', theMoveErrorsTests)
})

function startingAndReadingTests() {
  it('starts when an order is created, without the channel waiting for it', async () => {
    let finish: () => void = () => undefined
    const proveEnvironment = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const c = createForgeChannels(forgeDeps({ proveEnvironment }))
    const made = (await c.create({
      source: { kind: 'typed', text: 'x' },
      repoPaths: [repo],
    })) as OrderView
    expect(proveEnvironment).toHaveBeenCalledTimes(1)
    expect(proveEnvironment).toHaveBeenCalledWith(expect.objectContaining({ id: made.order.id }))
    finish()
  })

  it('is read with the other facts: the baseline and when the operator waived it', async () => {
    const seed = await drafted()
    await writeBaseline(root, seed.order.id, provenBaseline({ startedAt: '2026-09-01T00:00:00Z' }))
    const c = channels()
    await c.environment({ id: seed.order.id, move: 'waive' })
    const r = (await c.compile(compiling(seed.order.id, false))) as {
      environment: { baseline: { state: string } | null; waivedAt: string | null }
    }
    expect(r.environment.baseline?.state).toBe('proven')
    expect(r.environment.waivedAt).toBe(NOW)
  })
}

function readingTests() {
  it('has no baseline until one is written', async () => {
    const seed = await drafted()
    const r = (await channels().compile(compiling(seed.order.id, false))) as {
      environment: unknown
    }
    expect(r.environment).toEqual({
      baseline: null,
      waivedAt: null,
      proving: false,
      decisions: { continueUnmeasured: false, declinePictures: false },
    })
  })
}

function theMovesTests() {
  it('checks again on "check", and answers the view straight away', async () => {
    const seed = await drafted()
    const proveEnvironment = vi.fn(async () => undefined)
    const c = createForgeChannels(forgeDeps({ proveEnvironment }))
    const r = (await c.environment({ id: seed.order.id, move: 'check' })) as OrderView
    expect(proveEnvironment).toHaveBeenCalledWith(expect.objectContaining({ id: seed.order.id }))
    expect(r.order.id).toBe(seed.order.id)
  })

  it('records "environment.waived" on "waive", and checks nothing', async () => {
    const seed = await drafted()
    const proveEnvironment = vi.fn(async () => undefined)
    const c = createForgeChannels(forgeDeps({ proveEnvironment }))
    await c.environment({ id: seed.order.id, move: 'waive' })
    const last = (await store.entries(seed.order.id)).at(-1)
    expect(last).toMatchObject({
      actor: 'operator',
      action: 'environment.waived',
      subject: seed.order.id,
    })
    expect(proveEnvironment).not.toHaveBeenCalled()
  })
}

function theDecisionMovesTests() {
  const decide = async (move: 'continue-unmeasured') => {
    const seed = await drafted()
    const proveEnvironment = vi.fn(async () => undefined)
    const c = createForgeChannels(forgeDeps({ proveEnvironment }))
    const r = (await c.environment({ id: seed.order.id, move })) as {
      environment: { decisions: Record<string, boolean> }
    }
    return { seed, r, proveEnvironment }
  }

  it('records "checks.continue-unmeasured" and answers the decision from the ledger', async () => {
    const { seed, r, proveEnvironment } = await decide('continue-unmeasured')
    expect((await store.entries(seed.order.id)).at(-1)).toMatchObject({
      actor: 'operator',
      action: 'checks.continue-unmeasured',
    })
    expect(r.environment.decisions).toEqual({ continueUnmeasured: true, declinePictures: false })
    expect(proveEnvironment).not.toHaveBeenCalled()
  })
}

function thePicturesDecisionTests() {
  it('records "pictures.declined" and answers the decision from the ledger', async () => {
    const seed = await drafted()
    const c = createForgeChannels(forgeDeps({}))
    const r = (await c.environment({ id: seed.order.id, move: 'decline-pictures' })) as {
      environment: { decisions: Record<string, boolean> }
    }
    expect((await store.entries(seed.order.id)).at(-1)).toMatchObject({
      action: 'pictures.declined',
    })
    expect(r.environment.decisions).toEqual({ continueUnmeasured: false, declinePictures: true })
    const again = (await channels().compile(compiling(seed.order.id, false))) as {
      environment: { decisions: Record<string, boolean> }
    }
    expect(again.environment.decisions.declinePictures).toBe(true)
  })
}

function theMoveErrorsTests() {
  it('refuses a move other than check or waive, and errors on an unknown order', async () => {
    const seed = await drafted()
    expect(
      await sendThroughSchema('foundry:forge.environment', { id: seed.order.id, move: 'skip' })
    ).toEqual({ error: 'Malformed request.' })
    const r = (await channels().environment({ id: 'WO-nope', move: 'check' })) as {
      error?: string
    }
    expect(r.error).toBe('No order WO-nope.')
  })
}

describe('the decisions about what cannot be measured', theDecisionMovesTests)
describe('the decision to ship without pictures', thePicturesDecisionTests)

describe('handing off waits for the base branch check', () => {
  describe('the manual hand-off', manualHandOffTests)
  describe('manualHandOffAgreesTests', manualHandOffAgreesTests)
  describe('the automatic hand-off', automaticHandOffTests)
  describe('a waiver', waiverTests)
  describe('the moves on a draft only', draftOnlyMovesTests)
})

type Refusal = OrderView & { refused?: string }

async function handOffReadyOrder(baseline: ReturnType<typeof provenBaseline> | null) {
  const order = await completeOrder()
  if (baseline === null) fs.rmSync(path.join(root, 'orders', order.id, 'baseline.json'))
  else await writeBaseline(root, order.id, baseline)
  return order
}

const failingBaseline = provenBaseline({
  state: 'failing',
  steps: [baseStep('Lint', { result: 'fail', exitCode: 2, command: 'npm run lint' })],
})

function manualHandOffTests() {
  const notAgreed: [string, ReturnType<typeof provenBaseline> | null, string][] = [
    ['never checked', null, 'Not checked for this order yet.'],
    [
      'still checking',
      provenBaseline({ state: 'checking' }),
      'The check of main stopped before it finished.',
    ],
    ['failing', failingBaseline, 'Lint failed on main with exit code 2: `npm run lint`.'],
  ]
  it.each(notAgreed)(
    'refuses a commit when the base is %s, and saves nothing',
    async (_n, baseline, why) => {
      const order = await handOffReadyOrder(baseline)
      const r = (await channels().compile(compiling(order.id, true))) as Refusal
      expect(r.refused).toBe(why)
      expect(r.order.status).toBe('draft')
      expect((await store.load(order.id))?.status).toBe('draft')
      expect((await store.entries(order.id)).map((e) => e.action)).not.toContain('order.agreed')
    }
  )

  it('agrees when the base is proven', async () => {
    const order = await handOffReadyOrder(provenBaseline())
    const r = (await channels().compile(compiling(order.id, true))) as Refusal
    expect(r.refused).toBeUndefined()
    expect(r.order.status).toBe('agreed')
  })
}

function manualHandOffAgreesTests() {
  it('agrees a bug fix whose only failure is its tests', async () => {
    const order = await handOffReadyOrder(
      provenBaseline({
        state: 'failing',
        steps: [baseStep('Build'), baseStep('Tests', { result: 'fail', exitCode: 1 })],
      })
    )
    await store.save({ ...order, recipe: 'bugfix' })
    const r = (await channels().compile(compiling(order.id, true))) as Refusal
    expect(r.order.status).toBe('agreed')
  })

  it('still only previews while the base is failing', async () => {
    const order = await handOffReadyOrder(failingBaseline)
    const r = (await channels().compile(compiling(order.id, false))) as Refusal
    expect(r.refused).toBeUndefined()
  })
}

function automaticHandOffTests() {
  it("refuses the Forge's own hand-off too, with the same words", async () => {
    const order = await handOffReadyOrder(failingBaseline)
    const r = (await channels().compile({ id: order.id, commit: true, automatic: true })) as Refusal
    expect(r.refused).toBe('Lint failed on main with exit code 2: `npm run lint`.')
    expect((await store.load(order.id))?.status).toBe('draft')
  })
}

function waiverTests() {
  it('agrees a failing base the operator skipped the check for', async () => {
    const order = await handOffReadyOrder({ ...failingBaseline, startedAt: '2026-09-01T00:00:00Z' })
    await channels().environment({ id: order.id, move: 'waive' })
    const r = (await channels().compile(compiling(order.id, true))) as Refusal
    expect(r.order.status).toBe('agreed')
  })

  it('stops counting once a newer check has started', async () => {
    const order = await handOffReadyOrder({ ...failingBaseline, startedAt: '2026-09-01T00:00:00Z' })
    await channels().environment({ id: order.id, move: 'waive' })
    await writeBaseline(root, order.id, { ...failingBaseline, startedAt: '2026-09-07T00:00:00Z' })
    const r = (await channels().compile(compiling(order.id, true))) as Refusal & {
      environment: { waivedAt: string | null }
    }
    expect(r.environment.waivedAt).toBeNull()
    expect(r.refused).toBe('Lint failed on main with exit code 2: `npm run lint`.')
  })
}

function draftOnlyMovesTests() {
  it.each(['check', 'waive'] as const)(
    'refuses "%s" on an order that is not a draft',
    async (move) => {
      const order = await completeOrder()
      await store.save({ ...order, status: 'running' })
      const proveEnvironment = vi.fn(async () => undefined)
      const c = createForgeChannels(forgeDeps({ proveEnvironment }))
      const r = await c.environment({ id: order.id, move })
      expect(r).toEqual({ error: 'Only a draft order can check its base branch again.' })
      expect(proveEnvironment).not.toHaveBeenCalled()
      expect((await store.entries(order.id)).map((e) => e.action)).not.toContain(
        'environment.waived'
      )
    }
  )
}

// An order made by mistake used to stay on the list for good. Discarding marks
// it rather than deleting it, and refuses one whose agents are still working.
describe('foundry:order.cancel', () => {
  describe('discarding a draft', discardingADraftTests)
  describe('an order already cancelled', alreadyCancelledTests)
  describe('what it refuses', whatCancelRefusesTests)
})

function discardingADraftTests() {
  it('marks the order cancelled, records why, and takes it off the list', async () => {
    const seed = await drafted()
    const r = (await sendThroughSchema('foundry:order.cancel', {
      id: seed.order.id,
      reason: 'made by mistake',
    })) as OrderView
    expect(r.order.status).toBe('cancelled')
    expect((await store.load(seed.order.id))?.status).toBe('cancelled')
    const last = (await store.entries(seed.order.id)).at(-1)
    expect(last).toMatchObject({
      actor: 'operator',
      action: 'order.cancelled',
      reason: 'made by mistake',
    })
    const listed = (await channels().list()) as { orders: { id: string }[] }
    expect(listed.orders.map((row) => row.id)).not.toContain(seed.order.id)
  })

  it('says the operator discarded it when no reason is given', async () => {
    const seed = await drafted()
    await sendThroughSchema('foundry:order.cancel', { id: seed.order.id })
    const last = (await store.entries(seed.order.id)).at(-1)
    expect(last?.reason).toBe('Discarded by the operator.')
  })
}

function alreadyCancelledTests() {
  it('leaves an order already cancelled as it is, recording nothing more', async () => {
    const seed = await drafted()
    await sendThroughSchema('foundry:order.cancel', { id: seed.order.id })
    const before = (await store.entries(seed.order.id)).length
    const r = (await sendThroughSchema('foundry:order.cancel', { id: seed.order.id })) as OrderView
    expect(r.order.status).toBe('cancelled')
    expect(await store.entries(seed.order.id)).toHaveLength(before)
  })
}

function whatCancelRefusesTests() {
  it('refuses a running order, sending the operator to its gate', async () => {
    const seed = await drafted()
    await store.save({ ...seed.order, status: 'running' })
    const r = (await sendThroughSchema('foundry:order.cancel', { id: seed.order.id })) as {
      error: string
    }
    expect(r.error).toBe(
      `${seed.order.id} is running. Stop it at its gate before discarding it — its agents still have work in their worktrees.`
    )
    expect((await store.load(seed.order.id))?.status).toBe('running')
  })

  it('reports an order it cannot find', async () => {
    expect(await sendThroughSchema('foundry:order.cancel', { id: 'WO-nope' })).toEqual({
      error: 'No order WO-nope.',
    })
  })
}

const published = {
  path: 'research.md',
  url: 'https://claude.ai/artifact/abc-123',
  location: 'published' as const,
}

async function listedDocument(document: WorkOrder['document']): Promise<unknown> {
  const c = channels()
  const seeded = (await c.create({
    source: { kind: 'typed', text: 'first idea' },
    repoPaths: [repo],
  })) as OrderView
  const loaded = await store.load(seeded.order.id)
  await store.save({ ...loaded!, document })
  const r = (await c.list()) as { orders: { document: unknown }[] }
  return r.orders[0].document
}

function documentOnTheRowTests() {
  it('says what kind of document a published one is, where it opens, and where its copy is', async () => {
    expect(await listedDocument(published)).toEqual({
      kind: 'claude-artifact',
      url: published.url,
      path: expect.stringMatching(/\/orders\/WO-[^/]+\/research\.md$/),
    })
  })

  it('has a file in the outputs folder open by its path', async () => {
    expect(await listedDocument({ path: '/out/notes.md', location: 'outputs' })).toEqual({
      kind: 'file',
      url: null,
      path: '/out/notes.md',
    })
  })

  it('says nothing for a document in the checkout, which ships as a pull request, or for none', async () => {
    expect(await listedDocument({ path: 'docs/a.md', location: 'checkout' })).toBeNull()
    expect(await listedDocument(null)).toBeNull()
  })
}
