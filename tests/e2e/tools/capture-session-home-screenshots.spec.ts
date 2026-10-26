import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  launchApp,
  closeApp,
  createWorkspace,
  e2eTempDir,
  profileWithoutWeeklyReview,
  runQuickActionFromPanel,
} from '../helpers'
import type { AppHandle } from '../helpers'
import { openHome, runInVisibleTerminal } from '../session-views'

// Retakes the user-guide screenshots of Home (the Tasks layout, and a task's drawer) and Insights,
// with one task across three repos and one lane asking a numbered question. Writes into docs/, so it is run deliberately:
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

const TITLE = 'Rate limits across services'
const BRANCH = 'rate-limits'
const REPOS = ['terminator', 'api-gateway', 'web-console']

/** One task across three repos, with Terminal only so no agent is needed. */
async function startTaskAcrossRepos(page: Page): Promise<void> {
  await openHome(page)
  await page.getByRole('button', { name: /^Start work/ }).click()
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await launcher.getByRole('tab', { name: 'Across repos' }).click()
  await launcher.getByRole('textbox', { name: 'Task title' }).fill(TITLE)
  await launcher.getByRole('textbox', { name: 'Branch in every repo' }).fill(BRANCH)
  await launcher.getByRole('radio', { name: 'Terminal only' }).click()
  await launcher.getByRole('button', { name: 'Start 3 lanes' }).click()
  await expect(launcher).toBeHidden()
}

/** Shows the lane of `repo` and waits until its terminal is the one on screen. */
async function showLane(page: Page, repo: string): Promise<void> {
  const lanes = page.getByRole('group', { name: `Lanes of ${TITLE}` })
  await expect(async () => {
    await lanes.getByRole('button', { name: repo }).click()
    await expect(page.locator('.tab-bar__scope')).toHaveText(`${repo} · ${BRANCH}`)
  }).toPass()
}

/** api-gateway asks a numbered question and terminator runs a test loop. */
async function startWork(page: Page): Promise<void> {
  await startTaskAcrossRepos(page)
  await showLane(page, 'api-gateway')
  await runInVisibleTerminal(page, QUESTION)
  await showLane(page, 'terminator')
  await runInVisibleTerminal(page, BUSY)
}

async function settleOnHome(page: Page): Promise<void> {
  await openHome(page)
  await expect(page.getByRole('region', { name: 'Needs you' })).toContainText(
    'Do you want to create BoardScreen.tsx?'
  )
  const row = page
    .getByRole('region', { name: 'Tasks' })
    .getByRole('button', { name: TITLE, exact: true })
  for (const repo of REPOS) await expect(row).toContainText(repo)
}

test('capture Home and Insights', async () => {
  handle = await launchApp(profileWithoutWeeklyReview(), {}, { hideSidebarOnHome: true })
  const { page } = handle
  await page.setViewportSize({ width: 1440, height: 900 })
  await runQuickActionFromPanel(page, 'Toggle sidebar')
  for (const repo of REPOS) await createWorkspace(page, repo, gitFolder())
  await startWork(page)
  await settleOnHome(page)
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.screenshot({ path: join(DOCS, '11a-home-tasks.png') })

  await page
    .getByRole('region', { name: 'Tasks' })
    .getByRole('button', { name: TITLE, exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: TITLE })).toBeVisible()
  await page.screenshot({ path: join(DOCS, '11c-home-task-drawer.png') })
  await page.keyboard.press('Escape')

  await page.getByRole('radio', { name: 'Insights' }).click()
  await expect(page.getByText('How long do agents wait on me?')).toBeVisible()
  await page.screenshot({ path: join(DOCS, '11b-home-insights.png') })
})
