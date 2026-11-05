import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { closeApp, launchApp, type AppHandle } from './helpers'
import { makeRepoWithRemote, openCodeReviews, openRepo, pushBranchToOrigin } from './git-harness'
import { startGithubStub, type GithubStub } from './github-stub'

/** A stack of two pull requests (main <- #1 <- #2) merged from #2's overview against the stub
 * GitHub, and the revert of a merged pull request. */

let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-merge-stack'))
  pushBranchToOrigin(repo, 'feat/retry', { 'src/retry.ts': 'export const retry = 1\n' })
  pushBranchToOrigin(repo, 'feat/retry-jitter', { 'src/jitter.ts': 'export const jitter = 1\n' })
  stub = await startGithubStub({ bareRepo: bare })
  stub.openPullRequest({ title: 'Add retry to fetchUser', headRefName: 'feat/retry' })
  stub.openPullRequest({
    title: 'Retry jitter',
    headRefName: 'feat/retry-jitter',
    baseRefName: 'feat/retry',
  })
  handle = await launchApp(undefined, stub.env)
  await openRepo(handle, 'Merge Stack', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.shutDown()
  for (const dir of [repo, bare]) if (dir) rmSync(dir, { recursive: true, force: true })
})

test('a stack is merged bottom first, and a merged pull request can be reverted', async () => {
  const view = await openCodeReviews(handle, 'Merge Stack')
  await view.locator('.rd-row').filter({ hasText: 'Retry jitter' }).click()
  await expect(view.getByText('Stacked on #1')).toBeVisible()

  await view.getByRole('button', { name: 'Merge stack · 2' }).first().click()
  const confirm = view.getByRole('group', { name: 'Merge stack' })
  await expect(confirm).toContainText('Retarget from feat/retry to main')
  await confirm.getByRole('button', { name: 'Merge 2 pull requests' }).click()

  await expect(view.getByText('Merged 2 pull requests.')).toBeVisible()
  expect(stub.pullRequest(1).state).toBe('MERGED')
  expect(stub.pullRequest(2).state).toBe('MERGED')
  expect(stub.pullRequest(2).baseRefName).toBe('main')
  await expect(view.getByText('Merged', { exact: true }).first()).toBeVisible()

  await view.getByRole('button', { name: 'Open revert PR' }).first().click()
  await expect.poll(() => stub.pullRequests.length).toBe(3)
  expect(stub.pullRequest(3).title).toBe('Revert "Retry jitter"')
})
