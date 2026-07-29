import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, expandWorkspace, type AppHandle } from './helpers'

// The claim the whole re-home rests on: a card's phase runs in a terminal you
// can see, in its own project, with its tool calls held for you.
//
// Every unit below this passes in isolation, and every one of the previous
// branch's worst bugs did too — no xterm instance, the wrong workspace, output
// delivered before a tab existed. They only appeared when the application ran.
// So this drives the real extension inside the real app, through the same IPC
// its own UI uses.

let handle: AppHandle
let repo: string

function git(...args: string[]): void {
  const env = { ...process.env }
  // Deleted rather than blanked: inherited from the outer git inside a hook,
  // they point every command at the wrong repository, and an empty GIT_DIR is
  // not "unset", it is an invalid path.
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  execFileSync('git', args, { cwd: repo, env })
}

test.beforeAll(async () => {
  // Loading every bundled extension takes longer than the default hook budget.
  test.setTimeout(180_000)
  repo = mkdtempSync(join(tmpdir(), 'speckit-repo-'))
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# fixture\n')

  // A card, in the shape the pilot reads: specs/<slug> with its own pilot state.
  const featureDir = join(repo, 'specs', '021-e2e-card')
  mkdirSync(join(featureDir, '.pilot'), { recursive: true })
  writeFileSync(join(featureDir, 'spec.md'), '# E2E card\n\nDo the thing.\n')

  git('add', '.')
  git('commit', '-m', 'initial')

  handle = await launchApp()
  // In setup rather than in the first test: every test here shares one app, and
  // the runner resolves a card's workspace from its repository path — without
  // one, a run has nowhere to put its terminal.
  await createWorkspace(handle.page, 'Pilot', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  rmSync(repo, { recursive: true, force: true, maxRetries: 5 })
})

/** Calls one of the extension's own IPC channels, as its UI does. */
async function pilot(channel: string, payload: unknown = {}): Promise<unknown> {
  return handle.page.evaluate(
    ([ch, body]) =>
      (
        window as unknown as {
          electronAPI: { extensionBridge: { invoke(c: string, p: unknown): Promise<unknown> } }
        }
      ).electronAPI.extensionBridge.invoke(ch as string, body),
    [channel, payload] as [string, unknown]
  )
}

test('the pilot extension is loaded and answering', async () => {
  // If this is empty the extension did not activate, and everything below would
  // fail for a reason that has nothing to do with supervision.
  const features = (await pilot('speckit:feature-list', { repoRoot: repo })) as {
    features?: unknown[]
  }
  expect(features.features?.length ?? 0).toBeGreaterThan(0)
})

test('nothing is held, and nothing is queued, before a run starts', async () => {
  // Asserted rather than assumed: a surface that is empty because it failed to
  // load looks the same as one that is empty because all is well.
  const pending = (await pilot('speckit:permissions-list')) as { pending: unknown[] }
  expect(pending.pending).toEqual([])

  const snapshot = (await pilot('speckit:supervision-snapshot')) as {
    runs: unknown[]
    review: unknown[]
    backpressure: { allowed: boolean }
  }
  expect(snapshot.runs).toEqual([])
  expect(snapshot.review).toEqual([])
  expect(snapshot.backpressure.allowed).toBe(true)
})

test('the stall detector is recording rather than interrupting', async () => {
  // Shadow mode is the default and deliberately so: a detector that cries wolf
  // gets turned off, and then the real stalls go unreported too.
  const stalls = (await pilot('speckit:stalls-list')) as {
    firings: unknown[]
    shadowMode: boolean
  }
  expect(stalls.shadowMode).toBe(true)
  expect(stalls.firings).toEqual([])
})

test('starting a phase opens a project and a terminal running claude', async () => {
  test.setTimeout(180_000)
  const { page } = handle

  // Dispatch is how a card actually starts: it cuts the branch, provisions the
  // worktree and runs the first phase. Driven here exactly as the board does.
  const started = (await pilot('speckit:dispatch', {
    ticket: {
      source: 'linear',
      key: 'E2E-1',
      sourceUrl: 'https://example.invalid/E2E-1',
      title: 'End to end card',
    },
    workspacePath: repo,
  })) as { error?: string; message?: string } | null

  // Either it started something, or it said why. Silence would be the bug.
  expect(started).not.toBeNull()
  expect(started?.error ?? 'ok').toBe('ok')

  // The worktree became a project in the sidebar, named for its branch.
  await expandWorkspace(page, 'Pilot')
  // Named for the branch the card cut, which is what makes it findable at all.
  const project = page.locator('.project-row__name').filter({ hasText: 'e2e-1' })
  await expect(project.first()).toBeVisible({ timeout: 60_000 })

  // And it is running in a terminal, with the command visible in it — held
  // until the tab mounted rather than printed before anything was listening.
  await project.first().click()
  await expect(page.locator('.xterm-screen')).toHaveCount(1, { timeout: 60_000 })
  await expect(page.locator('.xterm-screen')).toContainText('claude --session-id', {
    timeout: 60_000,
  })

  // Never the thing this replaced.
  await expect(page.locator('.xterm-screen')).not.toContainText('bypassPermissions')

  // And it is on the register, where the review queue, the gate and the stall
  // detector all read from. Asserted here rather than in a test of its own:
  // they are one event, and splitting them made the second depend on the first
  // having run.
  const snapshot = (await pilot('speckit:supervision-snapshot')) as {
    runs: Array<{ featureDir: string; state: string; terminalSessionId: string; branch: string }>
  }
  expect(snapshot.runs).toHaveLength(1)
  expect(snapshot.runs[0]).toMatchObject({
    state: expect.stringMatching(/working|waiting|ready|finished|stalled/),
    branch: expect.stringContaining('e2e-1'),
  })
  expect(snapshot.runs[0].terminalSessionId).toBeTruthy()
  // The card it belongs to, which is the identity everything downstream keys on.
  expect(snapshot.runs[0].featureDir.startsWith(join(repo, 'specs'))).toBe(true)
})

test('the run actions are registered in the real host, not just in unit tests', async () => {
  // Registration is the failure mode these keep having: the unit tests pass
  // against a mock API that registers anything it is handed.
  for (const channel of [
    'speckit:run-terminal',
    'speckit:run-transcript',
    'speckit:run-interrupt',
    'speckit:run-redirect',
    'speckit:run-stop',
    'speckit:run-discard',
  ]) {
    // An unregistered extension channel rejects; a registered one answers.
    await expect(pilot(channel, { sessionId: 'nobody' })).resolves.toBeTruthy()
  }
})

test('a single-repository card declares no lanes, and says so without failing', async () => {
  // The lane strip renders nothing for almost every card, and "nothing" has to
  // be an answer rather than an error.
  const featureDir = join(repo, 'specs', '021-e2e-card')
  await expect(pilot('speckit:lanes', { featureDir })).resolves.toEqual({ lanes: [] })
  await expect(
    pilot('speckit:lane-may-merge', { featureDir, ord: 1, merged: [] })
  ).resolves.toEqual({ allowed: true, reason: null, blockingLane: null })
})

test('a card that declares lanes gets them back in merge order', async () => {
  const featureDir = join(repo, 'specs', '021-e2e-card')
  writeFileSync(
    join(featureDir, 'workitem.json'),
    JSON.stringify({
      id: 'E2E-1',
      contract: { shared_files: ['proto/session.proto'] },
      lanes: [
        { ord: 2, repo: 'cli-flow', branch: 'feat/x', role: 'consumer', blocked_by: [1] },
        { ord: 1, repo: 'fluent', branch: 'feat/x', role: 'producer', blocks: [2] },
      ],
    })
  )

  const { lanes } = (await pilot('speckit:lanes', { featureDir })) as {
    lanes: Array<{ lane: { ord: number; repo: string }; collisions: string[] }>
  }
  expect(lanes.map((view) => view.lane.repo)).toEqual(['fluent', 'cli-flow'])
  // Flagged on both, not only on the producer.
  expect(lanes.every((view) => view.collisions.includes('proto/session.proto'))).toBe(true)

  // And the consumer may not go first, because they share a file.
  const decision = (await pilot('speckit:lane-may-merge', {
    featureDir,
    ord: 2,
    merged: [],
  })) as { allowed: boolean; blockingLane: number | null }
  expect(decision).toMatchObject({ allowed: false, blockingLane: 1 })
})

test('nothing merged with nobody looking, and the log says so rather than erroring', async () => {
  await expect(pilot('speckit:unattended-merges')).resolves.toEqual({ merges: [] })
})
