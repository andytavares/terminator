import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from '../helpers'

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
  repo = mkdtempSync(join(tmpdir(), 'foundry-live-run-'))
  execFileSync('git', ['clone', REMOTE, repo])
  git('config', 'user.email', 'live@example.com')
  git('config', 'user.name', 'Live')

  handle = await launchApp()
  await createWorkspace(handle.page, 'live', repo)
  await handle.page.waitForTimeout(3000)
  await handle.page.locator('button[aria-label="Foundry"]').click()
  await handle.page.waitForTimeout(3000)
})

test.afterAll(async () => {
  if (handle !== undefined) await closeApp(handle)
})

/**
 * A complete, agreed order. The Forge is what writes one normally and has its
 * own cover; what is under test here is an agent doing the work it describes.
 */
function writeOrder(): void {
  const dir = join(repo, '.foundry', 'orders', ORDER)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'order.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: ORDER,
        title: 'Read the session TTL from the environment',
        status: 'agreed',
        source: { kind: 'typed', tracker: null, key: null, url: null },
        writeBack: [],
        stateMapping: { started: null, in_review: null, done: null },
        recipe: 'direct',
        recipeOverriddenBy: 'operator',
        intent: {
          problem: 'TTL_MS in src/session.js is a hardcoded literal.',
          outcome:
            'TTL_MS reads SESSION_TTL_MS from the environment, defaulting to the current value.',
          nonGoals: ['Changing how expiry is computed'],
        },
        context: {
          repos: [{ name: 'live', path: repo, lane: 1, baseBranch: 'main', headBranch: '' }],
          toolchain: {
            test: { command: 'npm test', source: 'package.json' },
            lint: { command: 'npm run lint', source: 'package.json' },
            format: null,
            coverage: null,
            e2e: null,
            build: null,
          },
          entryPoints: ['src/session.js'],
          priorArt: [],
          conventions: [],
          houseDocs: [],
        },
        acceptance: [
          {
            id: 'AC-1',
            statement:
              'TTL_MS takes its value from SESSION_TTL_MS when that is set, and the existing tests still pass.',
            priority: 'P1',
            verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
            unverifiable: null,
          },
        ],
        // The test file as well as the source. The builder's role tells it to
        // write the failing test first, so a unit that changes code in a tested
        // repository touches two files — and one it writes that the order did
        // not declare is a risk trigger. A live run was held for an operator on
        // `outside_blast_radius` for exactly this, which was the order being
        // wrong rather than the run.
        risk: {
          grade: 'P2',
          triggers: [],
          blastRadius: ['src/session.js', 'src/session.test.js'],
          criticalPaths: [],
        },
        // Room for the whole pipeline plus the climb. At twenty minutes the
        // budget was the thing under test: four agents and eight rungs is
        // fifteen minutes on a good run, so a slow builder gated it rather
        // than shipping. That the budget gate fires correctly is proven — a
        // live run raised it, halted, left its agents in their terminals and
        // wrote "not every node finished" — and it is not what this test is
        // named after.
        budgets: { agents: 1, wallClockMinutes: 30, filesTouched: 4, tokens: null },
        plan: {
          units: [
            {
              id: 'U-1',
              title: 'read TTL_MS from SESSION_TTL_MS, keeping the current value as the default',
              role: 'builder',
              lane: 1,
              dependsOn: [],
              satisfies: ['AC-1'],
              touches: ['src/session.js', 'src/session.test.js'],
              verify: [],
            },
          ],
          lanes: [{ ord: 1, repo: 'live', branch: '', role: null, blocks: [], blockedBy: [] }],
          sharedFiles: [],
        },
        assumptions: [],
        openQuestions: [],
        redTeam: [],
        provenance: { forgeSession: null, decisions: [], amendments: [] },
        createdAt: new Date().toISOString(),
        agreedAt: new Date().toISOString(),
      },
      null,
      2
    )
  )
}

interface Observed {
  error?: string
  graph?: { nodes: { id: string; state: string; role: string | null }[] }
  labels?: Record<string, string>
  blocked?: { id: string; reason: string }[]
}

test('an agent takes an order to a draft pull request', async () => {
  // Longer than the polling deadline below, which is itself longer than the
  // order's budget. At 25 minutes against a 30-minute deadline the loop could
  // never reach its own end, so the run was killed by Playwright rather than
  // reported by the test — and "timed out" says nothing about what happened.
  test.setTimeout(3_000_000)
  writeOrder()

  const started = (await foundry('foundry:run.start', { id: ORDER })) as {
    error?: string
    started?: boolean
  }
  expect(started.error, 'the run was refused').toBeUndefined()
  expect(started.started, 'nothing was there to run it').toBe(true)

  // Poll the graph rather than the clock. A settled node is one nothing is
  // waiting on any more — but a settled *graph* is not a finished run, and
  // reading it as one is what this test used to do.
  //
  // The climb and the shipping both happen after the last node leaves the
  // graph: the ladder runs over the finished work, and only then does the run
  // push its branch and open the draft. Breaking on a settled graph declared
  // the run over at that moment, asserted against GitHub while the ladder was
  // still climbing, and then closed the application — killing the very step
  // the test is named after. It reported "nothing was opened", which was true
  // and told nobody anything.
  //
  // So the run is over when it has said so: a draft on the ledger, or a gate
  // holding it, or the deadline.
  const SETTLED = new Set(['passed', 'failed', 'skipped', 'blocked'])
  const ledgerFile = join(repo, '.foundry', 'orders', ORDER, 'ledger.jsonl')
  const gatesFile = join(repo, '.foundry', 'orders', ORDER, 'gates.json')
  const finished = (): string | null => {
    const ledger = existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8') : ''
    if (ledger.includes('ship.draft_opened')) return 'a draft is on the ledger'
    if (ledger.includes('ship.refused')) return 'shipping was refused, and said so'
    if (existsSync(gatesFile)) return 'a gate is holding it'
    return null
  }
  // Longer than the order's own budget, deliberately. When the two were the
  // same the test gave up at the moment the budget would have stopped the run,
  // so the gate that exists for exactly this case was never seen.
  const deadline = Date.now() + 45 * 60_000
  let last: Observed = {}
  let previous = ''
  let settledSince: number | null = null

  while (Date.now() < deadline) {
    last = (await foundry('foundry:run.observe', { id: ORDER })) as Observed
    const nodes = last.graph?.nodes ?? []
    const line = nodes.map((n) => `${last.labels?.[n.id] ?? n.id}=${n.state}`).join(' ')
    if (line !== previous) {
      // eslint-disable-next-line no-console
      console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`)
      previous = line
    }
    const over = finished()
    if (over !== null) {
      // eslint-disable-next-line no-console
      console.log(`[run over] ${over}`)
      break
    }
    // A settled graph with nothing on the ledger yet means the tail is still
    // working — the climb, then the push and the draft. Keep waiting.
    if (nodes.length > 0 && nodes.every((n) => SETTLED.has(n.state)) && settledSince === null) {
      settledSince = Date.now()
      // eslint-disable-next-line no-console
      console.log('[graph settled] waiting on the climb and the draft')
    }
    // The tail is not unbounded: an hour of ladder is a hung rung, not a slow
    // one, and the test should say which.
    if (settledSince !== null && Date.now() - settledSince > 15 * 60_000) {
      // eslint-disable-next-line no-console
      console.log('[gave up] the graph settled 15 minutes ago and nothing shipped')
      break
    }
    await handle.page.waitForTimeout(10_000)
  }

  const nodes = last.graph?.nodes ?? []
  // eslint-disable-next-line no-console
  console.log(`blocked: ${JSON.stringify(last.blocked ?? [])}`)

  // A node may legitimately still be `running` — a budget breach halts the run
  // without killing its agents, which is what "preserving work in progress"
  // means. What may never happen is a run that stopped with nothing to say:
  // either every node settled, or something is on the inbox explaining it.
  const stillRunning = nodes.filter((n) => n.state === 'running')
  if (stillRunning.length > 0) {
    const gatesFile = join(repo, '.foundry', 'orders', ORDER, 'gates.json')
    expect(
      existsSync(gatesFile),
      `${stillRunning.length} nodes still running and no gate to explain it`
    ).toBe(true)
    // eslint-disable-next-line no-console
    console.log(`gates: ${readFileSync(gatesFile, 'utf8')}`)
  }

  // The agent's own work: the file the unit named actually changed.
  const worktree = join(repo, '.foundry', 'orders', ORDER, 'worktrees', 'live')
  expect(existsSync(worktree), 'no worktree was cut').toBe(true)
  const changed = execFileSync('git', ['status', '--porcelain'], { cwd: worktree }).toString()
  const committed = execFileSync('git', ['log', '--oneline', 'main..HEAD'], {
    cwd: worktree,
  }).toString()
  // eslint-disable-next-line no-console
  console.log(`worktree changes:\n${changed || '(clean)'}\ncommits:\n${committed || '(none)'}`)

  const session = readFileSync(join(worktree, 'src', 'session.js'), 'utf8')
  // eslint-disable-next-line no-console
  console.log(`src/session.js is now:\n${session}`)
  expect(session, 'the builder did not make the change the unit asked for').toContain(
    'SESSION_TTL_MS'
  )

  // And the project's own tests still pass against what it left behind.
  const tests = execFileSync('npm', ['test'], { cwd: worktree }).toString()
  expect(tests).toMatch(/pass \d+/)

  // The ledger says what happened, attributably.
  const ledger = readFileSync(join(repo, '.foundry', 'orders', ORDER, 'ledger.jsonl'), 'utf8')
  // eslint-disable-next-line no-console
  console.log(`ledger:\n${ledger}`)
  expect(ledger).toContain('run.started')

  // The thing this test is named after. Read back from GitHub rather than
  // from the ledger, because the ledger records what the code believed.
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: worktree })
    .toString()
    .trim()
  const listed = execFileSync(
    'gh',
    ['pr', 'list', '--head', branch, '--json', 'url,isDraft,headRefName'],
    { cwd: repo }
  ).toString()
  // eslint-disable-next-line no-console
  console.log(`pull requests on ${branch}: ${listed}`)
  const pulls = JSON.parse(listed) as { url: string; isDraft: boolean }[]
  expect(pulls, `nothing was opened on ${branch}`).toHaveLength(1)
  expect(pulls[0].isDraft, 'it was opened, but not as a draft (FR-053)').toBe(true)

  // And the order says so too, which is what the operator reads.
  expect(ledger).toContain('ship.draft_opened')
})
