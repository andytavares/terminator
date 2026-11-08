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

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-review'))
  pushBranchToOrigin(repo, 'feat/subtract', {
    'src/math.ts': 'export function subtract(a: number, b: number) {\n  return a - b\n}\n',
  })
  stub = await startGithubStub({ bareRepo: bare })
  stub.openPullRequest({ title: 'Add subtract', headRefName: 'feat/subtract' })
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
  await view.locator('.full-file-row[title="src/math.ts"]').click()
  await expect(view.getByRole('main')).toContainText('return a - b')
  await expect.poll(() => misalignedOn(view, 'Review screen')).toEqual([])
})
