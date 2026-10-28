import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'

// "Run it as" in Start work is a radio group: the arrow keys alone choose, and one Tab stop
// reaches it. It was a div with only a click handler, so the keyboard could not use it.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('Run it as is chosen with the arrow keys alone', async () => {
  const { page } = handle
  await page.keyboard.press('ControlOrMeta+n')
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await expect(launcher).toBeVisible()
  await launcher.getByRole('tab', { name: 'Prompt' }).click()
  const choices = launcher.getByRole('radiogroup', { name: 'Run it as' })
  const first = choices.getByRole('radio').first()
  const second = choices.getByRole('radio').nth(1)
  await first.focus()
  await expect(first).toBeChecked()
  await page.keyboard.press('ArrowDown')
  await expect(second).toBeChecked()
  await expect(second).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(first).toBeChecked()
})
