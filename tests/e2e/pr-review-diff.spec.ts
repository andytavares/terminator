import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { closeApp, launchApp, type AppHandle } from './helpers'
import { misalignedOn } from './control-alignment'
import { makeRepoWithRemote, openCodeReviews, openRepo, pushBranchToOrigin } from './git-harness'
import { startGithubStub, type GithubStub } from './github-stub'

/** A pull request's diff, fetched from the stub GitHub through the main process, drawn on the
 * review screen with its controls lined up. The review's steps have unit tests under
 * extensions/git-integration/tests/unit. */

let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string

/** 15 new files of 61 lines in 5 folders: 915 changed lines, the chapters band. Every file is the
 *  same settings object with other numbers, so all but the first fold as the same change. The
 *  first folder is deep, so its chapter name is a path longer than the chapter rail. */
function folderOf(pkg: number): string {
  return pkg === 1 ? 'python/klaviyo/step_service/settings_store/pkg1' : `pkg${pkg}`
}

function largePrFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  for (let pkg = 1; pkg <= 5; pkg++) {
    for (let n = 1; n <= 3; n++) {
      const keys = Array.from({ length: 59 }, (_, i) => `  key${i}: ${pkg * 100 + n * 10 + i},`)
      files[`${folderOf(pkg)}/settings${n}.ts`] = [
        'export const settings = {',
        ...keys,
        '}',
        '',
      ].join('\n')
    }
  }
  return files
}

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-review'))
  pushBranchToOrigin(repo, 'feat/subtract', {
    'src/math.ts': 'export function subtract(a: number, b: number) {\n  return a - b\n}\n',
  })
  stub = await startGithubStub({ bareRepo: bare })
  stub.openPullRequest({ title: 'Add subtract', headRefName: 'feat/subtract' })
  pushBranchToOrigin(repo, 'feat/settings', largePrFiles())
  stub.openPullRequest({ title: 'Add settings', headRefName: 'feat/settings' })
  handle = await launchApp(undefined, stub.env)
  await openRepo(handle, 'Review Diff', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.shutDown()
  for (const dir of [repo, bare]) if (dir) rmSync(dir, { recursive: true, force: true })
})

test("a pull request's diff is drawn on the review screen with its controls lined up", async () => {
  const view = await openCodeReviews(handle, 'Review Diff')
  await view.locator('.rd-row').filter({ hasText: 'Add subtract' }).click()
  await view.getByRole('button', { name: /^(Start|Continue|Resume) review/ }).click()
  // A three-line pull request is the page band: every file is on the page, with no chapter rail.
  await expect(view.locator('[data-review-path="src/math.ts"]')).toContainText('return a - b')
  await expect(view.getByRole('navigation', { name: 'PR chapters' })).toHaveCount(0)
  await expect.poll(() => misalignedOn(view, 'Review screen')).toEqual([])
})

test('a pull request over 800 lines shows one chapter at a time and folds repeated changes', async () => {
  const view = await openCodeReviews(handle, 'Review Diff')
  await view.locator('.rd-row').filter({ hasText: 'Add settings' }).click()
  await view.getByRole('button', { name: /^(Start|Continue|Resume) review/ }).click()
  const rail = view.getByRole('navigation', { name: 'PR chapters' })
  await expect(rail.getByRole('button')).toHaveCount(5)
  await expect(view.getByRole('group', { name: 'Folded hunk' }).first()).toContainText(
    'Same change as'
  )
  await expect(view.getByRole('button', { name: 'Done, next chapter' })).toBeVisible()
})

test("a chapter's long path name wraps instead of running under its hunk count", async () => {
  // Under 1100px the review view folds the chapter rail to a strip with no names.
  await handle.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1600, 800)
  )
  const view = await openCodeReviews(handle, 'Review Diff')
  await view.locator('.rd-row').filter({ hasText: 'Add settings' }).click()
  await view.getByRole('button', { name: /^(Start|Continue|Resume) review/ }).click()
  const name = view
    .getByRole('navigation', { name: 'PR chapters' })
    .getByRole('button', { name: /^python\/klaviyo/ })
    .locator('.chapter-nav-name')
  await expect(name).toBeVisible()
  const spill = await name.evaluate((el) => el.scrollWidth - el.clientWidth)
  await handle.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 800)
  )
  expect(spill).toBe(0)
})

test("a click on a line's + offers Comment, Ask agent and Explain, and Comment opens the composer", async () => {
  const view = await openCodeReviews(handle, 'Review Diff')
  await view.locator('.rd-row').filter({ hasText: 'Add subtract' }).click()
  await view.getByRole('button', { name: /^(Start|Continue|Resume) review/ }).click()
  const file = view.locator('[data-review-path="src/math.ts"]')
  const row = file.locator('tr[data-new-line="2"]')
  await row.hover()
  await row.getByRole('button', { name: 'Add comment' }).click()
  const bar = file.locator('.rs-float')
  await expect(bar.getByRole('button', { name: 'Ask agent' })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Explain' })).toBeVisible()
  await expect(view.getByTestId('composer')).toHaveCount(0)
  await bar.getByRole('button', { name: /^Comment/ }).click()
  await expect(view.getByTestId('composer')).toContainText('line 2')
  await view.getByTestId('composer').getByRole('button', { name: 'Cancel' }).click()
})

test('a drag down the + gutter selects the lines, and Comment opens the composer on them', async () => {
  const view = await openCodeReviews(handle, 'Review Diff')
  await view.locator('.rd-row').filter({ hasText: 'Add subtract' }).click()
  await view.getByRole('button', { name: /^(Start|Continue|Resume) review/ }).click()
  const file = view.locator('[data-review-path="src/math.ts"]')
  const first = file.locator('tr[data-new-line="1"]')
  await first.hover()
  await first.getByRole('button', { name: 'Add comment' }).hover()
  await view.mouse.down()
  await file.locator('tr[data-new-line="3"]').hover()
  await view.mouse.up()
  await file
    .locator('.rs-float')
    .getByRole('button', { name: /^Comment/ })
    .click()
  await expect(view.getByTestId('composer')).toContainText('lines 1–3')
  await view.getByTestId('composer').hover()
  const plus = (line: number) =>
    file.locator(`tr[data-new-line="${line}"]`).getByRole('button', { name: 'Add comment' })
  await expect(plus(1)).toHaveCSS('opacity', '1')
  await expect(plus(2)).toHaveCSS('opacity', '0')
  await expect(plus(3)).toHaveCSS('opacity', '0')
  await view.getByTestId('composer').getByRole('button', { name: 'Cancel' }).click()
})
