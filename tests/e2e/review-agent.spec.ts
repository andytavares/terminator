import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeApp,
  launchApp,
  readTerminalRowsIn,
  visibleTerminalScreen,
  type AppHandle,
} from './helpers'
import { makeRepoWithRemote, openCodeReviews, openRepo, pushBranchToOrigin } from './git-harness'
import { startGithubStub, type GithubStub } from './github-stub'
import type { ExtensionView } from './extension-page'

/** The review agent: a run cancelled, continued in a terminal, and one whose finding stays
 * dismissed. The `claude` stub (fixtures/bin/claude) idles until E2E_CLAUDE_REVIEW_REPLY
 * holds what `claude -p --output-format json` prints. */

let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string
let replyDir: string

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
  handle = await launchApp(undefined, {
    ...stub.env,
    E2E_CLAUDE_REVIEW_REPLY: join(replyDir, 'reply.json'),
  })
  // Opened through a symlink, as macOS's temporary folders are (/var -> /private/var):
  // the workspace names the link, git's top level is the real path.
  symlinkSync(repo, `${repo}-link`)
  await openRepo(handle, 'Agent Review', `${repo}-link`)
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.shutDown()
  for (const dir of [repo, `${repo}-link`, bare, replyDir]) {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

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

const panel = (view: Pick<ExtensionView, 'getByRole'>) => view.getByRole('complementary', { name: 'Agent panel' })

test('a running review can be continued in a terminal, then cancelled', async () => {
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

  const reopened = await openCodeReviews(handle, 'Agent Review')
  await panel(reopened).getByRole('button', { name: 'Cancel' }).click()
  await expect(panel(reopened)).not.toContainText('Reviewing')
})

test('a finished review lists its finding, and a dismissed finding stays dismissed', async () => {
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

  await panel(view).getByRole('button', { name: 'Dismiss' }).click()
  await expect(panel(view)).toContainText('0 findings')

  await view.getByRole('button', { name: 'Close review' }).click()
  await askReviewAgent()
  await expect(panel(view)).toContainText('0 findings')
  await expect(panel(view)).not.toContainText('subtract swaps its operands')
})
