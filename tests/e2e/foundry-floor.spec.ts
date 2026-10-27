import { test, expect } from '@playwright/test'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  launchApp,
  closeApp,
  createWorkspace,
  runQuickActionFromPanel,
  type AppHandle,
} from './helpers'
import {
  bodyText,
  captureFoundry,
  clickByName,
  clickContaining,
  createTypedOrder,
  hasStation,
  inFoundry,
  listOrdersInForge,
  makeFixtureRepo,
  openFoundry,
  openForge,
  openListedOrder,
  pressedByLabel,
  restartFoundry,
  stationCount,
} from './foundry-harness'

// What runs recorded, read back on every surface that shows it: the Factory view (kept
// across a restart) and its hall, the Floor's CI band and the Ledger's numbers. Records
// are written to disk by hand, so the app restarts to read them, as an operator's would.

let handle: AppHandle
let repo: string

test.beforeAll(async () => {
  repo = makeFixtureRepo('foundry-floor-repo-')
  // A running order with a real run graph, so the Factory view has a hall to draw.
  writeHallRecords(repo)
  handle = await launchApp()
  await createWorkspace(handle.page, 'Foundry Floor', repo)
  await openFoundry(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
  rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
})

/** The Forge is in Factory view, and List is not pressed. */
async function expectFactoryPressed(): Promise<void> {
  await expect.poll(() => pressedByLabel(handle, 'Factory view')).toBe('true')
  await expect.poll(() => pressedByLabel(handle, 'List view')).toBe('false')
}

/** The Forge is in List view, and Factory is not pressed. */
async function expectListPressed(): Promise<void> {
  await expect.poll(() => pressedByLabel(handle, 'List view')).toBe('true')
  await expect.poll(() => pressedByLabel(handle, 'Factory view')).toBe('false')
}

/** From the default, List, to Factory: and the factory surface draws something. */
async function switchToFactory(): Promise<void> {
  await openForge(handle)
  await expectListPressed()
  await expect.poll(() => clickByName(handle, 'button', 'Factory view')).toBe(true)
  await expectFactoryPressed()
  await expect.poll(async () => (await bodyText(handle)).length).toBeGreaterThan(0)
  await captureFoundry(handle, 'foundry-factory-view.png')
}

/** The view the operator chose, as the settings store holds it. */
async function storedView(): Promise<string> {
  const settings = await handle.page.evaluate(() =>
    window.electronAPI.extension.getSettingsValues()
  )
  return (settings.values['terminator.foundry.view'] as string | undefined) ?? 'list'
}

async function toggleFromQuickActions(): Promise<void> {
  await expect.poll(() => storedView()).toBe('factory')
  await runQuickActionFromPanel(handle.page, 'Toggle factory view')
  await expect.poll(storedView).toBe('list')
  await expectListPressed()
  await runQuickActionFromPanel(handle.page, 'Toggle factory view')
  await expect.poll(storedView).toBe('factory')
  await expectFactoryPressed()
}

/** Writes a watched draft and a shipped order, and restarts on the same profile. */
async function seedAndRestart(): Promise<string> {
  const watched = await seedWatchedDraft()
  await seedShippedOrder()
  await seedPublishedResearch()
  handle = await restartFoundry(handle, 'Foundry Floor')
  await openForge(handle)
  return watched
}

async function backToList(): Promise<void> {
  await expect.poll(() => clickByName(handle, 'button', 'All halls')).toBe(true)
  await openForge(handle)
  await expect.poll(() => clickByName(handle, 'button', 'List view')).toBe(true)
  await expectListPressed()
  await expect.poll(() => bodyText(handle)).toContain('New order')
}

async function openOrderRow(id: string, listShot?: string): Promise<string> {
  await listOrdersInForge(handle, id)
  if (listShot !== undefined) await captureFoundry(handle, listShot)
  const list = await bodyText(handle)
  await openListedOrder(handle, id)
  return list
}

/** One node of a run graph that has passed. */
function passedNode({ id, kind, role, lane }: NodeShape) {
  return {
    id,
    stepId: id.split(':')[0],
    kind,
    state: 'passed',
    unitIds: [],
    lane,
    role,
    dependsOn: [],
    attempts: 1,
    reworks: 0,
    feedback: [],
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
  }
}

interface NodeShape {
  id: string
  kind: string
  role: string | null
  lane: number | null
}

/** Marks the order running, with a passed lane build and a passed ship gate. */
function writeRunningOrder(dir: string, id: string): void {
  const file = join(dir, 'order.json')
  writeFileSync(
    file,
    JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), status: 'running' })
  )
  const nodes = [
    passedNode({ id: 'build:lane-1', kind: 'fanout', role: 'builder', lane: 1 }),
    passedNode({ id: 'ship', kind: 'gate', role: null, lane: null }),
  ]
  writeFileSync(
    join(dir, 'run-graph.json'),
    JSON.stringify({ orderId: id, recipe: 'direct', nodes })
  )
}

/** The draft this run opened, as shipping records it. */
function writeDraftPull(dir: string): void {
  writeFileSync(
    join(dir, 'pulls.json'),
    JSON.stringify([
      {
        lane: 1,
        repo: 'r',
        cwd: repo,
        branch: 'foundry/ci-watched',
        url: 'https://github.com/o/r/pull/7',
        bodyPath: join(dir, 'pull-request-lane-1.md'),
      },
    ])
  )
}

/** CI being watched on that draft: round 1 of 2, one check failing and one pending. */
function writeWatchedCi(dir: string): void {
  const link = (run: number) => `https://github.com/o/r/actions/runs/${run}/job/1`
  writeFileSync(
    join(dir, 'ci.json'),
    JSON.stringify({
      round: 1,
      max: 2,
      status: 'watching',
      pulls: [
        {
          url: 'https://github.com/o/r/pull/7',
          checks: [
            { name: 'Test', bucket: 'fail', link: link(1), workflow: 'CI' },
            { name: 'Lint', bucket: 'pass', link: link(1), workflow: 'CI' },
            { name: 'E2E', bucket: 'pending', link: link(1), workflow: 'CI' },
          ],
        },
      ],
      reason: '',
      at: new Date().toISOString(),
    })
  )
}

/** The text of the Floor's CI band. */
function ciBand(): Promise<string> {
  return inFoundry<string>(
    handle,
    `(function () {
    var h = document.getElementById('fdry-ci-h')
    return h && h.closest('section') ? h.closest('section').innerText : ''
  })()`
  )
}

/** A draft whose CI is being watched: running, with a pull request and a CI round on disk. */
async function seedWatchedDraft(): Promise<string> {
  const id = await createTypedOrder(handle, {
    repo,
    text: 'a draft whose CI is being watched',
    missing: 'no order was created',
  })
  const dir = join(repo, '.foundry', 'orders', id)
  writeRunningOrder(dir, id)
  writeDraftPull(dir)
  writeWatchedCi(dir)
  return id
}

async function ciOnTheFloor(id: string): Promise<void> {
  // The order's row says the same as its Floor before it is opened: the pull
  // request, and the CI round with a spinner while the checks run.
  const list = await openOrderRow(id, 'order-list-ci.png')
  expect(list).toContain('#7')
  expect(list).toContain('Fix 1 of 2')

  await expect.poll(ciBand).toContain('Fix 1 of 2')
  await expect.poll(() => ciBand()).toContain('Test')

  await captureFoundry(handle, 'floor-ci.png')
}

/** What a run that shipped first time leaves behind: started, then a draft
 * thirty minutes after the order was seeded, with nothing sent back. */
function writeShippedFirstTime(id: string): void {
  const seededAt = Date.now()
  const entry = (minutes: number, action: string): string =>
    JSON.stringify({
      at: new Date(seededAt + minutes * 60_000).toISOString(),
      orderId: id,
      actor: 'rule:line',
      action,
      subject: id,
      reason: 'seeded by the test',
      evidence: [],
    })
  appendFileSync(
    join(repo, '.foundry', 'orders', id, 'ledger.jsonl'),
    [entry(10, 'run.started'), entry(30, 'ship.draft_opened')].map((line) => `${line}\n`).join('')
  )
}

/** The Factory tab's metric tiles, by label. */
function metricTiles(): Promise<Record<string, string>> {
  return inFoundry<Record<string, string>>(
    handle,
    `(function () {
    var out = {}
    document.querySelectorAll('.tmui-metric-card').forEach(function (card) {
      var question = card.querySelector('.tmui-metric-card__question')
      var value = card.querySelector('.tmui-metric-card__value')
      out[(question && question.textContent.trim()) || ''] = value ? value.textContent.trim() : ''
    })
    return out
  })()`
  )
}

/** The factory site's status wall shows the metrics the Ledger reads. */
async function expectStatusWall(): Promise<void> {
  const wall = () =>
    inFoundry<string>(
      handle,
      `(function () {
    var wall = document.querySelector('[aria-label="Status wall"]')
    return wall ? wall.innerText : ''
  })()`
    )
  await expect.poll(wall).toContain('First-pass yield')
  await captureFoundry(handle, 'site-status-wall.png')
}

/** An order that shipped first time, its ledger written by hand. */
async function seedShippedOrder(): Promise<void> {
  const id = await createTypedOrder(handle, {
    repo,
    text: 'a shipped order to measure',
    missing: 'no order was created to measure',
  })
  writeShippedFirstTime(id)
}

const RESEARCH_TITLE = 'why the overview reads as one long scroll'
const RESEARCH_LINK = 'https://claude.ai/artifact/YJeSCmFWK1GJC8X9ZXUpVf'

/** A research order that ended on a published Claude artifact, written as the line leaves it. */
async function seedPublishedResearch(): Promise<void> {
  const id = await createTypedOrder(handle, {
    repo,
    text: RESEARCH_TITLE,
    missing: 'no research order was created',
  })
  const dir = join(repo, '.foundry', 'orders', id)
  const file = join(dir, 'order.json')
  const document = {
    path: join(dir, 'outputs', 'answer.html'),
    url: RESEARCH_LINK,
    location: 'published',
  }
  const order = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, JSON.stringify({ ...order, recipe: 'research', status: 'shipped', document }))
  const nodes = ['scout', 'write', 'verify'].map((step) =>
    passedNode({ id: step, kind: 'agent', role: step === 'write' ? 'author' : step, lane: 1 })
  )
  writeFileSync(
    join(dir, 'run-graph.json'),
    JSON.stringify({ orderId: id, recipe: 'research', nodes })
  )
}

/** Run in Foundry's view: whether a link of that name exists, and whether any sits inside a button. */
function artifactLinks(): Promise<{ count: number; insideButton: boolean }> {
  return inFoundry(
    handle,
    `(function () {
    var links = Array.prototype.filter.call(document.querySelectorAll('a'), function (a) {
      return a.textContent.trim() === 'Claude artifact' && a.getAttribute('href') === ${JSON.stringify(RESEARCH_LINK)}
    })
    return { count: links.length, insideButton: links.some(function (a) { return !!a.closest('button') }) }
  })()`
  )
}

/** The factory site's card links the artifact beside the hall, and the hall's HUD offers it. */
async function researchArtifactInTheFactory(): Promise<void> {
  await expect.poll(async () => (await artifactLinks()).count).toBe(1)
  expect((await artifactLinks()).insideButton).toBe(false)
  await captureFoundry(handle, 'foundry-factory-research-card.png')
  await expect.poll(() => clickContaining(handle, 'button', RESEARCH_TITLE)).toBe(true)
  // The hall loads after the click: wait for its HUD, not for the card's link still on screen.
  await expect.poll(() => bodyText(handle)).toContain('Open artifact')
  expect((await artifactLinks()).count).toBe(1)
  await captureFoundry(handle, 'foundry-factory-research-hall.png')
  await expect.poll(() => clickByName(handle, 'button', 'All halls')).toBe(true)
}

/** The order list's row links the artifact too. */
async function researchArtifactOnTheList(): Promise<void> {
  await expect.poll(async () => (await artifactLinks()).count).toBe(1)
  await captureFoundry(handle, 'foundry-list-research-row.png')
}

async function ledgerFactoryNumbers(): Promise<void> {
  await expect.poll(() => clickByName(handle, 'button', 'Ledger')).toBe(true)
  await expect.poll(() => clickByName(handle, 'button', 'Factory')).toBe(true)

  await expect.poll(async () => (await metricTiles()).Shipped).toBe('1')
  const finalTiles = await metricTiles()
  expect(finalTiles['First-pass yield']).toBe('100%')
  expect(finalTiles['Median lead time']).toBe('30 min')
  await expect.poll(() => bodyText(handle)).toContain('a shipped order to measure')

  await captureFoundry(handle, 'ledger-factory.png')
}

const HALL_ORDER_ID = 'WO-FACTORY-HALL'

/** The fixture repository and its toolchain. */
function hallContext(repo: string): unknown {
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

/** A builder unit on a lane, satisfying AC-1. */
function laneUnit(lane: number, touches: string): unknown {
  return {
    id: `U-${lane}`,
    title: `back off, lane ${lane}`,
    role: 'builder',
    lane,
    dependsOn: [],
    satisfies: ['AC-1'],
    touches: [touches],
    verify: [],
  }
}

/** Two build lanes, one unit each. */
function hallPlan(): unknown {
  return {
    units: [laneUnit(1, 'src/sync.ts'), laneUnit(2, 'src/sync2.ts')],
    lanes: [
      { ord: 1, repo: 'fixture', branch: '', role: null, blocks: [], blockedBy: [] },
      { ord: 2, repo: 'fixture', branch: '', role: null, blocks: [], blockedBy: [] },
    ],
    sharedFiles: [],
  }
}

/** The order's one criterion, verified by its tests. */
const BACKS_OFF = {
  id: 'AC-1',
  statement: 'A failed sync retries with exponential backoff up to five times.',
  priority: 'P1',
  verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
  unverifiable: null,
}

/** A running order, agreed and mid-run, with two build lanes. */
function hallOrder(repo: string): unknown {
  return {
    schemaVersion: 1,
    id: HALL_ORDER_ID,
    title: 'Add retry backoff to the sync job',
    status: 'running',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    writeBack: [],
    stateMapping: { started: null, in_review: null, done: null },
    recipe: 'standard',
    recipeOverriddenBy: null,
    intent: {
      problem: 'The sync job retries immediately and hammers the API on an outage.',
      outcome: 'It backs off exponentially and gives up after five tries.',
      nonGoals: [],
    },
    context: hallContext(repo),
    acceptance: [BACKS_OFF],
    risk: { grade: 'P2', triggers: [], blastRadius: [], criticalPaths: [] },
    budgets: { agents: 3, wallClockMinutes: 45, tokens: null },
    plan: hallPlan(),
    assumptions: [],
    openQuestions: [],
    redTeam: [],
    provenance: { forgeSession: null, decisions: [], amendments: [] },
    createdAt: '2026-09-25T10:00:00.000Z',
    agreedAt: '2026-09-25T10:05:00.000Z',
  }
}

interface HallNodeSpec {
  readonly id: string
  readonly stepId: string
  readonly kind: 'agent' | 'run' | 'gate' | 'fanout' | 'join'
  readonly state: string
  readonly lane: number | null
  readonly role: string | null
  readonly dependsOn: readonly string[]
  readonly attempts: number
  readonly sessionId?: string | null
}

function graphNode(spec: HallNodeSpec): unknown {
  const finished = spec.state === 'passed' || spec.state === 'failed' || spec.state === 'skipped'
  return {
    id: spec.id,
    stepId: spec.stepId,
    kind: spec.kind,
    state: spec.state,
    unitIds: [],
    lane: spec.lane,
    role: spec.role,
    dependsOn: spec.dependsOn,
    attempts: spec.attempts,
    sessionId: spec.sessionId ?? null,
    worktreePath: null,
    startedAt: spec.state === 'waiting' ? null : '2026-09-25T10:00:00.000Z',
    endedAt: finished ? '2026-09-25T10:10:00.000Z' : null,
  }
}

/** The graph frozen mid-run. `build:lane1` is `running` with a session nothing in this
 * process runs, which the Factory view must draw orphaned ("no agent"), not as live. */
const HALL_NODES: HallNodeSpec[] = [
  {
    id: 'architect',
    stepId: 'architect',
    kind: 'agent',
    state: 'passed',
    lane: null,
    role: 'architect',
    dependsOn: [],
    attempts: 1,
  },
  {
    id: 'build:lane1',
    stepId: 'build',
    kind: 'fanout',
    state: 'running',
    lane: 1,
    role: 'builder',
    dependsOn: ['architect'],
    attempts: 1,
    sessionId: '11111111-2222-3333-4444-555555555555',
  },
  {
    id: 'build:lane2',
    stepId: 'build',
    kind: 'fanout',
    state: 'passed',
    lane: 2,
    role: 'builder',
    dependsOn: ['architect'],
    attempts: 1,
  },
  {
    id: 'verify:lane1',
    stepId: 'verify',
    kind: 'run',
    state: 'waiting',
    lane: 1,
    role: 'verifier',
    dependsOn: ['build:lane1'],
    attempts: 0,
  },
  {
    id: 'verify:lane2',
    stepId: 'verify',
    kind: 'run',
    state: 'waiting',
    lane: 2,
    role: 'verifier',
    dependsOn: ['build:lane2'],
    attempts: 0,
  },
  {
    id: 'inspect',
    stepId: 'inspect',
    kind: 'agent',
    state: 'waiting',
    lane: null,
    role: 'inspector',
    dependsOn: ['verify:lane1', 'verify:lane2'],
    attempts: 0,
  },
  {
    id: 'join',
    stepId: 'join',
    kind: 'join',
    state: 'waiting',
    lane: null,
    role: 'scribe',
    dependsOn: ['inspect'],
    attempts: 0,
  },
  {
    id: 'gate',
    stepId: 'gate',
    kind: 'gate',
    state: 'waiting',
    lane: null,
    role: null,
    dependsOn: ['join'],
    attempts: 0,
  },
]

/** The graph, frozen mid-run. */
function hallGraph(): unknown {
  return { orderId: HALL_ORDER_ID, recipe: 'standard', nodes: HALL_NODES.map(graphNode) }
}

/** The order and its graph, and what the recorder writes beside the graph as a
 * run goes: two frames, the architect working and then done, for the replay
 * to play back. */
function writeHallRecords(repo: string): void {
  const dir = join(repo, '.foundry', 'orders', HALL_ORDER_ID)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'order.json'), `${JSON.stringify(hallOrder(repo), null, 2)}\n`)
  writeFileSync(join(dir, 'run-graph.json'), `${JSON.stringify(hallGraph(), null, 2)}\n`)
  const seeded = hallGraph() as {
    nodes: { id: string; attempts: number; sessionId: string | null }[]
  }
  const frame = (at: number, architect: string): string =>
    JSON.stringify({
      kind: 'graph',
      at,
      nodes: seeded.nodes.map((n, i) => ({
        id: n.id,
        state: i === 0 ? architect : 'waiting',
        attempts: n.attempts,
        sessionId: n.sessionId,
      })),
    })
  writeFileSync(
    join(dir, 'run-timeline.jsonl'),
    `${frame(Date.now() - 60_000, 'running')}\n${frame(Date.now() - 50_000, 'passed')}\n`
  )
}

/** Every node as `FactoryHall.tsx` labels a station: label, role (or "unassigned"),
 * `stateWord()` for its state (or "no agent" when orphaned) and attempt count. */
const EXPECTED_STATIONS = [
  'architect, architect, Done, attempt 1',
  'builder, builder, no agent, attempt 1',
  'builder, builder, Done, attempt 1',
  'verifier, verifier, Queued, attempt 0',
  'verifier, verifier, Queued, attempt 0',
  'inspector, inspector, Queued, attempt 0',
  'scribe, scribe, Queued, attempt 0',
  'gate, unassigned, Queued, attempt 0',
]

/** Run in Foundry's view: an open monitor headed BUILDER whose transcript says NO CARRIER. */
const ORPHAN_MONITOR = `(function () {
    var monitor = document.querySelector('section[aria-labelledby]')
    if (!monitor || !monitor.querySelector('button[aria-label="Close monitor"]')) return false
    var heading = document.getElementById(monitor.getAttribute('aria-labelledby'))
    var log = monitor.querySelector('[role="log"][aria-label="Transcript"]')
    return !!heading && heading.tagName === 'H3' && heading.textContent === 'BUILDER' && !!log && log.textContent.indexOf('NO CARRIER') !== -1
  })()`

/** From the Factory view's site, the hall's card and then the hall itself. */
async function openHall(): Promise<void> {
  await openForge(handle)
  await expect.poll(() => clickByName(handle, 'button', 'Factory view')).toBe(true)
  await expect.poll(() => pressedByLabel(handle, 'Factory view')).toBe('true')

  // The hall's card carries a still picture of its floor, drawn from the run graph.
  await expect
    .poll(() =>
      inFoundry<boolean>(
        handle,
        `!!document.querySelector('[role="img"][aria-label="Factory floor for Add retry backoff to the sync job"] canvas')`
      )
    )
    .toBe(true)
  await captureFoundry(handle, 'foundry-factory-site-cards.png')

  await expect
    .poll(() => clickContaining(handle, 'button', 'Add retry backoff to the sync job'))
    .toBe(true)
}

/** One station button per run-graph node — the honesty rule: every node gets a
 * place in the hall whether or not anything is really running it. */
async function expectEveryStation(): Promise<void> {
  await expect.poll(() => stationCount(handle)).toBe(8)
  for (const label of EXPECTED_STATIONS) {
    await expect.poll(() => hasStation(handle, label), `no station "${label}"`).toBe(true)
  }
  await captureFoundry(handle, 'foundry-factory-hall.png')
}

/** A station opens as a monitor: its heading and its transcript are there by
 * role. `build:lane1` is orphaned, so its tube says the line is dead. */
async function expectOrphanMonitor(): Promise<void> {
  await expect.poll(() => clickByName(handle, 'button', 'builder, builder, no agent')).toBe(true)
  await expect.poll(() => inFoundry<boolean>(handle, ORPHAN_MONITOR)).toBe(true)
  // The power-on takes 0.42s: wait for the tube to finish opening before the picture.
  await expect
    .poll(() =>
      inFoundry<boolean>(
        handle,
        `document.querySelector('section[aria-labelledby] > div').getAnimations().length === 0`
      )
    )
    .toBe(true)
  await captureFoundry(handle, 'foundry-station-monitor.png')
  await expect.poll(() => clickByName(handle, 'button', 'Close monitor')).toBe(true)
  await expect
    .poll(() => inFoundry<boolean>(handle, `!document.querySelector('[role="log"]')`))
    .toBe(true)
}

/** The recording plays back in the same hall. */
async function expectReplay(): Promise<void> {
  await expect.poll(() => clickByName(handle, 'button', 'Replay')).toBe(true)
  await expect.poll(() => bodyText(handle)).toContain('Back to live')
  await captureFoundry(handle, 'foundry-factory-replay.png')
  await expect.poll(() => clickByName(handle, 'button', 'Back to live')).toBe(true)
  await expect.poll(() => bodyText(handle)).not.toContain('Back to live')
}

/** The hall, its stations, a dead station's monitor and the replay. */
async function hallShowsTheRunGraph(): Promise<void> {
  const step = test.step
  await step('the hall’s card carries a picture of its floor, and opens the hall', openHall)
  await step(
    'the hall draws one station per run-graph node, the orphaned one dark',
    expectEveryStation
  )
  await step(
    'an orphaned station opens as a monitor that says the line is dead',
    expectOrphanMonitor
  )
  await step('the recording plays back in the same hall', expectReplay)
}

test('what runs recorded is shown in the factory hall, on the Floor and in the Ledger, and the Factory view survives a restart', async () => {
  const step = test.step
  await step('the Forge opens in List view and switches to Factory view', switchToFactory)
  await step(
    'Foundry → Toggle factory view switches the stored view and back',
    toggleFromQuickActions
  )
  const watched = await step('records written by hand are read after a restart', seedAndRestart)
  await step('Factory view survives a restart', () => expectFactoryPressed())
  await step('the factory site’s status wall reads the recorded numbers', expectStatusWall)
  await step(
    'a research order’s Claude artifact is linked on its hall card and in its hall',
    researchArtifactInTheFactory
  )
  await hallShowsTheRunGraph()
  await step('List view switches the Forge back', backToList)
  await step('the order list links the research order’s artifact', researchArtifactOnTheList)
  await step('a draft’s CI is on the Floor while it is watched', () => ciOnTheFloor(watched))
  await step(
    'the Ledger’s Factory tab reads the numbers off what was recorded',
    ledgerFactoryNumbers
  )
})
