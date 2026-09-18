import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'

// A click in the sidebar that opens nothing else dismisses whatever covers the
// terminal: the core Home and Overview screens, and an extension's surface.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

const bandEntry = (name: string) =>
  handle.page.locator(`.app-band__entry[aria-label="${name}"]`).first()

const clickSidebarSearch = () => handle.page.getByPlaceholder('Search…').click()

test('Home closes when the sidebar is clicked', async () => {
  const home = handle.page.getByRole('region', { name: 'Home' })
  await expect(home).toBeVisible({ timeout: 15000 })

  await clickSidebarSearch()

  await expect(home).toHaveCount(0)
})

test('Overview closes when the sidebar is clicked', async () => {
  await bandEntry('Overview').click()
  await expect(bandEntry('Overview')).toHaveAttribute('aria-current', 'page')

  await clickSidebarSearch()

  await expect(bandEntry('Overview')).not.toHaveAttribute('aria-current', 'page')
})

test('an extension closes when the sidebar is clicked', async () => {
  await bandEntry('Notes').click()
  await expect(handle.page.locator('[data-extension-panel]')).toHaveCount(1, { timeout: 10000 })

  await clickSidebarSearch()

  await expect(handle.page.locator('[data-extension-panel]')).toHaveCount(0)
})
