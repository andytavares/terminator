import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, runQuickActionFromPanel } from './helpers'
import { openOverview } from './session-views'

// Feature usage, against the running app: a screen the operator opens is counted, and the Usage
// screen, opened from Quick Actions, shows it as used. Addressed by role and name.

test('a screen the operator opens shows as used on the Usage screen', async () => {
  const handle: AppHandle = await launchApp()
  try {
    const { page } = handle
    await openOverview(page)
    await runQuickActionFromPanel(page, 'Usage')
    await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()
    const overview = page.getByRole('row', { name: /^Overview core\.overview / })
    await expect(overview.getByRole('cell', { name: 'Used', exact: true })).toBeVisible()
    await expect(overview.getByRole('cell', { name: '1', exact: true })).toBeVisible()
  } finally {
    await closeApp(handle)
  }
})
