import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle, e2eTempDir } from './helpers'
import {
  clickByName as clickInFoundry,
  foundryChannel,
  inFoundry as inFoundryFrame,
  openFoundry as openFoundryPanel,
} from './foundry-harness'
import { extensionPage } from './extension-page'

// Opening the application on a run the last one left in flight. An agent's terminal is a
// child of the application, so "the agents are gone" is a fact about a fresh process: the
// records are written before the app launches, as a previous session would have left them.

let handle: AppHandle
let repo: string

function git(...args: string[]): void {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  execFileSync('git', args, { cwd: repo, env })
}

const ORDER_ID = 'WO-INTERRUPTED'

/** The fixture repository and its toolchain. */
function orderContext(): unknown {
  return {
    repos: [{ name: 'fixture', path: repo, lane: 1, baseBranch: 'main', headBranch: '' }],
    toolchain: {
      test: { command: 'npm test', source: 'package.json' },
      lint: null,
      format: null,
      coverage: null,
      e2e: null,
      build: null,
    },
    entryPoints: [],
    priorArt: [],
    conventions: [],
    houseDocs: [],
  }
}

/** One builder unit on one lane, satisfying AC-1. */
function orderPlan(): unknown {
  return {
    units: [
      {
        id: 'U-1',
        title: 'refresh the token on a 401',
        role: 'builder',
        lane: 1,
        dependsOn: [],
        satisfies: ['AC-1'],
        touches: ['src/client.ts'],
        verify: [],
      },
    ],
    lanes: [{ ord: 1, repo: 'fixture', branch: '', role: null, blocks: [], blockedBy: [] }],
    sharedFiles: [],
  }
}

/** The order's one criterion, verified by its tests. */
const REFRESHES_ONCE = {
  id: 'AC-1',
  statement: 'A 401 refreshes once and retries once.',
  priority: 'P1',
  verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
  unverifiable: null,
}

/**
 * The order, as the Forge would have saved it before the run started.
 *
 * Written out in full rather than built from the schema's constructor: this
 * file is transpiled as CommonJS, and the extension's sources are ESM with
 * `.js` specifiers that do not resolve here. `the run is noticed on opening`
 * is what catches a fixture that drifts — an order that fails validation loads
 * as null and every surface reads "no such order".
 */
function order(): unknown {
  return {
    schemaVersion: 1,
    id: ORDER_ID,
    title: 'Refresh the token on a 401',
    status: 'running',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    writeBack: [],
    stateMapping: { started: null, in_review: null, done: null },
    recipe: 'direct',
    recipeOverriddenBy: null,
    intent: {
      problem: 'The client retries a 401 for ever instead of refreshing.',
      outcome: 'It refreshes once and retries once.',
      nonGoals: [],
    },
    context: orderContext(),
    acceptance: [REFRESHES_ONCE],
    risk: { grade: 'P2', triggers: [], blastRadius: [], criticalPaths: [] },
    budgets: { agents: 3, wallClockMinutes: 45, tokens: null },
    plan: orderPlan(),
    assumptions: [],
    openQuestions: [],
    redTeam: [],
    provenance: { forgeSession: null, decisions: [], amendments: [] },
    createdAt: '2026-09-06T10:00:00.000Z',
    agreedAt: '2026-09-06T10:05:00.000Z',
  }
}

/** The graph, frozen mid-run: one step `running`, with a session that is gone. */
function resumeGraph(): unknown {
  return {
    orderId: ORDER_ID,
    recipe: 'direct',
    nodes: [
      {
        id: 'build:U-1',
        stepId: 'build',
        kind: 'fanout',
        state: 'running',
        unitId: 'U-1',
        lane: 1,
        role: 'builder',
        dependsOn: [],
        attempts: 1,
        sessionId: '11111111-2222-3333-4444-555555555555',
        worktreePath: null,
        startedAt: '2026-09-06T10:00:00.000Z',
        endedAt: null,
      },
    ],
  }
}

const UNSHIPPED_ID = 'WO-UNSHIPPED'

/** An order whose run finished every step and then failed to ship. */
function unshippedOrder(): unknown {
  const base = order() as Record<string, unknown>
  return {
    ...base,
    id: UNSHIPPED_ID,
    title: 'Retry the failed upload',
  }
}

/** The graph, every node passed — WO-0913-0bd: the run finished and still failed. */
function unshippedGraph(): unknown {
  return {
    orderId: UNSHIPPED_ID,
    recipe: 'direct',
    nodes: [
      {
        id: 'build:U-1',
        stepId: 'build',
        kind: 'fanout',
        state: 'passed',
        unitId: 'U-1',
        lane: 1,
        role: 'builder',
        dependsOn: [],
        attempts: 1,
        sessionId: null,
        worktreePath: null,
        startedAt: '2026-09-06T10:00:00.000Z',
        endedAt: '2026-09-06T10:10:00.000Z',
      },
    ],
  }
}

/** The ledger tail WO-0913-0bd left: every node passed, then the ship tail threw. */
function unshippedLedger(): string {
  const line = (action: string, reason: string): string =>
    `${JSON.stringify({
      at: '2026-09-06T10:20:00.000Z',
      orderId: UNSHIPPED_ID,
      actor: 'role:builder',
      action,
      subject: UNSHIPPED_ID,
      reason,
      evidence: [],
    })}\n`
  return (
    line('run.started', 'run started') +
    line('run.complete', 'every step passed') +
    line('run.failed', 'Opening the pull request for fixture failed: exit code 1')
  )
}

function dataRoot(): string {
  return join(repo, '.foundry')
}

function graphOnDisk(): { nodes: { id: string; state: string; attempts: number }[] } {
  return JSON.parse(
    readFileSync(join(dataRoot(), 'orders', ORDER_ID, 'run-graph.json'), 'utf8')
  ) as { nodes: { id: string; state: string; attempts: number }[] }
}

function foundry(channel: string, payload: unknown = {}): Promise<unknown> {
  return foundryChannel(handle, channel, payload)
}

/** Runs a script inside Foundry's frame in the main window. */
function inFoundry<T>(script: string): Promise<T> {
  return inFoundryFrame<T>(handle, script)
}

function clickByName(name: string): Promise<boolean> {
  return clickInFoundry(handle, 'button', name)
}

/**
 * What the view is showing.
 *
 * `textContent`, not `innerText`: `innerText` is a rendered-layout property and
 * comes back empty for a view Chromium has not laid out, which is every read
 * that happens while the panel is not the frontmost thing on screen.
 */
function bodyText(): Promise<string> {
  return inFoundry<string>('document.body.textContent')
}

function openFoundry(): Promise<void> {
  return openFoundryPanel(handle)
}

/** The fixture repository's one commit: a README and a package whose test passes. */
function commitFixture(): void {
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# fixture\n')
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'echo ok' } }, null, 2)
  )
  git('add', '.')
  git('commit', '-m', 'initial')
}

/** Writes `files` into the data root's directory for `id`, each as pretty JSON or text. */
function writeOrderFiles(id: string, files: Record<string, string>): void {
  const dir = join(dataRoot(), 'orders', id)
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
}

const pretty = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** The run frozen mid-step; and a second order, left the way WO-0913-0bd was:
 * every node passed, status still `running`, and the ledger's last word is a
 * failure to ship. */
function writeLeftOrders(): void {
  writeOrderFiles(ORDER_ID, {
    'order.json': pretty(order()),
    'run-graph.json': pretty(resumeGraph()),
  })
  writeOrderFiles(UNSHIPPED_ID, {
    'order.json': pretty(unshippedOrder()),
    'run-graph.json': pretty(unshippedGraph()),
    'ledger.jsonl': unshippedLedger(),
  })
}

test.beforeAll(async () => {
  repo = e2eTempDir('foundry-resume-repo-')
  commitFixture()
  // Written before the application exists. This is what the last session left.
  writeLeftOrders()

  handle = await launchApp()
  await createWorkspace(handle.page, 'Foundry', repo)
  await openFoundry()
})

test.afterAll(async () => {
  await closeApp(handle)
  rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
})

async function noticedOnOpening(): Promise<void> {
  // Through the channel the chrome polls every four seconds from the moment
  // the application opens, which is the whole claim: this is found in one poll
  // rather than by coming back hours later and noticing nothing had moved.
  await expect
    .poll(async () => ((await foundry('foundry:attention')) as { inbox: number }).inbox)
    .toBe(2)

  // Two things wait on you: the interrupted run's gate, and the run that
  // finished but failed to open its pull request — which has no gate, and so
  // until ADR 090 was counted and listed nowhere.
  const listed = (await foundry('foundry:inbox.list')) as {
    gates: { rule: string; why: string; options: { id: string }[] }[]
    waiting: { orderId: string; headline: string; detail: string }[]
  }
  expect(listed.waiting).toEqual([
    expect.objectContaining({
      orderId: UNSHIPPED_ID,
      headline: 'Finished, but not shipped',
      detail: 'Opening the pull request for fixture failed: exit code 1',
    }),
  ])
  expect(listed.gates.map((g) => g.rule)).toEqual(['run.interrupted'])
  expect(listed.gates[0].why).toContain('builder · U-1 refresh the token on a 401')
  expect(listed.gates[0].options.map((o) => o.id)).toEqual(['resume', 'stop', 'hold'])
}

async function floorSaysNothingRunsIt(): Promise<void> {
  const view = (await foundry('foundry:run.observe', { id: ORDER_ID })) as { orphaned: string[] }
  expect(view.orphaned).toEqual(['build:U-1'])
}

async function refusesADeadTerminal(): Promise<void> {
  const r = (await foundry('foundry:session.attach', {
    orderId: ORDER_ID,
    nodeId: 'build:U-1',
  })) as { error?: string }
  expect(r.error).toMatch(/no live agent/)
}

async function inboxRendersTheMove(): Promise<void> {
  await openFoundry()
  // Polled rather than read once: the inbox refetches on a timer, and the gate
  // is raised by the same poll the chrome makes.
  await expect
    .poll(async () => await bodyText().catch((e) => `ERR:${(e as Error).message}`))
    .toContain('Refresh the token on a 401')

  await expect.poll(() => bodyText()).toContain('Pick it back up')
  await expect.poll(() => bodyText()).toContain('Stop here')

  // The picture, because a structural assertion passes while the band renders
  // in the wrong place, off-screen, or unreadable.
  const view = await extensionPage(handle, 'foundry')
  mkdirSync(join(process.cwd(), 'test-results'), { recursive: true })
  writeFileSync(
    join(process.cwd(), 'test-results', 'foundry-interrupted-inbox.png'),
    await view.screenshot()
  )
  expect(existsSync(join(process.cwd(), 'test-results', 'foundry-interrupted-inbox.png'))).toBe(
    true
  )
}

/** Waits for the order's row in the Forge list, then opens it. */
async function openOrderRowInView(id: string, missing: string): Promise<void> {
  await expect
    .poll(() =>
      inFoundry<string>(
        `Array.from(document.querySelectorAll('.fdry-orders button')).map(b => b.textContent || '').join('|')`
      )
    )
    .toContain(id)
  expect(
    await inFoundry<boolean>(`(function () {
      var rows = document.querySelectorAll('.fdry-orders button')
      for (var i = 0; i < rows.length; i++) {
        if ((rows[i].textContent || '').indexOf(${JSON.stringify(id)}) >= 0) {
          rows[i].click(); return true
        }
      }
      return false
    })()`),
    missing
  ).toBe(true)
}

/** Run in Foundry's view: opens the collapsed gate's reason, and says whether there was one. */
const SHOW_THE_REASON = `(function () {
      var b = document.querySelector('button[aria-label="Show the reason"]')
      if (!b) return false
      b.click(); return true
    })()`

/** Run in Foundry's view: whether a "Try again" button is on screen. */
const HAS_TRY_AGAIN = `(function () {
      var all = document.querySelectorAll('button')
      for (var i = 0; i < all.length; i++) {
        var label = (all[i].getAttribute('aria-label') || all[i].textContent || '').trim()
        if (label === 'Try again') return true
      }
      return false
    })()`

/** A PNG of the Foundry frame as it is now, base64. */
async function foundryShot(): Promise<string> {
  const view = await extensionPage(handle, 'foundry')
  return (await view.screenshot()).toString('base64')
}

async function floorCarriesTheMove(): Promise<void> {
  await openFoundry()

  // The Forge tab, then the running order — which opens on the Floor.
  await expect.poll(() => clickByName('Forge')).toBe(true)
  await openOrderRowInView(ORDER_ID, 'no row for the running order')

  // `Halted — your move`, not `Nothing is running this`: an orphan always raises
  // `run.interrupted` (adopt.ts), and ADR-045 puts an unanswered gate first.
  await expect.poll(() => bodyText()).toContain('Halted — your move')
  // A gate is one line until it is opened; its reason is behind the chevron.
  await expect
    .poll(() => inFoundry<boolean>(SHOW_THE_REASON), { message: 'no collapsed gate to open' })
    .toBe(true)
  // The interrupted gate's own words, so this proves the resume band rendered
  // rather than any halt at any gate.
  await expect.poll(() => bodyText()).toContain('Nothing is moving this run')
  await expect.poll(() => bodyText()).toContain('builder · U-1 refresh the token on a 401')
  await expect.poll(() => bodyText()).toContain('Pick it back up')

  writeFileSync(
    join(process.cwd(), 'test-results', 'foundry-interrupted-floor.png'),
    Buffer.from(await foundryShot(), 'base64')
  )
}

async function unshippedRunSaysSo(): Promise<void> {
  await openFoundry()

  // The interrupted order is still open from the step before: "All orders" is
  // the way back to the list, and the list refetches on its own 4s timer.
  await expect.poll(() => clickByName('Forge')).toBe(true)
  await clickByName('All orders')
  await openOrderRowInView(UNSHIPPED_ID, 'no row for the unshipped order')

  await expect.poll(() => bodyText()).toContain('Finished, but not shipped')
  await expect
    .poll(() => bodyText())
    .toContain('Opening the pull request for fixture failed: exit code 1')
  await expect.poll(() => bodyText()).not.toContain('Between steps')

  // The standing text also shows in the order's list row, so it can be on
  // screen before the Floor renders its move: wait for the button itself.
  await expect.poll(() => inFoundry<boolean>(HAS_TRY_AGAIN)).toBe(true)
}

async function answeringRequeuesTheStep(): Promise<void> {
  expect(graphOnDisk().nodes[0].state).toBe('running')

  const decided = (await foundry('foundry:inbox.decide', {
    gateId: `${ORDER_ID}-run.interrupted`,
    option: 'resume',
  })) as { ok?: boolean; error?: string }
  expect(decided.error, JSON.stringify(decided)).toBeUndefined()
  expect(decided.ok).toBe(true)

  // Reclaimed and written down. The executor then starts it again — which is
  // asynchronous and cuts a worktree, so what is asserted here is the reclaim
  // itself: the state the scheduler can act on, and the attempt given back.
  await expect.poll(() => graphOnDisk().nodes[0].attempts).toBeLessThanOrEqual(1)
  await expect.poll(() => graphOnDisk().nodes[0].state).toMatch(/^(waiting|running)$/)
}

async function stoppingStopsTheRun(): Promise<void> {
  const stopped = (await foundry('foundry:run.stop', { id: ORDER_ID })) as { ok?: boolean }
  expect(stopped.ok).toBe(true)

  // Read from the record rather than from `order.list`, which filters a
  // cancelled order out by design — the list is what needs doing.
  const saved = JSON.parse(
    readFileSync(join(dataRoot(), 'orders', ORDER_ID, 'order.json'), 'utf8')
  ) as { status: string }
  expect(saved.status).toBe('cancelled')

  const listed = (await foundry('foundry:order.list')) as {
    orders: { id: string }[]
  }
  expect(listed.orders.some((o) => o.id === ORDER_ID)).toBe(false)

  const ledger = readFileSync(join(dataRoot(), 'orders', ORDER_ID, 'ledger.jsonl'), 'utf8')
  expect(ledger).toContain('run.interrupted')
  expect(ledger).toContain('run.stopped')
}

test('a run that died with the app is noticed on opening, shown with its move, resumed and stopped', async () => {
  const step = test.step
  await step('the run is noticed on opening, without anybody going to look', noticedOnOpening)
  await step(
    'the Floor says nothing is running it, rather than drawing a working run',
    floorSaysNothingRunsIt
  )
  await step('it refuses to send you to a terminal that no longer exists', refusesADeadTerminal)
  await step('the inbox renders the row with its move on it', inboxRendersTheMove)
  await step('the Floor carries the same move, above the graph', floorCarriesTheMove)
  await step(
    'a run that finished every step and still failed to ship says so, with a move',
    unshippedRunSaysSo
  )
  await step('answering it puts the abandoned step back in the queue', answeringRequeuesTheStep)
  await step('stopping a run stops it, which nothing used to do', stoppingStopsTheRun)
})
