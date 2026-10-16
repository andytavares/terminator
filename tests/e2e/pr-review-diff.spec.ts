import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
import { closeApp, launchApp, type AppHandle } from './helpers'
import { misalignedOn } from './control-alignment'
import type { ExtensionView } from './extension-page'
import {
  git,
  makeRepoWithRemote,
  openCodeReviews,
  openRepo,
  pushBranchToOrigin,
  writeFile,
} from './git-harness'
import { startGithubStub, type GithubStub } from './github-stub'
import { expectCentredInWindow } from './modal-centre'

/** A pull request's diff in Code Reviews against the stub GitHub: context, risk, covering
 * tests, threads and pending comments, files marked viewed, and what changed since the last look. */

let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string

const MATH_HEAD = [
  'export function add(a: number, b: number) {',
  '  return a + b',
  '}',
  '',
  'export function subtract(a: number, b: number) {',
  '  return a - b',
  '}',
]
const MATH_TAIL = Array.from({ length: 30 }, (_, i) => `export const step${i} = ${i}`)
const MATH_SPEC =
  "import { add, subtract } from '../src/math'\n\n" +
  "test('add', () => expect(add(1, 2)).toBe(3))\n" +
  "test('subtract', () => expect(subtract(3, 2)).toBe(1))\n"

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-review'))
  writeFile(repo, 'src/math.ts', [...MATH_HEAD.slice(0, 4), ...MATH_TAIL, ''].join('\n'))
  writeFile(repo, 'tests/math.spec.ts', MATH_SPEC.replace(/\ntest\('subtract'.*\n/, '\n'))
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', 'math with a tail')
  git(repo, 'push', '--quiet')
  pushBranchToOrigin(repo, 'feat/subtract', {
    'src/math.ts': [...MATH_HEAD, ...MATH_TAIL, ''].join('\n'),
    'tests/math.spec.ts': MATH_SPEC,
  })
  stub = await startGithubStub({ bareRepo: bare })
  const pr = stub.openPullRequest({ title: 'Add subtract', headRefName: 'feat/subtract' })
  pr.reviewComments.push({
    id: 501,
    user: { login: 'octo-author' },
    body: 'Should this guard against NaN?',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    path: 'src/math.ts',
    line: 6,
    start_line: null,
    side: 'RIGHT',
    diff_hunk: '@@ -1,4 +1,8 @@',
    in_reply_to_id: null,
    pull_request_review_id: null,
  })
  handle = await launchApp(undefined, stub.env)
  await openRepo(handle, 'Review Diff', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.shutDown()
  for (const dir of [repo, bare]) if (dir) rmSync(dir, { recursive: true, force: true })
})

async function startPrReview(): Promise<ExtensionView> {
  const view = await openCodeReviews(handle, 'Review Diff')
  await view.locator('.rd-row').filter({ hasText: 'Add subtract' }).click()
  await view.getByRole('button', { name: /^(Start|Continue|Resume) review/ }).click()
  return view
}

/** The PR the test before left open: the tab reloads fresh on a re-open, so the
 * review screen comes back through its queue row, or from its overview when the
 * queue remembers it in progress. */
async function backInPrReview(): Promise<ExtensionView> {
  const view = await openCodeReviews(handle, 'Review Diff')
  if (await view.locator('.rd-row').first().isVisible()) {
    await view.locator('.rd-row').filter({ hasText: 'Add subtract' }).click()
  }
  await view.getByRole('button', { name: /^(Start|Continue|Resume) review/ }).click()
  return view
}

function fileInList(view: ExtensionView, path: string) {
  return view.locator(`.full-file-row[title="${path}"]`)
}

async function theDiffShowsTheChangeAndContext(): Promise<void> {
  const view = await startPrReview()
  await fileInList(view, 'src/math.ts').click()
  await expect(view.getByRole('main')).toContainText('return a - b')
  await expect(view.getByRole('main')).not.toContainText('export const step20 = 20')
  expect(await misalignedOn(view, 'Review screen')).toEqual([])

  await view.getByRole('button', { name: 'Show 20 lines below' }).click()
  await expect(view.getByRole('main')).toContainText('export const step20 = 20')
}

async function theReviewPlanOpensAChapter(): Promise<void> {
  const view = await backInPrReview()
  await fileInList(view, 'tests/math.spec.ts').click()
  await view.getByRole('main').focus()
  await view.keyboard.press('i')
  await view.getByRole('button', { name: 'Start here: Tests' }).click()
  await expect(fileInList(view, 'src/math.ts')).toHaveAttribute('aria-current', 'true')
  await expect(fileInList(view, 'tests/math.spec.ts')).not.toHaveAttribute('aria-current', 'true')
}

async function aFilesRiskNamesItsImporters(): Promise<void> {
  const view = await backInPrReview()
  await view.getByRole('button', { name: 'Ask agent about this PR' }).click()
  await view.getByRole('tab', { name: 'Why this file' }).click()
  await expect(view.getByText('Importers (1)')).toBeVisible()
  await expect(view.locator('.risk-importer-btn')).toHaveAttribute('title', 'tests/math.spec.ts')
  await view.keyboard.press('Escape')
}

async function aBlocksTestsAreFound(): Promise<void> {
  const view = await backInPrReview()
  await view.getByRole('button', { name: 'Jump to the tests for this block' }).first().click()
  const popover = view.getByRole('group', { name: 'Tests for this block' })
  await expect(popover.locator('.tp-where').first()).toHaveText(/^tests\/math\.spec\.ts:\d+$/)
  await expect(popover).toContainText('Open in review')
  await view.keyboard.press('Escape')
}

async function aReplyIsPostedUnderTheThread(): Promise<void> {
  const view = await backInPrReview()
  const thread = view.locator('.inline-comment-thread').filter({ hasText: 'guard against NaN' })
  await thread.getByRole('button', { name: 'Reply' }).click()
  await view.getByPlaceholder('Leave a comment…').fill('Callers validate first.')
  await view.getByRole('button', { name: 'Reply', exact: true }).last().click()

  await expect(thread).toContainText('Callers validate first.')
  const reply = stub.pullRequest(1).reviewComments.find((c) => c.in_reply_to_id === 501)
  expect(reply?.body).toBe('Callers validate first.')
}

async function markingAFileViewedMarksItOnGitHub(): Promise<void> {
  const view = await backInPrReview()
  await fileInList(view, 'tests/math.spec.ts').click()
  await view.getByRole('checkbox', { name: 'Viewed', exact: true }).check()
  await expect.poll(() => stub.pullRequest(1).viewedPaths).toEqual(['tests/math.spec.ts'])
}

async function aPendingCommentGoesOutWithTheReview(): Promise<void> {
  const view = await backInPrReview()
  await fileInList(view, 'src/math.ts').click()
  const lineFive = view.getByRole('row', { name: /^5 Add comment/ })
  await lineFive.getByRole('button', { name: 'Add comment' }).click()
  await view.getByRole('button', { name: /^Comment/ }).click()
  await view.getByPlaceholder('Leave a comment…').fill('Name the operands minuend and subtrahend.')
  await view.getByRole('button', { name: 'Add to pending review' }).click()
  await expect(view.getByRole('button', { name: /^Submit review 1 pending comment/ })).toBeVisible()

  // On the last file, finishing marks every file still unviewed (src/math.ts) viewed.
  await fileInList(view, 'tests/math.spec.ts').click()
  await view.getByRole('button', { name: /Viewed, submit review/ }).click()
  const dialog = view.getByRole('dialog', { name: 'Submit review' })
  await expectCentredInWindow(dialog, 'Git: Submit review')
  await dialog.getByLabel('Request changes').check()
  await dialog.getByPlaceholder('Leave a summary comment (optional)…').fill('One naming nit.')
  await dialog.getByRole('button', { name: 'Submit changes request' }).click()
  await expect(dialog).toContainText('Review submitted successfully.')

  const pr = stub.pullRequest(1)
  expect(pr.reviews.at(-1)).toMatchObject({ state: 'CHANGES_REQUESTED', body: 'One naming nit.' })
  expect(pr.reviewComments.at(-1)).toMatchObject({
    path: 'src/math.ts',
    line: 5,
    side: 'RIGHT',
    body: 'Name the operands minuend and subtrahend.',
  })
  expect([...pr.viewedPaths].sort()).toEqual(['src/math.ts', 'tests/math.spec.ts'])
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
}

async function aReReviewSaysWhatChangedSinceTheLastLook(): Promise<void> {
  // Submitted before: the row reopens the PR at its overview, which offers Continue.
  const view = await backInPrReview()
  await view.getByRole('button', { name: 'More review actions' }).click()
  await view.getByRole('menuitem', { name: 'Pause review' }).click()
  await expect(view.locator('.rd-row').filter({ hasText: 'Add subtract' })).toBeVisible()

  git(repo, 'checkout', '--quiet', 'feat/subtract')
  writeFile(
    repo,
    'src/math.ts',
    [...MATH_HEAD, ...MATH_TAIL, 'export const done = true', ''].join('\n')
  )
  git(repo, 'commit', '--quiet', '-am', 'mark done')
  git(repo, 'push', '--quiet', 'origin', 'feat/subtract')
  git(repo, 'checkout', '--quiet', 'main')

  await startPrReview()
  await expect(view.getByText('1 commit since you last looked')).toBeVisible()
}

/** The flow's steps in order, each titled with the behaviour it checks. */
const STEPS: Array<[title: string, run: () => Promise<void>]> = [
  [
    'the diff shows the change, and the context below it on request',
    theDiffShowsTheChangeAndContext,
  ],
  ["the overview's review plan opens a chapter at its first file", theReviewPlanOpensAChapter],
  ["a file's risk names the files that import it", aFilesRiskNamesItsImporters],
  ["a block's tests are found in the pull request", aBlocksTestsAreFound],
  [
    "a reply to a reviewer's thread is posted to GitHub and shown under it",
    aReplyIsPostedUnderTheThread,
  ],
  ['marking a file viewed marks it on GitHub', markingAFileViewedMarksItOnGitHub],
  [
    'a pending comment goes out with the review, and finishing marks the rest viewed',
    aPendingCommentGoesOutWithTheReview,
  ],
  [
    'after the author pushes again, the review says what changed since the last look',
    aReReviewSaysWhatChangedSinceTheLastLook,
  ],
]

test("a pull request's diff is read in context, commented on, submitted and re-reviewed after a push", async () => {
  test.setTimeout(150_000)
  for (const [title, run] of STEPS) await test.step(title, run)
})
