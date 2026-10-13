import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle, e2eTempDir } from '../helpers'
import { writeLiveOrder } from './live-order'

// A red CI goes back to the builder, for real (ADR-064).
//
// The branch carries a workflow enforcing a rule about the value the order
// reads that the order never states: a TTL above 24 hours is clamped to 24
// hours. No builder writes that unasked, so the first draft's CI is red, and
// its failed log is the only place the rule is said. So the run has to take one CI round — the log to the builder, a fix,
// a push — and reach the ready gate with CI green and nobody asked anything.
//
//   E2E_LIVE=1 LIVE_REMOTE=git@github.com:you/scratch.git \
//     npx playwright test tests/e2e/live/ci-rounds-live.spec.ts
//
// It leaves a branch and a draft pull request behind on that remote.

const REMOTE = process.env.LIVE_REMOTE ?? ''

let handle: AppHandle
let repo: string
// Unique per run, because the branch a lane works on is derived from the order
// id — so a fixed id means every run pushes to the branch the last one left
// behind, and the second one is refused as a non-fast-forward. Which is the
// right refusal: the remote holds a commit this worktree was not cut from, and
// forcing past that is destruction, not shipping. A live run reached the push
// and was turned down for exactly this, correctly.
const ORDER = `WO-CI-${Date.now().toString(36).toUpperCase()}`

function git(...args: string[]): string {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  return execFileSync('git', args, { cwd: repo, env }).toString()
}

async function foundry(channel: string, payload: unknown = {}): Promise<unknown> {
  return handle.app.evaluate(
    async ({ webContents }, { channel: c, payload: p }) => {
      const view = webContents
        .getAllWebContents()
        .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
      if (!view) throw new Error('the Foundry view is not loaded')
      return view.executeJavaScript(
        `window.electronAPI.extensionBridge.invoke(${JSON.stringify(c)}, ${JSON.stringify(p)})`
      )
    },
    { channel, payload }
  )
}

test.skip(REMOTE === '', 'set LIVE_REMOTE to run this')

/**
 * A CI check the order does not mention: the house rule that a session TTL
 * above 24 hours is clamped. Committed to the scratch repository, so the first
 * draft goes red on it.
 */
function commitMarkerWorkflow(): void {
  mkdirSync(join(repo, '.github', 'workflows'), { recursive: true })
  writeFileSync(
    join(repo, '.github', 'workflows', 'marker.yml'),
    [
      'name: marker',
      'on: pull_request',
      'jobs:',
      '  marker:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - run: |',
      `          SESSION_TTL_MS=999999999999 node --input-type=module -e "import('./src/session.js').then((m) => { if (m.TTL_MS !== 86400000) { console.error('House rule: a session TTL above 24 hours must be clamped to 86400000 ms. SESSION_TTL_MS=999999999999 gave ' + m.TTL_MS); process.exit(1) } })"`,
      '',
    ].join('\n')
  )
  git('add', '.github/workflows/marker.yml')
  git('commit', '-m', 'test: a CI check that clamps the session TTL to 24 hours')
}

test.beforeAll(async () => {
  test.setTimeout(300_000)
  repo = e2eTempDir('foundry-live-ci-')
  execFileSync('git', ['clone', REMOTE, repo])
  git('config', 'user.email', 'live@example.com')
  git('config', 'user.name', 'Live')
  commitMarkerWorkflow()

  handle = await launchApp()
  await createWorkspace(handle.page, 'live', repo)
  await handle.page.waitForTimeout(3000)
  await handle.page.locator('button[aria-label="Foundry"]').click()
  await handle.page.waitForTimeout(3000)

  // This run is unattended, so it says so.
  //
  // The default is `standard`, which asks about the risky things — right when
  // somebody is at the console, and a dead end when nobody is: the question
  // goes to the inbox, five minutes later to the runtime's own prompt in the
  // terminal, and the agent stands there until the budget ends the run. A live
  // run lost half an hour that way, to a builder redirecting its test output to
  // a scratch file. Nothing here can answer a question, and pretending
  // otherwise tests a situation this test is not in.
  await handle.app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (view === undefined) throw new Error('the Foundry view is not loaded')
    await view.executeJavaScript(
      "window.electronAPI.extension.updateSetting('terminator.foundry.autonomy', 'lights-out')"
    )
  })
})

test.afterAll(async () => {
  if (handle !== undefined) await closeApp(handle)
})

/**
 * A complete, agreed order. The Forge is what writes one normally and has its
 * own cover; what is under test here is an agent doing the work it describes.
 */
function writeOrder(): void {
  writeLiveOrder({
    repo,
    id: ORDER,
    title: 'Read the session TTL from the environment',
    problem: 'TTL_MS in src/session.js is a hardcoded literal.',
    outcome: 'TTL_MS reads SESSION_TTL_MS from the environment, defaulting to the current value.',
    statement:
      'TTL_MS takes its value from SESSION_TTL_MS when that is set, and the existing tests still pass.',
    unitTitle: 'read TTL_MS from SESSION_TTL_MS, keeping the current value as the default',
    lintCommand: 'npm run lint',
    wallClockMinutes: 45,
  })
}

/** Starts the run, and checks it was accepted with something to run. */
async function startRun(): Promise<void> {
  const started = (await foundry('foundry:run.start', { id: ORDER })) as {
    error?: string
    started?: boolean
  }
  expect(started.error, 'the run was refused').toBeUndefined()
  expect(started.started, 'nothing was there to run it').toBe(true)
}

const orderDir = (): string => join(repo, '.foundry', 'orders', ORDER)
const readIfThere = (file: string): string => (existsSync(file) ? readFileSync(file, 'utf8') : '')

/** The run is over when the ledger says how shipping ended. Null until then. */
function shippingOver(): string | null {
  const ledger = readIfThere(join(orderDir(), 'ledger.jsonl'))
  if (ledger.includes('ship.ready_asked')) return 'the ready gate was raised'
  if (ledger.includes('ship.ci_red')) return 'CI stayed red'
  if (ledger.includes('ship.refused')) return 'shipping was refused'
  if (ledger.includes('ship.ci_halted')) return 'a fix round halted'
  return null
}

/** Logs what ci.json says when it changes, and returns it. */
function logCi(previous: string): string {
  const ci = readIfThere(join(orderDir(), 'ci.json'))
  const state = ci === '' ? 'no ci yet' : ci.replace(/\s+/g, ' ').slice(0, 300)
  if (state !== previous) console.log(`[${new Date().toISOString().slice(11, 19)}] ${state}`)
  return state
}

/** Polls the CI record until shipping is over, or the deadline passes. */
async function waitForShipping(): Promise<void> {
  const deadline = Date.now() + 55 * 60_000
  let previous = ''
  while (Date.now() < deadline) {
    previous = logCi(previous)
    const over = shippingOver()
    if (over !== null) {
      console.log(`[run over] ${over}`)
      break
    }
    await handle.page.waitForTimeout(15_000)
  }
}

/** One fix round, CI green, and the ready gate raised with the checks that passed. */
function expectOneRoundToGreen(ledger: string): void {
  const gatesFile = join(orderDir(), 'gates.json')
  const gates = existsSync(gatesFile)
    ? (JSON.parse(readFileSync(gatesFile, 'utf8')) as { rule: string; why: string }[])
    : []

  console.log(`gates: ${JSON.stringify(gates.map((g) => g.rule))}`)

  expect(ledger).toContain('ship.draft_opened')
  expect(
    ledger.split('\n').filter((line) => line.includes('"ci.round"')),
    'one fix should take one round'
  ).toHaveLength(1)
  expect(ledger, 'CI never went green').toContain('ci.green')
  expect(ledger).not.toContain('ci.exhausted')
  expect(gates.map((g) => g.rule)).toEqual(['ready-for-review'])
  expect(gates[0].why).toMatch(/CI passed: \d+ checks?\./)
}

/** GitHub agrees: every check on the lane's branch passed or was skipped. */
function expectChecksGreenOnGitHub(): void {
  const worktree = join(orderDir(), 'worktrees', 'live')
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: worktree })
    .toString()
    .trim()
  const checks = JSON.parse(
    execFileSync('gh', ['pr', 'checks', branch, '--json', 'name,bucket'], { cwd: repo }).toString()
  ) as { name: string; bucket: string }[]

  console.log(`checks on ${branch}: ${JSON.stringify(checks)}`)
  expect(checks.every((c) => c.bucket === 'pass' || c.bucket === 'skipping')).toBe(true)
}

test('a red CI goes back to the builder and the draft reaches the ready gate green', async () => {
  test.setTimeout(3_600_000)
  writeOrder()
  await startRun()
  await waitForShipping()

  const ledger = readIfThere(join(orderDir(), 'ledger.jsonl'))

  console.log(`ledger:\n${ledger}`)
  expectOneRoundToGreen(ledger)
  expectChecksGreenOnGitHub()
})
