import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  type AppHandle,
} from '../helpers'

// Retakes the user-guide screenshots of Home and the Overview wall, with a
// session in each of the four states, and records what Tab reaches on Home.
// Writes into docs/, so it is run deliberately:
//
//   E2E_TOOLS=1 npx playwright test tests/e2e/tools/capture-session-home-screenshots.spec.ts

let handle: AppHandle | undefined
const DOCS = 'docs/user-guide/screenshots'
const REVIEW = join(tmpdir(), 'terminator-054-screens')

test.afterAll(async () => closeApp(handle))

async function run(page: Page, command: string): Promise<void> {
  await page.locator('.terminal-pane').click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

async function tab(page: Page, name: string): Promise<void> {
  const entry = page.getByRole('button', { name: new RegExp(`^${name}`) })
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
}

async function describe(page: Page, group: string, text: string): Promise<void> {
  const box = page
    .getByRole('rowgroup', { name: group })
    .getByRole('textbox', { name: 'What is this session doing?' })
  await box.fill(text)
  await box.press('Enter')
}

test('capture Home and the Overview wall', async () => {
  test.setTimeout(180_000)
  mkdirSync(REVIEW, { recursive: true })
  const folder = mkdtempSync(join(tmpdir(), 'home-shots-'))
  handle = await launchApp()
  const { page } = handle
  await page.setViewportSize({ width: 1440, height: 900 })
  await createWorkspace(page, 'terminator', folder)

  await addAndSelectProject(page, 'terminator', 'session-home')
  await run(
    page,
    "clear; printf ' Do you want to create BoardScreen.tsx?\\n ❯ 1. Yes\\n   2. Yes, and allow edits this session\\n   3. No\\n'"
  )

  await addAndSelectProject(page, 'terminator', 'rate-limits')
  await run(page, 'while true; do echo "$(date +%T) 14 passed, 2 failed"; sleep 0.4; done')

  await addAndSelectProject(page, 'terminator', 'dotfiles')
  await run(page, 'echo moving kitty keybinds to ghostty')

  await addAndSelectProject(page, 'terminator', 'bundle-check')
  await run(page, 'exit')

  await tab(page, 'Home')
  await describe(
    page,
    'terminator / dotfiles',
    'Moving kitty config to Ghostty, keybinds half done'
  )
  await describe(page, 'terminator / session-home', 'Session home view, build pass')
  // State settles a moment after output stops; wait for the prompt to be read.
  await expect(
    page.getByRole('region', { name: 'Home' }).getByRole('button', { name: /Needs you/ })
  ).toContainText('1', { timeout: 15_000 })
  await page.waitForTimeout(2000)

  await page
    .getByRole('rowgroup', { name: 'terminator / session-home' })
    .getByRole('row')
    .first()
    .click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(DOCS, '11a-home-ledger.png') })

  // What Tab reaches from the filter onwards.
  await page
    .getByRole('region', { name: 'Home' })
    .getByRole('searchbox', { name: 'Filter sessions' })
    .focus()
  const reached: string[] = []
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    reached.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el) return 'none'
        const outline = getComputedStyle(el).outlineStyle
        return `${el.getAttribute('role') ?? el.tagName.toLowerCase()}: ${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)} [outline ${outline}]`
      })
    )
  }
  writeFileSync(join(REVIEW, 'home-tab-order.json'), JSON.stringify(reached, null, 2))

  await page.getByRole('radio', { name: 'Logbook' }).click()
  await page.getByRole('option', { name: /Moving kitty config/ }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(DOCS, '11b-home-logbook.png') })

  await tab(page, 'Overview')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(DOCS, '12-overview-screen.png') })

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(REVIEW, 'wall-light.png') })
  await tab(page, 'Home')
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(REVIEW, 'logbook-light.png') })
  await page.getByRole('radio', { name: 'Ledger' }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(REVIEW, 'ledger-light.png') })
})
