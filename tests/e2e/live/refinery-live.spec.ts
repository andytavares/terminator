import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle, e2eTempDir } from '../helpers'
import { writeLiveOrder } from './live-order'

// A failed check sends the work back, for real (ADR-063).
//
// The order's lint command fails exactly once, the way a real lint failure
// reads, and then runs the repository's own lint. So the run has to go through
// one rework — the build sent back with the output, a second build, lint
// passing — and still reach a draft pull request with nobody deciding anything.
//
//   E2E_LIVE=1 LIVE_REMOTE=git@github.com:you/scratch.git \
//     npx playwright test tests/e2e/live/rework-live.spec.ts
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
  repo = e2eTempDir('foundry-live-refinery-')
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

/** The particulars of one of the refinery's two orders. */
interface RefineryOrder {
  id: string
  title: string
  problem: string
  outcome: string
  agreedAt: string
}

/**
 * A complete, agreed order. The Forge is what writes one normally and has its
 * own cover; what is under test here is an agent doing the work it describes.
 */
function writeOrder({ id, title, problem, outcome, agreedAt }: RefineryOrder): void {
  writeLiveOrder({
    repo,
    id,
    title,
    problem,
    outcome,
    statement: `${outcome} The existing tests still pass.`,
    unitTitle: title,
    lintCommand: 'npm run lint',
    wallClockMinutes: 45,
    agreedAt,
  })
}

// The refinery, for real (ADR-067): two orders change src/session.js, the
// first one's draft is merged on the scratch remote, and the second is
// restacked onto the new main with its CI watched again, or reports which
// files conflict.
//
//   E2E_LIVE=1 LIVE_REMOTE=git@github.com:you/scratch.git \
//     npx playwright test tests/e2e/live/refinery-live.spec.ts
//
// It merges the first draft into the scratch remote's main.

const STAMP = Date.now().toString(36).toUpperCase()
const FIRST = `WO-RFA-${STAMP}`
const SECOND = `WO-RFB-${STAMP}`

function ledgerOf(id: string): string {
  const file = join(repo, '.foundry', 'orders', id, 'ledger.jsonl')
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

async function runToDraft(id: string): Promise<string> {
  // "Start anyway": the first order's finished sessions fill the review
  // queue, and this is one operator deliberately running two in a row.
  const started = (await foundry('foundry:run.start', { id, force: true })) as { error?: string }
  expect(started.error, `${id} was refused`).toBeUndefined()
  const deadline = Date.now() + 25 * 60_000
  while (Date.now() < deadline) {
    const ledger = ledgerOf(id)
    if (ledger.includes('ship.ready_asked')) break
    if (ledger.includes('ship.refused') || ledger.includes('ship.ci_halted')) break
    await handle.page.waitForTimeout(10_000)
  }
  const pulls = JSON.parse(
    readFileSync(join(repo, '.foundry', 'orders', id, 'pulls.json'), 'utf8')
  ) as { url: string }[]

  console.log(`${id} drafted ${pulls[0]?.url}`)
  return pulls[0].url
}

/** Two orders on src/session.js, the first agreed a minute before the second. */
function writeTwoOrders(): void {
  writeOrder({
    id: FIRST,
    title: 'Add a helper that says how long a token has left',
    problem: 'Callers compute the time a session token has left by hand.',
    outcome:
      'src/session.js exports remainingMs(issuedAt, now), the milliseconds left before expiry, never negative, added at the end of the file.',
    // The queue is in order of agreement; two orders written in the same
    // millisecond would tie, and neither would be behind the other.
    agreedAt: new Date(Date.now() - 60_000).toISOString(),
  })
  writeOrder({
    id: SECOND,
    title: 'Name the session TTL in minutes',
    problem: 'TTL_MS in src/session.js is written as a bare product of numbers.',
    outcome:
      'src/session.js defines TTL_MINUTES = 15 at the top and computes TTL_MS from it, with the same value as today.',
    agreedAt: new Date().toISOString(),
  })
}

/** The second order is queued behind the first. */
async function expectSecondQueuedBehindFirst(): Promise<void> {
  const observed = (await foundry('foundry:run.observe', { id: SECOND })) as {
    queue: { position: number; behind: { orderId: string; files: string[] }[] } | null
  }

  console.log(`queue for ${SECOND}: ${JSON.stringify(observed.queue)}`)
  expect(observed.queue?.behind.map((b) => b.orderId)).toContain(FIRST)
}

/** How the second order came out of the first one's merge: rebased, conflict, or '' by the deadline. */
async function restackOutcome(): Promise<string> {
  const deadline = Date.now() + 15 * 60_000
  let outcome = ''
  while (Date.now() < deadline) {
    const ledger = ledgerOf(SECOND)
    if (ledger.includes('refinery.conflict')) outcome = 'conflict'
    if (ledger.includes('refinery.rebased')) outcome = 'rebased'
    if (outcome !== '') break
    await handle.page.waitForTimeout(15_000)
  }
  return outcome
}

/** The restacked branch sits on the new main. Throws, failing the test, when it does not. */
function expectRestackedOnMain(): void {
  git('fetch', 'origin')
  const branch = `foundry/${SECOND.toLowerCase()}`
  const merged = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: repo }).toString().trim()
  execFileSync('git', ['merge-base', '--is-ancestor', merged, `origin/${branch}`], { cwd: repo })
}

test('a merge restacks the order queued behind it', async () => {
  test.setTimeout(3_600_000)
  writeTwoOrders()
  const firstUrl = await runToDraft(FIRST)
  await runToDraft(SECOND)
  await expectSecondQueuedBehindFirst()

  execFileSync('gh', ['pr', 'ready', firstUrl], { cwd: repo })
  execFileSync('gh', ['pr', 'merge', firstUrl, '--merge'], { cwd: repo })

  const outcome = await restackOutcome()

  console.log(`first ledger:\n${ledgerOf(FIRST)}\nsecond ledger:\n${ledgerOf(SECOND)}`)
  expect(ledgerOf(FIRST)).toContain('refinery.merged')
  expect(['rebased', 'conflict']).toContain(outcome)
  if (outcome === 'rebased') expectRestackedOnMain()
})
