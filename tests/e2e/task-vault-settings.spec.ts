import { test, expect, type Page } from '@playwright/test'
import { AppHandle, launchApp, closeApp, closeSettingsPanel } from './helpers'
import { invokeChannel } from './extension-page'
import { openExtensionSettings, settingRow } from './extension-settings-page'
import { goToSection, openVault, localDate } from './task-vault-harness'

// Task Vault's "Stale Task Threshold" setting, changed on its settings page and
// seen on Today: a task that has rolled over for longer is marked stale.

let handle: AppHandle
let vault: Page

test.beforeAll(async () => {
  handle = await launchApp()
  vault = await openVault(handle)
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('"Stale Task Threshold" decides when a rolled-over task is marked stale', async () => {
  await invokeChannel(vault, 'task-vault:vault:add-task', {
    filePath: `daily/${localDate(-5)}.md`,
    text: 'Book the dentist',
  })
  // Opening the vault afresh rolls the open task over to today.
  await vault.reload()
  await goToSection(vault, 'Today')
  const row = vault.locator('.daily-log__task', { hasText: 'Book the dentist' })
  // Five days is within the default seven.
  await expect(row).toBeVisible()
  await expect(row.locator('.daily-log__stale-badge')).toHaveCount(0)

  const page = await openExtensionSettings(handle.page, 'Task Vault')
  await settingRow(page, 'Stale Task Threshold (days)').locator('input').fill('3')
  await closeSettingsPanel(handle.page)

  await vault.reload()
  await goToSection(vault, 'Today')
  await expect(row.locator('.daily-log__stale-badge')).toBeVisible()
})
