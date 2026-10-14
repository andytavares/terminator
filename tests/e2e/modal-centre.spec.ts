import { test, expect } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  openSettingsSection,
  closeSettingsPanel,
  projectGroup,
} from './helpers'
import { expectCentredInWindow } from './modal-centre'

// The modals no other spec opens. Every other one is measured where its own spec opens it,
// with the same helper (ADR 110).

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'Centre', handle.userDataDir)
  await addAndSelectProject(handle.page, 'Centre', 'main')
})

test.afterAll(async () => closeApp(handle))

test('Move to branch opens in the middle of the window', async () => {
  const { page } = handle
  await page.locator('.tab-bar__tab--session').first().click({ button: 'right' })
  await page.locator('.ctx-menu__item', { hasText: 'Move to branch…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move to branch' })
  await expectCentredInWindow(dialog, 'Move to branch')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('Name this terminal opens in the middle of the window', async () => {
  const { page } = handle
  await openSettingsSection(page, 'Appearance & Terminal')
  await page.getByLabel('Prompt for session name on creation').check()
  await closeSettingsPanel(page)

  await page.keyboard.press('ControlOrMeta+t')
  const dialog = page.getByRole('dialog', { name: 'Name this terminal' })
  await expectCentredInWindow(dialog, 'Name this terminal')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(1)
})

/** Run in the page: how the focused field is painted, and the tokens it should use. */
function fieldPaint(): Record<string, string> {
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Terminal name"]')!
  const style = getComputedStyle(field)
  const swatch = document.body.appendChild(document.createElement('div'))
  const token = (name: string) => {
    swatch.style.color = `var(${name})`
    return getComputedStyle(swatch).color
  }
  return {
    background: style.backgroundColor,
    backgroundToken: token('--tm-bg-input'),
    ring: style.outlineColor,
    ringToken: token('--tm-accent-glow'),
    paddingLeft: style.paddingLeft,
  }
}

test('the terminal name field is themed before Settings has ever been opened', async () => {
  // The setting from the test above survives a restart; Settings, and its sheet, stay unloaded.
  const { userDataDir } = handle
  await closeApp(handle)
  handle = await launchApp(userDataDir)
  await projectGroup(handle.page, 'main').click()
  await handle.page.keyboard.press('ControlOrMeta+t')
  await expect(handle.page.getByRole('textbox', { name: 'Terminal name' })).toBeVisible()
  const paint = await handle.page.evaluate(fieldPaint)
  expect(paint.background).toBe(paint.backgroundToken)
  expect(paint.ring, 'the field ring, not the white app-wide one').toBe(paint.ringToken)
  expect(paint.paddingLeft, 'the text clears the edge').not.toBe('0px')
  await handle.page.keyboard.press('Escape')
})
