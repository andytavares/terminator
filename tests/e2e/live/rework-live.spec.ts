import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, type AppHandle } from '../helpers'

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
  repo = mkdtempSync(join(tmpdir(), 'foundry-live-rework-'))
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
  const marker = join(tmpdir(), `${ORDER}.linted`)
  return `if [ -f '${marker}' ]; then npm run lint; else touch '${marker}'; echo 'src/session.js:3:17  error  Unexpected var, use const instead  no-var'; exit 1; fi`
}

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
            lint: { command: lintOnceFailing(), source: 'package.json' },
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
        budgets: { agents: 1, wallClockMinutes: 45, tokens: null },
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
  graph?: {
    nodes: {
      id: string
      stepId: string
      state: string
      attempts: number
      reworks: number
      feedback: { from: string; exitCode: number | null; excerpt: string; logPath: string | null }[]
    }[]
  }
}

test('a lint failure goes back to the builder and the run still ships', async () => {
  test.setTimeout(3_600_000)
  writeOrder()

  const started = (await foundry('foundry:run.start', { id: ORDER })) as {
    error?: string
    started?: boolean
  }
  expect(started.error, 'the run was refused').toBeUndefined()
  expect(started.started, 'nothing was there to run it').toBe(true)

  const orderDir = join(repo, '.foundry', 'orders', ORDER)
  const ledgerFile = join(orderDir, 'ledger.jsonl')
  const gatesFile = join(orderDir, 'gates.json')
  const finished = (): string | null => {
    const ledger = existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8') : ''
    if (ledger.includes('ship.draft_opened')) return 'a draft is on the ledger'
    if (ledger.includes('ship.refused')) return 'shipping was refused'
    if (existsSync(gatesFile)) return 'a gate is holding it'
    return null
  }

  const deadline = Date.now() + 55 * 60_000
  let last: Observed = {}
  let previous = ''
  while (Date.now() < deadline) {
    last = (await foundry('foundry:run.observe', { id: ORDER })) as Observed
    const line = (last.graph?.nodes ?? [])
      .map((n) => `${n.id}=${n.state}/a${n.attempts}/r${n.reworks}/f${n.feedback.length}`)
      .join(' ')
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
    await handle.page.waitForTimeout(10_000)
  }

  const ledger = existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8') : ''
  // eslint-disable-next-line no-console
  console.log(`ledger:\n${ledger}`)
  if (existsSync(gatesFile)) {
    // eslint-disable-next-line no-console
    console.log(`gates: ${readFileSync(gatesFile, 'utf8')}`)
  }

  const nodes = last.graph?.nodes ?? []
  const build = nodes.find((n) => n.stepId === 'build')
  const lint = nodes.find((n) => n.stepId === 'lint')
  expect(lint?.reworks, 'lint never sent the build back').toBe(1)
  expect(build?.attempts, 'the builder did not run a second time').toBe(2)
  expect(build?.feedback[0]?.excerpt, 'the builder was not handed the failure').toContain('no-var')
  expect(existsSync(build?.feedback[0]?.logPath ?? ''), 'the lint output was not kept').toBe(true)

  expect(ledger).toContain('rework.started')
  // The ready-for-review gate is raised once the draft exists; it is the one
  // decision that is always the operator's. Nothing else may have asked.
  const asked = existsSync(gatesFile)
    ? (JSON.parse(readFileSync(gatesFile, 'utf8')) as { rule: string }[]).map((g) => g.rule)
    : []
  expect(
    asked.filter((rule) => rule !== 'ready-for-review'),
    'a person was asked something'
  ).toEqual([])
  expect(ledger).toContain('ship.draft_opened')

  const worktree = join(orderDir, 'worktrees', 'live')
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: worktree })
    .toString()
    .trim()
  const pulls = JSON.parse(
    execFileSync('gh', ['pr', 'list', '--head', branch, '--json', 'url,isDraft'], {
      cwd: repo,
    }).toString()
  ) as { url: string; isDraft: boolean }[]
  // eslint-disable-next-line no-console
  console.log(`pull requests on ${branch}: ${JSON.stringify(pulls)}`)
  expect(pulls).toHaveLength(1)
  expect(pulls[0].isDraft).toBe(true)
})
