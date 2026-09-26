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
  repo = mkdtempSync(join(tmpdir(), 'foundry-live-sensors-'))
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

// Sensors, for real (ADR-066): a sensor reads CI that actually failed on a
// branch of the scratch repository, the failures cluster into one signal in
// the Inbox, and promoting it seeds a draft that nothing starts.
//
//   E2E_LIVE=1 LIVE_REMOTE=git@github.com:you/scratch.git LIVE_SENSOR_BRANCH=<a branch with failed runs> \
//     npx playwright test tests/e2e/live/sensors-live.spec.ts
//
// It reads GitHub and writes nothing there.

const BRANCH = process.env.LIVE_SENSOR_BRANCH ?? ''

interface SignalRow {
  id: string
  title: string
  occurrences: number
  status: string
  evidence: { url: string }[]
}

test('a failing branch becomes one ranked signal, and promoting it starts nothing', async () => {
  test.skip(BRANCH === '', 'set LIVE_SENSOR_BRANCH to a branch with failed runs')
  test.setTimeout(600_000)

  mkdirSync(join(repo, '.foundry', 'sensors'), { recursive: true })
  writeFileSync(
    join(repo, '.foundry', 'sensors', 'branch-red.yaml'),
    [
      'schemaVersion: 1',
      'id: branch-red',
      'description: Workflow runs failing on the branch under test',
      'every: 5m',
      'severity: high',
      'source:',
      '  kind: github-runs',
      `  branch: ${BRANCH}`,
      '  limit: 20',
      '',
    ].join('\n')
  )

  const set = (await foundry('foundry:sensors.set', {
    id: 'branch-red',
    enabled: true,
    repoPath: repo,
  })) as { error?: string }
  expect(set.error, 'the sensor could not be enabled').toBeUndefined()
  const ran = (await foundry('foundry:sensors.run-now', { id: 'branch-red' })) as {
    recorded?: number
    problem?: string | null
  }
  // eslint-disable-next-line no-console
  console.log(`run-now: ${JSON.stringify(ran)}`)
  expect(ran.problem ?? null).toBeNull()

  const listed = (await foundry('foundry:signals.list')) as { signals: SignalRow[] }
  // eslint-disable-next-line no-console
  console.log(`signals: ${JSON.stringify(listed.signals.map((s) => [s.title, s.occurrences]))}`)
  const red = listed.signals.find((s) => s.title.includes(BRANCH))
  expect(red, 'no signal for the failing branch').toBeDefined()
  const failed = JSON.parse(
    execFileSync(
      'gh',
      ['run', 'list', '--branch', BRANCH, '--status', 'failure', '--json', 'databaseId'],
      {
        cwd: repo,
      }
    ).toString()
  ) as unknown[]
  expect(red?.occurrences, 'every failed run should be one occurrence of one signal').toBe(
    failed.length
  )

  // It shows in the Inbox, under the gates.
  // The Inbox reads signals again on its own poll, so one open since before
  // the sensor ran still shows the signal.
  await handle.page.locator('button[aria-label="Foundry"]').click()
  await handle.page.waitForTimeout(6000)
  const inbox = await handle.app.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find(
        (wc) =>
          !wc.isDestroyed() && wc.getURL().includes('foundry') && wc.getURL().includes('view=main')
      )
    if (!view) throw new Error('the Foundry view is not loaded')
    const text = (await view.executeJavaScript('document.body.innerText')) as string
    const png = (await view.capturePage()).toPNG().toString('base64')
    return { text, png }
  })
  mkdirSync('test-results', { recursive: true })
  writeFileSync(join('test-results', 'inbox-signals.png'), Buffer.from(inbox.png, 'base64'))
  expect(inbox.text).toContain(red?.title as string)
  expect(inbox.text).toContain(`×${red?.occurrences}`)

  const promoted = (await foundry('foundry:signals.promote', {
    id: red?.id,
    repoPaths: [repo],
  })) as { order?: { id: string; status: string; source: { kind: string } }; error?: string }
  expect(promoted.error).toBeUndefined()
  expect(promoted.order?.source.kind).toBe('signal')
  expect(promoted.order?.status, 'promoting started something').toBe('draft')
  const orderDir = join(repo, '.foundry', 'orders', promoted.order?.id as string)
  expect(existsSync(join(orderDir, 'run-graph.json')), 'a run was started').toBe(false)
  expect(readFileSync(join(orderDir, 'ledger.jsonl'), 'utf8')).toContain('signal.promoted')
  const after = (await foundry('foundry:signals.list')) as { signals: SignalRow[] }
  expect(
    after.signals.find((s) => s.id === red?.id),
    'a promoted signal is still listed'
  ).toBeUndefined()
})
