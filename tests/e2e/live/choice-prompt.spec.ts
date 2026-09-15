import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from '../helpers'

// Runs a real `claude` in the app's terminal to answer the one question no
// fixture can: what Claude Code's numbered prompts look like on screen, and
// whether a bare digit answers them. Writes the screens it saw as fixtures for
// the choice-prompt parser. Run deliberately: E2E_LIVE=1 npx playwright test tests/e2e/live/choice-prompt.spec.ts

// Playwright empties test-results before a run, so the report goes beside the system temp files.
const REPORT_DIR = join(tmpdir(), 'terminator-054-live')
mkdirSync(REPORT_DIR, { recursive: true })

let handle: AppHandle | undefined
let repo: string

// A launched agent that inherits this session's Claude environment joins the
// parent's bridge and does nothing while looking busy.
for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE')) delete process.env[key]

test.afterAll(async () => {
  await closeApp(handle)
  if (repo) rmSync(repo, { recursive: true, force: true })
})

async function visibleRows(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.terminal-pane .xterm-rows > div')].map((row) =>
      (row.textContent ?? '').replace(/\u00a0/g, ' ').trimEnd()
    )
  )
}

const hasNumberedChoice = (rows: string[]): boolean =>
  rows.some((r) => /^[\s│]*❯\s*1\.\s/.test(r)) && rows.some((r) => /^[\s│]*2\.\s/.test(r))

async function waitForChoice(page: Page): Promise<string[]> {
  let rows: string[] = []
  try {
    await expect
      .poll(async () => hasNumberedChoice((rows = await visibleRows(page))), {
        timeout: 90_000,
        intervals: [500],
      })
      .toBe(true)
  } finally {
    writeFileSync(join(REPORT_DIR, 'last-screen.txt'), rows.join('\n'))
  }
  return rows
}

test('a live Claude Code prompt is pinned on the wall and answered from its buttons', async () => {
  test.setTimeout(240_000)
  repo = mkdtempSync(join(tmpdir(), 'choice-live-'))
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Live', repo)
  await addAndSelectProject(page, 'Live', 'prompt')
  await page.locator('.terminal-pane').click()
  await page.keyboard.type(
    'claude --permission-mode default "Create a file named a.txt containing the word hi. Do nothing else."'
  )
  await page.keyboard.press('Enter')

  const outcome: Record<string, unknown> = {
    claude: execSync('claude --version').toString().trim(),
  }
  const rows = await waitForChoice(page)
  writeFileSync(
    join('tests/unit/renderer/sidebar/fixtures', 'claude-prompt-1.txt'),
    rows.join('\n') + '\n'
  )

  // Answer from the wall, the way an operator would: the session is pinned in
  // Needs you with the prompt's options as buttons.
  await page.getByRole('button', { name: 'Overview' }).click()
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible({ timeout: 15_000 })
  const choices = page.getByRole('group', { name: /Do you want to create a\.txt\?/ })
  await expect(choices).toBeVisible()
  outcome.buttons = await choices
    .getByRole('button')
    .evaluateAll((b) => b.map((x) => x.getAttribute('aria-label')))
  await choices.getByRole('button', { name: /^1\. Yes$/ }).click()
  const answered = 1
  await expect(page.getByRole('heading', { name: 'Needs you' })).toBeHidden({ timeout: 15_000 })
  await expect.poll(() => existsSync(join(repo, 'a.txt')), { timeout: 90_000 }).toBe(true)
  outcome.answered = answered
  writeFileSync(join(REPORT_DIR, 'outcome.json'), JSON.stringify(outcome, null, 2))
})
