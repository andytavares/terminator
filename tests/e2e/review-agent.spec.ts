import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeApp,
  launchApp,
  readTerminalRowsIn,
  visibleTerminalScreen,
  type AppHandle,
} from './helpers'
import { misalignedOn } from './control-alignment'
import {
  git,
  gitView,
  makeRepoWithRemote,
  openCodeReviews,
  openRepo,
  pushBranchToOrigin,
} from './git-harness'
import { popoutPage, type ExtensionView } from './extension-page'
import { startGithubStub, type GithubStub } from './github-stub'

/** The Reviews dashboard and the review agent, against the stub GitHub. The dashboard runs
 * first, while no workspace has the repository, so it offers to clone it. The `claude` stub
 * (fixtures/bin/claude) idles until E2E_CLAUDE_REVIEW_REPLY holds what `claude -p` prints. */

let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string
let replyDir: string
let cloneFolder: string

const REPLY = {
  type: 'result',
  structured_output: {
    summary: 'One real problem in subtract.',
    findings: [
      {
        severity: 'must-fix',
        path: 'src/math.ts',
        startLine: 5,
        endLine: 6,
        side: 'RIGHT',
        title: 'subtract swaps its operands',
        body: 'It returns `b - a`.',
        suggestedCode: null,
      },
    ],
    walkthrough: [],
  },
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-agent'))
  pushBranchToOrigin(repo, 'feat/subtract', {
    'src/math.ts':
      'export function add(a: number, b: number) {\n  return a + b\n}\n\nexport function subtract(a: number, b: number) {\n  return b - a\n}\n',
  })
  stub = await startGithubStub({ bareRepo: bare })
  stub.openPullRequest({ title: 'Add subtract', headRefName: 'feat/subtract' })
  replyDir = mkdtempSync(join(tmpdir(), 'terminator-e2e-agent-reply-'))
  cloneFolder = mkdtempSync(join(tmpdir(), 'terminator-e2e-clones-'))
  handle = await launchApp(undefined, {
    ...stub.env,
    E2E_CLAUDE_REVIEW_REPLY: join(replyDir, 'reply.json'),
  })
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.shutDown()
  for (const dir of [repo, `${repo}-link`, bare, replyDir, cloneFolder]) {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

/** A flow's steps, run in order, each titled with the behaviour it checks. */
type Steps = Array<[title: string, run: () => Promise<void>]>

async function runSteps(steps: Steps): Promise<void> {
  for (const [title, run] of steps) await test.step(title, run)
}

// The Reviews dashboard.

/** The Reviews dashboard tab. A click on the band re-opens the tab when the click before
 * left it open and did not touch the tabs: the band reads it as chrome and toggles it off. */
async function openDashboard(): Promise<ExtensionView> {
  const open = handle.page.getByRole('button', { name: 'Reviews', exact: true })
  await open.click()
  return gitView(handle, 'reviews').catch(async () => {
    await open.click()
    return gitView(handle, 'reviews')
  })
}

async function choosingRepositoriesNarrowsTheQuery(): Promise<void> {
  const view = await openDashboard()
  await expect(view.getByRole('button', { name: 'Refresh' })).toBeVisible()
  const misaligned = await misalignedOn(view, 'Reviews')
  await view.getByRole('button', { name: 'All repositories, choose repositories' }).click()
  const picker = view.getByRole('dialog', { name: 'Repositories for Reviews' })
  // The check reads the page once; before the picker is drawn it would inspect nothing and pass.
  await expect(picker.getByRole('searchbox', { name: 'Search repositories' })).toBeVisible()
  misaligned.push(...(await misalignedOn(view, 'Reviews: repository picker')))
  expect(misaligned).toEqual([])
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
}

async function cloneAndReviewOpensThePullRequest(): Promise<void> {
  // Settings → Git Integration → "Clone folder for reviews", through the channel the field writes.
  await handle.page.evaluate(
    (folder) =>
      window.electronAPI.extension.updateSetting(
        'terminator.git-integration.review.cloneFolder',
        folder
      ),
    cloneFolder
  )
  const view = await openDashboard()
  const row = view.locator('.rd-row').filter({ hasText: 'Add subtract' })
  await row.getByRole('button', { name: 'Clone and review' }).click()

  const review = await popoutPage(handle, 'view=pr-review')
  await expect(review.getByRole('heading', { level: 1 })).toContainText('Add subtract', {
    timeout: 20000,
  })
  const clone = join(cloneFolder, 'widgets')
  expect(existsSync(join(clone, '.git'))).toBe(true)
  expect(git(clone, 'log', '-1', '--format=%s', 'origin/main')).toBe('initial')
  await review.close()
}

test('the Reviews dashboard is narrowed to a repository, and a pull request in it is cloned and reviewed', async () => {
  test.setTimeout(60_000)
  await runSteps([
    [
      'choosing repositories narrows what the dashboard asks GitHub for',
      choosingRepositoriesNarrowsTheQuery,
    ],
    [
      'Clone and review clones the repository and opens the pull request',
      cloneAndReviewOpensThePullRequest,
    ],
  ])
})

// The review agent, on a workspace opened through a symlink, as macOS's temporary folders are
// (/var -> /private/var): the workspace names the link, git's top level is the real path.

async function openAgentWorkspace(): Promise<void> {
  symlinkSync(repo, `${repo}-link`)
  await openRepo(handle, 'Agent Review', `${repo}-link`)
}

async function askReviewAgent(): Promise<ExtensionView> {
  const view = await openCodeReviews(handle, 'Agent Review')
  const queueOrReview = view.locator('.rd-row, [aria-label="Close review"]').first()
  await expect(queueOrReview).toBeVisible({ timeout: 15000 })
  if (await view.locator('.rd-row').first().isVisible()) {
    await view.locator('.rd-row').filter({ hasText: 'Add subtract' }).click()
    await view.getByRole('button', { name: /^(Start|Continue|Resume) review/ }).click()
  }
  await view.getByRole('button', { name: 'Ask agent about this PR' }).click()
  return view
}

const panel = (view: Pick<ExtensionView, 'getByRole'>) =>
  view.getByRole('complementary', { name: 'Agent panel' })

async function aRunningReviewContinuesInATerminal(): Promise<void> {
  const view = await askReviewAgent()
  await panel(view).getByRole('button', { name: 'Run' }).click()
  await expect(panel(view)).toContainText('Reviewing', { timeout: 15000 })

  await panel(view).getByRole('button', { name: 'Continue in terminal' }).click()
  await handle.page.locator('.branch-row').first().click()
  const tab = handle.page.locator('.tab-bar__tab').filter({ hasText: 'Review #1' })
  await expect(tab).toBeVisible({ timeout: 15000 })
  await tab.click()
  const screen = visibleTerminalScreen(handle.page)
  await expect(screen).toBeVisible({ timeout: 15000 })
  await expect
    .poll(async () => (await readTerminalRowsIn(screen)).join('\n'), { timeout: 15000 })
    .toContain('claude-stub --resume')
}

async function aRunningReviewIsCancelled(): Promise<void> {
  const view = await askReviewAgent()
  await expect(panel(view)).toContainText('Reviewing', { timeout: 15000 })
  await panel(view).getByRole('button', { name: 'Cancel' }).click()
  await expect(panel(view)).not.toContainText('Reviewing')
}

async function aFinishedReviewListsItsFinding(): Promise<ExtensionView> {
  writeFileSync(join(replyDir, 'reply.json'), JSON.stringify(REPLY))
  const view = await askReviewAgent()
  await panel(view)
    .getByRole('button', { name: /^(Run|Try again|Ask again)$/ })
    .click()
  if (await panel(view).getByRole('button', { name: 'Run' }).isVisible()) {
    await panel(view).getByRole('button', { name: 'Run' }).click()
  }
  await expect(panel(view)).toContainText('1 findings', { timeout: 20000 })
  await expect(panel(view)).toContainText('subtract swaps its operands')
  return view
}

async function aDismissedFindingStaysDismissed(): Promise<void> {
  const view = await aFinishedReviewListsItsFinding()
  await panel(view).getByRole('button', { name: 'Dismiss' }).click()
  await expect(panel(view)).toContainText('0 findings')

  await view.getByRole('button', { name: 'Close review' }).click()
  await askReviewAgent()
  await expect(panel(view)).toContainText('0 findings')
  await expect(panel(view)).not.toContainText('subtract swaps its operands')
}

test('the review agent runs on a pull request, moves to a terminal, and its dismissed finding stays dismissed', async () => {
  test.setTimeout(90_000)
  await openAgentWorkspace()
  await runSteps([
    ['a running review can be continued in a terminal', aRunningReviewContinuesInATerminal],
    ['a running review can then be cancelled', aRunningReviewIsCancelled],
    [
      'a finished review lists its finding, and a dismissed finding stays dismissed',
      aDismissedFindingStaysDismissed,
    ],
  ])
})
