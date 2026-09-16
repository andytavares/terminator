import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from '../helpers'

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
  return page.evaluate(() =>
    [...document.querySelectorAll('.terminal-pane .xterm-rows > div')]
      .map((row) => (row.textContent ?? '').split(String.fromCharCode(160)).join(' '))
      .join('\n')
  )
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

test('a real conversation is captured, ended, and brought back', async () => {
  test.setTimeout(300_000)
  folder = mkdtempSync(join(tmpdir(), 'resume-live-'))
  const report: Record<string, unknown> = {
    claude: execSync('claude --version').toString().trim(),
  }

  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Live', folder)
  await addAndSelectProject(page, 'Live', 'resume')

  // 1. A conversation, started by hand, that remembers something.
  await type(page, 'claude "remember the number 4242. reply with ok"')
  await expect.poll(() => rows(page), { timeout: 120_000 }).toContain('4242')

  // 2. Captured: the hook reported it against this terminal.
  const captured = join(handle.userDataDir, 'agent-sessions')
  await expect
    .poll(() => (existsSync(captured) ? readdirSync(captured).length : 0), { timeout: 30_000 })
    .toBeGreaterThan(0)
  const file = join(captured, readdirSync(captured)[0])
  report.captured = JSON.parse(readFileSync(file, 'utf8'))

  // 3. End it, and its terminal with it.
  await type(page, '/exit')
  await page.waitForTimeout(3000)
  await type(page, 'exit')

  // 4. Home offers to bring it back.
  await openHome(page)
  const resume = page.getByRole('button', { name: /^Resume/ }).first()
  await expect(resume).toBeVisible({ timeout: 30_000 })
  await resume.click()

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
