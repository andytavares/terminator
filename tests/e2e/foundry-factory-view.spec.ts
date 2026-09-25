import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from './helpers'

// The Forge's List ⇄ Factory toggle, driven through the running application.
//
// The extension's UI is an overlaid WebContentsView — Playwright's `page`
// cannot see it — so this reaches it the same way tests/e2e/foundry.spec.ts
// does: `electronApp.evaluate` over `getAllWebContents`, and every control is
// addressed by role and accessible name, never by CSS class.

let handle: AppHandle
let repo: string

function git(...args: string[]): void {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  execFileSync('git', args, { cwd: repo, env })
}

/** Runs a script inside Foundry's own view, which the page cannot reach. */
function inFoundry<T>(script: string): Promise<T> {
  return handle.app.evaluate(async ({ webContents }, src) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    return view.executeJavaScript(src) as Promise<unknown>
  }, script) as Promise<T>
}

/** Click a control inside the view by its accessible name, as foundry.spec.ts does. */
function clickByName(role: string, name: string): Promise<boolean> {
  return inFoundry<boolean>(`(function () {
    var selector = ${JSON.stringify(role === 'button' ? 'button' : `[role="${role}"]`)}
    var want = ${JSON.stringify(name)}
    var all = document.querySelectorAll(selector)
    for (var i = 0; i < all.length; i++) {
      var label = (all[i].getAttribute('aria-label') || all[i].textContent || '').trim()
      if (label === want || label.indexOf(want + ', ') === 0) { all[i].click(); return true }
    }
    return false
  })()`)
}

function pressedByLabel(label: string): Promise<string | null> {
  return inFoundry<string | null>(`(function () {
    var el = document.querySelector('button[aria-label=${JSON.stringify(label)}]')
    return el ? el.getAttribute('aria-pressed') : null
  })()`)
}

function bodyText(): Promise<string> {
  return inFoundry<string>('document.body.innerText')
}

/** Like `clickByName`, but by substring — a hall card's name is its title plus
 *  its standing label with no separator between them, so an exact match on
 *  the title alone never lands. */
function clickContaining(role: string, substring: string): Promise<boolean> {
  return inFoundry<boolean>(`(function () {
    var selector = ${JSON.stringify(role === 'button' ? 'button' : `[role="${role}"]`)}
    var want = ${JSON.stringify(substring)}
    var all = document.querySelectorAll(selector)
    for (var i = 0; i < all.length; i++) {
      var label = (all[i].getAttribute('aria-label') || all[i].textContent || '').trim()
      if (label.indexOf(want) !== -1) { all[i].click(); return true }
    }
    return false
  })()`)
}

/** How many run-graph station buttons the hall overlay has drawn. */
function stationCount(): Promise<number> {
  return inFoundry<number>(`document.querySelectorAll('button[aria-label*=", attempt "]').length`)
}

/** Whether a station button exists whose accessible name starts with `prefix`. */
function hasStation(prefix: string): Promise<boolean> {
  return inFoundry<boolean>(`(function () {
    var want = ${JSON.stringify(prefix)}
    var all = document.querySelectorAll('button[aria-label]')
    for (var i = 0; i < all.length; i++) {
      var label = all[i].getAttribute('aria-label') || ''
      if (label.indexOf(want) === 0) return true
    }
    return false
  })()`)
}

async function openFoundry(): Promise<void> {
  const panel = handle.page.locator('[data-extension-panel="terminator.foundry"]')
  if ((await panel.count()) === 0) {
    const button = handle.page.locator('button[aria-label="Foundry"]')
    await expect(button).toBeVisible({ timeout: 30_000 })
    await button.click()
  }
  await expect(panel).toHaveCount(1, { timeout: 30_000 })
  await handle.page.waitForTimeout(2500)
}

async function openForge(): Promise<void> {
  await expect.poll(() => clickByName('button', 'Forge'), { timeout: 15_000 }).toBe(true)
  await handle.page.waitForTimeout(400)
}

test.beforeAll(async () => {
  test.setTimeout(180_000)
  repo = mkdtempSync(join(tmpdir(), 'foundry-factory-repo-'))
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# fixture\n')
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'echo ok', lint: 'echo ok' } }, null, 2)
  )
  git('add', '.')
  git('commit', '-m', 'initial')
})

test.afterAll(async () => {
  await closeApp(handle)
  rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
})

// ---------------------------------------------------------------------------
// A real hall: a running order, seeded on disk exactly as tests/e2e/
// foundry-resume.spec.ts seeds one — records under `<repo>/.foundry/`, not
// through the app — so the Factory view has an actual run graph to draw
// rather than the empty site.
// ---------------------------------------------------------------------------

const HALL_ORDER_ID = 'WO-FACTORY-HALL'

function dataRoot(): string {
  return join(repo, '.foundry')
}

/** A running order, agreed and mid-run, with two build lanes. */
function hallOrder(): unknown {
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
    context: {
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
    },
    acceptance: [
      {
        id: 'AC-1',
        statement: 'A failed sync retries with exponential backoff up to five times.',
        priority: 'P1',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    risk: { grade: 'P2', triggers: [], blastRadius: [], criticalPaths: [] },
    budgets: { agents: 3, wallClockMinutes: 45, tokens: null },
    plan: {
      units: [
        {
          id: 'U-1',
          title: 'back off, lane 1',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/sync.ts'],
          verify: [],
        },
        {
          id: 'U-2',
          title: 'back off, lane 2',
          role: 'builder',
          lane: 2,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/sync2.ts'],
          verify: [],
        },
      ],
      lanes: [
        { ord: 1, repo: 'fixture', branch: '', role: null, blocks: [], blockedBy: [] },
        { ord: 2, repo: 'fixture', branch: '', role: null, blocks: [], blockedBy: [] },
      ],
      sharedFiles: [],
    },
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
  readonly kind: 'agent' | 'run' | 'judge' | 'gate' | 'fanout' | 'join'
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

/**
 * The graph, frozen mid-run: an architect done, two build lanes (one still
 * `running`, with a session nothing in this process is running — so the
 * Factory view must show it orphaned, dark and crewless, not faked as live),
 * a verifier per lane, a judge, a join and a gate.
 */
function hallGraph(): unknown {
  return {
    orderId: HALL_ORDER_ID,
    recipe: 'standard',
    nodes: [
      graphNode({
        id: 'architect',
        stepId: 'architect',
        kind: 'agent',
        state: 'passed',
        lane: null,
        role: 'architect',
        dependsOn: [],
        attempts: 1,
      }),
      graphNode({
        id: 'build:lane1',
        stepId: 'build',
        kind: 'fanout',
        state: 'running',
        lane: 1,
        role: 'builder',
        dependsOn: ['architect'],
        attempts: 1,
        sessionId: '11111111-2222-3333-4444-555555555555',
      }),
      graphNode({
        id: 'build:lane2',
        stepId: 'build',
        kind: 'fanout',
        state: 'passed',
        lane: 2,
        role: 'builder',
        dependsOn: ['architect'],
        attempts: 1,
      }),
      graphNode({
        id: 'verify:lane1',
        stepId: 'verify',
        kind: 'run',
        state: 'waiting',
        lane: 1,
        role: 'verifier',
        dependsOn: ['build:lane1'],
        attempts: 0,
      }),
      graphNode({
        id: 'verify:lane2',
        stepId: 'verify',
        kind: 'run',
        state: 'ready',
        lane: 2,
        role: 'verifier',
        dependsOn: ['build:lane2'],
        attempts: 0,
      }),
      graphNode({
        id: 'judge',
        stepId: 'judge',
        kind: 'judge',
        state: 'waiting',
        lane: null,
        role: 'inspector',
        dependsOn: ['verify:lane1', 'verify:lane2'],
        attempts: 0,
      }),
      graphNode({
        id: 'join',
        stepId: 'join',
        kind: 'join',
        state: 'waiting',
        lane: null,
        role: 'integrator',
        dependsOn: ['judge'],
        attempts: 0,
      }),
      graphNode({
        id: 'gate',
        stepId: 'gate',
        kind: 'gate',
        state: 'waiting',
        lane: null,
        role: null,
        dependsOn: ['join'],
        attempts: 0,
      }),
    ],
  }
}

test('the List/Factory toggle switches the Forge, survives a restart, and switches back', async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'Foundry Factory', repo)
  await openFoundry()

  // The channel behind the toggle is only answered once the extension has
  // activated, exactly as foundry.spec.ts's beforeAll waits for order.list.
  await expect
    .poll(
      async () =>
        (await handle.page.evaluate(() =>
          (
            window as unknown as {
              electronAPI: { extensionBridge: { invoke(c: string, p: unknown): Promise<unknown> } }
            }
          ).electronAPI.extensionBridge.invoke('foundry:order.list', {})
        )) !== null,
      { timeout: 30_000 }
    )
    .toBe(true)

  await openForge()

  // Default is List: the toggle group exists and List is pressed.
  await expect.poll(() => pressedByLabel('List view'), { timeout: 15_000 }).toBe('true')
  expect(await pressedByLabel('Factory view')).toBe('false')

  // Press Factory.
  expect(await clickByName('button', 'Factory view')).toBe(true)
  await handle.page.waitForTimeout(600)
  await expect.poll(() => pressedByLabel('Factory view')).toBe('true')
  expect(await pressedByLabel('List view')).toBe('false')

  // The factory surface actually rendered something (the site, empty or not).
  const factoryText = await bodyText()
  expect(factoryText.length).toBeGreaterThan(0)

  // Screenshot the factory surface for a human to look at.
  const outDir = join(process.cwd(), 'test-results')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, 'foundry-factory-view.png')
  const pngBase64 = await handle.app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    const image = await view.capturePage()
    return image.toPNG().toString('base64')
  })
  writeFileSync(outPath, Buffer.from(pngBase64, 'base64'))

  // Relaunch on the same profile: the preference is per-operator, not per-run.
  const userDataDir = handle.userDataDir
  await closeApp(handle, { keepProfile: true })
  handle = await launchApp(userDataDir)
  await openFoundry()
  await openForge()

  await expect.poll(() => pressedByLabel('Factory view'), { timeout: 15_000 }).toBe('true')
  expect(await pressedByLabel('List view')).toBe('false')

  // Toggle back to List.
  expect(await clickByName('button', 'List view')).toBe(true)
  await handle.page.waitForTimeout(600)
  await expect.poll(() => pressedByLabel('List view')).toBe('true')
  expect(await pressedByLabel('Factory view')).toBe('false')
  expect(await bodyText()).toContain('New order')
})

test('the Factory view draws a real hall: one station per run-graph node, the orphaned one dark', async () => {
  const dir = join(dataRoot(), 'orders', HALL_ORDER_ID)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'order.json'), `${JSON.stringify(hallOrder(), null, 2)}\n`)
  writeFileSync(join(dir, 'run-graph.json'), `${JSON.stringify(hallGraph(), null, 2)}\n`)

  // `handle` is wherever the previous test left it: on the Forge, in List
  // view. Switch to Factory and open the seeded order's hall card.
  await openForge()
  expect(await clickByName('button', 'Factory view')).toBe(true)
  await handle.page.waitForTimeout(400)

  await expect
    .poll(() => clickContaining('button', 'Add retry backoff to the sync job'), {
      timeout: 20_000,
    })
    .toBe(true)

  // One station button per run-graph node — the honesty rule: every node gets
  // a place in the hall whether or not anything is really running it.
  await expect.poll(() => stationCount(), { timeout: 15_000 }).toBe(8)

  // Every node, addressed exactly as `FactoryHall.tsx` labels a station: its
  // label, its role (or "unassigned"), its `NodeState`, and its attempt count.
  // `build:lane1` is `running` with a session nothing in this process is
  // running — the Factory view must still report its true `NodeState`
  // ("running") here; the orphaned treatment is that its crew member is
  // never drawn on the canvas, not a different label.
  const expectedStations = [
    'architect, architect, passed, attempt 1',
    'builder, builder, running, attempt 1',
    'builder, builder, passed, attempt 1',
    'verifier, verifier, waiting, attempt 0',
    'verifier, verifier, ready, attempt 0',
    'inspector, inspector, waiting, attempt 0',
    'integrator, integrator, waiting, attempt 0',
    'gate, unassigned, waiting, attempt 0',
  ]
  for (const label of expectedStations) {
    expect(await hasStation(label), `no station "${label}"`).toBe(true)
  }

  // Let the simulation settle — the crew walk to their seats — before
  // capturing, so the screenshot shows the hall doing something, not the
  // very first frame.
  await handle.page.waitForTimeout(3000)

  const outDir = join(process.cwd(), 'test-results')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, 'foundry-factory-hall.png')
  const pngBase64 = await handle.app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    const image = await view.capturePage()
    return image.toPNG().toString('base64')
  })
  writeFileSync(outPath, Buffer.from(pngBase64, 'base64'))
})
