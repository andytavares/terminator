import { test, expect, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { closeApp, launchApp, type AppHandle } from './helpers'
import {
  git,
  gitView,
  makeRepoWithRemote,
  openCodeReviews,
  openRepo,
  pushBranch,
  writeFile,
} from './git-harness'
import { startGithubStub, type GithubStub } from './github-stub'

/** Code Reviews' queue and a pull request's overview against the stub GitHub, from search
 * to a conflicted pull request merged in a worktree and an approval from the pop-out window. */

let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string

test.describe.configure({ mode: 'serial' })

/** Three pull requests: a draft behind main with a comment, one in conflict, and one clean. */
function openQueuePullRequests(stub: GithubStub): void {
  const subtract = stub.openPullRequest({
    title: 'Add subtract',
    headRefName: 'feat/subtract',
    isDraft: true,
    mergeStateStatus: 'BEHIND',
  })
  subtract.issueComments.push({
    id: 701,
    user: { login: 'octo-author' },
    body: 'Ready for a look once CI is green.',
    created_at: '2026-10-01T11:00:00Z',
    updated_at: '2026-10-01T11:00:00Z',
  })
  stub.openPullRequest({
    title: 'Rework greeting',
    headRefName: 'feat/greeting',
    mergeStateStatus: 'DIRTY',
  })
  stub.openPullRequest({ title: 'Tidy docs', headRefName: 'docs/tidy' })
}

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-queue'))
  pushBranch(repo, 'feat/subtract', {
    'src/math.ts':
      'export const add = (a: number, b: number) => a + b\nexport const subtract = (a: number, b: number) => a - b\n',
  })
  pushBranch(repo, 'feat/greeting', { 'README.md': '# widgets, greeted\n' })
  pushBranch(repo, 'docs/tidy', { 'docs/guide.md': '# Guide\n' })
  writeFile(repo, 'README.md', '# widgets, renamed on main\n')
  git(repo, 'commit', '--quiet', '-am', 'main: rename')
  git(repo, 'push', '--quiet')

  stub = await startGithubStub({ bareRepo: bare })
  openQueuePullRequests(stub)
  handle = await launchApp(undefined, stub.env)
  await openRepo(handle, 'Review Queue', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.close()
  for (const dir of [repo, bare]) if (dir) rmSync(dir, { recursive: true, force: true })
})

const row = (view: Page, title: string) => view.locator('.rd-row').filter({ hasText: title })

async function openOverview(title: string): Promise<Page> {
  const view = await openCodeReviews(handle, 'Review Queue')
  await row(view, title).click()
  await expect(view.locator('.pr-review-topbar-title')).toContainText(title)
  return view
}

test('the queue lists the open pull requests, and search narrows it', async () => {
  const view = await openCodeReviews(handle, 'Review Queue')
  await expect(view.locator('.rd-row')).toHaveCount(3)
  await view.getByRole('searchbox', { name: 'Search pull requests' }).fill('greeting')
  await expect(view.locator('.rd-row')).toHaveCount(1)
  await expect(row(view, 'Rework greeting')).toBeVisible()
  await view.getByRole('searchbox', { name: 'Search pull requests' }).fill('')
  await expect(view.locator('.rd-row')).toHaveCount(3)
})

test('a comment in the discussion is posted to the pull request', async () => {
  const view = await openOverview('Add subtract')
  await view.getByRole('button', { name: /^Discussion · 1/ }).click()
  await expect(view.locator('.pr-issue-comment-list')).toContainText('once CI is green')
  await view.getByPlaceholder('Leave a comment…').fill('Looking now.')
  await view.getByRole('button', { name: 'Comment', exact: true }).click()

  await expect(view.locator('.pr-issue-comment-list')).toContainText('Looking now.')
  expect(stub.pullRequest(1).issueComments.map((c) => c.body)).toEqual([
    'Ready for a look once CI is green.',
    'Looking now.',
  ])
})

test('a draft is marked ready, and a branch behind main is brought up to date', async () => {
  const view = await openCodeReviews(handle, 'Review Queue')
  await view.getByRole('button', { name: 'Mark as Ready' }).click()
  await expect(view.locator('.pr-draft-badge')).toBeHidden()
  expect(stub.pullRequest(1).isDraft).toBe(false)

  await view.getByRole('button', { name: 'Update from main' }).click()
  await expect(view.getByText('Behind main')).toBeHidden()
  expect(stub.pullRequest(1).branchUpdates).toBe(1)
})

test('an opened review stays in progress until it is dismissed', async () => {
  const view = await openCodeReviews(handle, 'Review Queue')
  await view.getByRole('button', { name: 'Close' }).click()
  await expect(row(view, 'Add subtract')).toContainText('0 of 1 viewed')
  await row(view, 'Add subtract').hover()
  await view.getByRole('button', { name: 'Dismiss PR #1 from in-progress' }).click()
  await expect(row(view, 'Add subtract')).toHaveCount(0)

  // Still open on GitHub, it comes back as not started: its review session is gone.
  await view.getByRole('button', { name: 'Refresh pull requests' }).click()
  await expect(row(view, 'Add subtract')).toContainText('Review')
  await expect(row(view, 'Add subtract')).not.toContainText('viewed')
})

test('a review whose pull request was merged elsewhere leaves the queue', async () => {
  const view = await openOverview('Tidy docs')
  await view.getByRole('button', { name: 'Close' }).click()
  await expect(row(view, 'Tidy docs')).toContainText('0 of 1 viewed')

  stub.pullRequest(3).state = 'MERGED'
  await view.getByRole('button', { name: 'Refresh pull requests' }).click()
  await expect(view.locator('.rd-row')).toHaveCount(2)
  await expect(row(view, 'Tidy docs')).toHaveCount(0)
})

test('a conflicted pull request is merged in a worktree and pushed', async () => {
  const view = await openOverview('Rework greeting')
  await view.getByRole('button', { name: 'Resolve conflicts' }).click()
  await expect(view.getByText('Merge conflicts need resolving')).toBeVisible({ timeout: 15000 })
  await view.getByTestId('conflict-file-row').filter({ hasText: 'README.md' }).click()
  await view.getByRole('button', { name: /^Keep theirs/ }).click()
  await view.getByRole('button', { name: /^Confirm/ }).click()
  await view.getByRole('button', { name: 'Commit merge' }).click()

  await expect(view.locator('.pr-review-topbar-title')).toContainText('Rework greeting', {
    timeout: 15000,
  })
  await expect.poll(() => git(bare, 'log', '-1', '--format=%s', 'feat/greeting')).toMatch(/^Merge/)
  const head = git(bare, 'rev-parse', 'feat/greeting')
  expect(git(bare, 'rev-list', '--parents', '-n', '1', head).split(' ')).toHaveLength(3)
  expect(git(bare, 'show', `${head}:README.md`)).toBe('# widgets, renamed on main')
})

test('an approval from the pop-out window reaches GitHub and closes the window', async () => {
  const view = await openCodeReviews(handle, 'Review Queue')
  await view.getByRole('button', { name: 'Close' }).click()
  await expect(row(view, 'Add subtract')).toBeVisible()
  await view.getByRole('button', { name: 'Pop out' }).click()
  const popout = await gitView(handle, 'pr-review')
  await row(popout, 'Add subtract').click()
  await popout.getByRole('button', { name: /^(Start|Continue|Resume) Review/ }).click()
  await popout.getByRole('button', { name: 'Submit review…' }).click()
  const dialog = popout.getByRole('dialog', { name: 'Submit review' })
  await dialog.getByLabel('Approve').check()
  await dialog.getByRole('button', { name: 'Submit review' }).click()

  await popout.waitForEvent('close')
  expect(stub.pullRequest(1).reviews.at(-1)?.state).toBe('APPROVED')
  await expect(row(view, 'Add subtract')).toContainText('1 approved')
})
