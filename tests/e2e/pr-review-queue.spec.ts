import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { closeApp, e2eTempDir, launchApp, type AppHandle } from './helpers'
import {
  git,
  makeRepoWithRemote,
  openCodeReviews,
  pushBranchToOrigin,
  seedWorkspace,
  writeFile,
} from './git-harness'
import { popoutPage, type ExtensionView } from './extension-page'
import { startGithubStub, type GithubStub } from './github-stub'

/** Code Reviews against the stub GitHub: what only the whole app shows, each change reaching
 * GitHub or git. The queue's search, a pull request that fails to open (in the tab and in the
 * pop-out) and a merged pull request leaving the queue have renderer and channel tests
 * (PrReviewTab.open, ReviewQueue, github-ipc, usePrReview). */

let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string

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
  pushBranchToOrigin(repo, 'feat/subtract', {
    'src/math.ts':
      'export const add = (a: number, b: number) => a + b\nexport const subtract = (a: number, b: number) => a - b\n',
  })
  pushBranchToOrigin(repo, 'feat/greeting', { 'README.md': '# widgets, greeted\n' })
  pushBranchToOrigin(repo, 'docs/tidy', { 'docs/guide.md': '# Guide\n' })
  writeFile(repo, 'README.md', '# widgets, renamed on main\n')
  git(repo, 'commit', '--quiet', '-am', 'main: rename')
  git(repo, 'push', '--quiet')

  stub = await startGithubStub({ bareRepo: bare })
  openQueuePullRequests(stub)
  // Seeded, not created through New repo: a click while the window settles at launch can be lost.
  const profile = e2eTempDir('review-queue-')
  seedWorkspace(profile, WORKSPACE, repo)
  handle = await launchApp(profile, stub.env)
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.shutDown()
  for (const dir of [repo, bare]) if (dir) rmSync(dir, { recursive: true, force: true })
})

const WORKSPACE = 'Review Queue'

const queueRow = (view: Pick<ExtensionView, 'locator'>, title: string) =>
  view.locator('.rd-row').filter({ hasText: title })

/** Opens a pull request from the queue, in the view already open. */
async function openFromQueue(view: ExtensionView, title: string): Promise<void> {
  await queueRow(view, title).click()
  await expect(view.getByRole('heading', { level: 1 })).toContainText(title)
}

async function backToQueue(view: ExtensionView): Promise<void> {
  await view.getByRole('button', { name: 'Close' }).click()
  await expect(view.locator('.rd-row').first()).toBeVisible()
}

async function aCommentAndReadyAndUpdateReachGitHub(view: ExtensionView): Promise<void> {
  await openFromQueue(view, 'Add subtract')
  await view.getByRole('tab', { name: 'Discussion, 1' }).click()
  await view.getByPlaceholder('Leave a comment…').fill('Looking now.')
  await view.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(view.locator('.pr-issue-comment-list')).toContainText('Looking now.')
  expect(stub.pullRequest(1).issueComments.map((c) => c.body)).toEqual([
    'Ready for a look once CI is green.',
    'Looking now.',
  ])
  await view.getByRole('button', { name: 'Mark as ready' }).click()
  await expect(view.getByRole('heading', { level: 1 })).not.toContainText('Draft')
  expect(stub.pullRequest(1).isDraft).toBe(false)
  await view.getByRole('button', { name: 'Update from main' }).click()
  await expect(view.getByText('Behind main')).toBeHidden()
  expect(stub.pullRequest(1).branchUpdates).toBe(1)
}

async function anOpenedReviewStaysInProgressUntilDismissed(view: ExtensionView): Promise<void> {
  await backToQueue(view)
  await expect(queueRow(view, 'Add subtract')).toContainText('0 of 1 viewed')
  await queueRow(view, 'Add subtract').hover()
  await view.getByRole('button', { name: 'Dismiss PR #1 from in-progress' }).click()
  await expect(queueRow(view, 'Add subtract')).toHaveCount(0)
  // Still open on GitHub, it comes back as not started: its review session is gone.
  await view.getByRole('button', { name: 'Refresh pull requests' }).click()
  await expect(queueRow(view, 'Add subtract')).not.toContainText('viewed')
}

async function aConflictedPullRequestIsMergedInAWorktree(view: ExtensionView): Promise<void> {
  await openFromQueue(view, 'Rework greeting')
  await view.getByRole('button', { name: 'Resolve conflicts' }).click()
  await view.getByTestId('conflict-file-row').filter({ hasText: 'README.md' }).click()
  await view.getByRole('button', { name: /^Keep theirs/ }).click()
  await view.getByRole('button', { name: /^Confirm/ }).click()
  await view.getByRole('button', { name: 'Commit merge' }).click()
  await expect.poll(() => git(bare, 'log', '-1', '--format=%s', 'feat/greeting')).toMatch(/^Merge/)
  const head = git(bare, 'rev-parse', 'feat/greeting')
  expect(git(bare, 'rev-list', '--parents', '-n', '1', head).split(' ')).toHaveLength(3)
  expect(git(bare, 'show', `${head}:README.md`)).toBe('# widgets, renamed on main')
}

async function anApprovalFromThePopOutReachesGitHub(view: ExtensionView): Promise<void> {
  await backToQueue(view)
  await view.getByRole('button', { name: 'Pop out' }).click()
  const popout = await popoutPage(handle, 'view=pr-review')
  await queueRow(popout, 'Add subtract').click()
  await popout.getByRole('button', { name: /^(Start|Continue|Resume) review/ }).click()
  const verdictBar = popout.getByRole('region', { name: 'Review verdict' })
  await verdictBar.getByRole('button', { name: 'Approve' }).click()
  await popout.waitForEvent('close')
  expect(stub.pullRequest(1).reviews.at(-1)?.state).toBe('APPROVED')
  await expect(queueRow(view, 'Add subtract')).toContainText('1 approved')
}

test('a pull request in the queue is discussed, made ready, merged and approved on GitHub', async () => {
  const view = await openCodeReviews(handle, WORKSPACE)
  await expect(view.locator('.rd-row')).toHaveCount(3)
  await test.step('a comment, Mark as ready and Update from main reach GitHub', () =>
    aCommentAndReadyAndUpdateReachGitHub(view))
  await test.step('an opened review stays in progress until it is dismissed', () =>
    anOpenedReviewStaysInProgressUntilDismissed(view))
  await test.step('a conflicted pull request is merged in a worktree and pushed', () =>
    aConflictedPullRequestIsMergedInAWorktree(view))
  await test.step('an approval from the pop-out window reaches GitHub', () =>
    anApprovalFromThePopOutReachesGitHub(view))
})
