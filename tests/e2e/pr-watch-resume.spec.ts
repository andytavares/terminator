import { test, expect } from '@playwright/test'
import { readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentRecordFile, closeApp, e2eTempDir, launchApp, type AppHandle } from './helpers'
import { git, gitView, makeRepoWithRemote, openRepo, pushBranchToOrigin } from './git-harness'
import { startGithubStub, type GithubStub } from './github-stub'
import { openHome } from './session-views'

/** ADR 142: with no agent running on the branch, a pull request event resumes its last
 * conversation once; the next event prompts that resumed agent and resumes nothing more. */

const BRANCH = 'feat/resume'
let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string

interface AgentRecord {
  kind: string
  resumed?: boolean
}

function records(): AgentRecord[] {
  const file = agentRecordFile(handle.userDataDir)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentRecord)
}
const prompts = () => records().filter((record) => record.kind === 'prompt').length
const resumes = () =>
  records().filter((record) => record.kind === 'session' && record.resumed).length

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-pr-resume'))
  pushBranchToOrigin(repo, BRANCH, { 'src/resume.ts': 'export const resumed = true\n' })
  git(repo, 'checkout', '--quiet', BRANCH)
  // The dashboard joins a pull request to a checkout by its origin's owner/name.
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/widgets.git')
  stub = await startGithubStub({ bareRepo: bare, viewer: 'andrew' })
  stub.openPullRequest({ title: 'Resume me', headRefName: BRANCH, author: 'andrew' }).failedChecks =
    ['unit']
  const reply = join(e2eTempDir('pr-resume-reply-'), 'reply.txt')
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

async function failAnotherCheck(name: string): Promise<void> {
  stub.pullRequest(1).failedChecks.push(name)
  await refreshDashboard()
}

async function startThenCloseTheAgentTab(): Promise<void> {
  const { page } = handle
  await refreshDashboard()
  await openHome(page)
  await page.getByRole('button', { name: 'Send to agent' }).first().click()
  await expect.poll(prompts).toBe(1)
  await page.locator('.branch-row').filter({ hasText: BRANCH }).click()
  const agentTab = page.locator('.tab-bar__tab--session', { hasText: 'Fix checks #1' })
  await agentTab.click()
  await page.keyboard.press('ControlOrMeta+w')
  await expect(agentTab).toHaveCount(0)
}

async function anEventResumesTheConversationOnce(): Promise<void> {
  await failAnotherCheck('e2e')
  await expect.poll(resumes).toBe(1)
  await expect.poll(prompts).toBe(2)
}

async function theNextEventPromptsTheResumedAgentOnly(): Promise<void> {
  await failAnotherCheck('lint')
  await expect.poll(prompts).toBe(3)
  expect(resumes()).toBe(1)
}

test('an event on a pull request whose agent exited resumes one agent; a second resumes none', async () => {
  await test.step('the agent started from Home is closed', startThenCloseTheAgentTab)
  await test.step(
    'a new failing check resumes its conversation once',
    anEventResumesTheConversationOnce
  )
  await test.step(
    'the next failing check prompts that agent and resumes nothing more',
    theNextEventPromptsTheResumedAgentOnly
  )
})
