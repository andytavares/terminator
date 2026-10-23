import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  launchApp,
  closeApp,
  createWorkspace,
  e2eTempDir,
  projectGroup,
  runQuickActionFromPanel,
  workspaceRow,
} from '../helpers'
import type { AppHandle } from '../helpers'
import { openHome, runInVisibleTerminal } from '../session-views'

// Retakes the user-guide screenshots of the Desk and Insights, with terminals on two branches
// and one agent asking a numbered question. Writes into docs/, so it is run deliberately:
//
//   npm run build
//   E2E_TOOLS=1 npx playwright test tests/e2e/tools/capture-session-home-screenshots.spec.ts

let handle: AppHandle | undefined
const DOCS = 'docs/user-guide/screenshots'

test.afterAll(async () => closeApp(handle))

// ❯ as its UTF-8 bytes in octal: typed as itself it reaches a shell with no UTF-8 locale
// (as on CI) as unknown characters, and nothing reads the prompt as a question.
const QUESTION =
  "clear; printf ' Do you want to create BoardScreen.tsx?\\n \\342\\235\\257 1. Yes\\n   2. Yes, and allow edits this session\\n   3. No\\n'"
const BUSY = 'while true; do echo "$(date +%T) 14 passed, 2 failed"; sleep 0.4; done'

/** Task Vault offers its weekly review on one weekday; move it off today so the band holds only the question. */
function profileWithoutWeeklyReview(): string {
  const profile = e2eTempDir('profile-')
  const otherDay = String((new Date().getDay() + 3) % 7)
  const values = { 'terminator.task-vault.weeklyReviewDay': otherDay }
  writeFileSync(join(profile, 'extension-settings.json'), JSON.stringify({ values }))
  return profile
}

/** A repository with one commit, so each branch the app makes reports its own name. */
function gitFolder(): string {
  const folder = e2eTempDir('home-shots-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' })
  git('init', '-q')
  git(
    '-c',
    'user.name=Demo',
    '-c',
    'user.email=demo@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'Start'
  )
  return folder
}

/** A second branch of the repository, in a worktree of its own, selected. */
async function addWorktreeBranch(page: Page, name: string): Promise<void> {
  await workspaceRow(page, 'terminator').hover()
  await workspaceRow(page, 'terminator')
    .locator('.repo-header__action[aria-label="New branch in terminator"]')
    .click()
  await page.getByPlaceholder('feature/my-feature').fill(name)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await projectGroup(page, name).click()
  await page.getByRole('textbox', { name: 'Terminal input' }).first().waitFor()
}

/** Two branches: main has an agent asking and a test run going; the other has a short job. */
async function startWork(page: Page): Promise<void> {
  await projectGroup(page, 'main').click()
  await runInVisibleTerminal(page, QUESTION)
  await page.getByRole('button', { name: 'New terminal' }).click()
  await runInVisibleTerminal(page, BUSY)
  await addWorktreeBranch(page, 'rate-limits')
  await runInVisibleTerminal(page, 'echo moving kitty keybinds to ghostty')
}

async function settleOnDesk(page: Page): Promise<void> {
  await openHome(page)
  await page.getByRole('button', { name: 'Skip today' }).click()
  await expect(page.getByRole('region', { name: 'Your move' })).toContainText(
    'Do you want to create BoardScreen.tsx?'
  )
  await expect(
    page.getByRole('region', { name: 'In flight' }).locator('[data-thread-key]')
  ).toHaveCount(2)
}

test('capture the Desk and Insights', async () => {
  handle = await launchApp(profileWithoutWeeklyReview(), {}, { hideSidebarOnHome: true })
  const { page } = handle
  await page.setViewportSize({ width: 1440, height: 900 })
  await runQuickActionFromPanel(page, 'Toggle sidebar')
  await createWorkspace(page, 'terminator', gitFolder())
  await startWork(page)
  await settleOnDesk(page)
  await page.getByRole('status').getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.screenshot({ path: join(DOCS, '11a-home-desk.png') })

  await page.getByRole('radio', { name: 'Insights' }).click()
  await expect(page.getByText('How long do agents wait on me?')).toBeVisible()
  await page.screenshot({ path: join(DOCS, '11b-home-insights.png') })
})
