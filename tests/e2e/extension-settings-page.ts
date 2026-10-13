import { expect, type Locator, type Page } from '@playwright/test'
import { openSettings } from './helpers'

// An extension's own page in Settings → Extensions, opened with its ⚙ button,
// and one setting's row on it, found by the label the extension declared.

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The extension's entry in Settings → Extensions, by the name it is listed under. */
export function extensionEntry(page: Page, name: string): Locator {
  return page
    .locator('.extension-item-wrapper')
    .filter({ has: page.locator('.extension-item__name', { hasText: new RegExp(`^${name}$`) }) })
}

/** The row of the setting whose label starts with `label`. */
export function settingRow(panel: Locator, label: string): Locator {
  return panel.locator('.extension-setting-row').filter({
    has: panel.page().locator('.extension-setting-row__label', {
      hasText: new RegExp(`^${escaped(label)}`),
    }),
  })
}

/** Opens Settings on the extension's own settings page and returns its entry. */
export async function openExtensionSettings(page: Page, name: string): Promise<Locator> {
  await openSettings(page, 'Extensions')
  const entry = extensionEntry(page, name)
  if ((await entry.locator('.extension-settings-panel').count()) === 0) {
    await entry.getByTitle('Configure').click()
  }
  await expect(entry.locator('.extension-settings-panel')).toBeVisible()
  return entry
}
