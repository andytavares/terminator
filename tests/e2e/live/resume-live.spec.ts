import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
  terminalRows,
} from '../helpers'

// The run that proves the feature: a real Claude Code conversation, ended, then
// brought back from Home and asked what it was told before it ended.
//
//   E2E_LIVE=1 npx playwright test tests/e2e/live/resume-live.spec.ts
//
// The application installs its capture hook into the operator's own Claude
// settings — that is the feature — so this backs the file up and puts it back.

const SETTINGS = join(homedir(), '.claude', 'settings.json')
const REPORT_DIR = join(tmpdir(), 'terminator-055-live')

let handle: AppHandle | undefined
let folder: string
let settingsBackup: string | null = null

// A launched agent that inherits this session's Claude environment joins the
// parent's bridge and does nothing while looking busy.
for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE')) delete process.env[key]

test.beforeAll(() => {
  settingsBackup = existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : null
})

test.afterAll(async () => {
  await closeApp(handle)
  if (settingsBackup !== null) writeFileSync(SETTINGS, settingsBackup)
  else rmSync(SETTINGS, { force: true })
  if (folder) rmSync(folder, { recursive: true, force: true })
})

async function rows(page: Page): Promise<string> {
  return (await terminalRows(page)).join('\n')
}

async function type(page: Page, text: string): Promise<void> {
  await page.locator('.terminal-pane').first().click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

async function openHome(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: /^Home/ })
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
}

/** 1. A conversation, started by hand, that remembers something. 2. Captured:
 * the hook reported it against this terminal. Returns what the hook reported. */
async function startAndCapture(handle: AppHandle): Promise<unknown> {
  const { page } = handle
  await type(page, 'claude "remember the number 4242. reply with ok"')
  await expect.poll(() => rows(page), { timeout: 120_000 }).toContain('4242')

  const captured = join(handle.userDataDir, 'agent-sessions')
  await expect
    .poll(() => (existsSync(captured) ? readdirSync(captured).length : 0), { timeout: 30_000 })
    .toBeGreaterThan(0)
  const file = join(captured, readdirSync(captured)[0])
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** 3. Ends it, and its terminal with it. 4. Home offers to bring it back, and does. */
async function endAndResume(page: Page): Promise<void> {
  await type(page, '/exit')
  await page.waitForTimeout(3000)
  await type(page, 'exit')

  await openHome(page)
  const resume = page.getByRole('button', { name: /^Resume/ }).first()
  await expect(resume).toBeVisible({ timeout: 30_000 })
  await resume.click()
}

test('a real conversation is captured, ended, and brought back', async () => {
  test.setTimeout(300_000)
  folder = e2eTempDir('resume-live-')
  const report: Record<string, unknown> = {
    claude: execSync('claude --version').toString().trim(),
  }

  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Live', folder)
  await addAndSelectProject(page, 'Live', 'resume')

  report.captured = await startAndCapture(handle)
  await endAndResume(page)

  // 5. One terminal for the conversation: the exited one is gone.
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(1, { timeout: 30_000 })

  // 6. It remembers.
  await expect.poll(() => rows(page), { timeout: 120_000 }).toMatch(/resume|Claude Code/i)
  await page.waitForTimeout(5000)
  await type(page, 'what number did I ask you to remember? reply with digits only')
  await expect.poll(() => rows(page), { timeout: 120_000 }).toContain('4242')
  report.resumedAnswered = true

  copyFileSync(SETTINGS, join(REPORT_DIR, 'settings-after.json'))
  writeFileSync(join(REPORT_DIR, 'outcome.json'), JSON.stringify(report, null, 2))
})
