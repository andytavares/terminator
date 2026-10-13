import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileSync as write } from 'node:fs'
import { launchApp, closeApp, createWorkspace, type AppHandle, e2eTempDir } from '../helpers'

// Retakes the user-guide screenshots of the Foundry surfaces.
//
// One image per surface, because a structural assertion passes while the
// surface renders broken — an unstyled panel, a control off the edge, a table
// that overflows. Looking at the picture is the only check for that.
//
// Not part of the suite — `playwright.config.ts` excludes `tools/` — because it
// writes into `docs/`, and a test that rewrites a committed file on every CI
// run is a test that produces a dirty tree. Run it deliberately when the
// surface changes:
//
//   E2E_TOOLS=1 npx playwright test tests/e2e/tools/capture-foundry-screenshot.spec.ts

let handle: AppHandle
let repo: string

const SHOTS = join(process.cwd(), 'docs', 'user-guide', 'screenshots')

function git(...args: string[]): void {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  execFileSync('git', args, { cwd: repo, env })
}

/** A repository with a README and a package whose scripts the Forge can read. */
function commitRepo(): void {
  git('init', '-b', 'main')
  git('config', 'user.email', 'shot@example.com')
  git('config', 'user.name', 'Shot')
  writeFileSync(join(repo, 'README.md'), '# terminator\n')
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify(
      { name: 'terminator', scripts: { test: 'vitest run', lint: 'eslint .' } },
      null,
      2
    )
  )
  git('add', '.')
  git('commit', '-m', 'initial')
}

/**
 * The Ledger's accepted-checks panel only appears when there is something in
 * it, and the records location defaults to `<workdir>/.foundry/`. Seeded here
 * so the screenshot shows the panel rather than its absence.
 */
function seedAcceptedCheck(): void {
  mkdirSync(join(repo, '.foundry', 'rules'), { recursive: true })
  writeFileSync(
    join(repo, '.foundry', 'rules', 'curator-hardcodes-the-timeout.yaml'),
    [
      'schemaVersion: 1',
      'id: curator-hardcodes-the-timeout',
      'scope: universal',
      'rung: L3',
      'asserts: >',
      '  No unit hardcodes a timeout; it is read from configuration.',
      'appliesWhen: always',
      'origin: curator:2026-09-01T10:00:00.000Z/U-1',
      '',
    ].join('\n')
  )
}

/** Runs `script` in the Foundry view. */
async function runInFoundry(script: string): Promise<void> {
  await handle.app.evaluate(async ({ webContents }, source: string) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    await view.executeJavaScript(source)
  }, script)
}

/**
 * The Foundry view as a PNG. The image comes back as base64 rather than being
 * written inside the main process: `evaluate` runs there, but only
 * serialisable values cross back.
 */
async function capture(): Promise<Buffer> {
  const png = await handle.app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    const image = await view.capturePage()
    return image.toPNG().toString('base64')
  })
  return Buffer.from(png, 'base64')
}

/**
 * Clicks land inside the extension's own WebContentsView, which Playwright's
 * `page` cannot see. Sent through the view's input queue instead, by the
 * accessible name the tab renders.
 */
async function openSurface(label: string): Promise<void> {
  await runInFoundry(
    `Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === ${JSON.stringify(
      label
    )})?.click()`
  )
  await handle.page.waitForTimeout(1200)
}

/** Run in the Foundry view: types an idea into the Forge, and makes it an order. */
const NEW_ORDER_FROM_IDEA = `
      (() => {
        const box = document.querySelector(
          'input[aria-label="Describe what you want built or fixed"]'
        )
        if (!box) throw new Error('the idea box is not on the Forge')
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set
        setter?.call(box, 'Session tokens are never refreshed, so long-lived tabs sign out')
        box.dispatchEvent(new Event('input', { bubbles: true }))
        const create = Array.from(document.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('New order')
        )
        if (!create) throw new Error('the New order button is not on the Forge')
        create.click()
      })()
    `

interface RunNodeSpec {
  id: string
  stepId: string
  kind: string
  state: string
  unitId: string | null
  lane: number | null
  role: string | null
  dependsOn: string[]
  attempts: number
  startedAt: string | null
  endedAt: string | null
}

/** A node of the run graph, with no session or worktree of its own. */
function runNode(spec: RunNodeSpec): unknown {
  return {
    id: spec.id,
    stepId: spec.stepId,
    kind: spec.kind,
    state: spec.state,
    unitId: spec.unitId,
    lane: spec.lane,
    role: spec.role,
    dependsOn: spec.dependsOn,
    attempts: spec.attempts,
    sessionId: null,
    worktreePath: null,
    startedAt: spec.startedAt,
    endedAt: spec.endedAt,
  }
}

/** Planned, building, then verifying and shipping still to come. */
const RUN_NODES: RunNodeSpec[] = [
  {
    id: 'n1',
    stepId: 'plan',
    kind: 'agent',
    state: 'passed',
    unitId: null,
    lane: 1,
    role: 'architect',
    dependsOn: [],
    attempts: 1,
    startedAt: '2026-09-06T10:00:00.000Z',
    endedAt: '2026-09-06T10:04:00.000Z',
  },
  {
    id: 'n2',
    stepId: 'build',
    kind: 'agent',
    state: 'running',
    unitId: 'U-1',
    lane: 1,
    role: 'builder',
    dependsOn: ['n1'],
    attempts: 1,
    startedAt: '2026-09-06T10:04:00.000Z',
    endedAt: null,
  },
  {
    id: 'n3',
    stepId: 'verify',
    kind: 'agent',
    state: 'waiting',
    unitId: 'U-1',
    lane: 1,
    role: 'verifier',
    dependsOn: ['n2'],
    attempts: 0,
    startedAt: null,
    endedAt: null,
  },
  {
    id: 'n4',
    stepId: 'ship',
    kind: 'gate',
    state: 'waiting',
    unitId: null,
    lane: null,
    role: null,
    dependsOn: ['n3'],
    attempts: 0,
    startedAt: null,
    endedAt: null,
  },
]

/**
 * The Floor only renders for an order that is running, and starting one for
 * real launches an agent. The order the Forge just made is moved to running
 * with a graph beside it instead: the same files a real run writes, so the
 * surface reads them the same way, without an agent being launched.
 */
function markOrderRunning(): void {
  const ordersDir = join(repo, '.foundry', 'orders')
  const orderId = readdirSync(ordersDir)[0]
  const orderFile = join(ordersDir, orderId, 'order.json')
  const order = JSON.parse(readFileSync(orderFile, 'utf8')) as Record<string, unknown>
  writeFileSync(orderFile, JSON.stringify({ ...order, status: 'running' }, null, 2))
  writeFileSync(
    join(ordersDir, orderId, 'run-graph.json'),
    JSON.stringify({ orderId, recipe: 'direct', nodes: RUN_NODES.map(runNode) }, null, 2)
  )
}

/** The app on the repository, with Foundry open. */
async function openFoundryOnRepo(): Promise<void> {
  handle = await launchApp()
  await createWorkspace(handle.page, 'terminator', repo)
  await handle.page.waitForTimeout(2500)

  await handle.page.locator('button[aria-label="Foundry"]').click()
  await handle.page.waitForTimeout(3500)
  mkdirSync(SHOTS, { recursive: true })
}

/**
 * An empty Forge shows a text box and nothing else. Seeded with a real idea so
 * the picture shows what the surface is actually for: the criteria, the
 * assumptions and the shape of work with the reason it was proposed.
 */
async function captureForgeWithAnIdea(): Promise<void> {
  await openSurface('Forge')
  await runInFoundry(NEW_ORDER_FROM_IDEA)
  await handle.page.waitForTimeout(4000)
  write(join(SHOTS, '08b-foundry-forge.png'), await capture())
}

/** Back out to the list and in again, so the surface re-reads the order, on its Floor. */
async function captureFloor(): Promise<void> {
  await openSurface('Ledger')
  await openSurface('Forge')
  await runInFoundry(`document.querySelector('.fdry-orders button')?.click()`)
  await handle.page.waitForTimeout(2500)
  write(join(SHOTS, '08e-foundry-floor.png'), await capture())
}

/**
 * Settings is behind the gear rather than a named tab, so it is reached by its
 * accessible name. Worth a picture of its own: every control here is one the
 * extension actually reads, and the panel is where that shows.
 */
async function captureSettings(): Promise<void> {
  await runInFoundry(`document.querySelector('button[aria-label="Settings"]')?.click()`)
  await handle.page.waitForTimeout(1500)
  write(join(SHOTS, '08d-foundry-settings.png'), await capture())
}

test('capture the Foundry surfaces', async () => {
  test.setTimeout(180_000)
  repo = e2eTempDir('foundry-shot-')
  commitRepo()
  seedAcceptedCheck()
  await openFoundryOnRepo()

  write(join(SHOTS, '08-foundry-tab.png'), await capture())
  await captureForgeWithAnIdea()
  markOrderRunning()
  await captureFloor()

  await openSurface('Ledger')
  write(join(SHOTS, '08c-foundry-ledger.png'), await capture())
  await captureSettings()

  await closeApp(handle)
})
