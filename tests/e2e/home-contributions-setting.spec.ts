import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, closeSettingsPanel } from './helpers'
import { openExtensionSettings, settingRow } from './extension-settings-page'

// An operator switches "Show contributions on Home" off and on again in Git Integration's
// settings, and Home drops and regains its Contributions section without a reload.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

const section = () => handle.page.getByRole('region', { name: 'Contributions' })
const sectionHeight = async () => (await section().boundingBox())?.height ?? 0

async function switchShowContributions(on: boolean): Promise<void> {
  const panel = await openExtensionSettings(handle.page, 'Git Integration')
  const toggle = settingRow(panel, 'Show contributions on Home').getByRole('switch')
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(on))
  await closeSettingsPanel(handle.page)
}

test('the Contributions section follows its setting on Home', async () => {
  await expect(handle.page.getByRole('region', { name: 'Home' })).toBeVisible({ timeout: 15000 })
  await expect.poll(sectionHeight, { timeout: 15000 }).toBeGreaterThan(40)
  await handle.page.screenshot({ path: test.info().outputPath('contributions-on.png') })

  await switchShowContributions(false)
  await expect.poll(sectionHeight).toBe(0)
  await handle.page.screenshot({ path: test.info().outputPath('contributions-off.png') })

  await switchShowContributions(true)
  await expect.poll(sectionHeight).toBeGreaterThan(40)
})
