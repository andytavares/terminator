import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  closeApp,
  createWorkspace,
  type AppHandle,
  e2eRunRoot,
  e2eTempDir,
} from '../helpers'
import { writeLiveOrder } from './live-order'
import { expectOneDraftPullRequest, liveOrderDir, liveRunOver, startLiveRun } from './live-run'

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
const ORDER = `WO-REWORK-${Date.now().toString(36).toUpperCase()}`

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
  repo = e2eTempDir('foundry-live-rework-')
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

/** Fails the first time it runs, as lint would, then runs the real lint. */
function lintOnceFailing(): string {
  const marker = join(e2eRunRoot(), `${ORDER}.linted`)
  return `if [ -f '${marker}' ]; then npm run lint; else touch '${marker}'; echo 'src/session.js:3:17  error  Unexpected var, use const instead  no-var'; exit 1; fi`
}

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
    lintCommand: lintOnceFailing(),
    wallClockMinutes: 30,
  })
}

interface Observed {
  graph?: {
    nodes: {
      id: string
      stepId: string
      state: string
      attempts: number
      reworks: number
      feedback: { from: string; exitCode: number | null; excerpt: string; logPath: string | null }[]
      sessionId: string | null
    }[]
  }
}

const ledgerFile = (): string => join(liveOrderDir(repo, ORDER), 'ledger.jsonl')
const gatesFile = (): string => join(liveOrderDir(repo, ORDER), 'gates.json')

/** Logs the graph's line when it differs from the last one logged, and returns it. */
function logGraphReworks(observed: Observed, previous: string): string {
  const line = (observed.graph?.nodes ?? [])
    .map((n) => `${n.id}=${n.state}/a${n.attempts}/r${n.reworks}/f${n.feedback.length}`)
    .join(' ')
  if (line !== previous) console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`)
  return line
}

/** Polls the graph until the run says it is over, or the deadline passes. */
async function observeUntilOverOrDeadline(): Promise<Observed> {
  const deadline = Date.now() + 55 * 60_000
  let last: Observed = {}
  let previous = ''
  while (Date.now() < deadline) {
    last = (await foundry('foundry:run.observe', { id: ORDER })) as Observed
    previous = logGraphReworks(last, previous)
    const over = liveRunOver(liveOrderDir(repo, ORDER))
    if (over !== null) {
      console.log(`[run over] ${over}`)
      break
    }
    await handle.page.waitForTimeout(10_000)
  }
  return last
}

/** Lint sent the build back once, with its output, and the builder ran again. */
function expectOneRework(last: Observed, ledger: string): void {
  const nodes = last.graph?.nodes ?? []
  const build = nodes.find((n) => n.stepId === 'build')
  const lint = nodes.find((n) => n.stepId === 'lint')
  expect(lint?.reworks, 'lint never sent the build back').toBe(1)
  expect(build?.attempts, 'the builder did not run a second time').toBe(2)
  expect(build?.feedback[0]?.excerpt, 'the builder was not handed the failure').toContain('no-var')
  expect(existsSync(build?.feedback[0]?.logPath ?? ''), 'the lint output was not kept').toBe(true)

  expect(ledger).toContain('rework.started')
}

/** The builder was given its skills (ADR-065): mounted, recorded, and seen by
 * the agent, with nothing written into the repository to do it. */
function expectSkillsMounted(last: Observed, ledger: string): void {
  expect(ledger).toMatch(/"skills.mounted"[^\n]*ci-fix \(built-in\)/)
  const buildSession = (last.graph?.nodes ?? []).find((n) => n.stepId === 'build')?.sessionId
  expect(buildSession, 'the build node never named its session').toBeTruthy()
  const projects = join(homedir(), '.claude', 'projects')
  const transcript = readdirSync(projects)
    .map((dir) => join(projects, dir, `${buildSession}.jsonl`))
    .find((file) => existsSync(file))
  expect(transcript, 'no transcript for the build session').toBeTruthy()
  expect(readFileSync(transcript as string, 'utf8'), 'the agent never saw ci-fix').toContain(
    'ci-fix'
  )
  expect(existsSync(join(repo, '.claude')), 'a skill was written into the repository').toBe(false)
}

/** The ready-for-review gate is raised once the draft exists; it is the one
 * decision that is always the operator's. Nothing else may have asked. */
function expectNobodyAsked(): void {
  const asked = existsSync(gatesFile())
    ? (JSON.parse(readFileSync(gatesFile(), 'utf8')) as { rule: string }[]).map((g) => g.rule)
    : []
  expect(
    asked.filter((rule) => rule !== 'ready-for-review'),
    'a person was asked something'
  ).toEqual([])
}

test('a lint failure goes back to the builder and the run still ships', async () => {
  test.setTimeout(3_600_000)
  writeOrder()
  await startLiveRun(foundry, ORDER)
  const last = await observeUntilOverOrDeadline()

  const ledger = existsSync(ledgerFile()) ? readFileSync(ledgerFile(), 'utf8') : ''

  console.log(`ledger:\n${ledger}`)
  if (existsSync(gatesFile())) {
    console.log(`gates: ${readFileSync(gatesFile(), 'utf8')}`)
  }

  expectOneRework(last, ledger)
  expectSkillsMounted(last, ledger)
  expectNobodyAsked()
  expect(ledger).toContain('ship.draft_opened')
  expectOneDraftPullRequest(repo, join(liveOrderDir(repo, ORDER), 'worktrees', 'live'))
})
