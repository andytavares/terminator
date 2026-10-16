import { expect, type Page } from '@playwright/test'

// The session views the Home, wall, resume and Quick Actions flows move between.

/** Shows Home, unless it already is. */
export async function openHome(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: /^Home/ })
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
}

/** Shows the Overview wall, unless it already is. */
export async function openOverview(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: /^Overview/ })
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
}

/** Waits until a terminal's input owns the keyboard: keys typed before then land on the page. */
export async function expectTerminalFocused(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
    .toBe('Terminal input')
}

/** Types `command` into the terminal on screen and runs it, without waiting for it to finish. */
export async function runInVisibleTerminal(page: Page, command: string): Promise<void> {
  await page.locator('.terminal-pane').filter({ visible: true }).click()
  await expectTerminalFocused(page)
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}
