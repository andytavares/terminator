import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle, e2eTempDir } from '../helpers'
import { writeLiveOrder } from './live-order'

// A whole run, for real: a real agent, in a real worktree, editing real code,
// running the project's real tests, and ending in a real draft pull request.
//
// Everything else in the suite mocks the agent. That proves the wiring around
// it and nothing about whether an agent handed this brief can finish. This is
// the only test that can fail because the *work* did not get done — which is
// why it is not in the suite: it costs minutes and quota, and its verdict is
// about the world rather than about the code.
//
//   E2E_LIVE=1 LIVE_REMOTE=git@github.com:you/scratch.git \
//     npx playwright test tests/e2e/live
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
const ORDER = `WO-LIVE-${Date.now().toString(36).toUpperCase()}`

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

test.beforeAll(async () => {
  test.setTimeout(300_000)
  repo = e2eTempDir('foundry-live-run-')
  execFileSync('git', ['clone', REMOTE, repo])
  git('config', 'user.email', 'live@example.com')
  git('config', 'user.name', 'Live')

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
    wallClockMinutes: 30,
  })
}

interface Observed {
  error?: string
  graph?: { nodes: { id: string; state: string; role: string | null }[] }
  labels?: Record<string, string>
  blocked?: { id: string; reason: string }[]
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

const orderFile = (name: string): string => join(repo, '.foundry', 'orders', ORDER, name)

/** The run is over when it has said so: a draft on the ledger, or a gate
 * holding it. Null while it has said neither. */
function runOver(): string | null {
  const ledger = existsSync(orderFile('ledger.jsonl'))
    ? readFileSync(orderFile('ledger.jsonl'), 'utf8')
    : ''
  if (ledger.includes('ship.draft_opened')) return 'a draft is on the ledger'
  if (ledger.includes('ship.refused')) return 'shipping was refused, and said so'
  if (existsSync(orderFile('gates.json'))) return 'a gate is holding it'
  return null
}

const SETTLED = new Set(['passed', 'failed', 'skipped', 'blocked'])

/** Logs the graph's line when it differs from the last one logged, and returns it. */
function logGraph(observed: Observed, previous: string): string {
  const nodes = observed.graph?.nodes ?? []
  const line = nodes.map((n) => `${observed.labels?.[n.id] ?? n.id}=${n.state}`).join(' ')
  if (line !== previous) console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`)
  return line
}

/** When the graph first settled. A settled graph with nothing on the ledger yet
 * means the tail is still working — the climb, then the push and the draft. */
function settledAt(observed: Observed, since: number | null): number | null {
  const nodes = observed.graph?.nodes ?? []
  if (since !== null || nodes.length === 0 || !nodes.every((n) => SETTLED.has(n.state))) {
    return since
  }
  console.log('[graph settled] waiting on the climb and the draft')
  return Date.now()
}

/** Polls until the run says it is over, the tail hangs, or the deadline (longer than the
 * order's budget) passes; never until the graph settles, since the climb and the shipping
 * come after. Why: docs/CONTRIBUTING.md, "Live specs". */
async function observeUntilOver(): Promise<Observed> {
  const deadline = Date.now() + 45 * 60_000
  let last: Observed = {}
  let previous = ''
  let settledSince: number | null = null
  while (Date.now() < deadline) {
    last = (await foundry('foundry:run.observe', { id: ORDER })) as Observed
    previous = logGraph(last, previous)
    const over = runOver()
    if (over !== null) {
      console.log(`[run over] ${over}`)
      break
    }
    settledSince = settledAt(last, settledSince)
    // The tail is not unbounded: an hour of ladder is a hung rung, not a slow
    // one, and the test should say which.
    if (settledSince !== null && Date.now() - settledSince > 15 * 60_000) {
      console.log('[gave up] the graph settled 15 minutes ago and nothing shipped')
      break
    }
    await handle.page.waitForTimeout(10_000)
  }
  return last
}

/** A budget breach halts the run without killing its agents, so a node may still be
 * `running`; but then something on the inbox must explain it. */
function expectNothingRunningUnexplained(last: Observed): void {
  const nodes = last.graph?.nodes ?? []
  console.log(`blocked: ${JSON.stringify(last.blocked ?? [])}`)
  const stillRunning = nodes.filter((n) => n.state === 'running')
  if (stillRunning.length > 0) {
    const gatesFile = orderFile('gates.json')
    expect(
      existsSync(gatesFile),
      `${stillRunning.length} nodes still running and no gate to explain it`
    ).toBe(true)

    console.log(`gates: ${readFileSync(gatesFile, 'utf8')}`)
  }
}

/** The agent's own work: the file the unit named actually changed, and the
 * project's own tests still pass against what it left behind. Returns the
 * worktree. */
function expectTheChangeMade(): string {
  const worktree = join(repo, '.foundry', 'orders', ORDER, 'worktrees', 'live')
  expect(existsSync(worktree), 'no worktree was cut').toBe(true)
  const changed = execFileSync('git', ['status', '--porcelain'], { cwd: worktree }).toString()
  const committed = execFileSync('git', ['log', '--oneline', 'main..HEAD'], {
    cwd: worktree,
  }).toString()

  console.log(`worktree changes:\n${changed || '(clean)'}\ncommits:\n${committed || '(none)'}`)

  const session = readFileSync(join(worktree, 'src', 'session.js'), 'utf8')

  console.log(`src/session.js is now:\n${session}`)
  expect(session, 'the builder did not make the change the unit asked for').toContain(
    'SESSION_TTL_MS'
  )

  const tests = execFileSync('npm', ['test'], { cwd: worktree }).toString()
  expect(tests).toMatch(/pass \d+/)
  return worktree
}

/** The thing this test is named after. Read back from GitHub rather than from
 * the ledger, because the ledger records what the code believed. */
function expectOneDraftOnGitHub(worktree: string): void {
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: worktree })
    .toString()
    .trim()
  const listed = execFileSync(
    'gh',
    ['pr', 'list', '--head', branch, '--json', 'url,isDraft,headRefName'],
    { cwd: repo }
  ).toString()

  console.log(`pull requests on ${branch}: ${listed}`)
  const pulls = JSON.parse(listed) as { url: string; isDraft: boolean }[]
  expect(pulls, `nothing was opened on ${branch}`).toHaveLength(1)
  expect(pulls[0].isDraft, 'it was opened, but not as a draft (FR-053)').toBe(true)
}

/** The climb measured what this repository has: a test that lets the ladder report a check
 * it ran as unmeasured would let it report one it never ran as passed (it once missed a
 * transcript at `-private-var-folders-…`). */
function expectTheClimbMeasured(ledger: string): void {
  const shipped = ledger
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { action: string; reason: string })
    .find((entry) => entry.action === 'ship.ready_asked')
  expect(shipped, 'nothing asked whether to mark it ready').toBeDefined()

  console.log(`ship said: ${shipped?.reason}`)
  // These two are the ones this repository declares a command for; the rest
  // genuinely have none and are unmeasured for a real reason.
  expect(shipped?.reason, 'the ladder did not measure a rung it ran').not.toMatch(
    /Not measured here:[^.]*\bLint\b/
  )
  expect(shipped?.reason, 'the ladder did not measure a rung it ran').not.toMatch(
    /Not measured here:[^.]*unit's own tests/
  )
}

test('an agent takes an order to a draft pull request', async () => {
  // Longer than the polling deadline, so the test reports the run rather than Playwright
  // killing it with "timed out".
  test.setTimeout(3_000_000)
  writeOrder()
  await startRun()

  const last = await observeUntilOver()
  expectNothingRunningUnexplained(last)
  const worktree = expectTheChangeMade()

  // The ledger says what happened, attributably.
  const ledger = readFileSync(orderFile('ledger.jsonl'), 'utf8')
  console.log(`ledger:\n${ledger}`)
  expect(ledger).toContain('run.started')

  expectOneDraftOnGitHub(worktree)
  // And the order says so too, which is what the operator reads.
  expect(ledger).toContain('ship.draft_opened')
  expectTheClimbMeasured(ledger)
})
