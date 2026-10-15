import { test, expect } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from './helpers'
import {
  bodyText,
  captureFoundry,
  clickByName,
  clickContaining,
  hasStation,
  inFoundry,
  makeFixtureRepo,
  openFoundry,
  openForge,
  pressedByLabel,
  stationCount,
} from './foundry-harness'

// The Forge's List ⇄ Factory toggle, driven through the running application.
// Controls are reached with `inFoundry` and addressed by role and accessible
// name, never by CSS class. Each test launches and closes its own app.

/** The Forge is in Factory view, and List is not pressed. */
async function expectFactoryPressed(timeout: number): Promise<void> {
  await expect.poll(() => pressedByLabel(toggleApp, 'Factory view'), { timeout }).toBe('true')
  expect(await pressedByLabel(toggleApp, 'List view')).toBe('false')
}

/** From the default, List, to Factory: and the factory surface draws something. */
async function switchToFactory(): Promise<void> {
  await openForge(toggleApp)

  // Default is List: the toggle group exists and List is pressed.
  await expect.poll(() => pressedByLabel(toggleApp, 'List view'), { timeout: 15_000 }).toBe('true')
  expect(await pressedByLabel(toggleApp, 'Factory view')).toBe('false')

  // Press Factory.
  expect(await clickByName(toggleApp, 'button', 'Factory view')).toBe(true)
  await expectFactoryPressed(10_000)

  // The factory surface actually rendered something (the site, empty or not).
  await expect
    .poll(async () => (await bodyText(toggleApp)).length, { timeout: 10_000 })
    .toBeGreaterThan(0)

  // Screenshot the factory surface for a human to look at.
  await captureFoundry(toggleApp, 'foundry-factory-view.png')
}

/** Relaunches on the same profile: the preference is per-operator, not per-run. */
async function relaunchToForge(): Promise<void> {
  const userDataDir = toggleApp.userDataDir
  await closeApp(toggleApp)
  toggleApp = await launchApp(userDataDir)
  await openFoundry(toggleApp)
  await openForge(toggleApp)
}

async function switchesAndSurvivesRestart(): Promise<void> {
  await switchToFactory()
  await relaunchToForge()
  await expectFactoryPressed(15_000)

  // Toggle back to List.
  expect(await clickByName(toggleApp, 'button', 'List view')).toBe(true)
  await expect.poll(() => pressedByLabel(toggleApp, 'List view'), { timeout: 10_000 }).toBe('true')
  expect(await pressedByLabel(toggleApp, 'Factory view')).toBe('false')
  await expect.poll(() => bodyText(toggleApp), { timeout: 10_000 }).toContain('New order')
}

/** The toggle story's app, relaunched by its test on the same profile. */
let toggleApp: AppHandle
let toggleRepo: string

test.describe('the List/Factory toggle', () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000)
    toggleRepo = makeFixtureRepo('foundry-factory-toggle-')
    toggleApp = await launchApp()
    await createWorkspace(toggleApp.page, 'Foundry Factory Toggle', toggleRepo)
    await openFoundry(toggleApp)
  })

  test.afterAll(async () => {
    await closeApp(toggleApp)
    rmSync(toggleRepo, { recursive: true, force: true, maxRetries: 5 })
  })

  test('switches the Forge, survives a restart, and switches back', switchesAndSurvivesRestart)
})

// ---------------------------------------------------------------------------
// A real hall: a running order, seeded on disk exactly as tests/e2e/
// foundry-resume.spec.ts seeds one — records under `<repo>/.foundry/`, not
// through the app — so the Factory view has an actual run graph to draw
// rather than the empty site.
// ---------------------------------------------------------------------------

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

let hall: AppHandle
let hallRepo: string

/** From the Factory view's site, the hall's card and then the hall itself. */
async function openHall(): Promise<void> {
  await openForge(hall)
  expect(await clickByName(hall, 'button', 'Factory view')).toBe(true)
  await expect.poll(() => pressedByLabel(hall, 'Factory view'), { timeout: 10_000 }).toBe('true')

  // The hall's card carries a still picture of its floor, drawn from the run graph.
  await expect
    .poll(
      () =>
        inFoundry<boolean>(
          hall,
          `!!document.querySelector('[role="img"][aria-label="Factory floor for Add retry backoff to the sync job"] canvas')`
        ),
      { timeout: 20_000 }
    )
    .toBe(true)
  await captureFoundry(hall, 'foundry-factory-site-cards.png')

  await expect
    .poll(() => clickContaining(hall, 'button', 'Add retry backoff to the sync job'), {
      timeout: 20_000,
    })
    .toBe(true)
}

/** One station button per run-graph node — the honesty rule: every node gets a
 * place in the hall whether or not anything is really running it. */
async function expectEveryStation(): Promise<void> {
  await expect.poll(() => stationCount(hall), { timeout: 15_000 }).toBe(8)
  for (const label of EXPECTED_STATIONS) {
    await expect.poll(() => hasStation(hall, label), `no station "${label}"`).toBe(true)
  }
  await captureFoundry(hall, 'foundry-factory-hall.png')
}

/** A station opens as a monitor: its heading and its transcript are there by
 * role. `build:lane1` is orphaned, so its tube says the line is dead. */
async function expectOrphanMonitor(): Promise<void> {
  expect(await clickByName(hall, 'button', 'builder, builder, no agent')).toBe(true)
  await expect.poll(() => inFoundry<boolean>(hall, ORPHAN_MONITOR), { timeout: 15_000 }).toBe(true)
  // The power-on takes 0.42s: wait for the tube to finish opening before the picture.
  await expect
    .poll(
      () =>
        inFoundry<boolean>(
          hall,
          `document.querySelector('section[aria-labelledby] > div').getAnimations().length === 0`
        ),
      { timeout: 10_000 }
    )
    .toBe(true)
  await captureFoundry(hall, 'foundry-station-monitor.png')
  expect(await clickByName(hall, 'button', 'Close monitor')).toBe(true)
  await expect
    .poll(() => inFoundry<boolean>(hall, `!document.querySelector('[role="log"]')`), {
      timeout: 10_000,
    })
    .toBe(true)
}

/** The recording plays back in the same hall. */
async function expectReplay(): Promise<void> {
  expect(await clickByName(hall, 'button', 'Replay')).toBe(true)
  await expect.poll(() => bodyText(hall), { timeout: 10_000 }).toContain('Back to live')
  await captureFoundry(hall, 'foundry-factory-replay.png')
  expect(await clickByName(hall, 'button', 'Back to live')).toBe(true)
  await expect.poll(() => bodyText(hall), { timeout: 10_000 }).not.toContain('Back to live')
}

test.describe('a real hall', () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000)
    hallRepo = makeFixtureRepo('foundry-factory-hall-')
    writeHallRecords(hallRepo)
    hall = await launchApp()
    await createWorkspace(hall.page, 'Foundry Factory Hall', hallRepo)
    await openFoundry(hall)
  })

  test.afterAll(async () => {
    await closeApp(hall)
    rmSync(hallRepo, { recursive: true, force: true, maxRetries: 5 })
  })

  test('draws a real hall: one station per run-graph node, the orphaned one dark', async () => {
    await openHall()
    await expectEveryStation()
    await expectOrphanMonitor()
    await expectReplay()
  })
})
