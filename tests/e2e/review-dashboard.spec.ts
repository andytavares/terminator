import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, launchApp, type AppHandle } from './helpers'
import { git, gitView, makeRepoWithRemote, pushBranch } from './git-harness'
import { startGithubStub, type GithubStub } from './github-stub'

/**
 * The Reviews dashboard, against the stub GitHub: narrowing it to chosen
 * repositories, and cloning a repository no workspace has yet to review a
 * pull request in it.
 */

let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string
let cloneFolder: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-dashboard'))
  pushBranch(repo, 'feat/subtract', { 'src/subtract.ts': 'export const subtract = 1\n' })
  stub = await startGithubStub({ bareRepo: bare })
  stub.openPullRequest({ title: 'Add subtract', headRefName: 'feat/subtract' })
  cloneFolder = mkdtempSync(join(tmpdir(), 'terminator-e2e-clones-'))
  handle = await launchApp(undefined, stub.env)
  // Settings → Git Integration → "Clone folder for reviews", through the channel the field writes.
  await handle.page.evaluate(
    (folder) =>
      (
        window as unknown as {
          electronAPI: { extension: { updateSetting(k: string, v: unknown): Promise<unknown> } }
        }
      ).electronAPI.extension.updateSetting(
        'terminator.git-integration.review.cloneFolder',
        folder
      ),
    cloneFolder
  )
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.close()
  for (const dir of [repo, bare, cloneFolder])
    if (dir) rmSync(dir, { recursive: true, force: true })
})

async function openDashboard(): Promise<Page> {
  await handle.page.getByRole('button', { name: 'Reviews', exact: true }).click()
  return gitView(handle, 'reviews')
}

test('choosing repositories narrows what the dashboard asks GitHub for', async () => {
  const view = await openDashboard()
  await view.getByRole('button', { name: 'All repositories, choose repositories' }).click()
  const picker = view.getByRole('dialog', { name: 'Repositories for Reviews' })
  await picker.getByRole('checkbox', { name: 'acme/widgets' }).check()
  await expect(picker.getByRole('checkbox', { name: 'acme/gadgets' })).not.toBeChecked()
  await picker.getByRole('button', { name: 'Save' }).click()

  await expect(
    view.getByRole('button', { name: '1 repository, choose repositories' })
  ).toBeVisible()
  await view.getByRole('button', { name: 'Refresh' }).click()
  await expect
    .poll(() => stub.calls.at(-1)?.args.find((arg) => arg.startsWith('query=')) ?? '')
    .toContain('repo:acme/widgets')
})

test('Clone and review clones the repository and opens the pull request', async () => {
  const view = await openDashboard()
  const row = view.locator('.rd-row').filter({ hasText: 'Add subtract' })
  await row.getByRole('button', { name: 'Clone and review' }).click()

  const review = await gitView(handle, 'pr-review')
  await expect(review.locator('.pr-review-topbar-title')).toContainText('Add subtract', {
    timeout: 20000,
  })
  const clone = join(cloneFolder, 'widgets')
  expect(existsSync(join(clone, '.git'))).toBe(true)
  expect(git(clone, 'log', '-1', '--format=%s', 'origin/main')).toBe('initial')
})
