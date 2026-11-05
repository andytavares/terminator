import { test, expect } from '@playwright/test'
import { readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentRecordFile, closeApp, e2eTempDir, launchApp, type AppHandle } from './helpers'
import { git, gitView, makeRepoWithRemote, openRepo, pushBranchToOrigin } from './git-harness'
import { startGithubStub, type GithubStub } from './github-stub'
import { openHome } from './session-views'

/** The pull request watch (ADR 142): a failing PR at app start wakes nothing; a check that
 * fails after start prompts the agent tab on the PR's branch. The stub ACP agent records each
 * prompt in the profile's agent record. The PR's branch is checked out in the workspace. */

const BRANCH = 'feat/watch'
let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string

const records = (): Array<{ kind: string }> => {
  const file = agentRecordFile(handle.userDataDir)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}
const prompts = () => records().filter((record) => record.kind === 'prompt').length

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-pr-watch'))
  pushBranchToOrigin(repo, BRANCH, { 'src/watch.ts': 'export const watched = true\n' })
  git(repo, 'checkout', '--quiet', BRANCH)
  // The dashboard joins a pull request to a checkout by its origin's owner/name, which a bare
  // path does not have; the test pushes nothing after this.
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/widgets.git')
  stub = await startGithubStub({ bareRepo: bare, viewer: 'andrew' })
  stub.openPullRequest({ title: 'Watch me', headRefName: BRANCH, author: 'andrew' }).failedChecks =
    ['unit']
  // A reply ends each turn: a wake waits for the running turn, so an endless one would hold it.
  const reply = join(e2eTempDir('pr-watch-reply-'), 'reply.txt')
  writeFileSync(reply, 'Done.')
  handle = await launchApp(undefined, { ...stub.env, E2E_AGENT_REPLY: reply })
  await openRepo(handle, 'widgets', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.shutDown()
  for (const dir of [repo, bare]) if (dir) rmSync(dir, { recursive: true, force: true })
})

const dashboardReads = () =>
  stub.calls.filter((call) => call.args.some((arg) => arg.includes('search(query:'))).length

/** A dashboard read made now knows the workspace; the one at app start ran before it existed,
 *  so it joined the pull request to no checkout and Send to agent had nowhere to go. */
async function refreshDashboard(): Promise<void> {
  const before = dashboardReads()
  const entry = handle.page.getByRole('button', { name: 'Reviews', exact: true })
  // A second click on the open Reviews closes it.
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  const reviews = await gitView(handle, 'reviews')
  await reviews.getByRole('button', { name: 'Refresh' }).click()
  await expect.poll(dashboardReads).toBeGreaterThan(before)
}

test('a failing check at app start wakes nothing; a new failing check prompts the agent tab', async () => {
  await expect.poll(dashboardReads).toBeGreaterThan(0)
  expect(records()).toEqual([])

  // The operator starts the agent tab once from Home; the watch then finds it live.
  await refreshDashboard()
  await openHome(handle.page)
  await handle.page.getByRole('button', { name: 'Send to agent' }).first().click()
  await expect.poll(prompts).toBe(1)

  stub.pullRequest(1).failedChecks.push('e2e')
  await refreshDashboard()
  await expect.poll(prompts).toBe(2)
})
